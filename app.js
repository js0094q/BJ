(function () {
  'use strict';

  // Core constants
  const DECKS = 6;
  const LOG_LIMIT = 50;
  const BANKROLL_UNITS = 100; // abstract bankroll units for bet sizing
  const MAX_KELLY = 0.25;      // quarter Kelly to keep swings sane

  const Engine = window.BJEngine;

  // State containers (mutable by design, explicit mutation only)
  const state = {
    rc: 0,
    cardsDealt: 0,
    decksSeen: 0,
    tc: 0,
    edge: -0.5,
    betUnits: 0,
    betFrac: 0,
    band: 'NEUTRAL',
    target: 'table',
    player: [],
    dealer: [],
    overlay: false,
    hardcore: false,
    showEdge: true,
    log: []
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
    cardsDealt: document.getElementById('cardsDealtVal'),
    overlay: document.getElementById('overlay'),
    grid: document.getElementById('grid'),
    controls: document.getElementById('controls'),
    hints: document.getElementById('hints'),
    noiseBtn: document.getElementById('noiseBtn'),
    hardcoreBtn: document.getElementById('hardcoreBtn'),
    perfBtn: document.getElementById('perfBtn'),
    overlayBtn: document.getElementById('overlayBtn'),
    resetBtn: document.getElementById('resetBtn'),
    edgeToggle: document.getElementById('edgeToggle'),
    perfHud: document.getElementById('perfHud'),
    perfFps: document.getElementById('perfFps'),
    perfFrames: document.getElementById('perfFrames'),
    edge: document.getElementById('edgeVal'),
    bet: document.getElementById('betVal'),
    guide: document.getElementById('guideLine')
  };

  // Render cache to avoid redundant writes (render_only_on_state_change)
  const rendered = {
    rc: null,
    tc: null,
    band: null,
    action: null,
    target: null,
    decksSeen: null,
    cardsDealt: null,
    edge: null,
    betUnits: null,
    betFrac: null,
    hardcore: null,
    overlay: null,
    showEdge: null,
    playerLen: 0,
    dealerLen: 0,
    bandClass: ''
  };

  // Perf HUD state
  let perfActive = false;
  let perfFrames = 0;
  let perfLast = performance.now();

  // Utility: manual clone to respect no-array-cloning-in-hot-path guidance
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
      tc: state.tc,
      band: state.band,
      target: state.target,
      player: copyHand(state.player),
      dealer: copyHand(state.dealer),
      overlay: state.overlay,
      hardcore: state.hardcore,
      showEdge: state.showEdge
    };
  }

  function pushUndo() {
    if (state.log.length >= LOG_LIMIT) state.log.shift();
    state.log.push(snapshot());
  }

  function undo() {
    if (!state.log.length) return;
    const prev = state.log.pop();
    state.rc = prev.rc;
    state.cardsDealt = prev.cardsDealt;
    state.decksSeen = prev.decksSeen;
    state.tc = prev.tc;
    state.band = prev.band;
    state.target = prev.target;
    state.player = copyHand(prev.player);
    state.dealer = copyHand(prev.dealer);
    state.overlay = prev.overlay;
    state.hardcore = prev.hardcore;
    state.showEdge = prev.showEdge;
    render();
  }

  function reset() {
    pushUndo();
    state.rc = 0;
    state.cardsDealt = 0;
    state.decksSeen = 0;
    state.tc = 0;
    state.band = 'NEUTRAL';
    state.target = 'table';
    state.player.length = 0;
    state.dealer.length = 0;
    state.overlay = false;
    state.hardcore = false;
    state.showEdge = true;
    render();
  }

  // Counting helpers delegated to engine
  const normalizeRank = Engine.normalizeRank;

  function applyCard(target, rank) {
    pushUndo();
    state.cardsDealt += 1;
    state.rc += Engine.weightHiLo(rank);
    if (target === 'player') {
      state.player[state.player.length] = rank;
    } else if (target === 'dealer') {
      state.dealer[state.dealer.length] = rank;
    }
    computeDerived();
    render(true);
  }

  function computeDerived() {
    const derived = Engine.trueCountState(state.rc, state.cardsDealt, DECKS);
    state.decksSeen = derived.decksSeen;
    state.tc = derived.tc;
    state.edge = Engine.edgeLogistic(derived.tc, derived.decksSeen, DECKS);
    const bet = Engine.betUnits(state.edge, BANKROLL_UNITS, 1, MAX_KELLY);
    state.betUnits = bet.units;
    state.betFrac = bet.frac;
    const nextBand = derived.band;
    if (nextBand !== state.band) triggerTCFlash();
    state.band = nextBand;
  }

  let flashTimer = 0;
  function triggerTCFlash() {
    clearTimeout(flashTimer);
    els.tc.classList.remove('tc-flash');
    // Force reflow once to restart animation without a repaint loop
    void els.tc.offsetWidth;
    els.tc.classList.add('tc-flash');
    flashTimer = setTimeout(() => {
      els.tc.classList.remove('tc-flash');
    }, 240);
  }

  // Noise mode: inject neutral-ish random cards, update RC/decks only
  function fireNoise() {
    pushUndo();
    const draws = 6 + Math.floor(Math.random() * 13); // 6–18
    for (let i = 0; i < draws; i++) {
      const r = randomRank();
      state.cardsDealt += 1;
      state.rc += Engine.weightHiLo(r);
    }
    computeDerived();
    render(true);
  }

  function randomRank() {
    const r = Math.floor(Math.random() * 13) + 1; // 1-13 where 1 is Ace
    if (r === 1) return 'A';
    if (r >= 10) return 10;
    return r + 1; // map 2-9
  }

  // Target switching
  function setTarget(next) {
    if (next === state.target) return;
    pushUndo();
    state.target = next;
    render(true);
  }

  // Hardcore toggle
  function toggleHardcore() {
    pushUndo();
    state.hardcore = !state.hardcore;
    persist();
    render(true);
  }

  // Overlay toggle
  function toggleOverlay() {
    pushUndo();
    state.overlay = !state.overlay;
    persist();
    render(true);
  }

  function toggleEdge() {
    pushUndo();
    state.showEdge = !state.showEdge;
    persist();
    render(true);
  }

  function persist() {
    try {
      sessionStorage.setItem('bj_state_prefs', JSON.stringify({
        hardcore: state.hardcore,
        overlay: state.overlay,
        showEdge: state.showEdge
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
      if (typeof saved.showEdge === 'boolean') {
        state.showEdge = saved.showEdge;
      } else {
        state.showEdge = true; // default on
      }
    } catch (_) {
      /* ignore */
    }
  }

  // Action recommendation (delegated to engine basic strategy)
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
    if (canSplit) {
      return `Pair ${state.player[0]}s vs ${dealerText}`;
    }
    const soft = Engine.isSoft(state.player);
    const totalVal = Engine.total(state.player);
    return `${soft ? 'Soft' : 'Hard'} ${totalVal} vs ${dealerText}`;
  }

  function guideLineText(act) {
    if (act === '—') return 'Waiting for cards…';
    return `${handDescriptor()} → ${act} (6D H17 DAS basic strategy)`;
  }

  // Render minimal: only touch DOM when value changed
  function render(force) {
    if (state.rc !== rendered.rc || force) {
      els.rc.textContent = state.rc.toString();
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
      // band class swap
      const classMap = {
        NEGATIVE: 'band-negative',
        NEUTRAL: 'band-neutral',
        POSITIVE: 'band-positive',
        HIGH: 'band-high'
      };
      els.band.classList.remove(rendered.bandClass);
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
      rendered.target = state.target;
    }

    if (state.decksSeen !== rendered.decksSeen || force) {
      els.decksSeen.textContent = state.decksSeen.toFixed(2);
      rendered.decksSeen = state.decksSeen;
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

    if (state.betFrac !== rendered.betFrac || force) {
      els.bet.setAttribute('data-frac', state.betFrac.toFixed(3));
      rendered.betFrac = state.betFrac;
    }

    // deviation highlight based on band
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
    if (rank) {
      applyCard(state.target, rank);
    }
  }

  // Wire controls
  function bindControls() {
    els.noiseBtn.addEventListener('click', fireNoise, { passive: true });
    els.hardcoreBtn.addEventListener('click', toggleHardcore, { passive: true });
    els.perfBtn.addEventListener('click', togglePerf, { passive: true });
    els.overlayBtn.addEventListener('click', toggleOverlay, { passive: true });
    els.resetBtn.addEventListener('click', reset, { passive: true });
    els.edgeToggle.addEventListener('click', toggleEdge, { passive: true });
    document.addEventListener('keydown', handleKey, false);
  }

  function togglePerf() {
    perfActive = !perfActive;
    els.perfHud.classList.toggle('hidden', !perfActive);
    perfFrames = 0;
    perfLast = performance.now();
  }

  function perfTick() {
    if (!perfActive) return;
    perfFrames += 1;
    const now = performance.now();
    const dt = now - perfLast;
    if (dt >= 500) { // update twice a second to keep overhead trivial
      const fps = Math.round((perfFrames / dt) * 1000);
      els.perfFps.textContent = `fps ${fps}`;
      els.perfFrames.textContent = `frames ${perfFrames}`;
      perfFrames = 0;
      perfLast = now;
    }
  }

  // Init
  bindControls();
  loadPersisted();
  render(true);

  // Keep perf HUD ticking even when no renders if active
  function rafLoop() {
    perfTick();
    requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);
})();
