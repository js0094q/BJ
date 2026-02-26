(function () {
  'use strict';

  const HI_OPT2_ACE_SIDE_MULT = 2;

  const rules = {
    decks: 6,
    dealerHitsSoft17: true,
    das: true,
    splitLimit: 1,
    splitAcesOneCard: true,
    surrender: false,
    insurance: true
  };

  const countSystems = {
    hilo: {
      name: 'Hi-Lo',
      weights: { A: -1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, T: -1, J: -1, Q: -1, K: -1 }
    },
    wong_halves: {
      name: 'Wong Halves',
      weights: { A: -1, 2: 0.5, 3: 1, 4: 1, 5: 1.5, 6: 1, 7: 0.5, 8: 0, 9: -0.5, T: -1, J: -1, Q: -1, K: -1 }
    },
    hiopt2: {
      name: 'Hi-Opt II',
      weights: { A: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 0, 9: 0, T: -2, J: -2, Q: -2, K: -2 }
    }
  };

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function normalizeRank(rank) {
    const raw = String(rank || '').trim().toUpperCase();
    if (raw === '10') return 'T';
    if ('A23456789TJQK'.includes(raw) && raw.length === 1) return raw;
    return null;
  }

  function rankValue(rank) {
    const r = normalizeRank(rank);
    if (!r) return 0;
    if (r === 'A') return 11;
    if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
    return Number(r);
  }

  function total(cards) {
    let sum = 0;
    let aces = 0;
    for (let i = 0; i < cards.length; i++) {
      const r = normalizeRank(cards[i]);
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

  function isSoft(cards) {
    let sum = 0;
    let aces = 0;
    for (let i = 0; i < cards.length; i++) {
      const r = normalizeRank(cards[i]);
      if (!r) continue;
      if (r === 'A') {
        sum += 11;
        aces += 1;
      } else {
        sum += rankValue(r);
      }
    }
    while (sum > 21 && aces > 0) {
      sum -= 10;
      aces -= 1;
    }
    return aces > 0;
  }

  function weightFor(rank, system) {
    const r = normalizeRank(rank);
    if (!r) return 0;
    const sys = countSystems[system] || countSystems.hilo;
    return sys.weights[r] || 0;
  }

  function trueCountState(rc, cardsDealt, decks, decksRemainingOverride, options) {
    const system = (options && options.countSystem) || 'hilo';
    const totalCards = decks * 52;
    const dealt = clamp(cardsDealt, 0, totalCards);
    const decksSeen = dealt / 52;

    const decksRemaining = Number.isFinite(decksRemainingOverride)
      ? clamp(decksRemainingOverride, 0.25, decks)
      : clamp((totalCards - dealt) / 52, 0.25, decks);

    let aceAdj = 0;
    if (system === 'hiopt2' && options && options.aceSideEnabled) {
      const expectedAcesSeen = dealt * (4 / 52);
      const acesSeen = Number(options.acesSeen || 0);
      aceAdj = (expectedAcesSeen - acesSeen) * HI_OPT2_ACE_SIDE_MULT;
    }

    const rcEffective = rc + aceAdj;
    const tc = rcEffective / decksRemaining;

    let band = 'NEUTRAL';
    if (tc >= 4) band = 'HIGH';
    else if (tc >= 1) band = 'POSITIVE';
    else if (tc <= -1) band = 'NEGATIVE';

    return {
      decksSeen,
      decksRemaining,
      tc,
      band,
      aceAdj,
      rcEffective
    };
  }

  function edgeEstimate(tc) {
    const e = -0.55 + (0.5 * tc);
    return clamp(e, -2.5, 3.5);
  }

  function betUnits(edgePct, bankrollUnits, minUnits, maxKelly) {
    const edge = edgePct / 100;
    if (edge <= 0) return { units: minUnits, frac: 0 };
    const variance = 1.3;
    const frac = clamp(edge / variance, 0, maxKelly || 0.25);
    const units = Math.max(minUnits || 1, Math.round(bankrollUnits * frac));
    return { units, frac };
  }

  function recommendBasic(player, dealerUp) {
    const up = normalizeRank(dealerUp);
    if (!up || player.length < 2) return '—';

    const t = total(player);
    const soft = isSoft(player);

    if (!soft && t >= 17) return 'S';
    if (!soft && t <= 8) return 'H';
    if (!soft && t >= 13 && t <= 16) {
      return ['2', '3', '4', '5', '6'].includes(up) ? 'S' : 'H';
    }
    if (!soft && t === 12) {
      return ['4', '5', '6'].includes(up) ? 'S' : 'H';
    }
    if (!soft && t === 11) return 'D';
    if (!soft && t === 10) return ['T', 'J', 'Q', 'K', 'A'].includes(up) ? 'H' : 'D';
    if (!soft && t === 9) return ['3', '4', '5', '6'].includes(up) ? 'D' : 'H';

    if (soft && t >= 19) return 'S';
    if (soft && t === 18) return ['9', 'T', 'J', 'Q', 'K', 'A'].includes(up) ? 'H' : 'S';
    return 'H';
  }

  window.BJEngine = {
    rules,
    countSystems,
    normalizeRank,
    weightFor,
    trueCountState,
    edgeEstimate,
    betUnits,
    total,
    isSoft,
    recommendBasic,
    HI_OPT2_ACE_SIDE_MULT
  };
})();
