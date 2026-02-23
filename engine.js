(function (global) {
  'use strict';

  // Minimal, dependency-free math core for BJ training.
  // Exposes: weightHiLo, trueCountState, bandFromTC, recommendBasic,
  // logistic edge model, Kelly sizing helpers, normalizeRank.

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

  // Hi-Lo weights (balanced, strong practical edge)
  function weightHiLo(rank) {
    if (rank === 'A' || rank === 10) return -1;
    if (rank >= 2 && rank <= 6) return 1;
    return 0;
  }

  function normalizeRank(key) {
    const k = key.toUpperCase();
    if (k === 'A') return 'A';
    if (k === 'T' || k === 'J' || k === 'Q' || k === 'K' || k === '0') return 10;
    const n = Number(k);
    if (n >= 2 && n <= 9) return n;
    return null;
  }

  function bandFromTC(tc) {
    if (tc <= -2) return 'NEGATIVE';
    if (tc < 1) return 'NEUTRAL';
    if (tc < 3) return 'POSITIVE';
    return 'HIGH';
  }

  function trueCountState(rc, cardsDealt, decks = RULES.decks) {
    const decksSeen = cardsDealt / 52;
    const remaining = Math.max(MIN_DECK_FRACTION, decks - decksSeen);
    const tc = rc / remaining;
    return { tc, decksSeen, decksRemaining: remaining, band: bandFromTC(tc) };
  }

  // Logistic edge curve to avoid linear overestimation at high TC.
  // Calibrated for 6D H17 DAS: base off-top ≈ -0.5%, slope ~0.5 per TC around 0,
  // saturates near +2.5% to +3% at extreme TC with light penetration dampener.
  function edgeLogistic(tc, decksSeen = 0, decks = RULES.decks) {
    const base = -0.5;     // off-the-top edge (%)
    const amp = 6.0;       // total swing span (%)
    const steep = 0.7;     // logistic steepness
    const logistic = 1 / (1 + Math.exp(-steep * tc));
    const raw = base + amp * (logistic - 0.5);
    const pen = Math.min(1, Math.max(0.4, decksSeen / decks || 0)); // damp early-shoe optimism
    const edged = raw * pen;
    if (edged > 5) return 5;
    if (edged < -3) return -3;
    return edged;
  }

  // Legacy linear approximation (kept for reference/back-compat)
  function edgeEstimate(tc) {
    return -0.5 + Math.max(0, tc - 1) * 0.5;
  }

  // Kelly fraction (default quarter-Kelly) for even-money payout.
  function kellyFraction(edgePct, payout = 1, cap = 0.25) {
    const edge = edgePct / 100;
    if (edge <= 0) return { frac: 0 };
    const p = 0.5 + edge / (payout + 1); // rough mapping of edge to win prob
    const q = 1 - p;
    const f = (payout * p - q) / payout;
    const clamped = Math.max(0, Math.min(cap, f));
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
    weightHiLo,
    normalizeRank,
    bandFromTC,
    trueCountState,
    edgeEstimate,
    edgeLogistic,
    kellyFraction,
    betUnits,
    recommendBasic,
    total,
    isSoft
  };
})(window);
