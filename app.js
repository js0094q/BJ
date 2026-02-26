(function () {
  'use strict';

  const Engine = window.BJEngine;

  const state = {
    rc: 0,
    cardsDealt: 0,
    tc: 0,
    band: 'NEUTRAL',
    edge: -0.55,
    betUnits: 1,
    player: [],
    dealer: [],
    table: [],
    target: 'table'
  };

  const els = {};
  document.querySelectorAll('[id]').forEach(el => els[el.id] = el);

  function compute() {
    const d = Engine.trueCountState(state.rc, state.cardsDealt, 6);
    state.tc = d.tc;
    state.band = d.band;
    state.edge = Engine.edgeEstimate(state.tc);
    state.betUnits = Engine.betUnits(state.edge, 100, 1, 0.25).units;
  }

  function render() {

    els.tcVal.textContent = state.tc.toFixed(2);
    els.betVal.textContent = state.betUnits + "u";
    els.bandBadge.textContent = state.band;
    els.rcVal.textContent = state.rc;
    els.edgeVal.textContent = state.edge.toFixed(2) + "%";
    els.cardsDealtVal.textContent = state.cardsDealt;

    paint(els.playerCards, state.player);
    paint(els.dealerCards, state.dealer);
    paint(els.tableCards, state.table);

    if (state.player.length && state.dealer.length) {
      const rec = Engine.recommendBasic(state.player, state.dealer[0]);
      els.actionVal.textContent = rec;
      els.guideLine.textContent = `6D H17 DAS · ${rec}`;
    } else {
      els.actionVal.textContent = "—";
      els.guideLine.textContent = "Waiting for cards…";
    }
  }

  function paint(node, cards) {
    node.innerHTML = "";
    cards.forEach(c => {
      const chip = document.createElement("div");
      chip.className = "card-chip";
      chip.textContent = c;
      node.appendChild(chip);
    });
  }

  function applyCard(target, rank) {
    state.cardsDealt++;
    state.rc += Engine.weightFor(rank, 'hilo');

    if (target === 'player') state.player.push(rank);
    if (target === 'dealer') state.dealer.push(rank);
    if (target === 'table') state.table.push(rank);

    compute();
    render();
  }

  function undo() {
    state.player.pop() || state.dealer.pop() || state.table.pop();
    compute();
    render();
  }

  function bind() {

    els.settingsBtn.onclick = () => {
      els.settingsBackdrop.classList.remove("hidden");
      els.settingsDrawer.classList.remove("hidden");
    };

    els.settingsCloseBtn.onclick = () => {
      els.settingsBackdrop.classList.add("hidden");
      els.settingsDrawer.classList.add("hidden");
    };

    els.settingsBackdrop.onclick = () => {
      els.settingsBackdrop.classList.add("hidden");
      els.settingsDrawer.classList.add("hidden");
    };

    els.tapPad.addEventListener("click", e => {
      const btn = e.target.closest("button[data-rank]");
      if (!btn) return;
      const rank = Engine.normalizeRank(btn.dataset.rank);
      if (rank) applyCard(state.target, rank);
    });

    els.tapUndo.onclick = undo;

    els.tapTarget.onclick = () => {
      state.target =
        state.target === "player"
          ? "dealer"
          : state.target === "dealer"
          ? "table"
          : "player";
    };
  }

  compute();
  render();
  bind();

})();
