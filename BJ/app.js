(function () {
  'use strict';

  // Core constants
  const DECKS = 6;
  const LOG_LIMIT = 50;
  const MIN_DECK_FRACTION = 0.25; // avoid divide-by-zero when shoe nearly exhausted

  // State containers (mutable by design, explicit mutation only)
  const state = {
    rc: 0,
    cardsDealt: 0,
    decksSeen: 0,
    tc: 0,
    band: 'NEUTRAL',
    target: 'table',
    player: [],
    dealer: [],
    overlay: false,
    hardcore: false,
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
    perfHud: document.getElementById('perfHud'),
    perfFps: document.getElementById('perfFps'),
    perfFrames: document.getElementById('perfFrames')
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
    hardcore: null,
    overlay: null,
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
      hardcore: state.hardcore
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
    render();
  }

  // Counting helpers
  function hiLoWeight(rank) {
    // rank: number 2-10 or 'A'
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

  function applyCard(target, rank) {
    pushUndo();
    state.cardsDealt += 1;
    state.rc += hiLoWeight(rank);
    if (target === 'player') {
      state.player[state.player.length] = rank;
    } else if (target === 'dealer') {
      state.dealer[state.dealer.length] = rank;
    }
    computeDerived();
    render(true);
  }

  function computeDerived() {
    state.decksSeen = state.cardsDealt / 52;
    const decksRemaining = Math.max(MIN_DECK_FRACTION, DECKS - state.decksSeen);
    state.tc = state.rc / decksRemaining;
    const nextBand = bandFromTC(state.tc);
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
      state.rc += hiLoWeight(r);
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

  function persist() {
    try {
      sessionStorage.setItem('bj_state_prefs', JSON.stringify({
        hardcore: state.hardcore,
        overlay: state.overlay
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
    } catch (_) {
      /* ignore */
    }
  }

  // Action recommendation (lean basic strategy for 6D, H17, DAS, no surrender)
  function recommendedAction() {
    if (!state.player.length || !state.dealer.length) return '—';
    const dealerUp = state.dealer[0];
    if (!dealerUp) return '—';

    // Helper values
    const canDouble = state.player.length === 2;
    const canSplit = state.player.length === 2 && valueEq(state.player[0], state.player[1]);

    // Pair handling
    if (canSplit) {
      const p = pairDecision(state.player[0], dealerUp);
      if (p) return p;
    }

    // Soft vs hard
    if (isSoft(state.player)) {
      return softDecision(state.player, dealerUp, canDouble);
    }
    return hardDecision(total(state.player), dealerUp, canDouble);
  }

  function cardVal(rank) {
    if (rank === 'A') return 11;
    return rank;
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
    // Returns 'SPLIT' or null
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
