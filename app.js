/* app.js
   UI glue for BLACKJ modern trainer
*/

(function(){
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    rcValue: $("#rcValue"),
    tcValue: $("#tcValue"),
    edgeValue: $("#edgeValue"),
    betValue: $("#betValue"),
    rcHint: $("#rcHint"),
    tcHint: $("#tcHint"),
    edgeHint: $("#edgeHint"),
    betHint: $("#betHint"),
    cardsSeen: $("#cardsSeen"),
    decksRem: $("#decksRem"),
    penValue: $("#penValue"),
    trayBlock: $("#trayBlock"),
    traySlider: $("#traySlider"),
    trayLabel: $("#trayLabel"),
    log: $("#log"),

    pillSystem: $("#pillSystem"),
    pillDecks: $("#pillDecks"),
    pillTCMode: $("#pillTCMode"),

    keypad: $("#keypad"),
    btnUndo: $("#btnUndo"),
    btnClearHand: $("#btnClearHand"),
    btnShuffle: $("#btnShuffle"),
    btnExport: $("#btnExport"),
    btnImport: $("#btnImport"),
    fileInput: $("#fileInput"),

    btnSettings: $("#btnSettings"),
    btnHelp: $("#btnHelp"),
    drawerBackdrop: $("#drawerBackdrop"),
    drawer: $("#drawer"),
    btnCloseDrawer: $("#btnCloseDrawer"),
    systemSelect: $("#systemSelect"),
    decksSelect: $("#decksSelect"),
    tcModeSelect: $("#tcModeSelect"),
    bankrollInput: $("#bankrollInput"),
    kellySelect: $("#kellySelect"),
    btnResetSettings: $("#btnResetSettings"),

    helpModal: $("#helpModal"),
    btnCloseHelp: $("#btnCloseHelp"),
    btnCloseHelp2: $("#btnCloseHelp2")
  };

  const DEFAULTS = {
    system: "HILO",
    decksInShoe: 6,
    tcMode: "SIM",
    trayDecksRemaining: 6,
    bankrollUnits: 200,
    kellyCapFrac: 0.25
  };

  const engine = new window.BJEngine(loadSettings());

  function log(msg){
    const ts = new Date().toLocaleTimeString();
    els.log.textContent = `[${ts}] ${msg}\n` + (els.log.textContent || "");
  }

  function pct(x){
    return `${Number(x).toFixed(1)}%`;
  }

  function fmtDecks(x){
    return `${Number(x).toFixed(2)}`;
  }

  function fmtPen(p){
    return `${Math.round(p * 100)}%`;
  }

  function saveSettings(){
    try{
      localStorage.setItem("blackj_settings_v2", JSON.stringify(engine.settings));
    }catch(e){}
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem("blackj_settings_v2");
      if(!raw) return { ...DEFAULTS };
      const obj = JSON.parse(raw);
      return { ...DEFAULTS, ...obj };
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

    els.traySlider.max = String(s.decksInShoe);
    els.traySlider.value = String(s.trayDecksRemaining);
    els.trayLabel.textContent = `${Number(s.trayDecksRemaining).toFixed(2)} decks remaining`;
  }

  function applyUISettingsPatch(patch){
    engine.setSettings(patch);
    saveSettings();
    syncSettingsToUI();
    render();
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
    els.tcHint.textContent = snap.settings.tcMode === "CASINO"
      ? "CASINO: tray estimate"
      : "SIM: by cards dealt";
    els.edgeHint.textContent = "Conservative, capped";
    els.betHint.textContent = `${Math.round(snap.settings.kellyCapFrac * 100)}% Kelly cap`;

    // tray block visibility
    const showTray = snap.settings.tcMode === "CASINO";
    els.trayBlock.style.display = showTray ? "block" : "none";
    els.trayLabel.textContent = `${Number(snap.settings.trayDecksRemaining).toFixed(2)} decks remaining`;
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

  function openHelp(){
    if(typeof els.helpModal.showModal === "function"){
      els.helpModal.showModal();
    }
  }

  function closeHelp(){
    if(typeof els.helpModal.close === "function"){
      els.helpModal.close();
    }
  }

  function wireKeypad(){
    els.keypad.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-card]");
      if(!btn) return;
      const card = btn.getAttribute("data-card");
      const res = engine.addCard(card);
      if(!res.ok){
        log(`Error: ${res.error}`);
        return;
      }
      render();
    });
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
      if(!res.ok){
        log(`Import failed: ${res.error}`);
        return;
      }
      saveSettings(); // engine.importJSON calls setSettings which we want persisted
      syncSettingsToUI();
      render();
      log("Imported state successfully");
    };
    reader.readAsText(file);
  }

  function wireButtons(){
    els.btnUndo.addEventListener("click", () => {
      const res = engine.undo();
      if(!res.ok){
        log(res.error);
        return;
      }
      render();
    });

    els.btnClearHand.addEventListener("click", () => {
      engine.clearHand();
      log("Cleared (note: counts persist, use Shuffle to reset)");
    });

    els.btnShuffle.addEventListener("click", () => {
      engine.shuffle();
      render();
      log("Shuffled: counts reset");
    });

    els.btnExport.addEventListener("click", exportState);

    els.btnImport.addEventListener("click", () => {
      els.fileInput.value = "";
      els.fileInput.click();
    });

    els.fileInput.addEventListener("change", () => {
      const f = els.fileInput.files && els.fileInput.files[0];
      if(!f) return;
      importStateFromFile(f);
    });

    els.btnSettings.addEventListener("click", openDrawer);
    els.btnCloseDrawer.addEventListener("click", closeDrawer);
    els.drawerBackdrop.addEventListener("click", closeDrawer);

    els.btnHelp.addEventListener("click", openHelp);
    els.btnCloseHelp.addEventListener("click", closeHelp);
    els.btnCloseHelp2.addEventListener("click", closeHelp);

    els.systemSelect.addEventListener("change", () => {
      applyUISettingsPatch({ system: els.systemSelect.value });
    });

    els.decksSelect.addEventListener("change", () => {
      const decks = Number(els.decksSelect.value);
      const tray = Math.min(Number(engine.settings.trayDecksRemaining), decks);
      applyUISettingsPatch({ decksInShoe: decks, trayDecksRemaining: tray });
    });

    els.tcModeSelect.addEventListener("change", () => {
      applyUISettingsPatch({ tcMode: els.tcModeSelect.value });
    });

    els.bankrollInput.addEventListener("change", () => {
      applyUISettingsPatch({ bankrollUnits: Number(els.bankrollInput.value) });
    });

    els.kellySelect.addEventListener("change", () => {
      applyUISettingsPatch({ kellyCapFrac: Number(els.kellySelect.value) });
    });

    els.traySlider.addEventListener("input", () => {
      const v = Number(els.traySlider.value);
      els.trayLabel.textContent = `${v.toFixed(2)} decks remaining`;
      engine.setSettings({ trayDecksRemaining: v });
      saveSettings();
      render();
    });

    els.btnResetSettings.addEventListener("click", () => {
      applyUISettingsPatch({ ...DEFAULTS });
      log("Settings reset to defaults");
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
        engine.undo();
        render();
      } else if(k === "c"){
        e.preventDefault();
        engine.clearHand();
        log("Cleared (note: counts persist, use Shuffle to reset)");
      } else if(k === "r"){
        e.preventDefault();
        engine.shuffle();
        render();
        log("Shuffled: counts reset");
      }
    });
  }

  // init
  engine.setSettings(loadSettings());
  syncSettingsToUI();
  wireKeypad();
  wireButtons();
  wireHotkeys();
  render();
  log("Ready");
})();
