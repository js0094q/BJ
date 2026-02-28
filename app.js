(function () {
  'use strict';

  const Engine = window.BJEngine;

  const LOG_LIMIT = 220;
  const TAP_DEBOUNCE_MS = 45;

  const state = {
    // counting
    rc: 0,
    cardsDealt: 0,
    decksSeen: 0,
    decksRemaining: Engine.rules.decks,
    tc: 0,
    band: 'NEUTRAL',
    acesSeen: 0,
    shoeCards: [],
    edge: -0.55,
    betUnits: 1,

    // hands
    target: 'table', // player | dealer | table
    player: [],
    dealer: [],
    table: [],

    // settings/prefs
    decks: Engine.rules.decks || 6,
    countSystem: 'hilo',
    tcMode: 'sim', // sim | casino
    decksRemainingEst: 3,
    bankrollUnits: 100,
    maxKelly: 0.25,
    aceSideEnabled: false,

    // undo
    log: []
  };

  const els = {};
  const IDS = [
    // metrics
    'tcVal','rcVal','bandBadge','edgeVal','betVal','cardsDealtVal','decksRemainVal',
    // hands
    'playerCards','dealerCards','tableCards',
    // recommendation
    'actionVal','guideLine','targetVal',
    // top actions
    'nextHandBtn','resetBtn','settingsBtn',
    // settings
    'settingsBackdrop','settingsDrawer','settingsCloseBtn','settingsApplyBtn','settingsResetBtn',
    'countSystemSelect','tcModeSimBtn','tcModeCasinoBtn','decksRemainField','decksRemainRange','decksRemainReadout',
    'bankrollInput','kellySelect','aceSideField','aceSideOnBtn','aceSideOffBtn',
    // keypad
    'tapPad','tapUndo','tapTarget','tapTargetVal',
    // toast
    'toast'
  ];
  IDS.forEach((id) => { els[id] = document.getElementById(id); });

  function safeEl(id) { return els[id] || null; }

  function storage() {
    try {
      const ls = window.localStorage;
      const k = '__bj_test__';
      ls.setItem(k, '1'); ls.removeItem(k);
      return ls;
    } catch (_) {
      return window.sessionStorage;
    }
  }

  function logPush(evt) {
    if (state.log.length >= LOG_LIMIT) state.log.shift();
    state.log.push(evt);
  }

  function copyHand(h) { return h.slice(); }

  function snapshotPrefs() {
    return {
      countSystem: state.countSystem,
      tcMode: state.tcMode,
      decksRemainingEst: state.decksRemainingEst,
      bankrollUnits: state.bankrollUnits,
      maxKelly: state.maxKelly,
      aceSideEnabled: state.aceSideEnabled
    };
  }

  function recomputeShoeStats() {
    let rc = 0;
    let acesSeen = 0;

    for (const rank of state.shoeCards) {
      rc += Engine.weightFor(rank, state.countSystem);
      if (rank === 'A') acesSeen += 1;
    }

    state.rc = rc;
    state.cardsDealt = state.shoeCards.length;
    state.acesSeen = acesSeen;
  }

  function persistPrefs() {
    try {
      storage().setItem('bj_prefs', JSON.stringify(snapshotPrefs()));
    } catch (_) {}
  }

  function loadPrefs() {
    try {
      const raw = storage().getItem('bj_prefs');
      if (!raw) return;
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return;
      if (p.countSystem) state.countSystem = p.countSystem;
      if (p.tcMode) state.tcMode = p.tcMode;
      if (typeof p.decksRemainingEst === 'number') state.decksRemainingEst = p.decksRemainingEst;
      if (typeof p.bankrollUnits === 'number') state.bankrollUnits = p.bankrollUnits;
      if (typeof p.maxKelly === 'number') state.maxKelly = p.maxKelly;
      if (typeof p.aceSideEnabled === 'boolean') state.aceSideEnabled = p.aceSideEnabled;
    } catch (_) {}
  }

  function computeDerived() {
    const decksOverride = (state.tcMode === 'casino') ? state.decksRemainingEst : undefined;

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

    state.edge = Engine.edgeEstimate(state.tc, state.decksSeen, state.decks, state.countSystem);
    state.betUnits = Engine.betUnits(state.edge, state.bankrollUnits, 1, state.maxKelly).units;
  }

  function paintCards(node, cards) {
    if (!node) return;
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

  function setBandUI() {
    const b = safeEl('bandBadge');
    if (!b) return;

    b.classList.remove('band-neutral','band-positive','band-negative','band-high');
    if (state.band === 'NEGATIVE') b.classList.add('band-negative');
    else if (state.band === 'POSITIVE') b.classList.add('band-positive');
    else if (state.band === 'HIGH') b.classList.add('band-high');
    else b.classList.add('band-neutral');

    b.textContent = state.band;
  }

  function recommendation() {
    // Needs at least player and dealer upcard
    if (state.player.length < 2 || state.dealer.length < 1) {
      return {
        act: '—',
        sub: 'Enter Player (2 cards) + Dealer upcard to get guidance.'
      };
    }

    const up = state.dealer[0];
    const act = Engine.recommendBasic(state.player, up);

    const soft = Engine.isSoft(state.player);
    const tv = Engine.total(state.player);
    const upTxt = (up === 'A') ? 'A' : String(up);

    const handDesc = `${soft ? 'Soft' : 'Hard'} ${tv} vs ${upTxt}`;
    const detail = (act === 'DOUBLE') ? 'Double if allowed, else Hit' : '';
    const sub = [handDesc, '6D H17 DAS', detail].filter(Boolean).join(' · ');
    return { act, sub };
  }

  function render(force) {
    if (safeEl('rcVal')) safeEl('rcVal').textContent =
      (state.countSystem === 'wong_halves') ? state.rc.toFixed(1) : String(Math.round(state.rc));

    if (safeEl('tcVal')) safeEl('tcVal').textContent = state.tc.toFixed(2);
    if (safeEl('edgeVal')) safeEl('edgeVal').textContent = `${state.edge.toFixed(2)}%`;
    if (safeEl('betVal')) safeEl('betVal').textContent = `${state.betUnits}u`;
    if (safeEl('cardsDealtVal')) safeEl('cardsDealtVal').textContent = String(state.cardsDealt);
    if (safeEl('decksRemainVal')) safeEl('decksRemainVal').textContent = state.decksRemaining.toFixed(2);

    setBandUI();

    paintCards(safeEl('playerCards'), state.player);
    paintCards(safeEl('dealerCards'), state.dealer);
    paintCards(safeEl('tableCards'), state.table);

    const r = recommendation();
    if (safeEl('actionVal')) safeEl('actionVal').textContent = r.act;
    if (safeEl('guideLine')) safeEl('guideLine').textContent = r.sub;

    const tgt = state.target.toUpperCase();
    if (safeEl('targetVal')) safeEl('targetVal').textContent = tgt;
    if (safeEl('tapTargetVal')) safeEl('tapTargetVal').textContent = tgt;

    // Keep settings UI synced when open
    if (safeEl('settingsDrawer') && !safeEl('settingsDrawer').classList.contains('hidden')) {
      hydrateSettingsUI();
    }
  }

  function toast(msg) {
    const t = safeEl('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 700);
  }

  function applyCard(target, rank) {
    if (target === 'player') state.player.push(rank);
    else if (target === 'dealer') state.dealer.push(rank);
    else state.table.push(rank);

    state.shoeCards.push(rank);
    logPush({ type: 'ADD_CARD', target, rank });

    recomputeShoeStats();
    computeDerived();
    render(true);
  }

  function cycleTarget() {
    const next = (state.target === 'player') ? 'dealer' : (state.target === 'dealer') ? 'table' : 'player';
    logPush({ type: 'SET_TARGET', prev: state.target, next });
    state.target = next;
    render(true);
    toast(`Target → ${next.toUpperCase()}`);
  }

  function nextHand() {
    logPush({
      type: 'NEXT_HAND',
      prevPlayer: copyHand(state.player),
      prevDealer: copyHand(state.dealer),
      prevTable: copyHand(state.table),
      prevTarget: state.target
    });

    state.player.length = 0;
    state.dealer.length = 0;
    state.table.length = 0;
    state.target = 'player';

    render(true);
    toast('Next hand');
  }

  function resetShoe() {
    logPush({ type: 'RESET_SHOE' });

    state.shoeCards.length = 0;
    recomputeShoeStats();

    state.player.length = 0;
    state.dealer.length = 0;
    state.table.length = 0;

    state.target = 'table';

    computeDerived();
    render(true);
    toast('Reset shoe');
  }

  function undo() {
    const evt = state.log.pop();
    if (!evt) return;

    if (evt.type === 'ADD_CARD') {
      if (evt.target === 'player') state.player.pop();
      else if (evt.target === 'dealer') state.dealer.pop();
      else state.table.pop();

      state.shoeCards.pop();
      recomputeShoeStats();
      computeDerived();
      render(true);
      return;
    }

    if (evt.type === 'NEXT_HAND') {
      state.player = copyHand(evt.prevPlayer);
      state.dealer = copyHand(evt.prevDealer);
      state.table = copyHand(evt.prevTable);
      state.target = evt.prevTarget;
      render(true);
      toast('Undo hand reset');
      return;
    }

    if (evt.type === 'SET_TARGET') {
      state.target = evt.prev;
      render(true);
      return;
    }

    // RESET_SHOE is not reversible safely without full snapshot, so ignore.
    computeDerived();
    render(true);
  }

  // ----- Settings -----
  function openSettings() {
    safeEl('settingsBackdrop').classList.remove('hidden');
    safeEl('settingsDrawer').classList.remove('hidden');
    hydrateSettingsUI();
  }

  function closeSettings() {
    safeEl('settingsBackdrop').classList.add('hidden');
    safeEl('settingsDrawer').classList.add('hidden');
  }

  function hydrateSettingsUI() {
    if (safeEl('countSystemSelect')) safeEl('countSystemSelect').value = state.countSystem;

    if (state.tcMode === 'casino') {
      safeEl('tcModeCasinoBtn').classList.add('active');
      safeEl('tcModeSimBtn').classList.remove('active');
      safeEl('decksRemainField').classList.remove('hidden');
    } else {
      safeEl('tcModeSimBtn').classList.add('active');
      safeEl('tcModeCasinoBtn').classList.remove('active');
      safeEl('decksRemainField').classList.add('hidden');
    }

    if (safeEl('decksRemainRange')) safeEl('decksRemainRange').value = String(state.decksRemainingEst);
    if (safeEl('decksRemainReadout')) safeEl('decksRemainReadout').textContent = Number(state.decksRemainingEst).toFixed(2);

    if (safeEl('bankrollInput')) safeEl('bankrollInput').value = String(state.bankrollUnits);
    if (safeEl('kellySelect')) safeEl('kellySelect').value = String(state.maxKelly);

    // Ace side only for hiopt2
    if (state.countSystem === 'hiopt2') {
      safeEl('aceSideField').classList.remove('hidden');
    } else {
      safeEl('aceSideField').classList.add('hidden');
      state.aceSideEnabled = false;
    }

    // toggle buttons
    if (safeEl('aceSideOnBtn') && safeEl('aceSideOffBtn')) {
      safeEl('aceSideOnBtn').classList.toggle('active', !!state.aceSideEnabled);
      safeEl('aceSideOffBtn').classList.toggle('active', !state.aceSideEnabled);
    }
  }

  function applySettings() {
    logPush({ type: 'APPLY_PREFS' });

    state.countSystem = safeEl('countSystemSelect').value || 'hilo';
    state.tcMode = safeEl('tcModeCasinoBtn').classList.contains('active') ? 'casino' : 'sim';

    const dr = Number(safeEl('decksRemainRange').value || 3);
    state.decksRemainingEst = Math.max(0.25, Math.min(state.decks, dr));

    const br = Number(safeEl('bankrollInput').value || 100);
    state.bankrollUnits = Math.max(10, br);

    const kc = Number(safeEl('kellySelect').value || 0.25);
    state.maxKelly = Math.max(0.01, Math.min(1, kc));

    if (state.countSystem !== 'hiopt2') state.aceSideEnabled = false;

    persistPrefs();
    recomputeShoeStats();
    computeDerived();
    render(true);
    toast('Settings applied');
  }

  function resetPrefs() {
    logPush({ type: 'RESET_PREFS' });

    state.countSystem = 'hilo';
    state.tcMode = 'sim';
    state.decksRemainingEst = 3;
    state.bankrollUnits = 100;
    state.maxKelly = 0.25;
    state.aceSideEnabled = false;

    persistPrefs();
    recomputeShoeStats();
    computeDerived();
    render(true);
    hydrateSettingsUI();
    toast('Settings reset');
  }

  function bind() {
    // Top actions
    safeEl('nextHandBtn').addEventListener('click', nextHand);
    safeEl('resetBtn').addEventListener('click', resetShoe);
    safeEl('settingsBtn').addEventListener('click', openSettings);

    // Settings close
    safeEl('settingsCloseBtn').addEventListener('click', closeSettings);
    safeEl('settingsBackdrop').addEventListener('click', closeSettings);
    safeEl('settingsApplyBtn').addEventListener('click', applySettings);
    safeEl('settingsResetBtn').addEventListener('click', resetPrefs);

    // Settings segmented
    safeEl('tcModeSimBtn').addEventListener('click', () => {
      safeEl('tcModeSimBtn').classList.add('active');
      safeEl('tcModeCasinoBtn').classList.remove('active');
      safeEl('decksRemainField').classList.add('hidden');
    });
    safeEl('tcModeCasinoBtn').addEventListener('click', () => {
      safeEl('tcModeCasinoBtn').classList.add('active');
      safeEl('tcModeSimBtn').classList.remove('active');
      safeEl('decksRemainField').classList.remove('hidden');
    });

    safeEl('decksRemainRange').addEventListener('input', () => {
      safeEl('decksRemainReadout').textContent = Number(safeEl('decksRemainRange').value).toFixed(2);
    });

    safeEl('countSystemSelect').addEventListener('change', () => {
      // show/hide ace side field live
      const v = safeEl('countSystemSelect').value;
      if (v === 'hiopt2') safeEl('aceSideField').classList.remove('hidden');
      else safeEl('aceSideField').classList.add('hidden');
    });

    safeEl('aceSideOnBtn').addEventListener('click', () => {
      if (safeEl('countSystemSelect').value === 'hiopt2') {
        state.aceSideEnabled = true;
        hydrateSettingsUI();
      }
    });
    safeEl('aceSideOffBtn').addEventListener('click', () => {
      state.aceSideEnabled = false;
      hydrateSettingsUI();
    });

    // Keydown input
    document.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Backspace') { e.preventDefault(); undo(); return; }
      if (k === 'Enter') { e.preventDefault(); nextHand(); return; }

      const rank = Engine.normalizeRank(k);
      if (!rank) return;

      applyCard(state.target, rank);
    });

    // Tap pad input (debounced)
    let lastTapAt = 0;
    safeEl('tapPad').addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button[data-rank]');
      if (!btn) return;

      e.preventDefault();
      const now = performance.now();
      if (now - lastTapAt < TAP_DEBOUNCE_MS) return;
      lastTapAt = now;

      const rank = Engine.normalizeRank(btn.dataset.rank);
      if (!rank) return;

      applyCard(state.target, rank);
    }, { passive: false });

    safeEl('tapUndo').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      undo();
    }, { passive: false });

    safeEl('tapTarget').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cycleTarget();
    }, { passive: false });
  }

  // init
  loadPrefs();
  computeDerived();
  render(true);
  bind();
  toast('Ready');
})();
