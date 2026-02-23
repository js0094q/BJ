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
  function normalizeRank(key) {
    const k = String(key).toUpperCase();
    if (k === 'A') return 'A';
    if (k === 'T' || k === 'J' || k === 'Q' || k === 'K' || k === '0') return 10;
    const n = Number(k);
    if (n >= 2 && n <= 9) return n;
    return null;
  }

  // --- Counting systems ---
  // Notes:
  // - We expose fractional RC for Wong Halves.
  // - For Hi-Opt II, we keep the *main count* only (Ace-neutral).
  //   (A true "Hi-Opt II + Ace side count" is more accurate but adds complexity.)
  const COUNT_SYSTEMS = {
    hilo: {
      id: 'hilo',
      name: 'Hi-Lo',
      balanced: true,
      weights: { A: -1, 10: -1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0 }
    },
    wong_halves: {
      id: 'wong_halves',
      name: 'Wong Halves',
      balanced: true,
      weights: { A: -1, 10: -1, 2: 0.5, 3: 1, 4: 1, 5: 1.5, 6: 1, 7: 0.5, 8: 0, 9: -0.5 }
    },
    hiopt2: {
      id: 'hiopt2',
      name: 'Hi-Opt II (Ace-neutral)',
      balanced: true,
      weights: { A: 0, 10: -2, 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 0, 9: 0 }
    }
  };

  function weightFor(rank, systemId) {
    const sys = COUNT_SYSTEMS[systemId] || COUNT_SYSTEMS.hilo;
    if (rank === 'A') return sys.weights.A;
    if (rank === 10) return sys.weights[10];
    return sys.weights[rank] || 0;
  }

  // --- Bands (for UI feedback) ---
  function bandFromTC(tc) {
    if (tc <= -2) return 'NEGATIVE';
    if (tc < 1) return 'NEUTRAL';
    if (tc < 3) return 'POSITIVE';
    return 'HIGH';
  }

  // --- True Count ---
  // Supports two modes:
  // 1) Computed remaining decks from cards dealt (sim mode)
  // 2) User-estimated decks remaining override (casino mode)
  function trueCountState(rc, cardsDealt, decks = RULES.decks, decksRemainingOverride) {
    const decksSeenFromCards = cardsDealt / 52;
    const computedRemaining = Math.max(MIN_DECK_FRACTION, decks - decksSeenFromCards);

    const remaining = (typeof decksRemainingOverride === 'number' && isFinite(decksRemainingOverride))
      ? Math.max(MIN_DECK_FRACTION, Math.min(decks, decksRemainingOverride))
      : computedRemaining;

    const decksSeen = decks - remaining;
    const tc = rc / remaining;
    return { tc, decksSeen, decksRemaining: remaining, band: bandFromTC(tc) };
  }

  // --- Edge model ---
  // We intentionally keep this conservative.
  // It is *not* a simulator, it is a monotone mapping from TC to EV (%),
  // damped early shoe and capped to avoid overconfidence.
  //
  // Defaults tuned around typical 6D H17 DAS for practical betting ramps.
  // Count systems are normalized so Hi-Lo TC=+1 roughly matches +0.5% swing per TC near 0.
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

  // Penetration dampener: avoid overstating edge off the top.
  function penetrationFactor(decksSeen, decks) {
    const pen = decks > 0 ? (decksSeen / decks) : 0;
    // start damped, approach 1 as shoe progresses
    return clamp(0.45 + 0.75 * pen, 0.45, 1.0);
  }

  function edgeEstimate(tc, decksSeen = 0, decks = RULES.decks, systemId = 'hilo') {
    const p = EDGE_PARAMS[systemId] || EDGE_PARAMS.hilo;
    const raw = p.base + p.slope * tc;
    const edged = raw * penetrationFactor(decksSeen, decks);
    return clamp(edged, p.capLow, p.capHigh);
  }

  // Kelly fraction (default quarter-Kelly) for even-money payout.
  function kellyFraction(edgePct, payout = 1, cap = 0.25) {
    const edge = edgePct / 100;
    if (edge <= 0) return { frac: 0 };
    // very rough mapping: converts EV to a win-prob delta on even-money bets
    const p = 0.5 + edge / (payout + 1);
    const q = 1 - p;
    const f = (payout * p - q) / payout;
    const clamped = clamp(f, 0, cap);
    return { frac: clamped };
  }

  // Bet units recommendation given bankroll in base units.
  function betUnits(edgePct, bankrollUnits = 100, payout = 1, cap = 0.25) {
    const { frac } = kellyFraction(edgePct, payout, cap);
    const units = Math.max(0, Math.round(frac * bankrollUnits * 100) / 100);
    return { frac, units };
  }

  // --- Basic strategy core (6D, H17, DAS, no surrender, split limit 1, split Aces 1 card) ---
  function recommendBasic(player, dealerUp) {
    if (!player || player.length === 0 || dealerUp === undefined) return '—';
    const canDouble = player.length === 2;
    const canSplit = player.length === 2 && valueEq(player[0], player[1]);

    if (canSplit) {
      const pairAct = pairDecision(player[0], dealerUp);
      if (pairAct) return pairAct;
    }
    if (isSoft(player)) return softDecision(player, dealerUp, canDouble);
    return hardDecision(total(player), dealerUp, canDouble);
  }

  function cardVal(rank) {
    return rank === 'A' ? 11 : rank;
  }

  function valueEq(a, b) {
    return (a === 'A' && b === 'A') || (a !== 'A' && b !== 'A' && cardVal(a) === cardVal(b));
  }

  function total(hand) {
    let sum = 0;
    let aces = 0;
    for (let i = 0; i < hand.length; i++) {
      const v = hand[i] === 'A' ? 11 : hand[i];
      sum += v;
      if (hand[i] === 'A') aces += 1;
    }
    while (sum > 21 && aces) {
      sum -= 10;
      aces -= 1;
    }
    return sum;
  }

  function isSoft(hand) {
    let sum = 0;
    let aces = 0;
    for (let i = 0; i < hand.length; i++) {
      const v = hand[i] === 'A' ? 11 : hand[i];
      sum += v;
      if (hand[i] === 'A') aces += 1;
    }
    return aces > 0 && sum <= 21;
  }

  function pairDecision(rank, dealerUp) {
    const d = dealerUp === 'A' ? 11 : dealerUp;
    const r = rank === 'A' ? 11 : rank;

    if (r === 11) return 'SPLIT'; // A,A always
    if (r === 8) return 'SPLIT';
    if (r === 10) return null; // never split tens
    if (r === 9) return (d === 7 || d === 10 || d === 11) ? 'STAND' : 'SPLIT';
    if (r === 7) return d <= 7 ? 'SPLIT' : 'HIT';
    if (r === 6) return d <= 6 ? 'SPLIT' : 'HIT';
    if (r === 5) return null; // treat as hard 10
    if (r === 4) return d === 5 || d === 6 ? 'SPLIT' : 'HIT';
    if (r === 3 || r === 2) return d <= 7 ? 'SPLIT' : 'HIT';
    return null;
  }

  function softDecision(hand, dealerUp, canDouble) {
    const d = dealerUp === 'A' ? 11 : dealerUp;
    const totalVal = total(hand);

    if (totalVal >= 20) return 'STAND';
    if (totalVal === 19) return d === 6 && canDouble ? 'DOUBLE' : 'STAND';
    if (totalVal === 18) {
      if (d >= 9 || d === 11) return 'HIT';
      if (d === 2 || d === 7 || d === 8) return 'STAND';
      return canDouble ? 'DOUBLE' : 'STAND';
    }
    if (totalVal === 17) return d >= 3 && d <= 6 && canDouble ? 'DOUBLE' : 'HIT';
    if (totalVal === 16 || totalVal === 15) return d >= 4 && d <= 6 && canDouble ? 'DOUBLE' : 'HIT';
    if (totalVal === 14 || totalVal === 13) return d >= 5 && d <= 6 && canDouble ? 'DOUBLE' : 'HIT';
    return 'HIT';
  }

  function hardDecision(totalVal, dealerUp, canDouble) {
    const d = dealerUp === 'A' ? 11 : dealerUp;
    if (totalVal >= 17) return 'STAND';
    if (totalVal >= 13 && totalVal <= 16) return d <= 6 ? 'STAND' : 'HIT';
    if (totalVal === 12) return d >= 4 && d <= 6 ? 'STAND' : 'HIT';
    if (totalVal === 11) return canDouble ? 'DOUBLE' : 'HIT';
    if (totalVal === 10) return d <= 9 && canDouble ? 'DOUBLE' : 'HIT';
    if (totalVal === 9) return d >= 3 && d <= 6 && canDouble ? 'DOUBLE' : 'HIT';
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
