(function () {
  'use strict';

  const Engine = window.BJEngine;
  const LOG_LIMIT = 180;
  const TAP_DEBOUNCE_MS = 45;

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

  const els = {};
  [
    'rcVal','tcVal','bandBadge','actionVal','targetVal','playerCards','dealerCards','decksSeenVal','decksRemainVal','acesSeenVal','cardsDealtVal',
    'overlay','noiseBtn','hardcoreBtn','perfBtn','overlayBtn','nextHandBtn','resetBtn','edgeToggle','btnPlayer','btnDealer','btnTable','perfHud','perfFps','perfFrames','edgeVal','betVal','guideLine','toast',
    'tapPad','tapUndo','tapTarget','tapTargetVal','countSysLabel','decksLabel','tcModeLabel','aceSidePill','aceSideLabel','aceDeltaPill','acesSeenLabel',
    'settingsBtn','settingsBackdrop','settingsDrawer','settingsCloseBtn','settingsApplyBtn','settingsResetBtn','countSystemSelect','decksSelect','tcModeSimBtn','tcModeCasinoBtn','aceSideField','aceSideOnBtn','aceSideOffBtn','decksRemainField','decksRemainRange','decksRemainReadout','bankrollInput','kellySelect'
  ].forEach((id) => { els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); els[id] = document.getElementById(id); });

  const rendered = { playerLen: -1, dealerLen: -1 };

  function storage() {
    try {
      if (window.localStorage) {
        const k = '__bj_test__'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k);
        return window.localStorage;
      }
    } catch (_) {}
    return window.sessionStorage;
  }

  function copyHand(h) { return h.slice(); }
  function logPush(evt) { if (state.log.length >= LOG_LIMIT) state.log.shift(); state.log.push(evt); }

  function snapshot() {
    return {
      rc: state.rc, cardsDealt: state.cardsDealt, acesSeen: state.acesSeen, target: state.target,
      player: copyHand(state.player), dealer: copyHand(state.dealer), overlay: state.overlay,
      hardcore: state.hardcore, showEdge: state.showEdge, decks: state.decks, countSystem: state.countSystem,
      tcMode: state.tcMode, decksRemainingEst: state.decksRemainingEst, bankrollUnits: state.bankrollUnits,
      maxKelly: state.maxKelly, aceSideEnabled: state.aceSideEnabled
    };
  }

  function restore(s) {
    Object.assign(state, {
      rc: s.rc, cardsDealt: s.cardsDealt, acesSeen: s.acesSeen, target: s.target,
      player: copyHand(s.player), dealer: copyHand(s.dealer), overlay: s.overlay, hardcore: s.hardcore,
      showEdge: s.showEdge, decks: s.decks, countSystem: s.countSystem, tcMode: s.tcMode,
      decksRemainingEst: s.decksRemainingEst, bankrollUnits: s.bankrollUnits, maxKelly: s.maxKelly,
      aceSideEnabled: s.aceSideEnabled
    });
  }

  function computeDerived() {
    const decksOverride = state.tcMode === 'casino' ? state.decksRemainingEst : undefined;
    const d = Engine.trueCountState(state.rc, state.cardsDealt, state.decks, decksOverride, {
      countSystem: state.countSystem,
      aceSideEnabled: state.aceSideEnabled,
      acesSeen: state.acesSeen
    });
    state.decksSeen = d.decksSeen;
    state.decksRemaining = d.decksRemaining;
    state.tc = d.tc;
    state.band = d.band;
    state.aceAdj = d.aceAdj;
    state.edge = Engine.edgeEstimate(state.tc);
    state.betUnits = Engine.betUnits(state.edge, state.bankrollUnits, 1, state.maxKelly).units;
  }

  function paintCards(node, cards) {
    while (node.childElementCount > cards.length) node.removeChild(node.lastElementChild);
    while (node.childElementCount < cards.length) {
      const chip = document.createElement('div');
      chip.className = 'card-chip';
      node.appendChild(chip);
    }
    for (let i = 0; i < cards.length; i++) {
      const txt = String(cards[i]);
      if (node.children[i].textContent !== txt) node.children[i].textContent = txt;
    }
  }

  function tapTargetLabel() {
    if (els.tapTargetVal) els.tapTargetVal.textContent = state.target === 'dealer' ? 'Dealer' : 'Player';
  }

  function render(force) {
    els.rcVal.textContent =
        state.countSystem === 'wong_halves'
            ? state.rc.toFixed(1)
            : String(Math.round(state.rc));

    // ---- TRUE COUNT ----
    els.tcVal.textContent = state.tc.toFixed(2);

    // 🔥 ADD THIS BLOCK RIGHT HERE
    els.tcVal.classList.remove('tc-positive', 'tc-negative', 'tc-high');

    if (state.band === 'POSITIVE') {
        els.tcVal.classList.add('tc-positive');
    } else if (state.band === 'NEGATIVE') {
        els.tcVal.classList.add('tc-negative');
    } else if (state.band === 'HIGH') {
        els.tcVal.classList.add('tc-high');
    }

    // ---- CONTINUE EXISTING CODE ----
    els.edgeVal.textContent = `${state.edge.toFixed(2)}%`;
    els.betVal.textContent = `${state.betUnits}u`;
    els.bandBadge.textContent = state.band;
    els.cardsDealtVal.textContent = String(state.cardsDealt);
    els.decksSeenVal.textContent = state.decksSeen.toFixed(2);
    els.decksRemainVal.textContent = state.decksRemaining.toFixed(2);
    els.acesSeenVal.textContent = String(state.acesSeen);
    els.targetVal.textContent = state.target.toUpperCase();
    els.countSysLabel.textContent = Engine.countSystems[state.countSystem].name;
    els.decksLabel.textContent = String(state.decks);
    els.tcModeLabel.textContent = state.tcMode.toUpperCase();
    els.aceSidePill.classList.toggle('hidden', state.countSystem !== 'hiopt2');
    els.aceDeltaPill.classList.toggle('hidden', state.countSystem !== 'hiopt2');
    els.aceSideLabel.textContent = state.aceSideEnabled ? 'ON' : 'OFF';
    els.acesSeenLabel.textContent = String(state.acesSeen);
    document.body.classList.toggle('edge-hidden', !state.showEdge);
    els.overlay.classList.toggle('hidden', !state.overlay);
}

    if (force || rendered.playerLen !== state.player.length) {
      paintCards(els.playerCards, state.player); rendered.playerLen = state.player.length;
    }
    if (force || rendered.dealerLen !== state.dealer.length) {
      paintCards(els.dealerCards, state.dealer); rendered.dealerLen = state.dealer.length;
    }

    const rec = (state.player.length && state.dealer.length) ? Engine.recommendBasic(state.player, state.dealer[0]) : '—';
    els.actionVal.textContent = rec;
    els.guideLine.textContent = rec === '—' ? 'Waiting for cards…' : `6D H17 DAS, No surrender · ${rec}`;
    tapTargetLabel();
  }

  function toast(t) {
    els.toast.textContent = t;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove('show'), 700);
  }

  function applyCard(target, rank) {
    logPush({ type: 'ADD_CARD', target, rank });
    state.cardsDealt += 1;
    state.rc += Engine.weightFor(rank, state.countSystem);
    if (rank === 'A') state.acesSeen += 1;
    if (target === 'player') state.player.push(rank);
    if (target === 'dealer') state.dealer.push(rank);
    computeDerived(); render(true);
  }

  function setTarget(next) {
    if (next === state.target) return;
    logPush({ type: 'SET_TARGET', prev: state.target, next });
    state.target = next; render(true);
  }

  function nextHand() {
    logPush({ type: 'NEXT_HAND', prevPlayer: copyHand(state.player), prevDealer: copyHand(state.dealer), prevTarget: state.target });
    state.player.length = 0; state.dealer.length = 0; state.target = 'player'; render(true);
  }

  function resetAll() {
    logPush({ type: 'RESET', prev: snapshot() });
    state.rc = 0; state.cardsDealt = 0; state.acesSeen = 0; state.player.length = 0; state.dealer.length = 0; state.target = 'table';
    state.overlay = false; state.hardcore = false; state.showEdge = true;
    computeDerived(); render(true);
  }

  function toggleOverlay() { logPush({ type: 'TOGGLE_OVERLAY', prev: state.overlay }); state.overlay = !state.overlay; persistPrefs(); render(true); }
  function toggleHardcore() { logPush({ type: 'TOGGLE_HARDCORE', prev: state.hardcore }); state.hardcore = !state.hardcore; persistPrefs(); render(true); }
  function toggleEdge() { logPush({ type: 'TOGGLE_EDGE', prev: state.showEdge }); state.showEdge = !state.showEdge; persistPrefs(); render(true); }

  function fireNoise() {
    const draws = []; const n = 6 + Math.floor(Math.random() * 8);
    const ranks = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
    for (let i = 0; i < n; i++) draws.push(ranks[Math.floor(Math.random() * ranks.length)]);
    logPush({ type: 'NOISE', draws });
    draws.forEach((r) => { state.cardsDealt += 1; state.rc += Engine.weightFor(r, state.countSystem); if (r === 'A') state.acesSeen += 1; });
    computeDerived(); render(true);
  }

  function undo() {
    const evt = state.log.pop();
    if (!evt) return;
    switch (evt.type) {
      case 'ADD_CARD':
        state.cardsDealt -= 1; state.rc -= Engine.weightFor(evt.rank, state.countSystem); if (evt.rank === 'A') state.acesSeen -= 1;
        if (evt.target === 'player') state.player.pop();
        if (evt.target === 'dealer') state.dealer.pop();
        break;
      case 'NOISE':
        for (let i = evt.draws.length - 1; i >= 0; i--) { const r = evt.draws[i]; state.cardsDealt -= 1; state.rc -= Engine.weightFor(r, state.countSystem); if (r === 'A') state.acesSeen -= 1; }
        break;
      case 'SET_TARGET': state.target = evt.prev; break;
      case 'NEXT_HAND': state.player = copyHand(evt.prevPlayer); state.dealer = copyHand(evt.prevDealer); state.target = evt.prevTarget; break;
      case 'TOGGLE_OVERLAY': state.overlay = evt.prev; break;
      case 'TOGGLE_HARDCORE': state.hardcore = evt.prev; break;
      case 'TOGGLE_EDGE': state.showEdge = evt.prev; break;
      case 'RESET':
      case 'APPLY_PREFS':
      case 'RESET_PREFS': restore(evt.prev); break;
      default: break;
    }
    computeDerived(); render(true);
  }

  function persistPrefs() {
    const data = JSON.stringify({
      overlay: state.overlay, hardcore: state.hardcore, showEdge: state.showEdge, decks: state.decks,
      countSystem: state.countSystem, tcMode: state.tcMode, decksRemainingEst: state.decksRemainingEst,
      bankrollUnits: state.bankrollUnits, maxKelly: state.maxKelly, aceSideEnabled: state.aceSideEnabled
    });
    try { storage().setItem('bj_prefs', data); } catch (_) {}
  }

  function loadPrefs() {
    try {
      const raw = storage().getItem('bj_prefs');
      if (!raw) return;
      const s = JSON.parse(raw);
      Object.assign(state, s);
    } catch (_) {}
  }

  function applySettings() {
    logPush({ type: 'APPLY_PREFS', prev: snapshot() });
    state.countSystem = els.countSystemSelect.value;
    state.decks = 6;
    state.tcMode = els.tcModeCasinoBtn.classList.contains('active') ? 'casino' : 'sim';
    state.decksRemainingEst = Math.max(0.25, Math.min(6, Number(els.decksRemainRange.value || 3)));
    state.bankrollUnits = Math.max(10, Number(els.bankrollInput.value || 100));
    state.maxKelly = Number(els.kellySelect.value || 0.25);
    if (state.countSystem !== 'hiopt2') state.aceSideEnabled = false;
    persistPrefs();
    computeDerived(); render(true);
  }

  function resetPrefs() {
    logPush({ type: 'RESET_PREFS', prev: snapshot() });
    state.decks = 6; state.countSystem = 'hilo'; state.tcMode = 'sim'; state.decksRemainingEst = 3;
    state.bankrollUnits = 100; state.maxKelly = 0.25; state.aceSideEnabled = false;
    persistPrefs(); computeDerived(); render(true);
  }

  function bind() {
    els.btnPlayer.addEventListener('click', () => setTarget('player'));
    els.btnDealer.addEventListener('click', () => setTarget('dealer'));
    els.btnTable.addEventListener('click', () => setTarget('table'));
    els.nextHandBtn.addEventListener('click', nextHand);
    els.noiseBtn.addEventListener('click', fireNoise);
    els.resetBtn.addEventListener('click', resetAll);
    els.overlayBtn.addEventListener('click', toggleOverlay);
    els.hardcoreBtn.addEventListener('click', toggleHardcore);
    els.edgeToggle.addEventListener('click', toggleEdge);

    document.querySelectorAll('.chip-btn').forEach((btn) => btn.addEventListener('click', () => {
      const rank = Engine.normalizeRank(btn.dataset.rank);
      if (rank) applyCard(state.target, rank);
    }));

    document.addEventListener('keydown', (e) => {
      const rank = Engine.normalizeRank(e.key);
      if (rank) applyCard(state.target, rank);
      if (e.key === 'Backspace') { e.preventDefault(); undo(); }
    });

    els.settingsBtn.addEventListener('click', () => { els.settingsBackdrop.classList.remove('hidden'); els.settingsDrawer.classList.remove('hidden'); });
    els.settingsCloseBtn.addEventListener('click', () => { els.settingsBackdrop.classList.add('hidden'); els.settingsDrawer.classList.add('hidden'); });
    els.settingsBackdrop.addEventListener('click', () => { els.settingsBackdrop.classList.add('hidden'); els.settingsDrawer.classList.add('hidden'); });
    els.settingsApplyBtn.addEventListener('click', applySettings);
    els.settingsResetBtn.addEventListener('click', resetPrefs);
    els.tcModeSimBtn.addEventListener('click', () => { els.tcModeSimBtn.classList.add('active'); els.tcModeCasinoBtn.classList.remove('active'); });
    els.tcModeCasinoBtn.addEventListener('click', () => { els.tcModeCasinoBtn.classList.add('active'); els.tcModeSimBtn.classList.remove('active'); });
    els.aceSideOnBtn.addEventListener('click', () => { if (state.countSystem === 'hiopt2') state.aceSideEnabled = true; render(true); });
    els.aceSideOffBtn.addEventListener('click', () => { state.aceSideEnabled = false; render(true); });

    let lastTapAt = 0;
    els.tapPad.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button[data-rank]');
      if (!btn) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastTapAt < TAP_DEBOUNCE_MS) return;
      lastTapAt = now;
      const rank = Engine.normalizeRank(btn.dataset.rank);
      if (!rank) return;
      const target = state.target === 'dealer' ? 'dealer' : 'player';
      applyCard(target, rank);
    }, { passive: false });

    els.tapUndo.addEventListener('pointerdown', (e) => { e.preventDefault(); undo(); }, { passive: false });

    els.tapTarget.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const next = state.target === 'dealer' ? 'player' : 'dealer';
      setTarget(next);
    }, { passive: false });
  }

  loadPrefs();
  computeDerived();
  render(true);
  bind();
  toast('Ready');
})();
