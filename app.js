(function () {
  'use strict';

  const Engine = window.BJEngine;

  const LOG_LIMIT = 180;
  const TAP_DEBOUNCE_MS = 45;

  const state = {
    // counting
    rc: 0,
    cardsDealt: 0,
    decksSeen: 0,
    decksRemaining: Engine.rules.decks,
    tc: 0,
    aceAdj: 0,
    acesSeen: 0,

    // outputs
    edge: -0.55,
    betUnits: 1,
    band: 'NEUTRAL',

    // hands
    target: 'table', // 'player' | 'dealer' | 'table'
    player: [],
    dealer: [],
    table: [],

    // preferences (MyBookie)
    decks: Engine.rules.decks || 6,
    countSystem: 'hilo',
    tcMode: 'sim', // 'sim' | 'casino'
    decksRemainingEst: 3,
    bankrollUnits: 100,
    maxKelly: 0.25,
    aceSideEnabled: false,

    // undo log
    log: []
  };

  // cache DOM by id (safe)
  const els = {};
  (function cacheEls() {
    const nodes = document.querySelectorAll('[id]');
    for (let i = 0; i < nodes.length; i++) {
      els[nodes[i].id] = nodes[i];
    }
  })();

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function copyHand(h) {
    return h.slice();
  }

  function logPush(evt) {
    if (state.log.length >= LOG_LIMIT) state.log.shift();
    state.log.push(evt);
  }

  function storage() {
    try {
      const k = '__bj_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return window.localStorage;
    } catch (_) {
      return window.sessionStorage;
    }
  }

  function persistPrefs() {
    // Only store prefs, not the running shoe state.
    const payload = {
      countSystem: state.countSystem,
      tcMode: state.tcMode,
      decksRemainingEst: state.decksRemainingEst,
      bankrollUnits: state.bankrollUnits,
      maxKelly: state.maxKelly,
      aceSideEnabled: state.aceSideEnabled
    };
    try {
      storage().setItem('bj_prefs', JSON.stringify(payload));
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
    state.aceAdj = d.aceAdj;

    state.edge = Engine.edgeEstimate(state.tc);
    state.betUnits = Engine.betUnits(state.edge, state.bankrollUnits, 1, state.maxKelly).units;
  }

  function paintCards(node, cards) {
    if (!node) return;

    // minimal DOM churn
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

  function setBandStyles() {
    if (els.bandBadge) {
      // reset
      els.bandBadge.classList.remove('band-neutral', 'band-positive', 'band-negative', 'band-high');

      // classify
      if (state.band === 'POSITIVE') els.bandBadge.classList.add('band-positive');
      else if (state.band === 'NEGATIVE') els.bandBadge.classList.add('band-negative');
      else if (state.band === 'HIGH') els.bandBadge.classList.add('band-high');
      else els.bandBadge.classList.add('band-neutral');

      els.bandBadge.textContent = state.band;
    }

    if (els.tcVal) {
      els.tcVal.classList.remove('tc-positive', 'tc-negative', 'tc-high');
      if (state.band === 'POSITIVE') els.tcVal.classList.add('tc-positive');
      else if (state.band === 'NEGATIVE') els.tcVal.classList.add('tc-negative');
      else if (state.band === 'HIGH') els.tcVal.classList.add('tc-high');
    }
  }

  function describeHand() {
    if (!state.player.length || !state.dealer.length) return '';
    const soft = Engine.isSoft(state.player);
    const total = Engine.total(state.player);
    const up = state.dealer[0];
    return (soft ? 'Soft ' : 'Hard ') + total + ' vs ' + (up === 'A' ? 'A' : String(up));
  }

  function computeRecommendation() {
    if (!state.player.length || !state.dealer.length) {
      return { act: '—', sub: 'Enter Player + Dealer cards to get guidance.' };
    }
    const up = state.dealer[0];
    const act = Engine.recommendBasic(state.player, up);
    const ctx = describeHand();
    return { act: act, sub: ctx + ' · 6D H17 DAS' };
  }

  function render() {
    if (els.rcVal) {
      els.rcVal.textContent =
        (state.countSystem === 'wong_halves')
          ? state.rc.toFixed(1)
          : String(Math.round(state.rc));
    }

    if (els.tcVal) els.tcVal.textContent = state.tc.toFixed(2);
    if (els.edgeVal) els.edgeVal.textContent = state.edge.toFixed(2) + '%';
    if (els.betVal) els.betVal.textContent = state.betUnits + 'u';
    if (els.decksRemainVal) els.decksRemainVal.textContent = state.decksRemaining.toFixed(2);
    if (els.cardsDealtVal) els.cardsDealtVal.textContent = String(state.cardsDealt);

    setBandStyles();

    paintCards(els.playerCards, state.player);
    paintCards(els.dealerCards, state.dealer);
    paintCards(els.tableCards, state.table);

    const r = computeRecommendation();
    if (els.actionVal) els.actionVal.textContent = r.act;
    if (els.guideLine) els.guideLine.textContent = r.sub;

    if (els.tapTargetVal) els.tapTargetVal.textContent = state.target.toUpperCase();

    // Keep settings UI synced if drawer is open
    if (els.settingsDrawer && !els.settingsDrawer.classList.contains('hidden')) {
      hydrateSettingsUI();
    }
  }

  function applyCard(target, rank) {
    logPush({ type: 'ADD_CARD', target: target, rank: rank });

    state.cardsDealt += 1;
    state.rc += Engine.weightFor(rank, state.countSystem);
    if (rank === 'A') state.acesSeen += 1;

    if (target === 'player') state.player.push(rank);
    else if (target === 'dealer') state.dealer.push(rank);
    else state.table.push(rank);

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
      else if (evt.target === 'dealer') state.dealer.pop();
      else state.table.pop();
    } else if (evt.type === 'RESET_HANDS') {
      state.player = copyHand(evt.prevPlayer);
      state.dealer = copyHand(evt.prevDealer);
      state.table = copyHand(evt.prevTable);
      state.target = evt.prevTarget;
    }

    computeDerived();
    render();
  }

  function resetHandsOnly() {
    logPush({
      type: 'RESET_HANDS',
      prevPlayer: copyHand(state.player),
      prevDealer: copyHand(state.dealer),
      prevTable: copyHand(state.table),
      prevTarget: state.target
    });

    state.player.length = 0;
    state.dealer.length = 0;
    state.table.length = 0;
    state.target = 'table';
    render();
  }

  function cycleTarget() {
    state.target = (state.target === 'player') ? 'dealer'
      : (state.target === 'dealer') ? 'table'
      : 'player';
    render();
  }

  // ---------- Settings drawer ----------

  function openSettings() {
    if (els.settingsBackdrop) els.settingsBackdrop.classList.remove('hidden');
    if (els.settingsDrawer) els.settingsDrawer.classList.remove('hidden');
    hydrateSettingsUI();
  }

  function closeSettings() {
    if (els.settingsBackdrop) els.settingsBackdrop.classList.add('hidden');
    if (els.settingsDrawer) els.settingsDrawer.classList.add('hidden');
  }

  function hydrateSettingsUI() {
    if (els.countSystemSelect) els.countSystemSelect.value = state.countSystem;

    if (els.tcModeSimBtn && els.tcModeCasinoBtn) {
      els.tcModeSimBtn.classList.toggle('active', state.tcMode === 'sim');
      els.tcModeCasinoBtn.classList.toggle('active', state.tcMode === 'casino');
    }

    const showCasino = (state.tcMode === 'casino');
    if (els.decksRemainField) els.decksRemainField.classList.toggle('hidden', !showCasino);

    if (els.decksRemainRange) els.decksRemainRange.value = String(state.decksRemainingEst);
    if (els.decksRemainReadout) els.decksRemainReadout.textContent = Number(state.decksRemainingEst).toFixed(2);

    const isHiOpt = (state.countSystem === 'hiopt2');
    if (els.aceSideField) els.aceSideField.classList.toggle('hidden', !isHiOpt);

    if (els.aceSideOnBtn && els.aceSideOffBtn) {
      els.aceSideOnBtn.classList.toggle('active', !!state.aceSideEnabled);
      els.aceSideOffBtn.classList.toggle('active', !state.aceSideEnabled);
    }

    if (els.bankrollInput) els.bankrollInput.value = String(state.bankrollUnits);
    if (els.kellySelect) els.kellySelect.value = String(state.maxKelly);
  }

  function applySettings() {
    if (els.countSystemSelect) state.countSystem = els.countSystemSelect.value;

    // MyBookie fixed 6D
    state.decks = 6;

    // tc mode from segmented control
    const casinoActive = !!(els.tcModeCasinoBtn && els.tcModeCasinoBtn.classList.contains('active'));
    state.tcMode = casinoActive ? 'casino' : 'sim';

    // decks remaining estimate
    if (els.decksRemainRange) {
      const v = Number(els.decksRemainRange.value);
      state.decksRemainingEst = clamp(isFinite(v) ? v : 3, 0.25, 6);
    }

    // bankroll
    if (els.bankrollInput) {
      const b = Number(els.bankrollInput.value);
      state.bankrollUnits = Math.max(10, isFinite(b) ? b : 100);
    }

    // max kelly
    if (els.kellySelect) {
      const k = Number(els.kellySelect.value);
      state.maxKelly = isFinite(k) ? k : 0.25;
    }

    // ace side only for hiopt2
    if (state.countSystem !== 'hiopt2') state.aceSideEnabled = false;

    persistPrefs();
    computeDerived();
    render();
    closeSettings();
  }

  function resetSettings() {
    state.decks = 6;
    state.countSystem = 'hilo';
    state.tcMode = 'sim';
    state.decksRemainingEst = 3;
    state.bankrollUnits = 100;
    state.maxKelly = 0.25;
    state.aceSideEnabled = false;

    persistPrefs();
    computeDerived();
    render();
    hydrateSettingsUI();
  }

  // ---------- Bindings ----------

  function bind() {
    // Settings
    if (els.settingsBtn) els.settingsBtn.addEventListener('click', openSettings);
    if (els.settingsCloseBtn) els.settingsCloseBtn.addEventListener('click', closeSettings);
    if (els.settingsBackdrop) els.settingsBackdrop.addEventListener('click', closeSettings);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSettings();
    });

    if (els.settingsApplyBtn) els.settingsApplyBtn.addEventListener('click', applySettings);
    if (els.settingsResetBtn) els.settingsResetBtn.addEventListener('click', resetSettings);

    if (els.tcModeSimBtn && els.tcModeCasinoBtn) {
      els.tcModeSimBtn.addEventListener('click', function () {
        els.tcModeSimBtn.classList.add('active');
        els.tcModeCasinoBtn.classList.remove('active');
        state.tcMode = 'sim';
        computeDerived();
        render();
      });

      els.tcModeCasinoBtn.addEventListener('click', function () {
        els.tcModeCasinoBtn.classList.add('active');
        els.tcModeSimBtn.classList.remove('active');
        state.tcMode = 'casino';
        computeDerived();
        render();
      });
    }

    if (els.decksRemainRange) {
      els.decksRemainRange.addEventListener('input', function () {
        const v = Number(els.decksRemainRange.value);
        if (els.decksRemainReadout) els.decksRemainReadout.textContent = v.toFixed(2);
        state.decksRemainingEst = v;
        if (state.tcMode === 'casino') {
          computeDerived();
          render();
        }
      });
    }

    if (els.aceSideOnBtn) {
      els.aceSideOnBtn.addEventListener('click', function () {
        if (state.countSystem !== 'hiopt2') return;
        state.aceSideEnabled = true;
        computeDerived();
        render();
      });
    }

    if (els.aceSideOffBtn) {
      els.aceSideOffBtn.addEventListener('click', function () {
        state.aceSideEnabled = false;
        computeDerived();
        render();
      });
    }

    // Tap pad
    let lastTapAt = 0;

    if (els.tapPad) {
      els.tapPad.addEventListener('pointerdown', function (e) {
        const btn = e.target && e.target.closest ? e.target.closest('button[data-rank]') : null;
        if (!btn) return;

        e.preventDefault();

        const now = performance.now();
        if (now - lastTapAt < TAP_DEBOUNCE_MS) return;
        lastTapAt = now;

        const rank = Engine.normalizeRank(btn.dataset.rank);
        if (!rank) return;

        applyCard(state.target, rank);
      }, { passive: false });
    }

    if (els.tapUndo) {
      els.tapUndo.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        undo();
      }, { passive: false });
    }

    if (els.tapTarget) {
      els.tapTarget.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        cycleTarget();
      }, { passive: false });
    }

    // Keyboard input
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace') {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        resetHandsOnly();
        return;
      }

      const r = Engine.normalizeRank(e.key);
      if (r) applyCard(state.target, r);
    });
  }

  // ---------- Init ----------
  loadPrefs();
  computeDerived();
  render();
  bind();
})();
