(function () {
  'use strict';

  const Engine = window.BJEngine;

  // Defaults (overridable via Settings)
  const DEFAULTS = {
    decks: Engine.rules.decks || 6,
    countSystem: 'hilo',
    tcMode: 'sim', // 'sim' or 'casino'
    decksRemainingEst: 3.0, // used in casino mode
    bankrollUnits: 100,
    maxKelly: 0.25
  };

  const LOG_LIMIT = 50;

  // State (mutable by design)
  const state = {
    // counting state
    rc: 0,
    cardsDealt: 0,
    decksSeen: 0,
    decksRemaining: DEFAULTS.decks,
    tc: 0,

    // model outputs
    edge: -0.55,
    betUnits: 0,
    betFrac: 0,
    band: 'NEUTRAL',

    // hand state
    target: 'table',
    player: [],
    dealer: [],

    // ui state
    overlay: false,
    hardcore: false,
    showEdge: true,
    log: [],

    // prefs
    decks: DEFAULTS.decks,
    countSystem: DEFAULTS.countSystem,
    tcMode: DEFAULTS.tcMode,
    decksRemainingEst: DEFAULTS.decksRemainingEst,
    bankrollUnits: DEFAULTS.bankrollUnits,
    maxKelly: DEFAULTS.maxKelly
  };

  // Cached DOM refs
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

    // mini meta
    countSysLabel: document.getElementById('countSysLabel'),
    decksLabel: document.getElementById('decksLabel'),
    tcModeLabel: document.getElementById('tcModeLabel'),

    // settings ui
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
    decksRemainField: document.getElementById('decksRemainField'),
    decksRemainRange: document.getElementById('decksRemainRange'),
    decksRemainReadout: document.getElementById('decksRemainReadout'),
    bankrollInput: document.getElementById('bankrollInput'),
    kellySelect: document.getElementById('kellySelect')
  };

  // Render cache to avoid redundant writes
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
    tcMode: null
  };

  // Toast timer
  let toastTimer = 0;

  // Perf HUD
  let perfActive = false;
  let perfFrames = 0;
  let perfLast = performance.now();

  function copyHand(hand) {
    const out = new Array(hand.length);
    for (let i = 0; i < hand.length; i++) out[i] = hand[i];
    return out;
  }

  function snapshot() {
    return {
      rc: state.rc,
      cardsDealt: state.cardsDealt,
      decksSeen: state.decksSeen,
      decksRemaining: state.decksRemaining,
      tc: state.tc,
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
      maxKelly: state.maxKelly
    };
  }

  function pushUndo() {
    if (state.log.length >= LOG_LIMIT) state.log.shift();
    state.log.push(snapshot());
  }

  function undo() {
    if (!state.log.length) return;
    const prev = state.log.pop();

    Object.keys(prev).forEach(k => {
      if (k === 'player' || k === 'dealer') return;
      state[k] = prev[k];
    });
    state.player = copyHand(prev.player);
    state.dealer = copyHand(prev.dealer);

    computeDerived();
    render(true);
    toast('Undo');
  }

  function reset() {
    pushUndo();
    state.rc = 0;
    state.cardsDealt = 0;
    state.decksSeen = 0;
    state.decksRemaining = state.decks;
    state.tc = 0;
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

  function nextHand() {
    pushUndo();
    state.player.length = 0;
    state.dealer.length = 0;
    state.target = 'player';
    render(true);
    toast('Next hand');
  }

  // Counting
  const normalizeRank = Engine.normalizeRank;

  function applyCard(target, rank) {
    pushUndo();
    state.cardsDealt += 1;
    state.rc += Engine.weightFor(rank, state.countSystem);

    if (target === 'player') {
      state.player[state.player.length] = rank;
    } else if (target === 'dealer') {
      state.dealer[state.dealer.length] = rank;
    }

    computeDerived();
    render(true);
    toast(`${target.toUpperCase()}: +${rank === 'A' ? 'A' : rank}`);
  }

  function computeDerived() {
    const decksOverride = state.tcMode === 'casino' ? state.decksRemainingEst : undefined;
    const derived = Engine.trueCountState(state.rc, state.cardsDealt, state.decks, decksOverride);

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

  // Visual flash when band changes
  let flashTimer = 0;
  function triggerTCFlash() {
    clearTimeout(flashTimer);
    els.tc.classList.remove('tc-flash');
    void els.tc.offsetWidth;
    els.tc.classList.add('tc-flash');
    flashTimer = setTimeout(() => {
      els.tc.classList.remove('tc-flash');
    }, 240);
  }

  // Noise mode: inject random cards (counts only)
  function fireNoise() {
    pushUndo();
    const draws = 6 + Math.floor(Math.random() * 13); // 6–18
    for (let i = 0; i < draws; i++) {
      const r = randomRank();
      state.cardsDealt += 1;
      state.rc += Engine.weightFor(r, state.countSystem);
    }
    computeDerived();
    render(true);
  }

  function randomRank() {
    const r = Math.floor(Math.random() * 13) + 1; // 1-13 where 1 is Ace
    if (r === 1) return 'A';
    if (r >= 10) return 10;
    return r + 1; // 2-9
  }

  function setTarget(next) {
    if (next === state.target) return;
    pushUndo();
    state.target = next;
    render(true);
    toast(`Target → ${next.toUpperCase()}`);
  }

  function toggleHardcore() {
    pushUndo();
    state.hardcore = !state.hardcore;
    persistPrefs();
    render(true);
    toast(state.hardcore ? 'Hardcore ON' : 'Hardcore OFF');
  }

  function toggleOverlay() {
    pushUndo();
    state.overlay = !state.overlay;
    persistPrefs();
    render(true);
    toast(state.overlay ? 'Overlay ON' : 'Overlay OFF');
  }

  function toggleEdge() {
    pushUndo();
    state.showEdge = !state.showEdge;
    persistPrefs();
    render(true);
    toast(state.showEdge ? 'Edge/Bet ON' : 'Edge/Bet OFF');
  }

  // Action recommendation (basic strategy)
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
    if (state.player.length === 2 && Engine.isSoft(state.player) && Engine.total(state.player) === 21) {
      return `Blackjack vs ${dealerText}`;
    }
    const canSplit = state.player.length === 2 && Engine.total([state.player[0]]) === Engine.total([state.player[1]]);
    if (canSplit) return `Pair ${state.player[0]}s vs ${dealerText}`;
    const soft = Engine.isSoft(state.player);
    const totalVal = Engine.total(state.player);
    return `${soft ? 'Soft' : 'Hard'} ${totalVal} vs ${dealerText}`;
  }

  // More complete (still lightweight) deviation hints for 6D H17 (training only)
  function indexDeviationNote() {
    if (!state.player.length || !state.dealer.length) return '';
    const dealerUp = state.dealer[0];
    const tc = state.tc;
    const totalVal = Engine.total(state.player);
    const soft = Engine.isSoft(state.player);

    // Insurance (common threshold)
    if (dealerUp === 'A' && tc >= 3) return 'Insurance (TC ≥ +3)';

    // Core stand/hit vs T (common training set)
    if (!soft && totalVal === 16 && dealerUp === 10 && tc >= 0) return 'Stand 16 vs T (TC ≥ 0)';
    if (!soft && totalVal === 15 && dealerUp === 10 && tc >= 4) return 'Stand 15 vs T (TC ≥ +4)';

    // 12 v 2/3
    if (!soft && totalVal === 12 && dealerUp === 2 && tc >= 3) return 'Stand 12 vs 2 (TC ≥ +3)';
    if (!soft && totalVal === 12 && dealerUp === 3 && tc >= 2) return 'Stand 12 vs 3 (TC ≥ +2)';

    // Doubles
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

  // Render: only touch DOM when changed
  function render(force) {
    if (state.rc !== rendered.rc || force) {
      // show one decimal if fractional count system used
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
    }

    if (state.decksSeen !== rendered.decksSeen || force) {
      els.decksSeen.textContent = state.decksSeen.toFixed(2);
      rendered.decksSeen = state.decksSeen;
    }

    if (state.decksRemaining !== rendered.decksRemaining || force) {
      els.decksRemain.textContent = state.decksRemaining.toFixed(2);
      rendered.decksRemaining = state.decksRemaining;
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
      const units = state.betUnits;
      els.bet.textContent = units > 0 ? `${units}u` : '—';
      rendered.betUnits = units;
    }

    // Deviation highlight based on band
    els.action.classList.toggle('deviation-hot', state.band === 'HIGH');
    els.action.classList.toggle('deviation-cool', state.band === 'NEGATIVE');

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

    // mini meta
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

    perfTick();
  }

  function paintCards(node, cards) {
    node.innerHTML = '';
    for (let i = 0; i < cards.length; i++) {
      const div = document.createElement('div');
      div.className = 'card-chip';
      div.textContent = cards[i];
      node.appendChild(div);
    }
  }

  function highlightTargetButtons() {
    const map = { player: els.btnPlayer, dealer: els.btnDealer, table: els.btnTable };
    Object.keys(map).forEach(key => {
      const btn = map[key];
      if (btn) btn.classList.toggle('active', state.target === key);
    });
  }

  // Perf HUD
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

  function toast(msg) {
    if (!els.toast) return;
    clearTimeout(toastTimer);
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 900);
  }

  // --- Settings ---
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

  function hydrateSettingsUI() {
    els.countSystemSelect.value = state.countSystem;
    els.decksSelect.value = String(state.decks);
    els.bankrollInput.value = String(state.bankrollUnits);
    els.kellySelect.value = String(state.maxKelly);

    setTcModeUI(state.tcMode);
    els.decksRemainRange.max = String(Math.max(8, state.decks));
    els.decksRemainRange.value = String(clampNumber(state.decksRemainingEst, 0.25, Number(els.decksRemainRange.max)));
    els.decksRemainReadout.textContent = Number(els.decksRemainRange.value).toFixed(2);
    syncDecksRemainFieldVisibility();
  }

  function setTcModeUI(mode) {
    els.tcModeSimBtn.classList.toggle('active', mode === 'sim');
    els.tcModeCasinoBtn.classList.toggle('active', mode === 'casino');
  }

  function syncDecksRemainFieldVisibility() {
    const show = state.tcMode === 'casino';
    els.decksRemainField.classList.toggle('hidden', !show);
  }

  function applySettings() {
    pushUndo();

    state.countSystem = els.countSystemSelect.value;
    state.decks = Number(els.decksSelect.value) || DEFAULTS.decks;

    state.bankrollUnits = Math.max(1, Math.floor(Number(els.bankrollInput.value) || DEFAULTS.bankrollUnits));
    state.maxKelly = Number(els.kellySelect.value) || DEFAULTS.maxKelly;

    const rangeMax = Math.max(8, state.decks);
    els.decksRemainRange.max = String(rangeMax);

    // decks remaining estimate should never exceed decks
    state.decksRemainingEst = clampNumber(Number(els.decksRemainRange.value), 0.25, state.decks);

    persistPrefs();
    computeDerived();
    render(true);

    closeSettings();
    toast('Settings applied');
  }

  function resetPrefs() {
    pushUndo();
    state.decks = DEFAULTS.decks;
    state.countSystem = DEFAULTS.countSystem;
    state.tcMode = DEFAULTS.tcMode;
    state.decksRemainingEst = DEFAULTS.decksRemainingEst;
    state.bankrollUnits = DEFAULTS.bankrollUnits;
    state.maxKelly = DEFAULTS.maxKelly;
    persistPrefs();
    computeDerived();
    render(true);
    hydrateSettingsUI();
    toast('Prefs reset');
  }

  function persistPrefs() {
    try {
      sessionStorage.setItem('bj_state_prefs', JSON.stringify({
        hardcore: state.hardcore,
        overlay: state.overlay,
        showEdge: state.showEdge,
        decks: state.decks,
        countSystem: state.countSystem,
        tcMode: state.tcMode,
        decksRemainingEst: state.decksRemainingEst,
        bankrollUnits: state.bankrollUnits,
        maxKelly: state.maxKelly
      }));
    } catch (_) {
      /* ignore */
    }
  }

  function loadPersisted() {
    try {
      const raw = sessionStorage.getItem('bj_state_prefs');
      if (!raw) return;
      const saved = JSON.parse(raw);

      if (typeof saved.hardcore === 'boolean') state.hardcore = saved.hardcore;
      if (typeof saved.overlay === 'boolean') state.overlay = saved.overlay;
      if (typeof saved.showEdge === 'boolean') state.showEdge = saved.showEdge;

      if (typeof saved.decks === 'number' && isFinite(saved.decks)) state.decks = saved.decks;
      if (typeof saved.countSystem === 'string' && Engine.countSystems[saved.countSystem]) state.countSystem = saved.countSystem;
      if (saved.tcMode === 'sim' || saved.tcMode === 'casino') state.tcMode = saved.tcMode;
      if (typeof saved.decksRemainingEst === 'number' && isFinite(saved.decksRemainingEst)) state.decksRemainingEst = saved.decksRemainingEst;
      if (typeof saved.bankrollUnits === 'number' && isFinite(saved.bankrollUnits)) state.bankrollUnits = Math.max(1, Math.floor(saved.bankrollUnits));
      if (typeof saved.maxKelly === 'number' && isFinite(saved.maxKelly)) state.maxKelly = saved.maxKelly;
    } catch (_) {
      /* ignore */
    }
  }

  function clampNumber(n, lo, hi) {
    if (!isFinite(n)) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  // Input handling
  function handleKey(e) {
    const { key } = e;

    if (key === 'Backspace') {
      e.preventDefault();
      undo();
      return;
    }
    if (key === 'x' || key === 'X') {
      e.preventDefault();
      reset();
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      nextHand();
      return;
    }
    if (key === 'o' || key === 'O') {
      e.preventDefault();
      toggleOverlay();
      return;
    }
    if (key === 'e' || key === 'E') {
      e.preventDefault();
      toggleEdge();
      return;
    }
    if (key === 'f' || key === 'F') {
      e.preventDefault();
      togglePerf();
      return;
    }
    if (key === 'n' || key === 'N') {
      e.preventDefault();
      fireNoise();
      return;
    }
    if (key === 'm' || key === 'M') {
      e.preventDefault();
      toggleHardcore();
      return;
    }
    if (key === 's' || key === 'S') {
      e.preventDefault();
      if (els.settingsDrawer.classList.contains('hidden')) openSettings();
      else closeSettings();
      return;
    }
    if (key === 'p' || key === 'P') {
      e.preventDefault();
      setTarget('player');
      return;
    }
    if (key === 'd' || key === 'D') {
      e.preventDefault();
      setTarget('dealer');
      return;
    }
    if (key === 'b' || key === 'B') {
      e.preventDefault();
      setTarget('table');
      return;
    }

    const rank = normalizeRank(key);
    if (rank) applyCard(state.target, rank);
  }

  // Control bindings
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
        const rank = btn.getAttribute('data-rank');
        applyCard(state.target, rank === 'A' ? 'A' : Number(rank));
      }, { passive: true });
    });

    // Settings controls
    els.settingsBtn.addEventListener('click', openSettings, { passive: true });
    els.settingsBackdrop.addEventListener('click', closeSettings, { passive: true });
    els.settingsCloseBtn.addEventListener('click', closeSettings, { passive: true });
    els.settingsApplyBtn.addEventListener('click', applySettings, { passive: true });
    els.settingsResetBtn.addEventListener('click', resetPrefs, { passive: true });

    els.tcModeSimBtn.addEventListener('click', () => {
      state.tcMode = 'sim';
      persistPrefs();
      syncDecksRemainFieldVisibility();
      computeDerived();
      render(true);
      setTcModeUI(state.tcMode);
      toast('TC mode: SIM');
    }, { passive: true });

    els.tcModeCasinoBtn.addEventListener('click', () => {
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
      state.decksRemainingEst = clampNumber(v, 0.25, state.decks);
      if (state.tcMode === 'casino') {
        computeDerived();
        render(true);
      }
      persistPrefs();
    }, { passive: true });

    document.addEventListener('keydown', handleKey, false);
  }

  // Init
  bindControls();
  loadPersisted();
  computeDerived();
  render(true);

  // Perf RAF loop
  function rafLoop() {
    perfTick();
    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);
})();
