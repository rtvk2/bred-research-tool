// jsPsych 7.3.4 version of the same experiment (standard library, standard plugins).
// Same stimuli.json, same counterbalancing and questionnaires (../shared.js), same data schema as the custom app,
// so server.py / Apps Script / tools/summarise.py work unchanged. Test flags all need ?dev=1414: &fast=1  &bot=1  &touch=1 (act as a phone).
(async () => {
  "use strict";
  const CFG = window.CFG, T = CFG.text, WM = window.WM;
  const Q = new URLSearchParams(location.search);
  const DEV = Q.get("dev") === CFG.devCode;   // test mode needs the code, so nobody lands in it by mistake
  const BOT = DEV && Q.has("bot"), TS = DEV && (BOT || Q.has("fast")) ? 0.02 : 1;
  const ROOT = new URL("../", location.href);
  const BO = DEV ? Q.get("backend") : null;   // test mode only: ?backend=<url> overrides, ?backend=local keeps data on this server
  const BACKEND = BO === "local" ? "" : (BO || CFG.backend || "");
  const { esc } = WM;
  const $ = (s) => document.querySelector(s);
  const stage = $("#stage");
  stage.tabIndex = -1;
  const S = { quit: false, finished: false, vis: [], t0: 0 };
  // phone or tablet (coarse pointer): tap buttons instead of the F / J keys. ?touch=1 forces it in test mode.
  const TOUCH = (DEV && Q.has("touch")) || matchMedia("(pointer:coarse)").matches;
  // keep the screen on: a phone would otherwise dim during the 2 minute word list
  let wake = null;
  const keepAwake = async () => { try { if ("wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } } catch (e) { /* not supported or refused: ignore */ } };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !S.finished && !S.quit) keepAwake(); });
  let log = () => {};                // anonymous stage-only progress log, set up after the group/version are known
  const STAGE = { "Instructions": "instructions", "Practice": "practice", "Part 1 of 2": "study", "Shape task": "distractor", "Part 2 of 2": "test", "A few questions": "questions" };
  const step = (t) => { $("#stepinfo").textContent = t; if (STAGE[t]) log(STAGE[t]); };
  const card = (html) => `<div class="card">${html}</div>`;

  // ---------- load ----------
  const getText = (u) => fetch(new URL(u, ROOT), { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.text(); });
  const [stimText, consentHtml, debriefHtml] = await Promise.all([getText("stimuli.json"), getText("content/consent.html"), getText("content/debrief.html")]);
  const stim = JSON.parse(stimText);
  const PLACEHOLDER = "PLACEHOLDER-NOT-FOR-PARTICIPANTS";
  if (!DEV) {
    let done = false; try { done = localStorage.getItem("wm_done") === "1"; } catch (e) { /* ignore */ }
    if (done) { stage.innerHTML = card(T.alreadyDone); return; }
    if (CFG.requireRealConsent && (consentHtml.includes(PLACEHOLDER) || debriefHtml.includes(PLACEHOLDER))) { stage.innerHTML = card(T.noConsentText); return; }
  }
  document.addEventListener("visibilitychange", () => S.vis.push({ t: Math.round(performance.now()), s: document.visibilityState }));

  // ---------- assignment ----------
  async function assign() {
    if (DEV && Q.has("v")) return { version: Number(Q.get("v")) % 5, keymap: Number(Q.get("k") || 0) % 2, group: Q.get("g") === "control" ? "control" : "cue", ticket: null, source: "url" };
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 4000);
      const url = BACKEND ? `${BACKEND}${BACKEND.includes("?") ? "&" : "?"}action=assign` : new URL(CFG.endpoints.assign, ROOT).href;
      const r = await fetch(url, { cache: "no-store", signal: ctl.signal }); clearTimeout(to);
      const j = await r.json();
      if (r.ok && [0, 1, 2, 3, 4].includes(j.version) && [0, 1].includes(j.keymap) && ["cue", "control"].includes(j.group)) return { version: j.version, keymap: j.keymap, group: j.group, ticket: j.ticket || null, source: "server" };
    } catch (e) { /* fall through */ }
    return { version: Math.floor(Math.random() * 5), keymap: Math.floor(Math.random() * 2), group: Math.random() < CFG.controlShare ? "control" : "cue", ticket: null, source: "client" };
  }
  const asg = await assign();
  log = WM.progressLogger(BACKEND || new URL(CFG.endpoints.save, ROOT).href, asg, DEV);
  window.addEventListener("pagehide", () => { if (!S.finished && !S.quit && log.closed) log.closed(); });
  const seed = BOT && Q.has("seed") ? Number(Q.get("seed")) : crypto.getRandomValues(new Uint32Array(1))[0];
  const control = asg.group === "control";
  const plan = WM.buildPlan(stim, asg.version, seed, asg.group);
  const prac = WM.buildPractice(stim, WM.mulberry32(seed ^ 0x9e3779b9), asg.group);
  const keyOld = asg.keymap === 0 ? "f" : "j";
  const frameMs = await WM.measureFrames();
  const consentSha = await WM.sha(consentHtml);
  const startISO = new Date().toISOString(), tStart = performance.now();
  let consent = null, jsPsych = null, payload = null;
  const saveState = { ok: false, choice: null };

  // ---------- trial builders ----------
  const K = jsPsychHtmlKeyboardResponse, B = jsPsychHtmlButtonResponse, F = jsPsychSurveyHtmlForm, C = jsPsychCallFunction;
  // wait = ms the button stays disabled, so a tap meant for the previous screen cannot skip this one
  const info = (html, label = "Continue", wait = 0) => ({ type: B, stimulus: card(html), choices: [label], enable_button_after: BOT ? 0 : wait * TS, data: { task: "info" } });
  const setStep = (t) => ({ type: C, func: () => step(t), data: { task: "step" } });
  const studyTrials = (words, ms, task) => words.map((w) => ({
    type: K, stimulus: `<div class="center"><div class="word">${esc(w)}</div><div class="bar"><i style="animation-duration:${ms * TS}ms"></i></div></div>`,
    choices: "NO_KEYS", trial_duration: ms * TS, data: { task, word: w },
    on_load: () => { S.t0 = performance.now(); }, on_finish: (d) => { d.shownMs = Math.round(performance.now() - S.t0); },
  }));
  const hint = (resp, label, key) => `<span class="hintbox">${label} <kbd>${key}</kbd></span>`;
  const labels = asg.keymap === 0 ? ["OLD", "NEW"] : ["NEW", "OLD"];   // left, right: same counterbalancing as the F / J keys
  const wordCue = (t) => {
    const cue = t.cueCount == null ? `<div class="cue none">&nbsp;</div>` : `<div class="cue">${t.cueCount} of ${CFG.crowdN} other participants said <b>${t.cueValence}</b></div>`;
    return `<div class="word">${esc(t.word)}</div>
      ${cue}`;
  };
  const trialHtml = (t) => {
    const left = asg.keymap === 0 ? hint("old", "OLD", "F") : hint("new", "NEW", "F"), right = asg.keymap === 0 ? hint("new", "NEW", "J") : hint("old", "OLD", "J");
    return `<div class="center" data-trial="1">${wordCue(t)}
      <div class="answers">${left}${right}</div></div>`;
  };
  const touchHtml = (t) => `<div class="center short" data-trial="1">${wordCue(t)}</div>`;   // the standard button plugin adds the two answer buttons below
  const testTrials = (t, n, task) => {
    const meta = { task, trial: n, itemId: t.itemId, status: t.status, isOld: t.isOld, lexical: t.lexical, word: t.word, condition: t.cond, cueCount: t.cueCount, cueValence: t.cueValence, sim: t.sim };
    const start = (tr) => { tr.data.v0 = S.vis.length; tr.data.hiddenAtOnset = document.visibilityState === "hidden"; };
    const finish = (d, resp, input) => {
      d.resp = resp; d.input = input; d.correct = d.resp === (d.isOld ? "old" : "new");
      d.hidden = d.hiddenAtOnset || S.vis.length > d.v0;
      if (d.task === "test" && (d.trial === 1 || d.trial % 10 === 0)) log("test", d.trial);
      if (BOT) d.rt = Math.round(600 + Math.random() * 900);
    };
    const answer = TOUCH
      ? { type: B, stimulus: touchHtml(t), choices: labels, button_html: '<button class="jspsych-btn answerbtn">%choice%</button>', margin_horizontal: "6px", post_trial_gap: CFG.itiMs * TS,
          data: meta, on_start: start, on_finish: (d) => finish(d, labels[d.response].toLowerCase(), "touch") }
      : { type: K, stimulus: trialHtml(t), choices: ["f", "j"], post_trial_gap: CFG.itiMs * TS, data: meta, on_start: start,
          on_load: () => { stage.focus({ preventScroll: true }); },   // jsPsych listens for keys on the display element, so it must have focus
          on_finish: (d) => finish(d, (d.response || "").toLowerCase() === keyOld ? "old" : "new", "key") };
    return [{ type: K, stimulus: `<div class="center"><div class="fix">+</div></div>`, choices: "NO_KEYS", trial_duration: CFG.fixationMs * TS, data: { task: "fix" } }, answer];
  };
  const catchTrials = (t, after) => [
    { type: B, stimulus: card(`<h2>Quick check</h2><p>For the <strong>last word</strong>, what did the other participants say?</p>`), choices: ["OLD", "NEW"],
      data: { task: "catch1", afterTrial: after, word: t.word, shownValence: t.cueValence, shownCount: t.cueCount },
      on_finish: (d) => { d.gotValence = ["OLD", "NEW"][d.response]; } },
    { type: B, stimulus: () => { const p = jsPsych.data.get().last(1).values()[0]; return card(`<h2>Quick check</h2><p>How many of the ${CFG.crowdN} said <strong>${p.gotValence}</strong> for that word?</p>`); },
      choices: Array.from({ length: CFG.crowdN + 1 }, (_, i) => String(i)),
      data: { task: "catch2", afterTrial: after, shownValence: t.cueValence, shownCount: t.cueCount },
      on_finish: (d) => { d.gotCount = d.response; d.gotValence = jsPsych.data.get().filter({ task: "catch1" }).last(1).values()[0].gotValence; d.correct = d.gotValence === d.shownValence && d.gotCount === d.shownCount; } },
  ];
  const fieldsHtml = (fields) => fields.map((f) => {
    const opt = f.required === false, req = opt ? "" : " required";
    const label = `${f.label}${f.hint ? ` <span class="hint">${f.hint}</span>` : ""}${opt ? ' <span class="hint">(optional)</span>' : ""}`;
    let body;
    if (f.type === "scale7") body = `<span class="lab">${label}</span><div class="scale">${[1, 2, 3, 4, 5, 6, 7].map((i) => `<label><span>${i}</span><input type="radio" name="${f.name}" value="${i}"${i === 1 ? req : ""}></label>`).join("")}</div><div class="anchors"><span>${f.lo}</span><span>${f.hi}</span></div>`;
    else if (f.type === "radio") body = `<span class="lab">${label}</span><div class="radios">${f.options.map((o, i) => `<label><input type="radio" name="${f.name}" value="${esc(o)}"${i === 0 ? req : ""}> ${esc(o)}</label>`).join("")}</div>`;
    else if (f.type === "select") body = `<label class="lab">${label}</label><select name="${f.name}"${req}><option value="">Select…</option>${f.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
    else if (f.type === "textarea") body = `<label class="lab">${label}</label><textarea name="${f.name}" maxlength="1500"${req}></textarea>`;
    else if (f.type === "number") body = `<label class="lab">${label}</label><input type="number" name="${f.name}" min="${f.min}" max="${f.max}" step="1"${req}>`;
    else body = `<label class="lab">${label}</label><input type="text" name="${f.name}" maxlength="200" autocomplete="off"${req}>`;
    return `<div class="field">${body}</div>`;
  }).join("");
  const formTrial = (title, intro, fields, key) => ({
    type: F, preamble: `<h2>${title}</h2>${intro ? `<p>${intro}</p>` : ""}`, html: fieldsHtml(fields), button_label: "Continue", data: { task: "form", key },
    on_finish: (d) => { fields.forEach((f) => { const v = d.response[f.name]; d.response[f.name] = (f.type === "scale7" || f.type === "number") && v !== "" && v != null ? Number(v) : (v == null ? "" : String(v).trim()); }); },
  });

  // distractor: one go (circle) or no-go (square) shape per second
  const distractorTrials = (seqSeed) => WM.goNoGoList(WM.mulberry32(seqSeed ^ 0x51ed270b), Math.round(CFG.distractorMs / CFG.distractorTrialMs), CFG.goShare).map((kind) => {
    const shape = `<div class="shape ${kind === "go" ? "circle" : "square"}"></div>`;
    const timing = { stimulus_duration: CFG.distractorShowMs * TS, trial_duration: CFG.distractorTrialMs * TS, response_ends_trial: false, data: { task: "distractor", go: kind === "go" } };
    return TOUCH
      ? { type: B, stimulus: `<div class="center short">${shape}</div>`, choices: ["TAP"], button_html: '<button class="jspsych-btn tapbtn">%choice%</button>', ...timing }   // tap button stays on screen while the shape comes and goes
      : { type: K, stimulus: `<div class="center">${shape}</div>`, choices: [" "], on_load: () => { stage.focus({ preventScroll: true }); }, ...timing };
  });
  const distractorSummary = (rows) => {
    const r = { n: rows.length, hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 }, rts = [];
    rows.forEach((d) => { const pressed = d.response !== null && d.response !== undefined; if (d.go) { if (pressed) { r.hits++; rts.push(d.rt); } else r.misses++; } else if (pressed) r.falseAlarms++; else r.correctRejections++; });
    r.meanRt = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null;
    return r;
  };

  // ---------- payload ----------
  function buildPayload() {
    const get = (task) => jsPsych.data.get().filter({ task }).values();
    const rec = (d) => ({ trial: d.trial, itemId: d.itemId, status: d.status, isOld: d.isOld, lexical: d.lexical, word: d.word, condition: d.condition, cueCount: d.cueCount, cueValence: d.cueValence,
      sim: d.sim, response: d.resp, correct: d.correct, rt: Math.round(d.rt), input: d.input || "key", hidden: d.hidden });
    const c1 = get("catch1"), c2 = get("catch2");
    const catches = c2.map((d, i) => ({ afterTrial: d.afterTrial, word: c1[i].word, shownValence: d.shownValence, shownCount: d.shownCount, gotValence: d.gotValence, gotCount: d.gotCount, correct: d.correct }));
    const q = {}; get("form").forEach((d) => Object.assign(q, d.response));
    return {
      schema: CFG.schema, appVersion: CFG.appVersion, engine: "jspsych 7.3.4", devMode: DEV, bot: BOT, participantCode: WM.makeCode(), ticket: asg.ticket,
      assignment: { group: asg.group, version: asg.version, keymap: asg.keymap, source: asg.source, seed, orderTries: plan.orderTries },
      consent, device: WM.deviceInfo(frameMs),
      timing: { startISO, endISO: new Date().toISOString(), durationMs: Math.round(performance.now() - tStart) },
      design: { cueHighValues: CFG.cueHighValues, cueLowValues: CFG.cueLowValues, crowdN: CFG.crowdN, studyMs: CFG.studyMs, distractorMs: CFG.distractorMs, stimuliSeed: stim.seed, stimuliSource: stim.source },
      study: { order: plan.studyOrder, kinds: plan.studyKinds, log: get("study").map((d) => ({ word: d.word, shownMs: d.shownMs })) },
      distractor: distractorSummary(get("distractor")),
      practice: get("practice").map(rec), trials: get("test").map(rec), catches,
      attention: { catchCorrect: catches.filter((c) => c.correct).length, catchTotal: catches.length },
      visibility: S.vis, questionnaire: q,
    };
  }
  async function trySave(p) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(BACKEND || new URL(CFG.endpoints.save, ROOT).href, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(p) });
        let j = {}; try { j = await r.json(); } catch (e) { /* not json */ }
        if (j.ok || j.error === "duplicate code") return true;
        if (j.error && j.error !== "server") return false;
      } catch (e) { /* retry */ }
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
    return false;
  }

  // ---------- timeline ----------
  const warn = DEV ? `<div class="warn">Test mode: data are marked as dev and are not real data.</div>` : "";
  const consentTrial = {
    type: F, html: `${warn}<div class="scroll">${consentHtml}</div><label class="agree"><input type="checkbox" name="agree" required><span>I have read the information above, I am 18 or older, and I agree to take part.</span></label><label class="agree"><input type="checkbox" name="share"><span>${T.shareLabel}</span></label>`,
    button_label: "Start", data: { task: "consent" },
    on_finish: (d) => { consent = { agreed: d.response.agree === "on", dataSharing: d.response.share === "on", ts: new Date().toISOString(), textSha256: consentSha }; log("consent"); keepAwake(); },
  };
  const timeline = [setStep("Consent"), consentTrial, setStep("Instructions")];
  timeline.push(...(TOUCH ? [info(T.phoneNote)] : []), info(T.intro), ...(control ? [] : [info(T.cueExplain)]), setStep("Practice"), info(T.practiceIntro), info(T.practiceStudyGo, "Start"));
  timeline.push(...studyTrials(prac.study, CFG.practiceStudyMs, "practice_study"), info(TOUCH ? T.practiceTestGoTouch : T.practiceTestGo, "Start"));
  prac.order.forEach((t, i) => timeline.push(...testTrials(t, i + 1, "practice")));
  timeline.push(setStep("Part 1 of 2"), info(T.realStudyGo, "Start the list"), ...studyTrials(plan.studyOrder, CFG.studyMs, "study"));
  timeline.push(setStep("Shape task"), info(TOUCH ? T.distractorGoTouch : T.distractorGo, "Start"), ...distractorTrials(seed));
  timeline.push(setStep("Part 2 of 2"), info(control ? T.realTestGoControl : T.realTestGo, "Start", 1000));
  plan.order.forEach((t, i) => {
    timeline.push(...testTrials(t, i + 1, "test"));
    if (plan.catches.includes(i + 1)) timeline.push(...catchTrials(t, i + 1));
  });
  timeline.push(setStep("A few questions"),
    formTrial("A few questions", "", WM.FIELDS.open, "open"), ...(control ? [] : [formTrial("A few questions", "", WM.FIELDS.check, "check")]),
    formTrial("About your languages", "These help us interpret the results. Your answers are anonymous.", WM.FIELDS.lang, "lang"),
    formTrial("About you", "", WM.FIELDS.demo, "demo"));
  timeline.push({
    timeline: [
      { type: C, async: true, func: (done) => { $("#quit").hidden = true; log("saving"); payload = payload || buildPayload(); trySave(payload).then((ok) => { saveState.ok = ok; done(); }); }, data: { task: "save" } },
      { conditional_function: () => !saveState.ok, type: B, choices: ["Download file", "Try again"], data: { task: "savefail" },
        stimulus: card(`<h2>Your answers could not be sent</h2><p>Check your internet connection and try again. If it keeps failing, download your data file and send it to the researchers.</p>`),
        on_finish: (d) => {
          saveState.choice = d.response;
          if (d.response === 0) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" })); a.download = payload.participantCode + ".json"; a.click(); }
        } },
    ],
    loop_function: () => !saveState.ok && saveState.choice !== 0,
  });
  timeline.push({ type: C, func: () => {
    if (saveState.ok && !DEV) { try { localStorage.setItem("wm_done", "1"); } catch (e) { /* ignore */ } }
    S.finished = true; log(saveState.ok ? "complete" : "downloaded"); step("Finished"); $("#quit").hidden = true;
    window.__result = { code: payload.participantCode, how: saveState.ok ? "saved" : "downloaded", trials: payload.trials.length, catches: payload.catches.length };
    window.__done = true;
  } }, { type: K, stimulus: () => card(WM.debriefFor(debriefHtml, asg.group, payload.participantCode)), choices: "NO_KEYS", data: { task: "debrief" } });

  // ---------- run ----------
  jsPsych = initJsPsych({ display_element: stage, show_progress_bar: false });
  $("#quit").hidden = false;
  WM.guardUnload(() => !S.quit && !S.finished, DEV);
  $("#quit").addEventListener("click", () => {
    if (!BOT && !confirm(T.quitConfirm)) return;
    log("quit"); S.quit = true; $("#quit").hidden = true; step("");
    jsPsych.abortExperiment(card(T.quitDone));
  });

  if (BOT) {   // test bot: reads the current trial and answers like the custom-app bot
    let last = "";
    const botResp = (t) => {
      const base = { oldP: 1.4, oldW: 1.4, lure: -1.1, foilW: -2.3, foilP: -2.0 }[t.status], shift = t.cueCount == null ? 0 : (t.cueValence === "OLD" ? 1 : -1) * (t.cueCount >= 5 ? 1.6 : 0.5);
      return Math.random() < 1 / (1 + Math.exp(-(base + shift))) ? "old" : "new";
    };
    setInterval(() => {
      const tr = jsPsych.getCurrentTrial && jsPsych.getCurrentTrial(); if (!tr) return;
      const node = jsPsych.getCurrentTimelineNodeID(); if (node === last) return;
      const d = tr.data || {};
      const form = $("form#jspsych-survey-html-form");
      if (form) {
        last = node;
        form.querySelectorAll(".field, label.agree").forEach((fl) => {
          const rad = [...fl.querySelectorAll("input[type=radio]")]; if (rad.length) { rad[Math.min(4, rad.length - 1)].checked = true; return; }
          const cb = fl.querySelector("input[type=checkbox]"); if (cb) { cb.checked = true; return; }
          const sel = fl.querySelector("select"); if (sel) { sel.selectedIndex = Math.min(2, sel.options.length - 1); return; }
          const num = fl.querySelector("input[type=number]"); if (num) { num.value = String(Math.max(Number(num.min) || 0, 20)); return; }
          const tx = fl.querySelector("textarea,input[type=text]"); if (tx) tx.value = "bot";
        });
        setTimeout(() => $("#jspsych-survey-html-form-next").click(), 5);
      } else if (document.querySelector(".jspsych-btn")) {
        last = node;
        const btns = [...document.querySelectorAll(".jspsych-btn")];
        let pick = btns[0];
        if (d.task === "catch1") pick = btns.find((b) => b.textContent === (Math.random() < 0.9 ? d.shownValence : d.shownValence === "OLD" ? "NEW" : "OLD"));
        if (d.task === "catch2") pick = btns.find((b) => b.textContent === String(Math.random() < 0.9 ? d.shownCount : 5));
        if (d.task === "savefail") pick = btns[1];
        if (d.task === "test" || d.task === "practice") pick = btns.find((b) => b.textContent.toLowerCase() === botResp(d));
        if (d.task === "distractor" && !(d.go && Math.random() < 0.85)) return;
        setTimeout(() => { const b = pick || btns[0]; if (b.isConnected) b.click(); }, 5);   // never click a button from a screen that has already ended
      } else if ((d.task === "test" || d.task === "practice") && document.querySelector("[data-trial]")) {
        last = node;
        const key = botResp(d) === "old" ? keyOld : keyOld === "f" ? "j" : "f";
        setTimeout(() => {
          stage.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
          setTimeout(() => stage.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true })), 2);
        }, 10);
      }
    }, 20);
  }
  jsPsych.run(timeline);
})().catch((e) => { console.error(e); window.__error = String((e && e.stack) || e); document.getElementById("stage").innerHTML = `<div class="card"><h2>Something went wrong</h2><p>Please reload the page. If it happens again, tell the researchers.</p></div>`; });
