/* engine.js
   Counting + TC + conservative edge model + bet sizing
   No external deps, browser safe.
*/

(function(global){
  "use strict";

  const CountSystems = {
    HILO: {
      name: "Hi-Lo",
      weights: {
        "2": 1, "3": 1, "4": 1, "5": 1, "6": 1,
        "7": 0, "8": 0, "9": 0,
        "T": -1, "J": -1, "Q": -1, "K": -1, "A": -1
      },
      decimals: 0
    },
    HALVES: {
      name: "Wong Halves",
      weights: {
        "2": 0.5, "3": 1, "4": 1, "5": 1.5, "6": 1,
        "7": 0.5, "8": 0, "9": -0.5,
        "T": -1, "J": -1, "Q": -1, "K": -1, "A": -1
      },
      decimals: 1
    },
    HIOPT2: {
      name: "Hi-Opt II (Ace-neutral)",
      weights: {
        "2": 1, "3": 1, "4": 2, "5": 2, "6": 1,
        "7": 1, "8": 0, "9": 0,
        "T": -2, "J": -2, "Q": -2, "K": -2, "A": 0
      },
      decimals: 0
    }
  };

  function clamp(x, lo, hi){
    return Math.max(lo, Math.min(hi, x));
  }

  function roundTo(x, decimals){
    const p = Math.pow(10, decimals);
    return Math.round(x * p) / p;
  }

  function normalizeCard(c){
    if(!c) return null;
    const s = String(c).trim().toUpperCase();
    if(s === "10") return "T";
    if(["A","2","3","4","5","6","7","8","9","T","J","Q","K"].includes(s)) return s;
    return null;
  }

  function cardsPerDeck(){
    return 52;
  }

  function decksRemainingFromSeen(decksInShoe, cardsSeen){
    const total = decksInShoe * cardsPerDeck();
    const remCards = clamp(total - cardsSeen, 0, total);
    const remDecks = remCards / cardsPerDeck();
    return clamp(remDecks, 0.25, decksInShoe);
  }

  // Conservative edge model:
  // - monotone with TC
  // - penetration damp (low pen => weaker confidence)
  // - capped to avoid fake precision
  // NOTE: This is an approximation, not a full sim.
  function estimateEdgePct(tc, penetration){
    // baseline approx: each +1 TC ~ +0.5% edge (common heuristic for Hi-Lo in shoe games)
    // Use a conservative slope and cap.
    const slope = 0.45; // percent per TC
    const cap = 3.0;    // percent cap
    const floor = -2.0; // negative cap

    // penetration is 0..1 (fraction dealt)
    // at shallow pen, reduce magnitude, at deeper pen, allow more
    const penAdj = clamp(0.55 + 0.60 * penetration, 0.55, 1.15);

    const raw = tc * slope * penAdj;
    return clamp(raw, floor, cap);
  }

  // Bet suggestion using simplified fractional Kelly:
  // Kelly fraction f* ≈ edge / variance
  // For blackjack, typical per-hand variance is ~1.3 (units^2).
  // Use an intentionally conservative mapping, plus caps.
  function suggestBetUnits(edgePct, bankrollUnits, kellyCapFrac){
    const edge = edgePct / 100;
    const variance = 1.30;
    const kelly = edge / variance;

    // if negative edge, stick to minimum
    if(kelly <= 0) return 1;

    // fraction of bankroll to bet, capped by user selection
    const f = clamp(kelly, 0, kellyCapFrac);

    // Convert fraction of bankroll to units, round, clamp
    const units = Math.max(1, Math.round(f * bankrollUnits));
    // Additional sanity cap: do not exceed 10% of bankroll even if settings allow more
    const hardCap = Math.max(1, Math.round(0.10 * bankrollUnits));
    return clamp(units, 1, hardCap);
  }

  class BJEngine {
    constructor(opts = {}){
      this.resetAll();

      this.settings = {
        system: opts.system || "HILO",
        decksInShoe: opts.decksInShoe || 6,
        tcMode: opts.tcMode || "SIM", // SIM or CASINO
        trayDecksRemaining: opts.trayDecksRemaining || (opts.decksInShoe || 6),
        bankrollUnits: opts.bankrollUnits || 200,
        kellyCapFrac: typeof opts.kellyCapFrac === "number" ? opts.kellyCapFrac : 0.25
      };
    }

    resetAll(){
      this.rc = 0;
      this.cardsSeen = 0;
      this.history = []; // stack of {card, delta}
    }

    resetCountsOnly(){
      this.rc = 0;
      this.cardsSeen = 0;
      this.history = [];
    }

    setSettings(patch){
      this.settings = { ...this.settings, ...patch };
      // keep tray value within range
      this.settings.trayDecksRemaining = clamp(
        Number(this.settings.trayDecksRemaining || this.settings.decksInShoe),
        0.25,
        Number(this.settings.decksInShoe || 6)
      );
      this.settings.decksInShoe = clamp(Number(this.settings.decksInShoe || 6), 1, 8);
      this.settings.bankrollUnits = clamp(Number(this.settings.bankrollUnits || 200), 10, 100000);
      this.settings.kellyCapFrac = clamp(Number(this.settings.kellyCapFrac || 0.25), 0.05, 0.50);

      if(!CountSystems[this.settings.system]) this.settings.system = "HILO";
      if(!["SIM","CASINO"].includes(this.settings.tcMode)) this.settings.tcMode = "SIM";
    }

    getSystem(){
      return CountSystems[this.settings.system] || CountSystems.HILO;
    }

    weightFor(card){
      const sys = this.getSystem();
      return sys.weights[card] ?? 0;
    }

    addCard(cardInput){
      const card = normalizeCard(cardInput);
      if(!card) return { ok:false, error:"Invalid card" };

      const delta = this.weightFor(card);
      this.rc = this.rc + delta;
      this.cardsSeen += 1;
      this.history.push({ card, delta });
      return { ok:true };
    }

    undo(){
      const last = this.history.pop();
      if(!last) return { ok:false, error:"Nothing to undo" };
      this.rc = this.rc - last.delta;
      this.cardsSeen = Math.max(0, this.cardsSeen - 1);
      return { ok:true };
    }

    clearHand(){
      // For this trainer we treat "clear" as no-op, since we do not track separate hands.
      // UI uses it to clear temporary input, but cards are added instantly.
      return { ok:true };
    }

    shuffle(){
      this.resetCountsOnly();
      return { ok:true };
    }

    decksRemaining(){
      const decksInShoe = Number(this.settings.decksInShoe || 6);
      if(this.settings.tcMode === "CASINO"){
        return clamp(Number(this.settings.trayDecksRemaining || decksInShoe), 0.25, decksInShoe);
      }
      return decksRemainingFromSeen(decksInShoe, this.cardsSeen);
    }

    penetration(){
      const decksInShoe = Number(this.settings.decksInShoe || 6);
      const totalCards = decksInShoe * cardsPerDeck();
      const dealt = clamp(this.cardsSeen, 0, totalCards);
      return dealt / totalCards; // 0..1
    }

    trueCount(){
      const sys = this.getSystem();
      const decksRem = this.decksRemaining();
      const tc = this.rc / decksRem;
      return roundTo(tc, sys.decimals === 0 ? 1 : 2); // show more precision if fractional system
    }

    edgePct(){
      const tc = this.trueCount();
      const pen = this.penetration();
      return roundTo(estimateEdgePct(tc, pen), 1);
    }

    betUnits(){
      const edgePct = this.edgePct();
      return suggestBetUnits(edgePct, this.settings.bankrollUnits, this.settings.kellyCapFrac);
    }

    snapshot(){
      const sys = this.getSystem();
      const decksRem = this.decksRemaining();
      return {
        settings: { ...this.settings },
        systemName: sys.name,
        rc: roundTo(this.rc, sys.decimals),
        cardsSeen: this.cardsSeen,
        decksRemaining: roundTo(decksRem, 2),
        penetration: roundTo(this.penetration(), 4),
        tc: this.trueCount(),
        edgePct: this.edgePct(),
        betUnits: this.betUnits()
      };
    }

    exportJSON(){
      return JSON.stringify({
        v: 2,
        state: {
          rc: this.rc,
          cardsSeen: this.cardsSeen,
          history: this.history
        },
        settings: this.settings
      }, null, 2);
    }

    importJSON(jsonText){
      let obj;
      try{
        obj = JSON.parse(jsonText);
      }catch(e){
        return { ok:false, error:"Invalid JSON" };
      }
      if(!obj || !obj.state || !obj.settings) return { ok:false, error:"Missing fields" };
      const st = obj.state;

      this.rc = Number(st.rc || 0);
      this.cardsSeen = Number(st.cardsSeen || 0);
      this.history = Array.isArray(st.history) ? st.history : [];
      this.setSettings(obj.settings);
      return { ok:true };
    }
  }

  global.BJEngine = BJEngine;
  global.BJCountSystems = CountSystems;

})(window);
