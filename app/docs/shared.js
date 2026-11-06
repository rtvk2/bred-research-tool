// Design logic shared by both engines (custom app: experiment.js; jsPsych version: jspsych/experiment-jspsych.js),
// so counterbalancing, cue assignment and questionnaires are identical whichever engine runs.
window.WM = (() => {
  "use strict";
  const CFG = window.CFG;
  const COND = ["HO", "LO", "HN", "LN", "NC"]; // high-OLD, low-OLD, high-NEW, low-NEW, no cue (within-person baseline)
  const N_COND = COND.length;
  const CI = {
    HO: { count: CFG.cueHigh, val: "OLD" }, LO: { count: CFG.cueLow, val: "OLD" },
    HN: { count: CFG.cueHigh, val: "NEW" }, LN: { count: CFG.cueLow, val: "NEW" },
  };
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // ---------- design / counterbalancing ----------
  // Five kinds of test word, 12 each: studied pseudowords (oldP), studied real words (oldW), unseen real-word neighbours of
  // studied pseudowords (lure), unrelated unseen real words (foilW) and unrelated unseen pseudowords (foilP). Studied real
  // words and pseudoword foils keep lexicality (word / non-word) from predicting OLD vs NEW.
  // Five conditions per participant: the four cue cells (HO, LO, HN, LN) and NC = no cue shown (a within-person baseline).
  // Studied pseudowords and lures: 15 words, 3 in each condition. The other kinds: 10 words, 2 in each condition. The version
  // (0-4) rotates which words get which condition, so every word appears in every condition equally often across participants.
  // An optional between-participants "control" group (all NC) still works in the code but is not used.
  const KINDS = ["oldP", "oldW", "lure", "foilW", "foilP"];
  const OFF = { oldP: 0, lure: 1, foilW: 2, foilP: 3, oldW: 2 };
  const IS_OLD = { oldP: true, oldW: true, lure: false, foilW: false, foilP: false };
  const LEX = { oldP: "nonword", oldW: "word", lure: "word", foilW: "word", foilP: "nonword" };
  function wordsByKind(stim) {
    return {
      oldP: stim.items.map((it) => ({ id: it.id, word: it.pseudo, sim: 1 })),
      lure: stim.items.map((it) => ({ id: it.id, word: it.real, sim: it.sim })),
      oldW: stim.studyReals.map((s) => ({ id: s.id, word: s.word, sim: null })),
      foilW: stim.foils.map((f) => ({ id: f.id, word: f.real, sim: f.simReal })),
      foilP: stim.foils.map((f) => ({ id: f.id, word: f.pseudo, sim: f.simPseudo })),
    };
  }
  const runOK = (arr, key, max) => { let run = 1; for (let i = 1; i < arr.length; i++) { run = arr[i][key] === arr[i - 1][key] ? run + 1 : 1; if (run > max) return false; } return true; };
  function buildPlan(stim, version, seed, group) {
    const control = group === "control", rnd = mulberry32(seed), wk = wordsByKind(stim), trials = [];
    KINDS.forEach((kind) => wk[kind].forEach((w, i) => {
      const cond = control ? "NC" : COND[(i + version + OFF[kind]) % N_COND];
      trials.push({ itemId: w.id, status: kind, isOld: IS_OLD[kind], lexical: LEX[kind], word: w.word, cond,
        cueCount: cond === "NC" ? null : CI[cond].count, cueValence: cond === "NC" ? null : CI[cond].val, sim: w.sim });
    }));
    let order, tries = 0;
    do { order = shuffle(trials, rnd); tries++; }
    while (!(runOK(order, "status", CFG.maxStatusRun) && (control || runOK(order, "cueValence", CFG.maxValenceRun))) && tries < 3000);
    const [lo, hi] = CFG.catchEligible; let catches = [];
    const eligible = order.map((t, i) => i + 1).filter((n) => n >= lo && n <= hi && order[n - 1].cueCount != null);   // a check can only follow a trial that showed a cue
    for (let k = 0; !control && k < 800; k++) {
      const c = [];
      while (c.length < CFG.catchTrials) { const p = eligible[Math.floor(rnd() * eligible.length)]; if (!c.includes(p)) c.push(p); }
      c.sort((a, b) => a - b);
      if (c.every((p, i) => i === 0 || p - c[i - 1] >= 5)) { catches = c; break; }
    }
    const studyKinds = {};
    [...wk.oldP, ...wk.oldW].forEach((w, i) => { studyKinds[w.word] = i < wk.oldP.length ? "oldP" : "oldW"; });
    const lexOf = (w) => LEX[studyKinds[w]];
    let studyOrder, st = 0;
    do { studyOrder = shuffle(Object.keys(studyKinds), rnd); st++; }
    while (!runOK(studyOrder.map((w) => ({ lex: lexOf(w) })), "lex", 3) && st < 3000);
    return { order, catches, studyOrder, studyKinds, orderTries: tries };
  }
  function buildPractice(stim, rnd, group) {
    const control = group === "control";
    const words = shuffle([...stim.practice.old.map((w) => ["oldP", w]), ...stim.practice.new.map((w) => ["foilW", w])], rnd);
    const conds = shuffle(["HO", "LN", "LO", "HN"], rnd);
    return { study: stim.practice.study, order: words.map(([status, word], i) => ({ itemId: null, status, isOld: IS_OLD[status], lexical: LEX[status], word,
      cond: control ? "NC" : conds[i], cueCount: control ? null : CI[conds[i]].count, cueValence: control ? null : CI[conds[i]].val, sim: null })) };
  }
  // distractor: go (circle) / no-go (square), goShare of the trials are go
  function goNoGoList(rnd, n, goShare) {
    const nGo = Math.round(n * goShare);
    return shuffle(Array.from({ length: n }, (_, i) => (i < nGo ? "go" : "nogo")), rnd);
  }
  // keep only the debrief sections for this group (<div data-group="cue">...</div> / data-group="control") and insert the code
  function debriefFor(html, group, code) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("[data-group]").forEach((el) => { if (el.getAttribute("data-group") !== group) el.remove(); });
    return doc.body.innerHTML.replace("{{CODE}}", esc(code));
  }

  // ---------- questionnaire definitions ----------
  const F_OPEN = [
    { name: "aboutOpen", type: "textarea", label: "What do you think this study was about?" },
    { name: "oddOpen", type: "textarea", label: "Did anything about the task seem odd or unusual? If so, what?", required: false },
  ];
  const F_CHECK = [
    { name: "believable", type: "scale7", label: `How real did the answers of the other participants seem to you?`, lo: "Definitely invented", hi: "Definitely real" },
    { name: "influence", type: "scale7", label: "How much did what the other participants said influence your own answers?", lo: "Not at all", hi: "Very much" },
  ];
  const F_LANG = [
    { name: "firstLanguage", type: "select", label: "What is your first language (the one you learned first at home)?", options: CFG.languages },
    { name: "firstLanguageOther", type: "text", label: "If you chose Other, which language?", required: false },
    { name: "otherLanguages", type: "text", label: "Other languages you use regularly", required: false },
    { name: "ageEnglish", type: "number", label: "At what age did you start learning English?", hint: "Enter 0 if from birth.", min: 0, max: 40 },
    { name: "schoolMedium", type: "radio", label: "Language of instruction at your school", options: ["English", "A language other than English", "Both"] },
    { name: "englishShare", type: "select", label: "About how much of what you read each day is in English?", options: ["0-20%", "21-40%", "41-60%", "61-80%", "81-100%"] },
    { name: "englishEase", type: "scale7", label: "How easy is it for you to read English?", lo: "Very difficult", hi: "Very easy" },
  ];
  const F_DEMO = [
    { name: "age", type: "number", label: "Your age in years", min: 18, max: 99 },
    { name: "gender", type: "select", label: "Gender", options: ["Woman", "Man", "Non-binary", "Prefer to self-describe", "Prefer not to say"] },
    { name: "degree", type: "select", label: "Current programme", options: ["Undergraduate", "Master's", "PhD", "Other", "Prefer not to say"] },
    { name: "priorParticipation", type: "radio", label: "Have you already taken part in this study, or in a trial run of it?", options: ["No", "Yes", "Not sure"] },
  ];

  // ---- helpers used by both engines ----
  const nextFrame = () => new Promise((r) => {
    let d = false; const fin = () => { if (!d) { d = true; r(performance.now()); } };
    requestAnimationFrame(() => requestAnimationFrame(fin)); setTimeout(fin, 120);
  });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  async function sha(s) {
    try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
    catch (e) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return "djb2-" + (h >>> 0).toString(16); }
  }
  async function measureFrames() {
    const d = []; let last = await nextFrame();
    for (let i = 0; i < 20; i++) { const t = await nextFrame(); d.push(t - last); last = t; }
    return Math.round(median(d) * 10) / 10;
  }
  function deviceInfo(frameMs) {
    const ua = navigator.userAgent;
    return { browser: /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "other",
      os: /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "other",
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio, coarsePointer: matchMedia("(pointer:coarse)").matches, frameMs, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
  function makeCode() {
    const al = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", a = new Uint8Array(8); crypto.getRandomValues(a);
    return "WM-" + [...a].map((x) => al[x % al.length]).join("");
  }

  // warn before an accidental close/reload while a session is running (not in test mode)
  function guardUnload(isActive, dev) {
    window.addEventListener("beforeunload", (e) => { if (!dev && isActive()) { e.preventDefault(); e.returnValue = ""; } });
  }
  return { guardUnload, goNoGoList, debriefFor, KINDS, IS_OLD, LEX, esc, median, sha, nextFrame, measureFrames, deviceInfo, makeCode, COND, CI, mulberry32, shuffle, buildPlan, buildPractice, FIELDS: { open: F_OPEN, check: F_CHECK, lang: F_LANG, demo: F_DEMO } };
})();
