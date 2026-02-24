(function(){
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    rcValue: $("#rcValue"), tcValue: $("#tcValue"), edgeValue: $("#edgeValue"), betValue: $("#betValue"),
    rcHint: $("#rcHint"), tcHint: $("#tcHint"), edgeHint: $("#edgeHint"), betHint: $("#betHint"),
    cardsSeen: $("#cardsSeen"), decksRem: $("#decksRem"), penValue: $("#penValue"),
    trayBlock: $("#trayBlock"), traySlider: $("#traySlider"), trayLabel: $("#trayLabel"),
    log: $("#log"),

    pillSystem: $("#pillSystem"), pillDecks: $("#pillDecks"), pillTCMode: $("#pillTCMode"),

    keypad: $("#keypad"), btnUndo: $("#btnUndo"), btnClearHand: $("#btnClearHand"), btnShuffle: $("#btnShuffle"),
    btnExport: $("#btnExport"), btnImport: $("#btnImport"), fileInput: $("#fileInput"),

    btnSettings: $("#btnSettings"), btnHelp: $("#btnHelp"),
    drawerBackdrop: $("#drawerBackdrop"), drawer: $("#drawer"), btnCloseDrawer: $("#btnCloseDrawer"),
    systemSelect: $("#systemSelect"), decksSelect: $("#decksSelect"), tcModeSelect: $("#tcModeSelect"),
    bankrollInput: $("#bankrollInput"), kellySelect: $("#kellySelect"), btnResetSettings: $("#btnResetSettings"),

    // New rule selectors
    soft17Select: $("#soft17Select"),
    dasSelect: $("#dasSelect"),
    lsSelect: $("#lsSelect"),

    helpModal: $("#helpModal"), btnCloseHelp: $("#btnCloseHelp"), btnCloseHelp2: $("#btnCloseHelp2"),

    targetSeg: $("#targetSeg"), devToggle: $("#devToggle"),
    dealerUp: $("#dealerUp"), playerHand: $("#playerHand"), recAction: $("#recAction"),
    recExplain: $("#recExplain"), actionResult: $("#actionResult"),
    btnNewHand: $("#btnNewHand"), btnClearHand2: $("#btnClearHand2")
  };

  const DEFAULTS = {
    system: "HILO",
    decksInShoe: 6,
    tcMode: "SIM",
    trayDecksRemaining: 6,
    bankrollUnits: 200,
    kellyCapFrac: 0.25,
    dealerHitsSoft17: false,   // S17 default
    doubleAfterSplit: true,    // DAS default
    lateSurrender: true,       // LS default
    useDeviations: false
  };

  const engine = new window.BJEngine(loadSettings());
  let inputTarget = "PLAYER";

  function log(msg){
    const ts = new Date().toLocaleTimeString();
    els.log.textContent = `[${ts}] ${msg}\n` + (els.log.textContent || "");
  }
  function pct(x){ return `${Number(x).toFixed(1)}%`; }
  function fmtDecks(x){ return `${Number(x).toFixed(2)}`; }
  function fmtPen(p){ return `${Math.round(p * 100)}%`; }

  function saveSettings(){
    try{ localStorage.setItem("blackj_settings_v4", JSON.stringify(engine.settings)); }catch(e){}
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem("blackj_settings_v4");
      if(!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }catch(e){
      return { ...DEFAULTS };
    }
  }

  function syncSettingsToUI(){
    const s = engine.settings;
    els.systemSelect.value = s.system;
    els.decksSelect.value = String(s.decksInShoe);
    els.tcModeSelect.value = s.tcMode;
    els.bankrollInput.value = String(s.bankrollUnits);
    els.kellySelect.value = String(s.kellyCapFrac);
    els.devToggle.checked = !!s.useDeviations;

    els.soft17Select.value = s.dealerHitsSoft17 ? "H17" : "S17";
    els.dasSelect.value = s.doubleAfterSplit ? "YES" : "NO";
    els.lsSelect.value = s.lateSurrender ? "YES" : "NO";

    els.traySlider.max = String(s.decksInShoe);
    els.traySlider.value = String(s.trayDecksRemaining);
    els.trayLabel.textContent = `${Number(s.trayDecksRemaining).toFixed(2)} decks remaining`;
  }

  function applySettings(patch){
    engine.setSettings(patch);
    saveSettings();
    syncSettingsToUI();
    render();
  }

  function actionLabel(a){
    if(a === "H") return "Hit";
    if(a === "S") return "Stand";
    if(a === "D") return "Double";
    if(a === "P") return "Split";
    if(a === "R") return "Surrender";
    return "–";
  }

  function handText(cards, info){
    if(!cards || cards.length === 0) return "–";
    const list = cards.join(" ");
    if(!info) return list;
    const tag = info.soft ? "soft" : "hard";
    const pair = info.isPair ? `, pair ${info.pairRank}${info.pairRank}` : "";
    return `${list} (${info.total} ${tag}${pair})`;
  }

  function render(){
    const snap = engine.snapshot();

    els.rcValue.textContent = String(snap.rc);
    els.tcValue.textContent = String(snap.tc);
    els.edgeValue.textContent = pct(snap.edgePct);
    els.betValue.textContent = `${snap.betUnits}u`;

    els.cardsSeen.textContent = String(snap.cardsSeen);
    els.decksRem.textContent = fmtDecks(snap.decksRemaining);
    els.penValue.textContent = fmtPen(snap.penetration);

    els.pillSystem.textContent = snap.systemName;
    els.pillDecks.textContent = String(snap.settings.decksInShoe);
    els.pillTCMode.textContent = snap.settings.tcMode;

    els.rcHint.textContent = `Weights: ${snap.systemName}`;
    els.tcHint.textContent = snap.settings.tcMode === "CASINO" ? "CASINO: tray estimate" : "SIM: by cards seen";
    els.edgeHint.textContent = "Conservative, capped";
    els.betHint.textContent = `${Math.round(snap.settings.kellyCapFrac * 100)}% Kelly cap`;

    const showTray = snap.settings.tcMode === "CASINO";
    els.trayBlock.style.display = showTray ? "block" : "none";
    els.trayLabel.textContent = `${Number(snap.settings.trayDecksRemaining).toFixed(2)} decks remaining`;

    els.dealerUp.textContent = snap.hand.dealerUp ? snap.hand.dealerUp : "–";
    els.playerHand.textContent = handText(snap.hand.playerCards, snap.hand.playerInfo);
    els.recAction.textContent = snap.rec.action ? actionLabel(snap.rec.action) : "–";

    if(!snap.rec.action){
      els.recExplain.textContent = snap.rec.reason || "Set dealer upcard and player cards.";
    } else {
      const dev = snap.rec.usedDeviation ? " (index)" : "";
      els.recExplain.textContent = `${snap.rec.reason}${dev}`;
    }
  }

  function openDrawer(){
    els.drawerBackdrop.hidden = false;
    els.drawer.classList.add("open");
    els.drawer.setAttribute("aria-hidden", "false");
  }
  function closeDrawer(){
    els.drawer.classList.remove("open");
    els.drawer.setAttribute("aria-hidden", "true");
    els.drawerBackdrop.hidden = true;
  }
  function openHelp(){ if(typeof els.helpModal.showModal === "function") els.helpModal.showModal(); }
  function closeHelp(){ if(typeof els.helpModal.close === "function") els.helpModal.close(); }

  function setInputTarget(t){
    inputTarget = t;
    const buttons = els.targetSeg.querySelectorAll(".seg-btn");
    buttons.forEach(b => b.classList.toggle("active", b.dataset.target === t));
    log(`Input target: ${t}`);
  }

  function addCard(card){
    let res;
    if(inputTarget === "PLAYER") res = engine.addCardToPlayer(card);
    else if(inputTarget === "DEALER") res = engine.addCardToDealer(card);
    else res = engine.addSeenCard(card);

    if(!res.ok){ log(`Error: ${res.error}`); return; }
    render();
  }

  function wireKeypad(){
    els.keypad.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-card]");
      if(!btn) return;
      addCard(btn.getAttribute("data-card"));
    });
  }

  function gradeAction(chosen){
    const rec = engine.recommendation();
    if(!rec.action){
      els.actionResult.textContent = "Set dealer upcard and player cards first.";
      return;
    }
    const correct = (chosen === rec.action);
    els.actionResult.innerHTML = correct
      ? `<span class="good">Correct</span>: ${actionLabel(chosen)}`
      : `<span class="bad">Incorrect</span>: you chose ${actionLabel(chosen)}, recommended ${actionLabel(rec.action)}`;
  }

  function exportState(){
    const json = engine.exportJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blackj_state.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log("Exported state to blackj_state.json");
  }

  function importStateFromFile(file){
    const reader = new FileReader();
    reader.onload = () => {
      const res = engine.importJSON(String(reader.result || ""));
      if(!res.ok){ log(`Import failed: ${res.error}`); return; }
      saveSettings();
      syncSettingsToUI();
      render();
      log("Imported state successfully");
    };
    reader.readAsText(file);
  }

  function wireButtons(){
    els.btnUndo.addEventListener("click", () => { const r = engine.undo(); if(!r.ok) log(r.error); render(); });
    els.btnClearHand.addEventListener("click", () => { engine.clearHand(); els.actionResult.textContent = "Hand cleared."; render(); });
    els.btnShuffle.addEventListener("click", () => { engine.shuffle(); els.actionResult.textContent = "Shuffled, counts and hand reset."; render(); });

    els.btnExport.addEventListener("click", exportState);
    els.btnImport.addEventListener("click", () => { els.fileInput.value = ""; els.fileInput.click(); });
    els.fileInput.addEventListener("change", () => { const f = els.fileInput.files && els.fileInput.files[0]; if(f) importStateFromFile(f); });

    els.btnSettings.addEventListener("click", openDrawer);
    els.btnCloseDrawer.addEventListener("click", closeDrawer);
    els.drawerBackdrop.addEventListener("click", closeDrawer);

    els.btnHelp.addEventListener("click", openHelp);
    els.btnCloseHelp.addEventListener("click", closeHelp);
    els.btnCloseHelp2.addEventListener("click", closeHelp);

    els.systemSelect.addEventListener("change", () => applySettings({ system: els.systemSelect.value }));
    els.decksSelect.addEventListener("change", () => {
      const decks = Number(els.decksSelect.value);
      const tray = Math.min(Number(engine.settings.trayDecksRemaining), decks);
      applySettings({ decksInShoe: decks, trayDecksRemaining: tray });
    });
    els.tcModeSelect.addEventListener("change", () => applySettings({ tcMode: els.tcModeSelect.value }));
    els.bankrollInput.addEventListener("change", () => applySettings({ bankrollUnits: Number(els.bankrollInput.value) }));
    els.kellySelect.addEventListener("change", () => applySettings({ kellyCapFrac: Number(els.kellySelect.value) }));

    els.soft17Select.addEventListener("change", () => applySettings({ dealerHitsSoft17: els.soft17Select.value === "H17" }));
    els.dasSelect.addEventListener("change", () => applySettings({ doubleAfterSplit: els.dasSelect.value === "YES" }));
    els.lsSelect.addEventListener("change", () => applySettings({ lateSurrender: els.lsSelect.value === "YES" }));

    els.devToggle.addEventListener("change", () => applySettings({ useDeviations: !!els.devToggle.checked }));

    els.traySlider.addEventListener("input", () => {
      const v = Number(els.traySlider.value);
      els.trayLabel.textContent = `${v.toFixed(2)} decks remaining`;
      engine.setSettings({ trayDecksRemaining: v });
      saveSettings();
      render();
    });

    els.btnResetSettings.addEventListener("click", () => applySettings({ ...DEFAULTS }));

    els.targetSeg.addEventListener("click", (e) => {
      const b = e.target.closest(".seg-btn");
      if(b) setInputTarget(b.dataset.target);
    });

    els.btnNewHand.addEventListener("click", () => { engine.newHand(); els.actionResult.textContent = "New hand started."; render(); });
    els.btnClearHand2.addEventListener("click", () => { engine.clearHand(); els.actionResult.textContent = "Hand cleared."; render(); });

    document.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-action]");
      if(b) gradeAction(b.getAttribute("data-action"));
    });
  }

  function wireHotkeys(){
    window.addEventListener("keydown", (e) => {
      if(e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if(k === "s"){
        e.preventDefault();
        if(els.drawer.classList.contains("open")) closeDrawer();
        else openDrawer();
      } else if(k === "u"){
        e.preventDefault();
        engine.undo(); render();
      } else if(k === "r"){
        e.preventDefault();
        engine.shuffle(); render();
      }
    });
  }

  engine.setSettings(loadSettings());
  syncSettingsToUI();
  setInputTarget("PLAYER");
  wireKeypad();
  wireButtons();
  wireHotkeys();
  render();
  log("Ready");
})();
