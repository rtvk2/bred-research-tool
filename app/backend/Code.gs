/**
 * Data inbox for the GitHub Pages version of the study (Google Apps Script web app, bound to a Google Sheet).
 * Does only two things: hands out a group (cue : no-cue control = 2 : 1) and a balanced counterbalancing cell (GET ?action=assign) and stores one JSON file
 * per finished participant (POST). The website itself is NOT served from here.
 *
 * Sheet tabs created automatically: "assigned" (cells handed out) and "done" (one row per saved participant).
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
  folder_();
  Logger.log('ready. Folder id: ' + PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
}

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); }
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
      sh.appendRow([d.participantCode, d.assignment.version, d.assignment.keymap, new Date().toISOString(), d.devMode === true, file.getId(), d.ticket || '', d.assignment.group || 'cue']);
      return json_({ ok: true });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  }
}
