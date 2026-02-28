(function (global) {
  'use strict';

  // Rules tuned to your stated MyBookie live assumptions:
  // 6 decks, H17, DAS, no surrender, split limit 1, split aces 1 card.
  const RULES = {
    decks: 6,
    dealerHitsSoft17: true,
    doubleAfterSplit: true,
    splitLimit: 1,
    splitAcesOneCard: true,
    surrender: false
  };

  const MIN_DECK_FRACTION = 0.25;

  // Canonical ranks: 'A','2'..'9','T' where 'T' covers 10/J/Q/K.
  function normalizeRank(key) {
    const k = String(key ?? '').trim().toUpperCase();
    if (k === 'A') return 'A';
    if (k === '10' || k === '0' || k === 'T' || k === 'J' || k === 'Q' || k === 'K') return 'T';
    if (k.length === 1 && '23456789'.includes(k)) return k;
    return null;
  }

  function rankValue(rank) {
    const r = normalizeRank(rank);
    if (!r) return 0;
    if (r === 'A') return 11;
    if (r === 'T') return 10;
    return Number(r);
  }

  // Counting systems
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
    return r ? (sys.weights[r] ?? 0) : 0;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function bandFromTC(tc) {
    if (tc <= -2) return 'NEGATIVE';
    if (tc < 1) return 'NEUTRAL';
    if (tc < 3) return 'POSITIVE';
    return 'HIGH';
  }

  // True count:
  // - sim mode: decks remaining from cards dealt
  // - casino mode: user override decksRemainingOverride
  // - Hi-Opt II optional ace side correction (simple expected-vs-seen)
  function trueCountState(rc, cardsDealt, decks = RULES.decks, decksRemainingOverride, opts = {}) {
    const decksSeenFromCards = cardsDealt / 52;
    const computedRemaining = Math.max(MIN_DECK_FRACTION, decks - decksSeenFromCards);

    const remaining =
      (typeof decksRemainingOverride === 'number' && isFinite(decksRemainingOverride))
        ? Math.max(MIN_DECK_FRACTION, Math.min(decks, decksRemainingOverride))
        : computedRemaining;

    const decksSeen = decks - remaining;
    const countSystem = opts.countSystem || 'hilo';

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

  // Conservative EV mapping for edge/bet display (not a full sim).
  const EDGE_PARAMS = {
    hilo: { base: -0.55, slope: 0.50, capLow: -3.0, capHigh: 3.0 },
    wong_halves: { base: -0.55, slope: 0.52, capLow: -3.0, capHigh: 3.2 },
    hiopt2: { base: -0.55, slope: 0.54, capLow: -3.0, capHigh: 3.4 }
  };

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
    return { frac: clamp(f, 0, cap) };
  }

  function betUnits(edgePct, bankrollUnits = 100, payout = 1, cap = 0.25) {
    const { frac } = kellyFraction(edgePct, payout, cap);
    const units = Math.max(0, Math.round(frac * bankrollUnits * 100) / 100);
    return { frac, units };
  }

  // -------- Basic Strategy (6D H17 DAS, no surrender) --------
  // Actions: HIT | STAND | DOUBLE | SPLIT
  // DOUBLE means "double if allowed, else hit".
  function recommendBasic(player, dealerUp) {
    const up = normalizeRank(dealerUp);
    if (!up || !Array.isArray(player) || player.length < 2) return '—';

    const hand = player.map(normalizeRank).filter(Boolean);
    if (hand.length < 2) return '—';

    const canDouble = (hand.length === 2);
    const pair = (hand.length === 2 && hand[0] === hand[1]) ? hand[0] : null;

    // Pair logic first (split logic)
    if (pair) {
      const pairAct = pairDecision(pair, up);
      if (pairAct) return pairAct;
      // if null, fall through to hard/soft totals (e.g., 5,5)
    }

    if (isSoft(hand)) return softDecision(hand, up, canDouble);
    return hardDecision(total(hand), up, canDouble);
  }

  function upVal(up) {
    return up === 'A' ? 11 : (up === 'T' ? 10 : Number(up));
  }

  function total(hand) {
    let sum = 0;
    let aces = 0;
    for (const c of hand) {
      const r = normalizeRank(c);
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
    for (const c of hand) {
      const r = normalizeRank(c);
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

  function pairDecision(pairRank, dealerUp) {
    const d = upVal(dealerUp);

    // A,A always split (split aces 1 card rule is gameplay, not decision)
    if (pairRank === 'A') return 'SPLIT';

    // 8,8 always split
    if (pairRank === '8') return 'SPLIT';

    // T,T never split
    if (pairRank === 'T') return 'STAND';

    // 9,9 split vs 2-6,8-9; stand vs 7,10,A
    if (pairRank === '9') return (d === 7 || d === 10 || d === 11) ? 'STAND' : 'SPLIT';

    // 7,7 split vs 2-7 else hit
    if (pairRank === '7') return (d <= 7) ? 'SPLIT' : 'HIT';

    // 6,6 split vs 2-6 else hit
    if (pairRank === '6') return (d <= 6) ? 'SPLIT' : 'HIT';

    // 5,5 treat as hard 10
    if (pairRank === '5') return null;

    // 4,4 split vs 5-6 if DAS, else hit
    if (pairRank === '4') return (RULES.doubleAfterSplit && (d === 5 || d === 6)) ? 'SPLIT' : 'HIT';

    // 3,3 and 2,2 split vs 2-7 else hit (6D H17 DAS)
    if (pairRank === '3' || pairRank === '2') return (d <= 7) ? 'SPLIT' : 'HIT';

    return null;
  }

  function softDecision(hand, dealerUp, canDouble) {
    const d = upVal(dealerUp);
    const tv = total(hand);

    // A9/AT
    if (tv >= 20) return 'STAND';

    // A8 (soft 19): double vs 6 if allowed, else stand
    if (tv === 19) return (canDouble && d === 6) ? 'DOUBLE' : 'STAND';

    // A7 (soft 18): H17 DAS => double vs 2-6, stand vs 7-8, hit vs 9-A
    if (tv === 18) {
      if (d >= 9 || d === 11) return 'HIT';
      if (d === 7 || d === 8) return 'STAND';
      return canDouble ? 'DOUBLE' : 'STAND'; // 2-6
    }

    // A6 (soft 17): double vs 3-6 else hit
    if (tv === 17) return (canDouble && d >= 3 && d <= 6) ? 'DOUBLE' : 'HIT';

    // A5/A4 (soft 16/15): double vs 4-6 else hit
    if (tv === 16 || tv === 15) return (canDouble && d >= 4 && d <= 6) ? 'DOUBLE' : 'HIT';

    // A3/A2 (soft 14/13): double vs 5-6 else hit
    if (tv === 14 || tv === 13) return (canDouble && d >= 5 && d <= 6) ? 'DOUBLE' : 'HIT';

    return 'HIT';
  }

  function hardDecision(totalVal, dealerUp, canDouble) {
    const d = upVal(dealerUp);

    if (totalVal >= 17) return 'STAND';

    if (totalVal >= 13 && totalVal <= 16) return (d <= 6) ? 'STAND' : 'HIT';

    if (totalVal === 12) return (d >= 4 && d <= 6) ? 'STAND' : 'HIT';

    // DAS-aware doubles (hard totals)
    if (totalVal === 11) {
      // H17: 11 vs A should also be doubled; S17 keeps HIT vs A.
      if (!canDouble) return 'HIT';
      if (d === 11) return RULES.dealerHitsSoft17 ? 'DOUBLE' : 'HIT';
      return 'DOUBLE';
    }

    if (totalVal === 10) return (canDouble && d <= 9) ? 'DOUBLE' : 'HIT';

    if (totalVal === 9) return (canDouble && d >= 3 && d <= 6) ? 'DOUBLE' : 'HIT';

    return 'HIT';
  }

  global.BJEngine = {
    rules: RULES,
    minDeckFraction: MIN_DECK_FRACTION,
    countSystems: COUNT_SYSTEMS,
    normalizeRank,
    weightFor,
    trueCountState,
    bandFromTC,
    edgeEstimate,
    kellyFraction,
    betUnits,
    recommendBasic,
    total,
    isSoft
  };
})(window);
