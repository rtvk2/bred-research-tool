// All tunable settings and participant-facing wording live here.
// The manipulation follows the submitted research form: cue strength (9 vs 2 of 10) x valence (others say OLD vs NEW).
window.CFG = {
  appVersion: "2.0.0",
  schema: 1,

  // ---- timing (ms) ----
  studyMs: 5000,          // each study word 5 s: 12 pseudowords + 12 real words = 24 words = 120 s (form: 12 pseudowords, 5 s each)
  fixationMs: 500,
  itiMs: 300,
  practiceStudyMs: 3000,
  // distractor between study and test: go (circle) / no-go (square), 60 s
  distractorMs: 60000,
  distractorTrialMs: 1000,        // one shape per second
  distractorShowMs: 500,          // shape visible for the first 500 ms
  goShare: 0.75,
  // group assignment fallback (the server normally decides): share of participants in the no-cue control group
  controlShare: 0,                // 0 = everyone gets the cue version (the no-cue baseline is within each person)

  // ---- cue manipulation: high (centred on 9 of 10) vs low (centred on 2 of 10), valence OLD vs NEW ----
  // The number shown is drawn at random within each level, equally often within each condition, so the same two numbers do not repeat.
  crowdN: 10,
  cueHighValues: [8, 9, 10],
  cueLowValues: [1, 2, 3],

  // ---- data quality ----
  catchTrials: 3,                 // unannounced "what did the others say?" checks
  catchEligible: [8, 52],         // test positions (1-based, of 60) where a check may follow (cue group only)
  maxStatusRun: 3,                // no more than 3 test words of the same kind in a row
  maxValenceRun: 4,               // no more than 4 cues with the same valence in a row

  // ---- safety ----
  requireRealConsent: true,       // refuse real participants while content/consent.html is a placeholder (use ?dev=1 to test)

  // Where data go. "" = the Python server in this repo (api/assign, api/save, same origin).
  // For GitHub Pages (static, cannot store data) paste the Apps Script web-app URL here (ends in /exec); see backend/README.md.
  backend: "https://script.google.com/macros/s/AKfycbxZrojjHFhpeI0y0BfhuRjf4JTkOjF6slVM_MINDa5yvjiKlvC_50VscMQNWmb57Sy1/exec",
  endpoints: { assign: "api/assign", save: "api/save" },

  // ---- participant-facing wording (instrument text; consent and debrief are in content/*.html) ----
  text: {
    studyTitle: "Word memory study",
    intro: `
      <h2>Before you start</h2>
      <p>This takes about 15 minutes. Please use a laptop or desktop computer in a quiet place, keep this tab in front, and do not use the back button.</p>
      <p><strong>Part 1.</strong> You will see a list of words, one at a time, each for 5 seconds (about 2 minutes). Some may look unusual. Try to remember them exactly as they appear.</p>
      <p>Then comes a one-minute shape task.</p>
      <p><strong>Part 2.</strong> You will then see words one at a time. For each word, decide whether it was <strong>OLD</strong> (it appeared in the list you studied) or <strong>NEW</strong> (it did not).</p>`,
    cueExplain: `
      <h2>Other participants</h2>
      <p>Ten other participants did this same task earlier. Under most words you will see how many of those 10 gave a particular answer, OLD or NEW, for that word. For some words no answers are shown.</p>
      <p>Make your own decision for each word. Answer as accurately and as quickly as you can.</p>`,
    practiceIntro: `
      <h2>A short practice</h2>
      <p>First, a short practice with different words, so you know how the screens work.</p>`,
    practiceStudyGo: `<h2>Practice: learn these words</h2><p>Three words will appear, a few seconds each. Remember them.</p>`,
    practiceTestGo: `<h2>Practice: OLD or NEW?</h2><p>Four words will appear. Press <strong>F</strong> or <strong>J</strong>, or click a button.</p>`,
    realStudyGo: `<h2>Part 1: learn the words</h2><p>A list of words will appear, <strong>5 seconds each</strong>, one after another (about 2 minutes). Remember as many as you can, exactly as they appear.</p><p>The list starts as soon as you click.</p>`,
    distractorGo: `<h2>A one-minute shape task</h2><p>Shapes will appear one at a time. Press the <strong>space bar</strong> (or tap the screen) when you see a <strong>circle</strong>. Do <strong>not</strong> press for a square.</p>`,
    realTestGo: `<h2>Part 2: OLD or NEW?</h2><p>Now decide for each word: did it appear in the list you just studied (<strong>OLD</strong>) or not (<strong>NEW</strong>)? Under most words you will see what other participants said.</p><p>Now and then a short question about those answers will appear.</p>`,
    realTestGoControl: `<h2>Part 2: OLD or NEW?</h2><p>Now decide for each word: did it appear in the list you just studied (<strong>OLD</strong>) or not (<strong>NEW</strong>)? Answer as accurately and as quickly as you can.</p>`,
    quitConfirm: "Quit the study? Nothing you have done so far will be saved.",
    quitDone: `<h2>You have left the study</h2><p>No data were saved. You can close this tab.</p>`,
    alreadyDone: `<h2>Thank you</h2><p>This browser has already completed the study, so it cannot be done twice.</p>`,
    noConsentText: `<h2>This study cannot start yet</h2><p>The consent page still has open notes for the researchers (content/consent.html). No data can be collected yet.</p>`,
  },

  languages: ["English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Urdu", "Odia", "Punjabi", "Other"],
};
