/**
 * Data inbox for the GitHub Pages version of the study (Google Apps Script web app, bound to a Google Sheet).
 * Does only two things: hands out a group (cue : no-cue control = 2 : 1) and a balanced counterbalancing cell (GET ?action=assign) and stores one JSON file
 * per finished participant (POST). The website itself is NOT served from here.
 *
 * Sheet tabs created automatically: "assigned" (cells handed out), "done" (index: one row per saved participant),
 * and the readable data: "trials" (one row per test word), "participants" (one row per person, with the questionnaire) and "codebook"
 * (what every column means). The JSON files in Drive are the master copy; run rebuildTables() to regenerate "trials" and "participants" from them.
 * Files: one JSON per participant in the Drive folder "wm_study_data" (same format as app/data/*.json).
 * Apps Script does not expose client IPs to this code.
 *
 * Setup: see backend/README.md. Run setup() once from the editor to grant permissions.
 */
var MAX_BODY = 200000;                 // characters
var PENDING_MS = 45 * 60 * 1000;
var CODE_RE = /^[A-Z0-9-]{6,24}$/;
var DONE_HEADER = ['code', 'version', 'keymap', 'savedISO', 'devMode', 'fileId', 'ticket', 'group'];
var ASSIGNED_HEADER = ['ticket', 'version', 'keymap', 'timeMs', 'group'];

function setup() {                     // run once from the editor
  sheet_('assigned', ASSIGNED_HEADER);
  sheet_('done', DONE_HEADER);
  tables_();
  codebook_();
  folder_();
  Logger.log('ready. Folder id: ' + PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
}

var STAGES = ['consent', 'instructions', 'practice', 'study', 'distractor', 'test', 'questions', 'saving', 'complete', 'downloaded', 'quit', 'closed'];
var PROGRESS_HEADER = ['savedISO', 'sid', 'seq', 'stage', 'n', 'group', 'version', 'keymap', 'dev', 'last', 'clientMs'];

// anonymous stage-only entries (no answers, no timings, no identity): one row per ping in the tab "progress"
function progress_(d, size) {
  if (size > 2000 || typeof d.sid !== 'string' || !/^[a-z0-9]{8,24}$/.test(d.sid) || STAGES.indexOf(d.stage) === -1) return { ok: false, error: 'bad progress' };
  sheet_('progress', PROGRESS_HEADER).appendRow([new Date().toISOString(), d.sid, d.seq, d.stage, d.n, d.group || 'cue', d.version, d.keymap, d.dev === true, d.last || '', d.t]);
  return { ok: true };
}

function sheet_(name, header, textCols) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name); sh.appendRow(header);
    (textCols || []).forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); });   // free text stays text, never a formula
  }
  return sh;
}

function folder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var f = DriveApp.createFolder('wm_study_data');
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function rows_(sh) {
  var n = sh.getLastRow();
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'assign') return json_(assign_());
  return json_({ ok: true, service: 'wm-study' });
}

function assign_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var done = rows_(sheet_('done', DONE_HEADER));
    var asg = sheet_('assigned', ASSIGNED_HEADER);
    var counts = {}, v, k;
    ['cue', 'control'].forEach(function (grp) { for (v = 0; v < 5; v++) for (k = 0; k < 2; k++) counts[grp + '_' + v + '_' + k] = 0; });
    var doneTickets = {};
    done.forEach(function (r) {
      if (r[4] !== true) counts[(r[7] || 'cue') + '_' + r[1] + '_' + r[2]]++;      // real participants only
      if (r[6]) doneTickets[r[6]] = true;
    });
    var now = Date.now();
    rows_(asg).forEach(function (r) {
      if (now - Number(r[3]) < PENDING_MS && !doneTickets[r[0]]) counts[(r[4] || 'cue') + '_' + r[1] + '_' + r[2]]++;
    });
    var nCue = 0, nCtl = 0;
    Object.keys(counts).forEach(function (c) { if (c.indexOf('cue_') === 0) nCue += counts[c]; else nCtl += counts[c]; });
    var group = 'cue';   // the no-cue baseline is within each person; no between-participants control group is used
    var min = Infinity, cells = [];
    Object.keys(counts).forEach(function (c) {
      if (c.indexOf(group + '_') !== 0) return;
      if (counts[c] < min) { min = counts[c]; cells = [c]; } else if (counts[c] === min) cells.push(c);
    });
    var pick = cells[Math.floor(Math.random() * cells.length)].split('_');
    var ticket = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    asg.appendRow([ticket, Number(pick[1]), Number(pick[2]), now, group]);
    return { group: group, version: Number(pick[1]), keymap: Number(pick[2]), ticket: ticket };
  } finally {
    lock.releaseLock();
  }
}

function validate_(d) {
  if (!d || typeof d !== 'object' || d.schema !== 1) return 'bad schema';
  if (typeof d.participantCode !== 'string' || !CODE_RE.test(d.participantCode)) return 'bad participantCode';
  var need = ['assignment', 'trials', 'questionnaire', 'consent'];
  for (var i = 0; i < need.length; i++) if (!(need[i] in d)) return 'missing ' + need[i];
  if (!Array.isArray(d.trials) || d.trials.length < 1 || d.trials.length > 200) return 'bad trials';
  if (!d.consent || d.consent.agreed !== true) return 'no consent';
  if (!d.assignment || ['cue', 'control'].indexOf(d.assignment.group || 'cue') === -1) return 'bad group';
  return null;
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (!raw || raw.length > MAX_BODY) return json_({ ok: false, error: 'size' });
    var d;
    try { d = JSON.parse(raw); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
    if (d && d.type === 'progress') return json_(progress_(d, raw.length));
    var bad = validate_(d);
    if (bad) return json_({ ok: false, error: bad });
    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var sh = sheet_('done', DONE_HEADER);
      var codes = rows_(sh).map(function (r) { return r[0]; });
      if (codes.indexOf(d.participantCode) !== -1) return json_({ ok: false, error: 'duplicate code' });
      var name = (d.devMode ? 'dev_' : '') + d.participantCode + '.json';
      var file = folder_().createFile(name, JSON.stringify(d), MimeType.PLAIN_TEXT);
      var savedISO = new Date().toISOString();
      sh.appendRow([d.participantCode, d.assignment.version, d.assignment.keymap, savedISO, d.devMode === true, file.getId(), d.ticket || '', d.assignment.group || 'cue']);
      try { addTables_(d, savedISO); } catch (err2) { Logger.log('tables: ' + err2); }   // the answers are already safe in Drive; rebuildTables() can redo this
      return json_({ ok: true });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  }
}

// ---------- readable tables (derived from the saved JSON; the JSON in Drive stays the master copy) ----------
var Q_FIELDS = ['aboutOpen', 'oddOpen', 'believable', 'influence', 'firstLanguage', 'firstLanguageOther', 'otherLanguages', 'ageEnglish', 'schoolMedium', 'englishShare', 'englishEase', 'age', 'gender', 'degree', 'priorParticipation'];
var TRIALS_HEADER = ['code', 'devMode', 'group', 'version', 'keymap', 'trial', 'word', 'kind', 'kindLabel', 'condition', 'conditionLabel', 'cueValence', 'cueCount', 'studied', 'respOld', 'correct', 'rt_ms', 'input', 'hidden'];
var PARTICIPANTS_BASE = ['code', 'savedISO', 'devMode', 'group', 'version', 'keymap', 'engine', 'durationMin', 'device', 'os', 'browser', 'screen', 'frameMs', 'timeZone', 'dataSharing', 'consentISO',
  'catchCorrect', 'catchTotal', 'distractorHits', 'distractorMisses', 'distractorFalseAlarms', 'distractorCorrectRej', 'hitRate', 'lureOldRate', 'foilOldRate', 'nTrials', 'hiddenTrials'];
var PARTICIPANTS_HEADER = PARTICIPANTS_BASE.concat(Q_FIELDS);
var KIND_ = { oldP: 'studied made-up word', oldW: 'studied real word', lure: 'real look-alike of a studied made-up word (never shown)', foilW: 'new unrelated real word', foilP: 'new made-up word' };
var COND_ = { HO: 'high cue, others said OLD', LO: 'low cue, others said OLD', HN: 'high cue, others said NEW', LN: 'low cue, others said NEW', NC: 'no cue shown' };

function tables_() {
  var textCols = [PARTICIPANTS_HEADER.indexOf('aboutOpen') + 1, PARTICIPANTS_HEADER.indexOf('oddOpen') + 1, PARTICIPANTS_HEADER.indexOf('firstLanguageOther') + 1, PARTICIPANTS_HEADER.indexOf('otherLanguages') + 1];
  return { trials: sheet_('trials', TRIALS_HEADER), participants: sheet_('participants', PARTICIPANTS_HEADER, textCols) };
}

function rate_(trials, pred) {
  var n = 0, o = 0;
  trials.forEach(function (t) { if (pred(t)) { n++; if (t.response === 'old') o++; } });
  return n ? Math.round(1000 * o / n) / 1000 : '';
}

function trialRows_(d) {
  var a = d.assignment || {};
  return (d.trials || []).map(function (t) {
    return [d.participantCode, d.devMode === true, a.group || 'cue', a.version, a.keymap, t.trial, t.word, t.status, KIND_[t.status] || '', t.condition, COND_[t.condition] || '',
      t.cueValence || '', (t.cueCount === null || t.cueCount === undefined) ? '' : t.cueCount, t.isOld ? 1 : 0, t.response === 'old' ? 1 : 0, t.correct ? 1 : 0, t.rt, t.input || '', t.hidden ? 1 : 0];
  });
}

function participantRow_(d, savedISO) {
  var a = d.assignment || {}, dv = d.device || {}, c = d.consent || {}, ds = d.distractor || {}, at = d.attention || {}, q = d.questionnaire || {}, tm = d.timing || {}, tr = d.trials || [];
  var base = [d.participantCode, savedISO, d.devMode === true, a.group || 'cue', a.version, a.keymap, d.engine || '', tm.durationMs ? Math.round(tm.durationMs / 6000) / 10 : '',
    dv.coarsePointer ? 'touch' : 'keyboard/mouse', dv.os || '', dv.browser || '', (dv.width || '') + 'x' + (dv.height || ''), dv.frameMs === undefined ? '' : dv.frameMs, dv.tz || '', c.dataSharing === true, c.ts || '',
    at.catchCorrect, at.catchTotal, ds.hits, ds.misses, ds.falseAlarms, ds.correctRejections,
    rate_(tr, function (t) { return t.isOld; }), rate_(tr, function (t) { return t.status === 'lure'; }), rate_(tr, function (t) { return t.status === 'foilW' || t.status === 'foilP'; }),
    tr.length, tr.filter(function (t) { return t.hidden; }).length];
  return base.concat(Q_FIELDS.map(function (k) { return q[k] === undefined ? '' : q[k]; }));
}

function write_(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function addTables_(d, savedISO) {
  var t = tables_();
  write_(t.trials, trialRows_(d));
  write_(t.participants, [participantRow_(d, savedISO)]);
  if (!SpreadsheetApp.getActive().getSheetByName('codebook')) codebook_();
}

// run from the editor any time: rewrites "trials", "participants" and "codebook" from the JSON files in the Drive folder
function rebuildTables() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var t = tables_(), items = [], files = folder_().getFiles();
    [t.trials, t.participants].forEach(function (sh) { var n = sh.getLastRow(); if (n > 1) sh.getRange(2, 1, n - 1, sh.getLastColumn()).clearContent(); });
    while (files.hasNext()) {
      var f = files.next(), d;
      if (!/\.json$/.test(f.getName())) continue;
      try { d = JSON.parse(f.getBlob().getDataAsString()); } catch (err) { continue; }
      if (validate_(d)) continue;
      items.push({ iso: f.getDateCreated().toISOString(), d: d });
    }
    items.sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });
    var trialRows = [], partRows = [];
    items.forEach(function (it) { partRows.push(participantRow_(it.d, it.iso)); trialRows = trialRows.concat(trialRows_(it.d)); });
    write_(t.trials, trialRows); write_(t.participants, partRows);
    codebook_();
    Logger.log('rebuilt: ' + partRows.length + ' participants, ' + trialRows.length + ' trials');
  } finally {
    lock.releaseLock();
  }
}

var CODEBOOK = [
  ['trials', 'code', 'Anonymous participant code (shown to the participant at the end).'],
  ['trials', 'devMode', 'TRUE = a test session. Leave these out of the analysis.'],
  ['trials', 'group', 'Always "cue": every participant does every condition; there is no control group.'],
  ['trials', 'version', 'Word-list version 0 to 4: which words appear under which cue condition.'],
  ['trials', 'keymap', '0 = OLD on the left (F key), NEW on the right (J). 1 = swapped.'],
  ['trials', 'trial', 'Position in the 60-word test (1 to 60).'],
  ['trials', 'word', 'The word shown.'],
  ['trials', 'kind', 'oldP = studied made-up word; oldW = studied real word; lure = real look-alike of a studied made-up word, never shown before; foilW = new unrelated real word; foilP = new made-up word.'],
  ['trials', 'kindLabel', 'The same as kind, in words.'],
  ['trials', 'condition', 'HO = high cue, others said OLD; LO = low cue, OLD; HN = high cue, others said NEW; LN = low cue, NEW; NC = no cue shown.'],
  ['trials', 'conditionLabel', 'The same as condition, in words.'],
  ['trials', 'cueValence', 'What the other participants were shown as saying (OLD or NEW). Blank when no cue.'],
  ['trials', 'cueCount', 'How many of the 10 other participants were shown as saying it (high 8 to 10, low 1 to 3). Blank when no cue.'],
  ['trials', 'studied', '1 = the word was in the study list, 0 = it was not.'],
  ['trials', 'respOld', '1 = the participant answered OLD, 0 = NEW. Main outcome: for kind = lure, respOld = 1 is a false recognition.'],
  ['trials', 'correct', '1 = the answer matched the truth (studied words are OLD, all others NEW).'],
  ['trials', 'rt_ms', 'Milliseconds from the word appearing to the answer (includes reading the cue).'],
  ['trials', 'input', 'key, touch or click.'],
  ['trials', 'hidden', '1 = the page was hidden (tab switched) during this trial.'],
  ['participants', 'code, savedISO, devMode, group, version, keymap', 'As in trials; savedISO is the save time (UTC).'],
  ['participants', 'engine, durationMin', 'Software version and minutes from consent to saving.'],
  ['participants', 'device, os, browser, screen, frameMs, timeZone', 'touch or keyboard/mouse; operating system; browser; window size in pixels; screen refresh interval in ms; time zone.'],
  ['participants', 'dataSharing, consentISO', 'TRUE = ticked the optional box allowing anonymous data in a public database; time consent was given.'],
  ['participants', 'catchCorrect, catchTotal', 'Attention questions answered fully correctly, out of 3.'],
  ['participants', 'distractorHits, Misses, FalseAlarms, CorrectRej', 'Shape task: taps on circles, missed circles, taps on squares, squares correctly ignored (60 shapes).'],
  ['participants', 'hitRate', 'Share of studied words answered OLD.'],
  ['participants', 'lureOldRate', 'Share of look-alike real words answered OLD (the false recognition rate, all cue conditions pooled).'],
  ['participants', 'foilOldRate', 'Share of new unrelated words (real or made-up) answered OLD.'],
  ['participants', 'nTrials, hiddenTrials', 'Test trials saved (should be 60); trials where the page was hidden.'],
  ['participants', 'aboutOpen, oddOpen', 'Free-text answers: what the participant thought the study was about; anything odd they noticed.'],
  ['participants', 'believable, influence', 'Ratings 1 to 7: how believable the other participants\' answers seemed; how much they influenced the participant.'],
  ['participants', 'firstLanguage ... englishEase', 'Language background questions (first language, other languages, age learned English, school medium, share of daily English, ease of reading English 1 to 7).'],
  ['participants', 'age, gender, degree, priorParticipation', 'Demographics and whether they had taken part in a similar study before.']
];

function codebook_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName('codebook');
  if (!sh) sh = ss.insertSheet('codebook');
  sh.clearContents();
  var rows = [['tab', 'column', 'meaning']].concat(CODEBOOK);
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
}
