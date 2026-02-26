(function (global) {
  'use strict';

  // BLACKJ Engine
  // Goals:
  // - Accurate, configurable counting (multiple systems)
  // - True count that supports real-world tray estimates (decks remaining override)
  // - Edge model that is conservative, monotone, and capped (avoids "fake precision")
  // - Basic strategy core (fixed for 6D H17 DAS, no surrender, split limit 1, split Aces 1 card)

  const RULES = {
    decks: 6,
    dealerHitsSoft17: true,
    blackjackPayout: '3:2',
    doubleAfterSplit: true,
    splitLimit: 1,
    splitAcesOneCard: true,
    surrender: false,
    insuranceAllowed: true
  };

  const MIN_DECK_FRACTION = 0.25; // floors division to keep TC stable late-shoe

  // --- Rank normalization ---
  // Canonical rank set: 'A','2'..'9','T' (T represents any 10-value: 10/J/Q/K)
  function normalizeRank(key) {
    const k = String(key ?? '').trim().toUpperCase();
    if (k === 'A') return 'A';
    if (k === '10' || k === '0' || k === 'T' || k === 'J' || k === 'Q' || k === 'K') return 'T';
    if ('23456789'.includes(k) && k.length === 1) return k;
    return null;
  }

  function rankValue(rank) {
    const r = normalizeRank(rank);
    if (!r) return 0;
    if (r === 'A') return 11;
    if (r === 'T') return 10;
    return Number(r);
  }

  // --- Counting systems ---
  const COUNT_SYSTEMS = {
    hilo: {
      id: 'hilo',
      name: 'Hi-Lo',
      balanced: true,
      weights: { A: -1, T: -1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0 }
    },
    wong_halves: {
      id: 'wong_halves',
      name: 'Wong Halves',
      balanced: true,
      weights: { A: -1, T: -1, 2: 0.5, 3: 1, 4: 1, 5: 1.5, 6: 1, 7: 0.5, 8: 0, 9: -0.5 }
    },
    hiopt2: {
      id: 'hiopt2',
      name: 'Hi-Opt II (Ace-neutral)',
      balanced: true,
      weights: { A: 0, T: -2, 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 0, 9: 0 }
    }
  };

  function weightFor(rank, systemId) {
    const sys = COUNT_SYSTEMS[systemId] || COUNT_SYSTEMS.hilo;
    const r = normalizeRank(rank);
    if (!r) return 0;
    return sys.weights[r] ?? 0;
  }

  // --- Bands (for UI feedback) ---
  function bandFromTC(tc) {
    if (tc <= -2) return 'NEGATIVE';
    if (tc < 1) return 'NEUTRAL';
    if (tc < 3) return 'POSITIVE';
    return 'HIGH';
  }

  // --- True Count ---
  function trueCountState(rc, cardsDealt, decks = RULES.decks, decksRemainingOverride, opts = {}) {
    const decksSeenFromCards = cardsDealt / 52;
    const computedRemaining = Math.max(MIN_DECK_FRACTION, decks - decksSeenFromCards);

    const remaining = (typeof decksRemainingOverride === 'number' && isFinite(decksRemainingOverride))
      ? Math.max(MIN_DECK_FRACTION, Math.min(decks, decksRemainingOverride))
      : computedRemaining;

    const decksSeen = decks - remaining;
    const countSystem = opts.countSystem || 'hilo';

    // Ace side count (Hi-Opt II only)
    const expectedAcesSeen = (cardsDealt * 4) / 52;
    const acesSeen = Math.max(0, Number(opts.acesSeen) || 0);
    const aceDelta = (countSystem === 'hiopt2' && opts.aceSideEnabled) ? (expectedAcesSeen - acesSeen) : 0;

    const rcEffective = rc + aceDelta;
    const tc = rcEffective / remaining;

    return {
      tc,
      decksSeen,
      decksRemaining: remaining,
      band: bandFromTC(tc),
      aceDelta,
      rcEffective,
      expectedAcesSeen
    };
  }

  // --- Edge model (conservative) ---
  const EDGE_PARAMS = {
    hilo: { base: -0.55, slope: 0.50, capLow: -3.0, capHigh: 3.0 },
    wong_halves: { base: -0.55, slope: 0.52, capLow: -3.0, capHigh: 3.2 },
    hiopt2: { base: -0.55, slope: 0.54, capLow: -3.0, capHigh: 3.4 }
  };

  function clamp(x, lo, hi) {
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
  }

  function penetrationFactor(decksSeen, decks) {
    const pen = decks > 0 ? (decksSeen / decks) : 0;
    return clamp(0.45 + 0.75 * pen, 0.45, 1.0);
  }

  function edgeEstimate(tc, decksSeen = 0, decks = RULES.decks, systemId = 'hilo') {
    const p = EDGE_PARAMS[systemId] || EDGE_PARAMS.hilo;
    const raw = p.base + p.slope * tc;
    const edged = raw * penetrationFactor(decksSeen, decks);
    return clamp(edged, p.capLow, p.capHigh);
  }

  function kellyFraction(edgePct, payout = 1, cap = 0.25) {
    const edge = edgePct / 100;
    if (edge <= 0) return { frac: 0 };
    const p = 0.5 + edge / (payout + 1);
    const q = 1 - p;
    const f = (payout * p - q) / payout;
    const clamped = clamp(f, 0, cap);
    return { frac: clamped };
  }

  function betUnits(edgePct, bankrollUnits = 100, payout = 1, cap = 0.25) {
    const { frac } = kellyFraction(edgePct, payout, cap);
    const units = Math.max(0, Math.round(frac * bankrollUnits * 100) / 100);
    return { frac, units };
  }

  // --- Basic strategy core (6D, H17, DAS, no surrender, split limit 1, split Aces 1 card) ---
  // Output actions: 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT'
  // Interpretation: 'DOUBLE' means "Double if allowed, otherwise Hit".
  function recommendBasic(player, dealerUp) {
    const up = normalizeRank(dealerUp);
    if (!up || !Array.isArray(player) || player.length < 2) return '—';

    const hand = [];
    for (let i = 0; i < player.length; i++) {
      const r = normalizeRank(player[i]);
      if (r) hand.push(r);
    }
    if (hand.length < 2) return '—';

    const canD = hand.length === 2;

    // Pairs (only meaningful at 2 cards)
    const pk = pairKey(hand);
    if (pk) {
      const act = pairDecision(pk, up);
      if (act) return act;
      // pk may be '5' which falls through to hard 10 logic
    }

    if (isSoft(hand)) return softDecision(hand, up, canD);
    return hardDecision(total(hand), up, canD);
  }

  function pairKey(hand) {
    if (!Array.isArray(hand) || hand.length !== 2) return null;
    const a = normalizeRank(hand[0]);
    const b = normalizeRank(hand[1]);
    if (!a || !b) return null;
    if (a === b) return a;
    return null;
  }

  function total(hand) {
    let sum = 0;
    let aces = 0;
    for (let i = 0; i < hand.length; i++) {
      const r = normalizeRank(hand[i]);
      if (!r) continue;
      sum += rankValue(r);
      if (r === 'A') aces += 1;
    }
    while (sum > 21 && aces > 0) {
      sum -= 10;
      aces -= 1;
    }
    return sum;
  }

  function isSoft(hand) {
    let sum = 0;
    let aces = 0;
    for (let i = 0; i < hand.length; i++) {
      const r = normalizeRank(hand[i]);
      if (!r) continue;
      sum += rankValue(r);
      if (r === 'A') aces += 1;
    }
    while (sum > 21 && aces > 0) {
      sum -= 10;
      aces -= 1;
    }
    return aces > 0;
  }

  function upVal(up) {
    return up === 'A' ? 11 : (up === 'T' ? 10 : Number(up));
  }

  function pairDecision(pairRank, dealerUp) {
    const d = upVal(dealerUp);

    // A,A always split
    if (pairRank === 'A') return 'SPLIT';

    // 8,8 always split
    if (pairRank === '8') return 'SPLIT';

    // Never split tens
    if (pairRank === 'T') return 'STAND';

    // 9,9 split vs 2-6,8-9, stand vs 7,10,A
    if (pairRank === '9') return (d === 7 || d === 10 || d === 11) ? 'STAND' : 'SPLIT';

    // 7,7 split vs 2-7
    if (pairRank === '7') return d <= 7 ? 'SPLIT' : 'HIT';

    // 6,6 split vs 2-6
    if (pairRank === '6') return d <= 6 ? 'SPLIT' : 'HIT';

    // 5,5 treat as hard 10
    if (pairRank === '5') return null;

    // 4,4 split vs 5-6 (DAS)
    if (pairRank === '4') return (RULES.doubleAfterSplit && (d === 5 || d === 6)) ? 'SPLIT' : 'HIT';

    // 3,3 and 2,2 split vs 2-7
    if (pairRank === '3' || pairRank === '2') return d <= 7 ? 'SPLIT' : 'HIT';

    return null;
  }

  function softDecision(hand, dealerUp, canDoubleNow) {
    const d = upVal(dealerUp);
    const tv = total(hand);

    if (tv >= 20) return 'STAND'; // A9, AT

    // A8 (soft 19): double vs 6 if allowed, else stand
    if (tv === 19) return (canDoubleNow && d === 6) ? 'DOUBLE' : 'STAND';

    // A7 (soft 18)
    if (tv === 18) {
      if (d >= 9 || d === 11) return 'HIT';
      if (d === 2 || d === 7 || d === 8) return 'STAND';
      return canDoubleNow ? 'DOUBLE' : 'STAND'; // 3-6
    }

    // A6 (soft 17)
    if (tv === 17) return (canDoubleNow && d >= 3 && d <= 6) ? 'DOUBLE' : 'HIT';

    // A4/A5 (soft 15/16)
    if (tv === 16 || tv === 15) return (canDoubleNow && d >= 4 && d <= 6) ? 'DOUBLE' : 'HIT';

    // A2/A3 (soft 13/14)
    if (tv === 14 || tv === 13) return (canDoubleNow && d >= 5 && d <= 6) ? 'DOUBLE' : 'HIT';

    return 'HIT';
  }

  function hardDecision(totalVal, dealerUp, canDoubleNow) {
    const d = upVal(dealerUp);

    if (totalVal >= 17) return 'STAND';
    if (totalVal >= 13 && totalVal <= 16) return d <= 6 ? 'STAND' : 'HIT';
    if (totalVal === 12) return (d >= 4 && d <= 6) ? 'STAND' : 'HIT';

    // Doubles
    if (totalVal === 11) return canDoubleNow ? 'DOUBLE' : 'HIT';
    if (totalVal === 10) return (canDoubleNow && d <= 9) ? 'DOUBLE' : 'HIT';
    if (totalVal === 9) return (canDoubleNow && d >= 3 && d <= 6) ? 'DOUBLE' : 'HIT';

    return 'HIT';
  }

  global.BJEngine = {
    rules: RULES,
    minDeckFraction: MIN_DECK_FRACTION,
    countSystems: COUNT_SYSTEMS,
    weightFor,
    normalizeRank,
    bandFromTC,
    trueCountState,
    edgeEstimate,
    kellyFraction,
    betUnits,
    recommendBasic,
    total,
    isSoft
  };
})(window);
