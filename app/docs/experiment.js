// Cue (9 vs 2 of 10) x valence (others say OLD vs NEW) false-recognition task, plus a no-cue control group. No dependencies.
// Flow: consent -> instructions -> practice -> study 12 pseudowords + 12 real words (5 s each) -> 60 s shape task
//       -> 60-word recognition test (cue group: with cues) -> questions -> save (only at the very end) -> debrief.
// URL flags (testing only, data marked devMode): ?dev=1  ?fast=1 (timers x0.02)  ?bot=1 (auto-run, implies dev+fast)
(() => {
  "use strict";
  const CFG = window.CFG, T = CFG.text;
  const Q = new URLSearchParams(location.search);
  const BOT = Q.has("bot"), DEV = BOT || Q.has("dev"), TS = BOT || Q.has("fast") ? 0.02 : 1;
  // Data backend: "" = the Python server in this repo (same origin); otherwise a Google Apps Script web-app URL (see backend/).
  // ?backend=<url> overrides it in test mode only.
  const BACKEND = (DEV && Q.get("backend")) || CFG.backend || "";
  const { COND, CI, mulberry32, shuffle, buildPlan, buildPractice, goNoGoList, debriefFor, esc, median, sha, nextFrame, measureFrames, deviceInfo, makeCode } = window.WM;
  const S = { quit: false, finished: false, vis: [] };
  let log = () => {};                // anonymous stage-only progress log, set up after the group/version are known
  const $ = (s, r = document) => r.querySelector(s);
  const stage = $("#stage");

  // ---------- utilities ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * TS));
  const fetchText = (u) => fetch(u, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.text(); });
  const setStep = (t) => { $("#stepinfo").textContent = t; };

  // ---------- rendering ----------
  function render(html, cls = "") {
    if (S.quit) return;
    stage.className = cls; stage.innerHTML = html; window.scrollTo(0, 0);
    if (BOT) botAfterRender();
  }
  function info(html, label = "Continue") {
    return new Promise((res) => {
      render(`<div class="card">${html}<div class="actions"><button class="primary" data-next>${label}</button></div></div>`);
      $("[data-next]").addEventListener("click", () => res(), { once: true });
    });
  }
  function choice(selector, getVal, botPick) {
    return new Promise((res) => {
      const bs = [...stage.querySelectorAll(selector)];
      bs.forEach((b) => b.addEventListener("click", () => res(getVal(b)), { once: true }));
      if (BOT) setTimeout(() => (bs.find((b) => getVal(b) === botPick) || bs[0]).click(), 5);
    });
  }

  // ---------- forms ----------
  function fieldHtml(f) {
    const req = f.required !== false;
    const hint = (f.hint ? ` <span class="hint">${f.hint}</span>` : "") + (req ? "" : ' <span class="hint">(optional)</span>');
    const id = "f_" + f.name;
    const lab = (tag) => `<${tag === "label" ? `label for="${id}"` : 'span class="lab"'}>${f.label}${hint}</${tag === "label" ? "label" : "span"}>`;
    let body = "";
    if (f.type === "scale7") {
      body = `${lab("span")}<div class="scale">${[1, 2, 3, 4, 5, 6, 7].map((i) => `<label><span>${i}</span><input type="radio" name="${f.name}" value="${i}"></label>`).join("")}</div><div class="anchors"><span>${f.lo}</span><span>${f.hi}</span></div>`;
    } else if (f.type === "radio") {
      body = `${lab("span")}<div class="radios">${f.options.map((o) => `<label><input type="radio" name="${f.name}" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</div>`;
    } else if (f.type === "select") {
      body = `${lab("label")}<select id="${id}" name="${f.name}"><option value="">Select…</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
    } else if (f.type === "textarea") {
      body = `${lab("label")}<textarea id="${id}" name="${f.name}" maxlength="1500"></textarea>`;
    } else if (f.type === "number") {
      body = `${lab("label")}<input id="${id}" name="${f.name}" type="number" inputmode="numeric" min="${f.min}" max="${f.max}" step="1">`;
    } else {
      body = `${lab("label")}<input id="${id}" name="${f.name}" type="text" autocomplete="off" maxlength="200">`;
    }
    return `<div class="field" data-name="${f.name}">${body}<div class="err" hidden></div></div>`;
  }
  function readForm(fm, fields) {
    const fd = new FormData(fm), out = {}; let ok = true;
    for (const f of fields) {
      const err = fm.querySelector(`.field[data-name="${f.name}"] .err`); err.hidden = true;
      let v = fd.get(f.name); v = v == null ? "" : String(v).trim();
      let bad = "";
      if (f.required !== false && v === "") bad = "Please answer this question.";
      else if (f.type === "number" && v !== "") {
        const n = Number(v);
        if (!Number.isFinite(n) || n < f.min || n > f.max) bad = `Enter a whole number from ${f.min} to ${f.max}.`; else v = n;
      }
      if (bad) { ok = false; err.textContent = bad; err.hidden = false; }
      out[f.name] = f.type === "scale7" && v !== "" ? Number(v) : v;
    }
    if (!ok) { const e = fm.querySelector(".err:not([hidden])"); if (e) e.scrollIntoView({ block: "center" }); return null; }
    return out;
  }
  function form(title, intro, fields) {
    return new Promise((res) => {
      render(`<div class="card"><h2>${title}</h2>${intro ? `<p>${intro}</p>` : ""}<form data-form novalidate>${fields.map(fieldHtml).join("")}<div class="actions"><button class="primary" type="submit">Continue</button></div></form></div>`);
      const fm = $("form[data-form]");
      fm.addEventListener("submit", (e) => { e.preventDefault(); const v = readForm(fm, fields); if (v) res(v); });
    });
  }
  function botFill(fm) {
    fm.querySelectorAll(".field").forEach((fl) => {
      const rad = [...fl.querySelectorAll("input[type=radio]")];
      if (rad.length) { (rad[Math.min(4, rad.length - 1)]).checked = true; return; }
      const sel = fl.querySelector("select"); if (sel) { sel.selectedIndex = Math.min(2, sel.options.length - 1); return; }
      const num = fl.querySelector("input[type=number]"); if (num) { num.value = String(Math.max(Number(num.min) || 0, 20)); return; }
      const t = fl.querySelector("textarea,input[type=text]"); if (t) t.value = "bot";
    });
  }
  function botAfterRender() {
    setTimeout(() => {
      const fm = $("form[data-form]");
      if (fm) { botFill(fm); fm.requestSubmit(); return; }
      const cb = $("#agree"); if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
      const n = $("[data-next]"); if (n && !n.disabled) n.click();
    }, 5);
  }

  // ---------- task screens ----------
  async function studyPhase(words, ms) {
    const log = [];
    for (const w of words) {
      render(`<div class="center"><div class="word">${esc(w)}</div><div class="bar"><i style="animation-duration:${ms * TS}ms"></i></div></div>`, "study");
      const t0 = await nextFrame(); await sleep(ms);
      log.push({ word: w, shownMs: Math.round(performance.now() - t0) });
    }
    return log;
  }
  function trialHtml(t, keymap) {
    const left = keymap === 0 ? ["old", "OLD"] : ["new", "NEW"], right = keymap === 0 ? ["new", "NEW"] : ["old", "OLD"];
    const cue = t.cueCount == null ? `<div class="cue none">&nbsp;</div>` : `<div class="cue">${t.cueCount} of ${CFG.crowdN} other participants said <b>${t.cueValence}</b></div>`;
    return `<div class="center"><div class="word">${esc(t.word)}</div>
      ${cue}
      <div class="answers"><button data-resp="${left[0]}">${left[1]} <kbd>F</kbd></button><button data-resp="${right[0]}">${right[1]} <kbd>J</kbd></button></div></div>`;
  }
  function botResp(t) {
    const base = { oldP: 1.4, oldW: 1.4, lure: -1.1, foilW: -2.3, foilP: -2.0 }[t.status];
    const shift = t.cueCount == null ? 0 : (t.cueValence === "OLD" ? 1 : -1) * (t.cueCount >= 5 ? 1.6 : 0.5);
    return Math.random() < 1 / (1 + Math.exp(-(base + shift))) ? "old" : "new";
  }
  function getResponse(t, keymap) {
    return new Promise((res) => {
      let done = false;
      const keyOld = keymap === 0 ? "f" : "j";
      const fin = (resp, input) => { if (done) return; done = true; document.removeEventListener("keydown", onKey); res({ resp, input, at: performance.now() }); };
      const onKey = (e) => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase(); if (k === "f" || k === "j") fin(k === keyOld ? "old" : "new", "key");
      };
      document.addEventListener("keydown", onKey);
      stage.querySelectorAll("[data-resp]").forEach((b) => b.addEventListener("click", () => fin(b.dataset.resp, "click"), { once: true }));
      if (BOT) setTimeout(() => fin(botResp(t), "bot"), 5);
    });
  }
  async function recogTrial(t, keymap, n) {
    render(`<div class="center"><div class="fix">+</div></div>`); await sleep(CFG.fixationMs);
    render(trialHtml(t, keymap)); const t0 = await nextFrame();
    const hiddenAtOnset = document.visibilityState === "hidden";
    const r = await getResponse(t, keymap);
    const rt = BOT ? Math.round(600 + Math.random() * 900) : Math.round(r.at - t0);
    const hidden = hiddenAtOnset || S.vis.some((v) => v.t >= t0 && v.t <= r.at);
    render(`<div class="center"></div>`); await sleep(CFG.itiMs);
    return { trial: n, itemId: t.itemId, status: t.status, isOld: t.isOld, lexical: t.lexical, word: t.word, condition: t.cond, cueCount: t.cueCount, cueValence: t.cueValence,
      sim: t.sim, response: r.resp, correct: r.resp === (t.isOld ? "old" : "new"), rt, input: r.input, hidden };
  }
  async function catchTrial(t, after) {
    render(`<div class="card"><h2>Quick check</h2><p>For the <strong>last word</strong>, what did the other participants say?</p><div class="actions"><button data-v="OLD">OLD</button><button data-v="NEW">NEW</button></div></div>`);
    const flip = (x) => (x === "OLD" ? "NEW" : "OLD");
    const v = await choice("[data-v]", (b) => b.dataset.v, Math.random() < 0.9 ? t.cueValence : flip(t.cueValence));
    render(`<div class="card"><h2>Quick check</h2><p>How many of the ${CFG.crowdN} said <strong>${v}</strong> for that word?</p><div class="grid11">${Array.from({ length: CFG.crowdN + 1 }, (_, i) => `<button data-n="${i}">${i}</button>`).join("")}</div></div>`);
    const n = await choice("[data-n]", (b) => Number(b.dataset.n), Math.random() < 0.9 ? t.cueCount : 5);
    return { afterTrial: after, word: t.word, shownValence: t.cueValence, shownCount: t.cueCount, gotValence: v, gotCount: n, correct: v === t.cueValence && n === t.cueCount };
  }

  // go / no-go shape task between study and test (removes rehearsal of the list)
  async function distractor(seed) {
    const n = Math.round(CFG.distractorMs / CFG.distractorTrialMs);
    const seq = goNoGoList(mulberry32(seed ^ 0x51ed270b), n, CFG.goShare);
    const res = { n, hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 }, rts = [];
    for (const kind of seq) {
      render(`<div class="center"><div class="shape ${kind === "go" ? "circle" : "square"}"></div></div>`);
      const t0 = await nextFrame();
      let rt = null;
      const press = () => { if (rt === null) rt = performance.now() - t0; };
      const onKey = (e) => { if (e.code === "Space" || e.key === " ") { e.preventDefault(); press(); } };
      document.addEventListener("keydown", onKey); stage.addEventListener("pointerdown", press);
      if (BOT && kind === "go" && Math.random() < 0.85) setTimeout(press, 3);
      await sleep(CFG.distractorShowMs);
      render(`<div class="center"></div>`);
      await sleep(CFG.distractorTrialMs - CFG.distractorShowMs);
      document.removeEventListener("keydown", onKey); stage.removeEventListener("pointerdown", press);
      if (kind === "go") { if (rt === null) res.misses++; else { res.hits++; rts.push(Math.round(rt)); } }
      else if (rt === null) res.correctRejections++; else res.falseAlarms++;
    }
    res.meanRt = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null;
    return res;
  }

  // ---------- assignment, device, saving ----------
  async function assign() {
    if (DEV && Q.has("v")) return { version: Number(Q.get("v")) % 5, keymap: Number(Q.get("k") || 0) % 2, group: Q.get("g") === "control" ? "control" : "cue", ticket: null, source: "url" };
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 4000);
      const url = BACKEND ? `${BACKEND}${BACKEND.includes("?") ? "&" : "?"}action=assign` : CFG.endpoints.assign;
      const r = await fetch(url, { cache: "no-store", signal: ctl.signal }); clearTimeout(to);
      const j = await r.json();
      if (r.ok && [0, 1, 2, 3, 4].includes(j.version) && [0, 1].includes(j.keymap) && ["cue", "control"].includes(j.group)) return { version: j.version, keymap: j.keymap, group: j.group, ticket: j.ticket || null, source: "server" };
    } catch (e) { /* fall through */ }
    return { version: Math.floor(Math.random() * 5), keymap: Math.floor(Math.random() * 2), group: Math.random() < CFG.controlShare ? "control" : "cue", ticket: null, source: "client" };
  }
  async function trySave(payload) {
    for (let i = 0; i < 3; i++) {
      try {
        // text/plain keeps this a "simple" cross-origin request (no preflight), which Apps Script requires
        const r = await fetch(BACKEND || CFG.endpoints.save, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(payload) });
        let j = {}; try { j = await r.json(); } catch (e) { /* not json */ }
        if (j.ok || j.error === "duplicate code") return true;    // duplicate = an earlier try got through
        if (j.error && j.error !== "server") return false;        // rejected for good (bad payload, no consent, too big)
      } catch (e) { /* network error: retry */ }
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
    return false;
  }
  async function saveWithFallback(payload) {
    render(`<div class="card"><h2>Saving…</h2><p>Please wait.</p></div>`);
    while (!(await trySave(payload))) {
      const act = await new Promise((res) => {
        render(`<div class="card"><h2>Your answers could not be sent</h2><p>Check your internet connection and try again. If it keeps failing, download your data file and send it to the researchers.</p><div class="actions"><button data-act="dl">Download file</button><button class="primary" data-act="retry">Try again</button></div></div>`);
        stage.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => res(b.dataset.act)));
        if (BOT) setTimeout(() => $('[data-act="retry"]').click(), 5);
      });
      if (act === "dl") {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
        a.download = `${payload.participantCode}.json`; a.click();
        return "downloaded";
      }
    }
    return "saved";
  }
  // ---------- main flow ----------
  async function run() {
    if (DEV) window.__t = { form, F_LANG: WM.FIELDS.lang, catchTrial, CI }; // test hooks (screenshots)
    document.addEventListener("visibilitychange", () => S.vis.push({ t: Math.round(performance.now()), s: document.visibilityState }));
    $("#quit").hidden = false;
    WM.guardUnload(() => !S.quit && !S.finished, DEV);
    $("#quit").addEventListener("click", () => {
      if (!BOT && !confirm(T.quitConfirm)) return;
      log("quit");
      S.quit = true; stage.className = ""; stage.innerHTML = `<div class="card">${T.quitDone}</div>`; $("#quit").hidden = true; setStep("");
    });

    const [stim, consentHtml, debriefHtml] = await Promise.all([
      fetch("stimuli.json", { cache: "no-store" }).then((r) => r.json()), fetchText("content/consent.html"), fetchText("content/debrief.html")]);
    const PLACEHOLDER = "PLACEHOLDER-NOT-FOR-PARTICIPANTS";
    if (!DEV) {
      let done = false; try { done = localStorage.getItem("wm_done") === "1"; } catch (e) { /* ignore */ }
      if (done) return render(`<div class="card">${T.alreadyDone}</div>`);
      if (CFG.requireRealConsent && (consentHtml.includes(PLACEHOLDER) || debriefHtml.includes(PLACEHOLDER))) return render(`<div class="card">${T.noConsentText}</div>`);
    }

    const startISO = new Date().toISOString(), t00 = performance.now();
    setStep("Consent");
    const warn = DEV ? `<div class="warn">Test mode: data are marked as dev and are not real data.</div>` : "";
    const consent = await new Promise((res) => {
      render(`<div class="card">${warn}<div class="scroll">${consentHtml}</div><label class="agree"><input type="checkbox" id="agree"><span>I have read the information above, I am 18 or older, and I agree to take part.</span></label><div class="actions"><button class="primary" data-next disabled>Start</button></div></div>`);
      const cb = $("#agree"), nb = $("[data-next]");
      cb.addEventListener("change", () => { nb.disabled = !cb.checked; });
      nb.addEventListener("click", async () => res({ agreed: true, ts: new Date().toISOString(), textSha256: await sha(consentHtml) }));
    });

    const asg = await assign();
    log = WM.progressLogger(BACKEND || CFG.endpoints.save, asg, DEV);
    log("consent");
    window.addEventListener("pagehide", () => { if (!S.finished && !S.quit && log.closed) log.closed(); });
    const seed = BOT && Q.has("seed") ? Number(Q.get("seed")) : crypto.getRandomValues(new Uint32Array(1))[0];
    const control = asg.group === "control";
    const plan = buildPlan(stim, asg.version, seed, asg.group);
    const prac = buildPractice(stim, mulberry32(seed ^ 0x9e3779b9), asg.group);
    const frameMs = await measureFrames();

    setStep("Instructions"); log("instructions");
    if (matchMedia("(pointer:coarse)").matches || innerWidth < 700)
      await info(`<div class="warn">This study works best on a laptop or desktop computer with a keyboard. You can continue on this device, but a computer is better.</div>`);
    await info(T.intro);
    if (!control) await info(T.cueExplain);

    setStep("Practice"); log("practice");
    await info(T.practiceIntro); await info(T.practiceStudyGo, "Start");
    await studyPhase(prac.study, CFG.practiceStudyMs);
    await info(T.practiceTestGo, "Start");
    const practice = []; let pn = 0;
    for (const t of prac.order) practice.push(await recogTrial(t, asg.keymap, ++pn));

    setStep("Part 1 of 2"); log("study");
    await info(T.realStudyGo, "Start the list");
    const studyLog = await studyPhase(plan.studyOrder, CFG.studyMs);

    setStep("Shape task"); log("distractor");
    await info(T.distractorGo, "Start");
    const distr = await distractor(seed);

    setStep("Part 2 of 2"); log("test");
    await info(control ? T.realTestGoControl : T.realTestGo, "Start");
    const trials = [], catches = []; let n = 0;
    for (const t of plan.order) {
      const rec = await recogTrial(t, asg.keymap, ++n); trials.push(rec);
      if (n === 1 || n % 10 === 0) log("test", n);
      if (plan.catches.includes(n)) catches.push(await catchTrial(t, n));
    }

    setStep("A few questions"); log("questions");
    const q = {};
    Object.assign(q, await form("A few questions", "", WM.FIELDS.open));
    if (!control) Object.assign(q, await form("A few questions", "", WM.FIELDS.check));
    Object.assign(q, await form("About your languages", "These help us interpret the results. Your answers are anonymous.", WM.FIELDS.lang));
    Object.assign(q, await form("About you", "", WM.FIELDS.demo));

    if (S.quit) return;                 // someone who clicked Quit never reaches the save
    const code = makeCode();
    const payload = {
      schema: CFG.schema, appVersion: CFG.appVersion, devMode: DEV, bot: BOT, participantCode: code, ticket: asg.ticket,
      assignment: { group: asg.group, version: asg.version, keymap: asg.keymap, source: asg.source, seed, orderTries: plan.orderTries },
      consent, device: deviceInfo(frameMs),
      timing: { startISO, endISO: new Date().toISOString(), durationMs: Math.round(performance.now() - t00) },
      design: { cueHigh: CFG.cueHigh, cueLow: CFG.cueLow, crowdN: CFG.crowdN, studyMs: CFG.studyMs, distractorMs: CFG.distractorMs, stimuliSeed: stim.seed, stimuliSource: stim.source },
      study: { order: plan.studyOrder, kinds: plan.studyKinds, log: studyLog }, distractor: distr, practice, trials, catches,
      attention: { catchCorrect: catches.filter((c) => c.correct).length, catchTotal: catches.length },
      visibility: S.vis, questionnaire: q,
    };
    $("#quit").hidden = true;   // no quitting while the answers are being sent
    log("saving");
    const how = await saveWithFallback(payload);
    S.finished = true; log(how === "saved" ? "complete" : "downloaded");
    if (how === "saved" && !DEV) { try { localStorage.setItem("wm_done", "1"); } catch (e) { /* ignore */ } }
    setStep("Finished"); $("#quit").hidden = true;
    render(`<div class="card">${debriefFor(debriefHtml, asg.group, code)}</div>`);
    window.__done = true; window.__result = { code, how, trials: trials.length, catches: catches.length };
  }

  run().catch((e) => {
    console.error(e); window.__error = String(e && e.stack || e);
    stage.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>Please reload the page. If it happens again, tell the researchers.</p></div>`;
  });
})();
