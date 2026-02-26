(function () {
  'use strict';

  const Engine = window.BJEngine;
  const LOG_LIMIT = 180;
  const TAP_DEBOUNCE_MS = 45;

  /* ================= STATE ================= */

  const state = {
    rc: 0,
    cardsDealt: 0,
    decksSeen: 0,
    decksRemaining: Engine.rules.decks,
    tc: 0,
    aceAdj: 0,
    acesSeen: 0,
    edge: -0.55,
    betUnits: 1,
    band: 'NEUTRAL',
    target: 'table',
    player: [],
    dealer: [],
    overlay: false,
    hardcore: false,
    showEdge: true,
    decks: 6,
    countSystem: 'hilo',
    tcMode: 'sim',
    decksRemainingEst: 3,
    bankrollUnits: 100,
    maxKelly: 0.25,
    aceSideEnabled: false,
    log: []
  };

  /* ================= DOM ================= */

  const els = {};
  document.querySelectorAll('[id]').forEach(el => {
    els[el.id] = el;
  });

  /* ================= UTIL ================= */

  function copyHand(h) {
    return h.slice();
  }

  function logPush(evt) {
    if (state.log.length >= LOG_LIMIT) state.log.shift();
    state.log.push(evt);
  }

  function storage() {
    try {
      localStorage.setItem('_t','1');
      localStorage.removeItem('_t');
      return localStorage;
    } catch (_) {
      return sessionStorage;
    }
  }

  /* ================= ENGINE ================= */

  function computeDerived() {
    const decksOverride =
      state.tcMode === 'casino' ? state.decksRemainingEst : undefined;

    const d = Engine.trueCountState(
      state.rc,
      state.cardsDealt,
      state.decks,
      decksOverride,
      {
        countSystem: state.countSystem,
        aceSideEnabled: state.aceSideEnabled,
        acesSeen: state.acesSeen
      }
    );

    state.decksSeen = d.decksSeen;
    state.decksRemaining = d.decksRemaining;
    state.tc = d.tc;
    state.band = d.band;
    state.aceAdj = d.aceAdj;
    state.edge = Engine.edgeEstimate(state.tc);
    state.betUnits =
      Engine.betUnits(state.edge, state.bankrollUnits, 1, state.maxKelly).units;
  }

  /* ================= RENDER ================= */

  function render() {

    if (els.rcVal)
      els.rcVal.textContent =
        state.countSystem === 'wong_halves'
          ? state.rc.toFixed(1)
          : String(Math.round(state.rc));

    if (els.tcVal) {
      els.tcVal.textContent = state.tc.toFixed(2);

      els.tcVal.classList.remove('tc-positive','tc-negative','tc-high');

      if (state.band === 'POSITIVE')
        els.tcVal.classList.add('tc-positive');
      else if (state.band === 'NEGATIVE')
        els.tcVal.classList.add('tc-negative');
      else if (state.band === 'HIGH')
        els.tcVal.classList.add('tc-high');
    }

    if (els.edgeVal)
      els.edgeVal.textContent = state.edge.toFixed(2) + "%";

    if (els.betVal)
      els.betVal.textContent = state.betUnits + "u";

    if (els.bandBadge)
      els.bandBadge.textContent = state.band;

    if (els.cardsDealtVal)
      els.cardsDealtVal.textContent = state.cardsDealt;

    if (els.decksSeenVal)
      els.decksSeenVal.textContent = state.decksSeen.toFixed(2);

    if (els.decksRemainVal)
      els.decksRemainVal.textContent = state.decksRemaining.toFixed(2);

    if (els.acesSeenVal)
      els.acesSeenVal.textContent = state.acesSeen;

    if (els.targetVal)
      els.targetVal.textContent = state.target.toUpperCase();

    if (els.playerCards)
      paintCards(els.playerCards, state.player);

    if (els.dealerCards)
      paintCards(els.dealerCards, state.dealer);

    if (els.actionVal) {
      const rec =
        state.player.length && state.dealer.length
          ? Engine.recommendBasic(state.player, state.dealer[0])
          : '—';

      els.actionVal.textContent = rec;
    }

    if (els.guideLine) {
      els.guideLine.textContent =
        state.player.length && state.dealer.length
          ? `6D H17 DAS · ${els.actionVal.textContent}`
          : 'Waiting for cards…';
    }

    document.body.classList.toggle('edge-hidden', !state.showEdge);
  }

  function paintCards(node, cards) {
    node.innerHTML = '';
    cards.forEach(card => {
      const chip = document.createElement('div');
      chip.className = 'card-chip';
      chip.textContent = card;
      node.appendChild(chip);
    });
  }

  /* ================= GAME ACTIONS ================= */

  function applyCard(target, rank) {
    logPush({ type: 'ADD_CARD', target, rank });

    state.cardsDealt += 1;
    state.rc += Engine.weightFor(rank, state.countSystem);
    if (rank === 'A') state.acesSeen += 1;

    if (target === 'player') state.player.push(rank);
    if (target === 'dealer') state.dealer.push(rank);

    computeDerived();
    render();
  }

  function undo() {
    const evt = state.log.pop();
    if (!evt) return;

    if (evt.type === 'ADD_CARD') {
      state.cardsDealt -= 1;
      state.rc -= Engine.weightFor(evt.rank, state.countSystem);
      if (evt.rank === 'A') state.acesSeen -= 1;
      if (evt.target === 'player') state.player.pop();
      if (evt.target === 'dealer') state.dealer.pop();
    }

    computeDerived();
    render();
  }

  function setTarget(next) {
    state.target = next;
    render();
  }

  function resetAll() {
    state.rc = 0;
    state.cardsDealt = 0;
    state.acesSeen = 0;
    state.player = [];
    state.dealer = [];
    state.target = 'table';
    computeDerived();
    render();
  }

  /* ================= INPUT ================= */

  function bind() {

    let lastTap = 0;

    if (els.tapPad) {
      els.tapPad.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('button[data-rank]');
        if (!btn) return;

        const now = performance.now();
        if (now - lastTap < TAP_DEBOUNCE_MS) return;
        lastTap = now;

        const rank = Engine.normalizeRank(btn.dataset.rank);
        if (!rank) return;

        const target =
          state.target === 'dealer' ? 'dealer' : 'player';

        applyCard(target, rank);
      }, { passive: true });
    }

    if (els.tapUndo)
      els.tapUndo.addEventListener('click', undo);

    if (els.tapTarget)
      els.tapTarget.addEventListener('click', () =>
        setTarget(state.target === 'dealer' ? 'player' : 'dealer')
      );

    document.addEventListener('keydown', (e) => {
      const rank = Engine.normalizeRank(e.key);
      if (rank) applyCard(state.target, rank);
      if (e.key === 'Backspace') undo();
    });
  }

  /* ================= INIT ================= */

  computeDerived();
  render();
  bind();

})();
