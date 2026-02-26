(function () {
  'use strict';

  const Engine = window.BJEngine;

  const DEFAULTS = {
    decks: Engine.rules.decks || 6,
    countSystem: 'hilo',
    tcMode: 'sim', // 'sim' or 'casino'
    decksRemainingEst: 3.0, // used in casino mode
    bankrollUnits: 100,
    maxKelly: 0.25,
    aceSideEnabled: false
  };

  const LOG_LIMIT = 120;

  const state = {
    rc: 0,
    cardsDealt: 0,
    decksSeen: 0,
    decksRemaining: DEFAULTS.decks,
    tc: 0,
    acesSeen: 0,

    edge: -0.55,
    betUnits: 0,
    betFrac: 0,
    band: 'NEUTRAL',

    target: 'table',
    player: [],
    dealer: [],

    overlay: false,
    hardcore: false,
    showEdge: true,

    // prefs
    decks: DEFAULTS.decks,
    countSystem: DEFAULTS.countSystem,
    tcMode: DEFAULTS.tcMode,
    decksRemainingEst: DEFAULTS.decksRemainingEst,
    bankrollUnits: DEFAULTS.bankrollUnits,
    maxKelly: DEFAULTS.maxKelly,
    aceSideEnabled: DEFAULTS.aceSideEnabled,

    // delta undo log
    log: []
  };

  const els = {
    rc: document.getElementById('rcVal'),
    tc: document.getElementById('tcVal'),
    band: document.getElementById('bandBadge'),
    action: document.getElementById('actionVal'),
    target: document.getElementById('targetVal'),
    playerCards: document.getElementById('playerCards'),
    dealerCards: document.getElementById('dealerCards'),
    decksSeen: document.getElementById('decksSeenVal'),
    decksRemain: document.getElementById('decksRemainVal'),
    acesSeen: document.getElementById('acesSeenVal'),
    cardsDealt: document.getElementById('cardsDealtVal'),
    overlay: document.getElementById('overlay'),
    noiseBtn: document.getElementById('noiseBtn'),
    hardcoreBtn: document.getElementById('hardcoreBtn'),
    perfBtn: document.getElementById('perfBtn'),
    overlayBtn: document.getElementById('overlayBtn'),
    nextHandBtn: document.getElementById('nextHandBtn'),
    resetBtn: document.getElementById('resetBtn'),
    edgeToggle: document.getElementById('edgeToggle'),
    btnPlayer: document.getElementById('btnPlayer'),
    btnDealer: document.getElementById('btnDealer'),
    btnTable: document.getElementById('btnTable'),
    perfHud: document.getElementById('perfHud'),
    perfFps: document.getElementById('perfFps'),
    perfFrames: document.getElementById('perfFrames'),
    edge: document.getElementById('edgeVal'),
    bet: document.getElementById('betVal'),
    guide: document.getElementById('guideLine'),
    toast: document.getElementById('toast'),

    // tap pad
    tapPad: document.getElementById('tapPad'),
    tapUndo: document.getElementById('tapUndo'),
    tapTarget: document.getElementById('tapTarget'),
    tapTargetVal: document.getElementById('tapTargetVal'),

    // mini meta
    countSysLabel: document.getElementById('countSysLabel'),
    decksLabel: document.getElementById('decksLabel'),
    tcModeLabel: document.getElementById('tcModeLabel'),
    aceSidePill: document.getElementById('aceSidePill'),
    aceSideLabel: document.getElementById('aceSideLabel'),
    aceDeltaPill: document.getElementById('aceDeltaPill'),
    acesSeenLabel: document.getElementById('acesSeenLabel'),

    // settings
    settingsBtn: document.getElementById('settingsBtn'),
    settingsBackdrop: document.getElementById('settingsBackdrop'),
    settingsDrawer: document.getElementById('settingsDrawer'),
    settingsCloseBtn: document.getElementById('settingsCloseBtn'),
    settingsApplyBtn: document.getElementById('settingsApplyBtn'),
    settingsResetBtn: document.getElementById('settingsResetBtn'),

    countSystemSelect: document.getElementById('countSystemSelect'),
    decksSelect: document.getElementById('decksSelect'),
    tcModeSimBtn: document.getElementById('tcModeSimBtn'),
    tcModeCasinoBtn: document.getElementById('tcModeCasinoBtn'),
    aceSideField: document.getElementById('aceSideField'),
    aceSideOnBtn: document.getElementById('aceSideOnBtn'),
    aceSideOffBtn: document.getElementById('aceSideOffBtn'),
    decksRemainField: document.getElementById('decksRemainField'),
    decksRemainRange: document.getElementById('decksRemainRange'),
    decksRemainReadout: document.getElementById('decksRemainReadout'),
    bankrollInput: document.getElementById('bankrollInput'),
    kellySelect: document.getElementById('kellySelect')
  };

  const rendered = {
    rc: null,
    tc: null,
    band: null,
    action: null,
    target: null,
    decksSeen: null,
    decksRemaining: null,
    cardsDealt: null,
    edge: null,
    betUnits: null,
    hardcore: null,
    overlay: null,
    showEdge: null,
    playerLen: 0,
    dealerLen: 0,
    bandClass: '',
    countSystem: null,
    decks: null,
    tcMode: null,
    aceSide: null,
    acesSeen: null,
    guide: null
  };

  // toast + perf
  let toastTimer = 0;
  let perfActive = false;
  let perfFrames = 0;
  let perfLast = performance.now();

  // -------- Delta Undo Helpers --------

  function logPush(evt) {
    if (state.log.length >= LOG_LIMIT) state.log.shift();
    state.log.push(evt);
  }

  function copyHand(hand) {
    const out = new Array(hand.length);
    for (let i = 0; i < hand.length; i++) out[i] = hand[i];
    return out;
  }

  // snapshot only for rare operations (reset, prefs reset, apply settings)
  function captureSnapshot() {
    return {
      rc: state.rc,
      cardsDealt: state.cardsDealt,
      acesSeen: state.acesSeen,
      band: state.band,
      target: state.target,
      player: copyHand(state.player),
      dealer: copyHand(state.dealer),
      overlay: state.overlay,
      hardcore: state.hardcore,
      showEdge: state.showEdge,

      decks: state.decks,
      countSystem: state.countSystem,
      tcMode: state.tcMode,
      decksRemainingEst: state.decksRemainingEst,
      bankrollUnits: state.bankrollUnits,
      maxKelly: state.maxKelly,
      aceSideEnabled: state.aceSideEnabled
    };
  }

  function restoreSnapshot(s) {
    state.rc = s.rc;
    state.cardsDealt = s.cardsDealt;
    state.acesSeen = s.acesSeen;
    state.band = s.band;
    state.target = s.target;
    state.player = copyHand(s.player);
    state.dealer = copyHand(s.dealer);
    state.overlay = s.overlay;
    state.hardcore = s.hardcore;
    state.showEdge = s.showEdge;

    state.decks = s.decks;
    state.countSystem = s.countSystem;
    state.tcMode = s.tcMode;
    state.decksRemainingEst = s.decksRemainingEst;
    state.bankrollUnits = s.bankrollUnits;
    state.maxKelly = s.maxKelly;
    state.aceSideEnabled = s.aceSideEnabled;
  }

  function undo() {
    if (!state.log.length) return;

    const evt = state.log.pop();

    switch (evt.type) {
      case 'ADD_CARD': {
        // reverse counts
        state.cardsDealt -= 1;
        state.rc -= Engine.weightFor(evt.rank, state.countSystem);
        if (evt.rank === 'A') state.acesSeen -= 1;

        // reverse hand append
        if (evt.target === 'player') state.player.pop();
        if (evt.target === 'dealer') state.dealer.pop();

        break;
      }

      case 'NOISE': {
        // reverse counts for each drawn rank
        for (let i = evt.draws.length - 1; i >= 0; i--) {
          const r = evt.draws[i];
          state.cardsDealt -= 1;
          state.rc -= Engine.weightFor(r, state.countSystem);
          if (r === 'A') state.acesSeen -= 1;
        }
        break;
      }

      case 'SET_TARGET': {
        state.target = evt.prev;
        break;
      }

      case 'NEXT_HAND': {
        state.player = copyHand(evt.prevPlayer);
        state.dealer = copyHand(evt.prevDealer);
        state.target = evt.prevTarget;
        break;
      }

      case 'TOGGLE_OVERLAY': {
        state.overlay = evt.prev;
        break;
      }

      case 'TOGGLE_HARDCORE': {
        state.hardcore = evt.prev;
        break;
      }

      case 'TOGGLE_EDGE': {
        state.showEdge = evt.prev;
        break;
      }

      case 'RESET': {
        restoreSnapshot(evt.prev);
        break;
      }

      case 'APPLY_PREFS': {
        restoreSnapshot(evt.prev);
        break;
      }

      case 'RESET_PREFS': {
        restoreSnapshot(evt.prev);
        break;
      }

      default:
        // no-op
        break;
    }

    computeDerived();
    render(true);
    toast('Undo');
  }

  // -------- Core Logic --------

  const normalizeRank = Engine.normalizeRank;

  function computeDerived() {
    const decksOverride = state.tcMode === 'casino' ? state.decksRemainingEst : undefined;

    const derived = Engine.trueCountState(
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

    state.decksSeen = derived.decksSeen;
    state.decksRemaining = derived.decksRemaining;
    state.tc = derived.tc;

    state.edge = Engine.edgeEstimate(state.tc, state.decksSeen, state.decks, state.countSystem);

    const bet = Engine.betUnits(state.edge, state.bankrollUnits, 1, state.maxKelly);
    state.betUnits = bet.units;
    state.betFrac = bet.frac;

    const nextBand = derived.band;
    if (nextBand !== state.band) triggerTCFlash();
    state.band = nextBand;
  }

  function applyCard(target, rank) {
    // event-sourced undo
    logPush({ type: 'ADD_CARD', target, rank });

    state.cardsDealt += 1;
    state.rc += Engine.weightFor(rank, state.countSystem);
    if (rank === 'A') state.acesSeen += 1;

    if (target === 'player') state.player.push(rank);
    if (target === 'dealer') state.dealer.push(rank);

    computeDerived();
    render(true);
    toast(`${target.toUpperCase()}: +${rank === 'A' ? 'A' : rank}`);
  }

  function setTarget(next) {
    if (next === state.target) return;
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
      prevTarget: state.target
    });

    state.player.length = 0;
    state.dealer.length = 0;
    state.target = 'player';
    render(true);
    toast('Next hand');
  }

  function reset() {
    logPush({ type: 'RESET', prev: captureSnapshot() });

    state.rc = 0;
    state.cardsDealt = 0;
    state.decksSeen = 0;
    state.decksRemaining = state.decks;
    state.tc = 0;
    state.acesSeen = 0;
    state.band = 'NEUTRAL';
    state.target = 'table';
    state.player.length = 0;
    state.dealer.length = 0;
    state.overlay = false;
    state.hardcore = false;
    state.showEdge = true;

    computeDerived();
    render(true);
    toast('Reset');
  }

  function randomRank() {
    const r = Math.floor(Math.random() * 13) + 1;
    if (r === 1) return 'A';
    if (r >= 10) return 10;
    return r + 1;
  }

  function fireNoise() {
    const draws = 6 + Math.floor(Math.random() * 13); // 6–18
    const drawn = [];
    for (let i = 0; i < draws; i++) drawn.push(randomRank());

    logPush({ type: 'NOISE', draws: drawn });

    for (let i = 0; i < drawn.length; i++) {
      const r = drawn[i];
      state.cardsDealt += 1;
      state.rc += Engine.weightFor(r, state.countSystem);
      if (r === 'A') state.acesSeen += 1;
    }

    computeDerived();
    render(true);
  }

  function toggleHardcore() {
    logPush({ type: 'TOGGLE_HARDCORE', prev: state.hardcore });
    state.hardcore = !state.hardcore;
    persistPrefs();
    render(true);
    toast(state.hardcore ? 'Hardcore ON' : 'Hardcore OFF');
  }

  function toggleOverlay() {
    logPush({ type: 'TOGGLE_OVERLAY', prev: state.overlay });
    state.overlay = !state.overlay;
    persistPrefs();
    render(true);
    toast(state.overlay ? 'Overlay ON' : 'Overlay OFF');
  }

  function toggleEdge() {
    logPush({ type: 'TOGGLE_EDGE', prev: state.showEdge });
    state.showEdge = !state.showEdge;
    persistPrefs();
    render(true);
    toast(state.showEdge ? 'Edge/Bet ON' : 'Edge/Bet OFF');
  }

  // -------- Recommendations (basic strategy + lightweight deviations) --------

  function recommendedAction() {
    if (!state.player.length || !state.dealer.length) return '—';
    const dealerUp = state.dealer[0];
    if (!dealerUp) return '—';
    return Engine.recommendBasic(state.player, dealerUp);
  }

  function handDescriptor() {
    if (!state.player.length || !state.dealer.length) return 'Waiting for cards…';
    const dealerUp = state.dealer[0];
    const dealerText = `Dealer ${dealerUp === 'A' ? 'A' : dealerUp}`;
    const soft = Engine.isSoft(state.player);
    const totalVal = Engine.total(state.player);
    return `${soft ? 'Soft' : 'Hard'} ${totalVal} vs ${dealerText}`;
  }

  function indexDeviationNote() {
    if (!state.player.length || !state.dealer.length) return '';
    const dealerUp = state.dealer[0];
    const tc = state.tc;
    const totalVal = Engine.total(state.player);
    const soft = Engine.isSoft(state.player);

    if (dealerUp === 'A' && tc >= 3) return 'Insurance (TC ≥ +3)';
    if (!soft && totalVal === 16 && dealerUp === 10 && tc >= 0) return 'Stand 16 vs T (TC ≥ 0)';
    if (!soft && totalVal === 15 && dealerUp === 10 && tc >= 4) return 'Stand 15 vs T (TC ≥ +4)';
    if (!soft && totalVal === 12 && dealerUp === 2 && tc >= 3) return 'Stand 12 vs 2 (TC ≥ +3)';
    if (!soft && totalVal === 12 && dealerUp === 3 && tc >= 2) return 'Stand 12 vs 3 (TC ≥ +2)';
    if (!soft && totalVal === 10 && dealerUp === 10 && state.player.length === 2 && tc >= 4) return 'Double 10 vs T (TC ≥ +4)';
    if (!soft && totalVal === 11 && dealerUp === 'A' && state.player.length === 2 && tc >= 1) return 'Double 11 vs A (TC ≥ +1)';
    if (!soft && totalVal === 9 && dealerUp === 2 && state.player.length === 2 && tc >= 1) return 'Double 9 vs 2 (TC ≥ +1)';
    if (!soft && totalVal === 9 && dealerUp === 7 && state.player.length === 2 && tc >= 3) return 'Double 9 vs 7 (TC ≥ +3)';
    return '';
  }

  function guideLineText(act) {
    if (act === '—') return 'Waiting for cards…';
    const idx = indexDeviationNote();
    return `${handDescriptor()} → ${act} (6D H17 DAS${idx ? ` • Dev: ${idx}` : ''})`;
  }

  // -------- Rendering --------

  let flashTimer = 0;
  function triggerTCFlash() {
    clearTimeout(flashTimer);
    els.tc.classList.remove('tc-flash');
    void els.tc.offsetWidth;
    els.tc.classList.add('tc-flash');
    flashTimer = setTimeout(() => els.tc.classList.remove('tc-flash'), 240);
  }

  function paintCards(node, cards) {
    if (!node) return;

    while (node.childElementCount > cards.length) node.removeChild(node.lastElementChild);
    while (node.childElementCount < cards.length) {
      const div = document.createElement('div');
      div.className = 'card-chip';
      node.appendChild(div);
    }
    for (let i = 0; i < cards.length; i++) {
      const el = node.children[i];
      const txt = String(cards[i]);
      if (el.textContent !== txt) el.textContent = txt;
    }
  }

  function highlightTargetButtons() {
    const map = { player: els.btnPlayer, dealer: els.btnDealer, table: els.btnTable };
    Object.keys(map).forEach(key => map[key]?.classList.toggle('active', state.target === key));
  }

  function render(force) {
    if (state.rc !== rendered.rc || force) {
      const fractional = state.countSystem === 'wong_halves';
      els.rc.textContent = fractional ? (Math.round(state.rc * 10) / 10).toFixed(1) : state.rc.toString();
      rendered.rc = state.rc;
    }

    const tcRounded = Math.round(state.tc * 100) / 100;
    if (tcRounded !== rendered.tc || force) {
      els.tc.textContent = tcRounded.toFixed(2);
      rendered.tc = tcRounded;
    }

    if (state.band !== rendered.band || force) {
      els.band.textContent = state.band;
      rendered.band = state.band;

      const classMap = {
        NEGATIVE: 'band-negative',
        NEUTRAL: 'band-neutral',
        POSITIVE: 'band-positive',
        HIGH: 'band-high'
      };
      if (rendered.bandClass) els.band.classList.remove(rendered.bandClass);
      const cls = classMap[state.band];
      if (cls) els.band.classList.add(cls);
      rendered.bandClass = cls;
    }

    const act = recommendedAction();
    if (act !== rendered.action || force) {
      els.action.textContent = act;
      rendered.action = act;
    }
    if (force || rendered.guide !== act) {
      els.guide.textContent = guideLineText(act);
      rendered.guide = act;
    }

    if (state.target !== rendered.target || force) {
      els.target.textContent = state.target.toUpperCase();
      highlightTargetButtons();
      rendered.target = state.target;
      tapTargetLabel();
    }

    if (state.decksSeen !== rendered.decksSeen || force) {
      els.decksSeen.textContent = state.decksSeen.toFixed(2);
      rendered.decksSeen = state.decksSeen;
    }

    if (state.decksRemaining !== rendered.decksRemaining || force) {
      els.decksRemain.textContent = state.decksRemaining.toFixed(2);
      rendered.decksRemaining = state.decksRemaining;
    }

    if (state.acesSeen !== rendered.acesSeen || force) {
      els.acesSeen.textContent = state.acesSeen.toString();
      rendered.acesSeen = state.acesSeen;
    }

    if (state.cardsDealt !== rendered.cardsDealt || force) {
      els.cardsDealt.textContent = state.cardsDealt.toString();
      rendered.cardsDealt = state.cardsDealt;
    }

    if (state.edge !== rendered.edge || force) {
      els.edge.textContent = `${state.edge.toFixed(2)}%`;
      rendered.edge = state.edge;
    }

    if (state.betUnits !== rendered.betUnits || force) {
      els.bet.textContent = state.betUnits > 0 ? `${state.betUnits}u` : '—';
      rendered.betUnits = state.betUnits;
    }

    if (state.hardcore !== rendered.hardcore || force) {
      document.body.classList.toggle('hardcore', state.hardcore);
      rendered.hardcore = state.hardcore;
    }

    if (state.overlay !== rendered.overlay || force) {
      els.overlay.classList.toggle('hidden', !state.overlay);
      rendered.overlay = state.overlay;
    }

    if (state.showEdge !== rendered.showEdge || force) {
      document.body.classList.toggle('edge-hidden', !state.showEdge);
      rendered.showEdge = state.showEdge;
    }

    if (state.player.length !== rendered.playerLen || force) {
      paintCards(els.playerCards, state.player);
      rendered.playerLen = state.player.length;
    }

    if (state.dealer.length !== rendered.dealerLen || force) {
      paintCards(els.dealerCards, state.dealer);
      rendered.dealerLen = state.dealer.length;
    }

    if (state.countSystem !== rendered.countSystem || force) {
      const sys = Engine.countSystems[state.countSystem] || Engine.countSystems.hilo;
      els.countSysLabel.textContent = sys.name;
      rendered.countSystem = state.countSystem;
    }

    if (state.decks !== rendered.decks || force) {
      els.decksLabel.textContent = String(state.decks);
      rendered.decks = state.decks;
    }

    if (state.tcMode !== rendered.tcMode || force) {
      els.tcModeLabel.textContent = state.tcMode === 'casino' ? 'CASINO' : 'SIM';
      rendered.tcMode = state.tcMode;
    }

    const showAcePills = state.countSystem === 'hiopt2';
    const aceSideActive = showAcePills && state.aceSideEnabled;
    els.aceSidePill?.classList.toggle('hidden', !showAcePills);
    els.aceDeltaPill?.classList.toggle('hidden', !showAcePills);
    if (showAcePills && (aceSideActive !== rendered.aceSide || force)) {
      els.aceSideLabel.textContent = aceSideActive ? 'ON' : 'OFF';
      rendered.aceSide = aceSideActive;
    }
    if (showAcePills && (rendered.acesSeen !== state.acesSeen || force)) {
      els.acesSeenLabel.textContent = state.acesSeen.toString();
    }

    perfTick();
  }

  // -------- Toast + Perf --------

  function toast(msg) {
    if (!els.toast) return;
    clearTimeout(toastTimer);
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 900);
  }

  function togglePerf() {
    perfActive = !perfActive;
    els.perfHud.classList.toggle('hidden', !perfActive);
    perfFrames = 0;
    perfLast = performance.now();
    toast(perfActive ? 'Perf HUD ON' : 'Perf HUD OFF');
  }

  function perfTick() {
    if (!perfActive) return;
    perfFrames += 1;
    const now = performance.now();
    const dt = now - perfLast;
    if (dt >= 500) {
      const fps = Math.round((perfFrames / dt) * 1000);
      els.perfFps.textContent = `fps ${fps}`;
      els.perfFrames.textContent = `frames ${perfFrames}`;
      perfFrames = 0;
      perfLast = now;
    }
  }

  // -------- Settings + Prefs --------

  function openSettings() {
    els.settingsBackdrop.classList.remove('hidden');
    els.settingsDrawer.classList.remove('hidden');
    els.settingsDrawer.setAttribute('aria-hidden', 'false');
    hydrateSettingsUI();
  }

  function closeSettings() {
    els.settingsBackdrop.classList.add('hidden');
    els.settingsDrawer.classList.add('hidden');
    els.settingsDrawer.setAttribute('aria-hidden', 'true');
  }

  function clampNumber(x, lo, hi) {
    if (!isFinite(x)) return lo;
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
  }

  function persistPrefs() {
    try {
      const store = window.localStorage || window.sessionStorage;
      store.setItem('bj_state_prefs', JSON.stringify({
        hardcore: state.hardcore,
        overlay: state.overlay,
        showEdge: state.showEdge,
        decks: state.decks,
        countSystem: state.countSystem,
        tcMode: state.tcMode,
        decksRemainingEst: state.decksRemainingEst,
        bankrollUnits: state.bankrollUnits,
        maxKelly: state.maxKelly,
        aceSideEnabled: state.aceSideEnabled
      }));
    } catch (_) {}
  }

  function loadPersisted() {
    try {
      const store = window.localStorage || window.sessionStorage;
      const raw = store.getItem('bj_state_prefs');
      if (!raw) return;
      const saved = JSON.parse(raw);

      if (typeof saved.hardcore === 'boolean') state.hardcore = saved.hardcore;
      if (typeof saved.overlay === 'boolean') state.overlay = saved.overlay;
      if (typeof saved.showEdge === 'boolean') state.showEdge = saved.showEdge;

      if (typeof saved.decks === 'number') state.decks = saved.decks;
      if (typeof saved.countSystem === 'string') state.countSystem = saved.countSystem;
      if (typeof saved.tcMode === 'string') state.tcMode = saved.tcMode;
      if (typeof saved.decksRemainingEst === 'number') state.decksRemainingEst = saved.decksRemainingEst;
      if (typeof saved.bankrollUnits === 'number') state.bankrollUnits = saved.bankrollUnits;
      if (typeof saved.maxKelly === 'number') state.maxKelly = saved.maxKelly;
      if (typeof saved.aceSideEnabled === 'boolean') state.aceSideEnabled = saved.aceSideEnabled;
    } catch (_) {}
  }

  function setTcModeUI(mode) {
    els.tcModeSimBtn.classList.toggle('active', mode === 'sim');
    els.tcModeCasinoBtn.classList.toggle('active', mode === 'casino');
  }

  function syncDecksRemainFieldVisibility() {
    const show = state.tcMode === 'casino';
    els.decksRemainField.classList.toggle('hidden', !show);
  }

  function setAceSideUI(enabled) {
    els.aceSideOnBtn?.classList.toggle('active', !!enabled);
    els.aceSideOffBtn?.classList.toggle('active', !enabled);
  }

  function syncAceSideVisibility(selectedSystem, mutateState = true) {
    const sys = selectedSystem || state.countSystem;
    const isHiOpt = sys === 'hiopt2';
    els.aceSideField.classList.toggle('hidden', !isHiOpt);
    if (!isHiOpt && mutateState) {
      state.aceSideEnabled = false;
      setAceSideUI(false);
    }
  }

  function hydrateSettingsUI() {
    els.countSystemSelect.value = state.countSystem;
    els.decksSelect.value = String(state.decks);
    els.bankrollInput.value = String(state.bankrollUnits);
    els.kellySelect.value = String(state.maxKelly);
    setAceSideUI(state.aceSideEnabled);

    setTcModeUI(state.tcMode);
    els.decksRemainRange.max = String(Math.max(8, state.decks));
    els.decksRemainRange.value = String(clampNumber(state.decksRemainingEst, 0.25, Number(els.decksRemainRange.max)));
    els.decksRemainReadout.textContent = Number(els.decksRemainRange.value).toFixed(2);
    syncDecksRemainFieldVisibility();
    syncAceSideVisibility();
  }

  function applySettings() {
    logPush({ type: 'APPLY_PREFS', prev: captureSnapshot() });

    state.countSystem = els.countSystemSelect.value;
    state.decks = Number(els.decksSelect.value) || DEFAULTS.decks;

    state.bankrollUnits = Math.max(1, Math.floor(Number(els.bankrollInput.value) || DEFAULTS.bankrollUnits));
    state.maxKelly = Number(els.kellySelect.value) || DEFAULTS.maxKelly;

    const rangeMax = Math.max(8, state.decks);
    els.decksRemainRange.max = String(rangeMax);

    state.decksRemainingEst = clampNumber(Number(els.decksRemainRange.value), 0.25, state.decks);

    const aceSideEnabled = state.countSystem === 'hiopt2'
      && els.aceSideOnBtn
      && els.aceSideOnBtn.classList.contains('active');

    state.aceSideEnabled = aceSideEnabled;
    setAceSideUI(state.aceSideEnabled);
    syncAceSideVisibility();

    persistPrefs();
    computeDerived();
    render(true);
    closeSettings();
    toast('Settings applied');
  }

  function resetPrefs() {
    logPush({ type: 'RESET_PREFS', prev: captureSnapshot() });

    state.decks = DEFAULTS.decks;
    state.countSystem = DEFAULTS.countSystem;
    state.tcMode = DEFAULTS.tcMode;
    state.decksRemainingEst = DEFAULTS.decksRemainingEst;
    state.bankrollUnits = DEFAULTS.bankrollUnits;
    state.maxKelly = DEFAULTS.maxKelly;
    state.aceSideEnabled = DEFAULTS.aceSideEnabled;

    persistPrefs();
    computeDerived();
    render(true);
    hydrateSettingsUI();
    toast('Prefs reset');
  }

  // -------- Inputs --------

  function handleKey(e) {
    const { key } = e;

    if (key === 'Backspace') { e.preventDefault(); undo(); return; }
    if (key === 'x' || key === 'X') { e.preventDefault(); reset(); return; }
    if (key === 'Enter') { e.preventDefault(); nextHand(); return; }
    if (key === 'o' || key === 'O') { e.preventDefault(); toggleOverlay(); return; }
    if (key === 'e' || key === 'E') { e.preventDefault(); toggleEdge(); return; }
    if (key === 'f' || key === 'F') { e.preventDefault(); togglePerf(); return; }
    if (key === 'n' || key === 'N') { e.preventDefault(); fireNoise(); return; }
    if (key === 'm' || key === 'M') { e.preventDefault(); toggleHardcore(); return; }
    if (key === 's' || key === 'S') {
      e.preventDefault();
      if (els.settingsDrawer.classList.contains('hidden')) openSettings();
      else closeSettings();
      return;
    }
    if (key === 'p' || key === 'P') { e.preventDefault(); setTarget('player'); return; }
    if (key === 'd' || key === 'D') { e.preventDefault(); setTarget('dealer'); return; }
    if (key === 'b' || key === 'B') { e.preventDefault(); setTarget('table'); return; }

    const rank = normalizeRank(key);
    if (rank) applyCard(state.target, rank);
  }

  // Tap pad
  const TAP_DEBOUNCE_MS = 45;
  let lastTapAt = 0;

  function tapTargetLabel() {
    const t = state.target === 'dealer' ? 'Dealer' : 'Player';
    if (els.tapTargetVal) els.tapTargetVal.textContent = t;
  }

  function tapAddRank(rank) {
    const now = performance.now();
    if (now - lastTapAt < TAP_DEBOUNCE_MS) return;
    lastTapAt = now;

    const r = normalizeRank(rank);
    if (!r) return;

    const t = state.target === 'dealer' ? 'dealer' : 'player';
    applyCard(t, r);
    tapTargetLabel();
  }

  function initTapPad() {
    if (!els.tapPad) return;

    els.tapPad.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button[data-rank]');
      if (!btn) return;
      e.preventDefault();
      const r = btn.dataset.rank;
      tapAddRank(r === '10' ? 'T' : r);
    }, { passive: false });

    els.tapUndo?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      undo();
      tapTargetLabel();
    }, { passive: false });

    els.tapTarget?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.target = (state.target === 'dealer') ? 'player' : 'dealer';
      tapTargetLabel();
      render(true);
    }, { passive: false });

    tapTargetLabel();
  }

  // -------- Bindings --------

  function bindControls() {
    els.noiseBtn.addEventListener('click', fireNoise, { passive: true });
    els.hardcoreBtn.addEventListener('click', toggleHardcore, { passive: true });
    els.perfBtn.addEventListener('click', togglePerf, { passive: true });
    els.overlayBtn.addEventListener('click', toggleOverlay, { passive: true });
    els.nextHandBtn.addEventListener('click', nextHand, { passive: true });
    els.resetBtn.addEventListener('click', reset, { passive: true });
    els.edgeToggle.addEventListener('click', toggleEdge, { passive: true });

    els.btnPlayer.addEventListener('click', () => setTarget('player'), { passive: true });
    els.btnDealer.addEventListener('click', () => setTarget('dealer'), { passive: true });
    els.btnTable.addEventListener('click', () => setTarget('table'), { passive: true });

    document.querySelectorAll('.card-buttons .chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const raw = btn.getAttribute('data-rank');
        const rank = raw === 'A' ? 'A' : Number(raw);
        applyCard(state.target, rank);
      }, { passive: true });
    });

    // settings controls
    els.settingsBtn.addEventListener('click', openSettings, { passive: true });
    els.settingsBackdrop.addEventListener('click', closeSettings, { passive: true });
    els.settingsCloseBtn.addEventListener('click', closeSettings, { passive: true });
    els.settingsApplyBtn.addEventListener('click', applySettings, { passive: true });
    els.settingsResetBtn.addEventListener('click', resetPrefs, { passive: true });

    els.countSystemSelect?.addEventListener('change', () => {
      const selected = els.countSystemSelect.value;
      syncAceSideVisibility(selected, false);
      setAceSideUI(selected === 'hiopt2' ? state.aceSideEnabled : false);
    }, { passive: true });

    els.aceSideOnBtn?.addEventListener('click', () => {
      if (state.countSystem !== 'hiopt2') return;
      logPush({ type: 'APPLY_PREFS', prev: captureSnapshot() });
      state.aceSideEnabled = true;
      setAceSideUI(true);
      persistPrefs();
      computeDerived();
      render(true);
      toast('Ace side ON');
    }, { passive: true });

    els.aceSideOffBtn?.addEventListener('click', () => {
      logPush({ type: 'APPLY_PREFS', prev: captureSnapshot() });
      state.aceSideEnabled = false;
      setAceSideUI(false);
      persistPrefs();
      computeDerived();
      render(true);
      toast('Ace side OFF');
    }, { passive: true });

    els.tcModeSimBtn.addEventListener('click', () => {
      logPush({ type: 'APPLY_PREFS', prev: captureSnapshot() });
      state.tcMode = 'sim';
      persistPrefs();
      syncDecksRemainFieldVisibility();
      computeDerived();
      render(true);
      setTcModeUI(state.tcMode);
      toast('TC mode: SIM');
    }, { passive: true });

    els.tcModeCasinoBtn.addEventListener('click', () => {
      logPush({ type: 'APPLY_PREFS', prev: captureSnapshot() });
      state.tcMode = 'casino';
      persistPrefs();
      syncDecksRemainFieldVisibility();
      computeDerived();
      render(true);
      setTcModeUI(state.tcMode);
      toast('TC mode: CASINO');
    }, { passive: true });

    els.decksRemainRange.addEventListener('input', () => {
      const v = Number(els.decksRemainRange.value);
      els.decksRemainReadout.textContent = v.toFixed(2);

      // log as prefs change because it changes TC live in casino mode
      logPush({ type: 'APPLY_PREFS', prev: captureSnapshot() });

      state.decksRemainingEst = clampNumber(v, 0.25, state.decks);
      if (state.tcMode === 'casino') {
        computeDerived();
        render(true);
      }
      persistPrefs();
    }, { passive: true });

    document.addEventListener('keydown', handleKey, false);
  }

  // -------- init --------

  bindControls();
  loadPersisted();
  syncAceSideVisibility();
  computeDerived();
  render(true);
  initTapPad();

  function rafLoop() {
    perfTick();
    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);
})();
