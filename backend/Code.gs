/**
 * SLC Venue Inspection – Google Drive backend (Google Apps Script web app).
 *
 * Lives inside a Google Sheet that has two tabs (created by setup()):
 *   Curators : Name | Password | PasswordHash | Active
 *   Matches  : index of every match (the full data is a JSON file in Drive)
 *
 * Drive layout (created by setup()):
 *   SLC Venue Inspection/
 *     Reports/   ← final Word reports (shared "anyone with the link can view")
 *     Photos/    ← final-day pitch photos
 *     Data/      ← match data (JSON), private
 */

var ROOT_FOLDER_NAME = 'SLC Venue Inspection';
var TOKEN_DAYS = 30;
var MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
var MATCH_COLS = ['id', 'curator', 'tournament', 'venue', 'startDate', 'endDate', 'updatedAt',
  'status', 'dataFileId', 'photoFileId', 'reportFileId', 'reportUrl', 'generatedAt'];

// ============================================================ admin / setup

function onOpen() {
  SpreadsheetApp.getUi().createMenu('SLC Venue Inspection')
    .addItem('1. Run first-time setup', 'setup')
    .addItem('2. Secure new curator passwords', 'hashPasswords')
    .addItem('Show Drive folder link', 'showFolder')
    .addToUi();
}

/** Creates the sheets, the Drive folders and the secret key. Safe to re-run. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  var cur = ss.getSheetByName('Curators') || ss.insertSheet('Curators');
  if (cur.getLastRow() === 0) {
    cur.appendRow(['Name', 'Password', 'PasswordHash', 'Active']);
    cur.appendRow(['Sample Curator', 'ChangeMe123', '', 'TRUE']);
    cur.setFrozenRows(1);
    cur.getRange('A1:D1').setFontWeight('bold');
    cur.setColumnWidth(1, 220); cur.setColumnWidth(3, 320);
  }
  var mt = ss.getSheetByName('Matches') || ss.insertSheet('Matches');
  if (mt.getLastRow() === 0) {
    mt.appendRow(MATCH_COLS);
    mt.setFrozenRows(1);
    mt.getRange(1, 1, 1, MATCH_COLS.length).setFontWeight('bold');
  }
  var f = folders_();
  hashPasswords();
  // Non-blocking messages (a pop-up would wait in the sheet tab until clicked
  // and make the editor run time out).
  var msg = 'Setup complete. Drive folder: ' + f.root.getUrl();
  Logger.log(msg);
  ss.toast('Setup complete. Drive folder "' + ROOT_FOLDER_NAME + '" is ready.', 'SLC Venue Inspection', 10);
}

/** Hashes any plain-text password in the Curators tab and clears it. */
function hashPasswords() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Curators');
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var name = String(rows[i][0]).trim();
    var pw = String(rows[i][1]);
    if (name && pw) {
      sh.getRange(i + 1, 3).setValue(hashPw_(name, pw));
      sh.getRange(i + 1, 2).setValue('');
      if (rows[i][3] === '') sh.getRange(i + 1, 4).setValue(true);
    }
  }
}

function showFolder() {
  var url = folders_().root.getUrl();
  Logger.log(url);
  SpreadsheetApp.getActiveSpreadsheet().toast(url, 'Drive folder', 20);
}

// ============================================================ web entry

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'listReports') return json_(listReports_());
  return json_({ ok: true, service: 'SLC Venue Inspection API' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    var a = req.action;
    if (a === 'login') return json_(login_(req.name, req.password));
    if (a === 'listReports') return json_(listReports_());

    var user = verifyToken_(req.token);
    if (!user) return json_({ ok: false, error: 'AUTH', message: 'Session expired. Please log in again.' });

    if (a === 'listMyMatches') return json_(listMyMatches_(user));
    if (a === 'getMatch') return json_(getMatch_(user, req.id));
    if (a === 'saveMatch') return json_(withLock_(function () { return saveMatch_(user, req.match, req.photoBase64); }));
    if (a === 'generateReport') return json_(withLock_(function () { return generateReport_(user, req.match, req.photoBase64); }));
    if (a === 'deleteMatch') return json_(withLock_(function () { return deleteMatch_(user, req.id); }));
    if (a === 'polishText') return json_(polishPitchText_(req.text));
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: 'SERVER', message: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ============================================================ auth

function secret_() {
  var s = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!s) throw new Error('Backend not set up. Run setup() first.');
  return s;
}

function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function hashPw_(name, pw) {
  var raw = String(name).trim().toLowerCase() + '::' + String(pw) + '::' + secret_();
  return b64url_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8));
}

function login_(name, password) {
  name = String(name || '').trim();
  if (!name || !password) return { ok: false, error: 'LOGIN', message: 'Enter your name and password.' };

  var cache = CacheService.getScriptCache();
  var key = 'fail_' + name.toLowerCase();
  var fails = +(cache.get(key) || 0);
  if (fails >= 5) return { ok: false, error: 'LOCKED', message: 'Too many attempts. Try again in 15 minutes.' };

  var rows = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Curators').getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var rowName = String(rows[i][0]).trim();
    var active = String(rows[i][3]).toUpperCase() !== 'FALSE';
    if (rowName.toLowerCase() === name.toLowerCase() && active && rows[i][2] &&
        rows[i][2] === hashPw_(rowName, password)) {
      cache.remove(key);
      return { ok: true, name: rowName, token: makeToken_(rowName) };
    }
  }
  cache.put(key, String(fails + 1), 900);
  return { ok: false, error: 'LOGIN', message: 'Incorrect name or password.' };
}

function makeToken_(name) {
  var exp = Date.now() + TOKEN_DAYS * 86400000;
  var payload = b64url_(Utilities.newBlob(JSON.stringify({ n: name, e: exp })).getBytes());
  var sig = b64url_(Utilities.computeHmacSha256Signature(payload, secret_()));
  return payload + '.' + sig;
}

function verifyToken_(token) {
  if (!token || String(token).indexOf('.') < 0) return null;
  var parts = String(token).split('.');
  var sig = b64url_(Utilities.computeHmacSha256Signature(parts[0], secret_()));
  if (sig !== parts[1]) return null;
  var pad = parts[0] + '==='.slice((parts[0].length + 3) % 4);
  var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
  if (!data || data.e < Date.now()) return null;
  // Curator must still be active.
  var rows = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Curators').getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === data.n && String(rows[i][3]).toUpperCase() !== 'FALSE') return data.n;
  }
  return null;
}

// ============================================================ Drive

function folders_() {
  var props = PropertiesService.getScriptProperties();
  var get = function (key, name, parent) {
    var id = props.getProperty(key);
    if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
    var it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
    var folder = it.hasNext() ? it.next() : (parent ? parent.createFolder(name) : DriveApp.createFolder(name));
    props.setProperty(key, folder.getId());
    return folder;
  };
  var root = get('ROOT_ID', ROOT_FOLDER_NAME, null);
  return {
    root: root,
    reports: get('REPORTS_ID', 'Reports', root),
    photos: get('PHOTOS_ID', 'Photos', root),
    data: get('DATA_ID', 'Data', root),
  };
}

function trash_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
}

function safeName_(s) {
  return String(s || '').replace(/[\\\/:*?"<>|#%]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// ============================================================ matches index

function matchSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Matches');
}

function readIndex_() {
  var values = matchSheet_().getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    MATCH_COLS.forEach(function (c, j) {
      var v = values[i][j];
      o[c] = v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd") : String(v);
    });
    if (o.id) out.push(o);
  }
  return out;
}

function writeIndexRow_(rec) {
  var sh = matchSheet_();
  var row = MATCH_COLS.map(function (c) { return rec[c] == null ? '' : String(rec[c]); });
  var existing = readIndex_().filter(function (r) { return r.id === rec.id; })[0];
  var rowNum = existing ? existing._row : sh.getLastRow() + 1;
  // Plain-text format stops Sheets turning dates/IDs into other types.
  sh.getRange(rowNum, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  rec._row = rowNum;
}

function publicRow_(r) {
  return {
    id: r.id, curator: r.curator, tournament: r.tournament, venue: r.venue,
    startDate: r.startDate, endDate: r.endDate, updatedAt: r.updatedAt, status: r.status,
    reportFileId: r.reportFileId, reportUrl: r.reportUrl, generatedAt: r.generatedAt,
    downloadUrl: r.reportFileId ? 'https://drive.google.com/uc?export=download&id=' + r.reportFileId : '',
  };
}

function listMyMatches_(user) {
  var rows = readIndex_().filter(function (r) { return r.curator === user; });
  return { ok: true, matches: rows.map(publicRow_) };
}

function listReports_() {
  var rows = readIndex_().filter(function (r) { return r.reportFileId; });
  return { ok: true, reports: rows.map(publicRow_) };
}

function getMatch_(user, id) {
  var rec = readIndex_().filter(function (r) { return r.id === id; })[0];
  if (!rec || rec.curator !== user) return { ok: false, error: 'NOT_FOUND' };
  var match = JSON.parse(DriveApp.getFileById(rec.dataFileId).getBlob().getDataAsString('UTF-8'));
  var photoBase64 = '';
  if (rec.photoFileId) {
    try { photoBase64 = Utilities.base64Encode(DriveApp.getFileById(rec.photoFileId).getBlob().getBytes()); } catch (e) {}
  }
  return { ok: true, match: match, photoBase64: photoBase64, index: publicRow_(rec) };
}

function saveMatch_(user, match, photoBase64) {
  if (!match || !match.id) throw new Error('Missing match data');
  var existing = readIndex_().filter(function (r) { return r.id === match.id; })[0];
  if (existing && existing.curator !== user) throw new Error('This match belongs to another curator.');

  var f = folders_();
  match.curator = user;
  if (match.photo) { delete match.photo.base64; }
  var rec = existing || { id: match.id, curator: user, status: 'draft' };

  // Photo
  if (photoBase64) {
    trash_(rec.photoFileId);
    var img = Utilities.newBlob(Utilities.base64Decode(photoBase64), 'image/jpeg',
      safeName_(match.venue) + ' ' + (match.startDate || '') + ' pitch ' + match.id + '.jpg');
    var pf = f.photos.createFile(img);
    rec.photoFileId = pf.getId();
  } else if (!match.photo && rec.photoFileId) {
    trash_(rec.photoFileId); // curator removed the photo
    rec.photoFileId = '';
  }
  if (match.photo) match.photo.driveFileId = rec.photoFileId;

  // Data JSON
  var content = JSON.stringify(match);
  if (rec.dataFileId) {
    try { DriveApp.getFileById(rec.dataFileId).setContent(content); }
    catch (e) { rec.dataFileId = ''; }
  }
  if (!rec.dataFileId) {
    rec.dataFileId = f.data.createFile(match.id + '.json', content, 'application/json').getId();
  }

  rec.tournament = match.tournament; rec.venue = match.venue;
  rec.startDate = match.startDate; rec.endDate = match.endDate || match.startDate;
  rec.updatedAt = new Date().toISOString();
  writeIndexRow_(rec);
  return { ok: true, index: publicRow_(rec), photoFileId: rec.photoFileId };
}

function deleteMatch_(user, id) {
  var rec = readIndex_().filter(function (r) { return r.id === id; })[0];
  if (!rec) return { ok: true };
  if (rec.curator !== user) throw new Error('This match belongs to another curator.');
  trash_(rec.dataFileId); trash_(rec.photoFileId); trash_(rec.reportFileId);
  matchSheet_().deleteRow(rec._row);
  return { ok: true };
}

// ============================================================ report

function generateReport_(user, match, photoBase64) {
  var saved = saveMatch_(user, match, photoBase64);
  var rec = readIndex_().filter(function (r) { return r.id === match.id; })[0];
  var f = folders_();

  var photoBytes = null;
  if (photoBase64) photoBytes = Utilities.base64Decode(photoBase64);
  else if (rec.photoFileId) {
    try { photoBytes = DriveApp.getFileById(rec.photoFileId).getBlob().getBytes(); } catch (e) {}
  }

  var docBlob = buildReportDocx_(match, photoBytes);
  var name = [match.startDate, safeName_(match.venue), safeName_(match.tournament)]
    .filter(String).join(' - ') + ' - Venue Inspection Report.docx';
  docBlob.setName(name);

  trash_(rec.reportFileId);
  var file = f.reports.createFile(docBlob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  file.setDescription('Curator: ' + user + '\nTournament: ' + match.tournament + '\nVenue: ' + match.venue);

  rec.reportFileId = file.getId();
  rec.reportUrl = file.getUrl();
  rec.generatedAt = new Date().toISOString();
  rec.status = 'submitted';
  writeIndexRow_(rec);
  return { ok: true, index: publicRow_(rec), photoFileId: saved.photoFileId };
}

function buildReportDocx_(match, photoBytes) {
  var tpl = Utilities.newBlob(Utilities.base64Decode(TEMPLATE_DOCX_B64), 'application/zip', 'template.zip');
  var entries = Utilities.unzip(tpl);
  var byName = {};
  entries.forEach(function (b) { byName[b.getName()] = b; });
  var text = function (n) { return byName[n].getDataAsString('UTF-8'); };
  var put = function (n, s) { byName[n] = Utilities.newBlob('', 'application/xml', n).setDataFromString(s, 'UTF-8'); };

  var photo = null;
  if (photoBytes && photoBytes.length) {
    byName['word/media/pitch_photo.jpeg'] = Utilities.newBlob(photoBytes, 'image/jpeg', 'word/media/pitch_photo.jpeg');
    put('word/_rels/document.xml.rels', addImageRel(text('word/_rels/document.xml.rels'), 'rIdPitchPhoto', 'media/pitch_photo.jpeg'));
    photo = { relId: 'rIdPitchPhoto', size: imageSize(photoBytes) };
  }
  put('[Content_Types].xml', ensureContentTypes(text('[Content_Types].xml')));

  var paras = match.pitchParagraphs && match.pitchParagraphs.length ? match.pitchParagraphs : [];
  put('word/document.xml', fillDocumentXml(text('word/document.xml'), {
    tournament: match.tournament,
    venue: match.venue,
    dateText: match.dateText || match.startDate,
    curator: match.curator,
    pitchParagraphs: paras,
    sections: match.sections || {},
    photo: photo,
  }));

  var list = Object.keys(byName).map(function (k) { return byName[k]; });
  var zipped = Utilities.zip(list, 'report.docx');
  return Utilities.newBlob(zipped.getBytes(), MIME_DOCX, 'report.docx');
}

/** Run from the editor to test report generation without the app. */
function testGenerateSample() {
  var m = {
    id: 'test', curator: 'Sample Curator', tournament: 'Test Tournament', venue: 'Test Venue',
    startDate: '2025-12-16', dateText: '16th – 18th December 2025',
    pitchParagraphs: [{ text: 'The 7th wicket was prepared as a fresh wicket for the upcoming match.' },
      { label: '10th December:', text: 'Wicket preparation commenced with heavy watering.' }],
    sections: { outfield: 'Good.', scoreboard: 'Working.', dressingRooms: 'Clean.', umpiresRoom: 'OK', refereeRoom: 'OK' },
  };
  var blob = buildReportDocx_(m, null);
  blob.setName('TEST - Venue Inspection Report.docx');
  var file = folders_().root.createFile(blob);
  Logger.log(file.getUrl());
}


// ============================================================ AI rewrite of the Pitch text
//
// Turns the app's draft (built from the curator's entries) into natural report
// prose. Uses Google Gemini (free key from aistudio.google.com) or, if you
// prefer, Anthropic Claude. Add ONE of these in Project Settings → Script
// Properties:
//   GEMINI_API_KEY      – Google AI Studio key
//   ANTHROPIC_API_KEY   – Anthropic Console key (paid)
// Optional: AI_MODEL to choose a specific model.
// The rewrite is only accepted if every date, time and number is unchanged.

var AI_SYSTEM_PROMPT = [
  'You are an experienced Sri Lanka Cricket curator writing the "Pitch" section of an official venue inspection report for a domestic tournament match.',
  'You will receive a draft that was generated automatically from the curator\'s daily log. Rewrite it so it reads as if written by an experienced curator: natural, professional British English, varied sentence structure, smooth transitions, and no repetitive openings such as "At 7.00 a.m., ..." in every sentence.',
  'STRICT RULES:',
  '1. Keep every fact exactly: dates, clock times, roller types, numbers of passes, cross rolling, watering amounts and times, mowing heights, crease marking, grass cover, cracks, bounce and remarks. Keep the times written in the same form (e.g. 6.30 a.m.).',
  '2. Do not add, guess or omit any activity, number, condition or opinion. Do not add weather, reasons or outcomes that are not in the draft.',
  '3. Keep the same paragraph structure: the opening sentence about the wicket, then one paragraph per day that starts with exactly the same date label and colon as the draft (e.g. "10th December:"), then the closing assessment paragraph.',
  '4. Keep the order of activities within each day.',
  '5. Output plain text only: paragraphs separated by a single line break, no headings, no bullet points, no markdown, no quotation marks around the text, no comments before or after.',
].join('\n');

function aiConfig_() {
  var p = PropertiesService.getScriptProperties();
  var gemini = p.getProperty('GEMINI_API_KEY');
  var claude = p.getProperty('ANTHROPIC_API_KEY');
  var model = p.getProperty('AI_MODEL');
  if (gemini) return { provider: 'gemini', key: gemini.trim(), model: model || 'gemini-flash-latest' };
  if (claude) return { provider: 'claude', key: claude.trim(), model: model || 'claude-haiku-4-5' };
  return null;
}

function callAI_(cfg, system, user) {
  var res, data;
  if (cfg.provider === 'gemini') {
    res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(cfg.model) + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': cfg.key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 8192 },
      }),
    });
    data = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() !== 200) throw new Error('Gemini: ' + (data.error && data.error.message || res.getResponseCode()));
    var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    return parts.filter(function (x) { return !x.thought; }).map(function (x) { return x.text || ''; }).join('');
  }
  res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: cfg.model, max_tokens: 2500, temperature: 0.6, system: system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200) throw new Error('Claude: ' + (data.error && data.error.message || res.getResponseCode()));
  return (data.content || []).map(function (x) { return x.text || ''; }).join('');
}

// Tidy the model's answer into plain paragraphs.
function cleanAIText_(t) {
  return String(t || '')
    .replace(/\r/g, '')
    .replace(/\*\*|__|^#+\s*/gm, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .split(/\n+/).map(function (l) { return l.trim(); }).filter(String)
    .join('\n')
    .replace(/^"|"$/g, '');
}

var DAY_LABEL_RE_ = /^(\d{1,2}(?:st|nd|rd|th)\s+[A-Z][a-z]+|Day\s+\d+)\s*:/gm;

// True when the rewrite kept the day labels and did not change or invent numbers.
function factsPreserved(src, out) {
  var labels = function (t) { return (t.match(DAY_LABEL_RE_) || []).map(function (x) { return x.replace(/\s+/g, ' '); }); };
  var a = labels(src), b = labels(out);
  if (a.join('|') !== b.join('|')) return { ok: false, why: 'day labels changed' };
  var nums = function (t) { return t.match(/\d+(?:\.\d+)?/g) || []; };
  var srcNums = nums(src), outNums = nums(out);
  var missing = srcNums.filter(function (n) { return outNums.indexOf(n) < 0; });
  var extra = outNums.filter(function (n) { return srcNums.indexOf(n) < 0; });
  if (missing.length) return { ok: false, why: 'missing ' + missing.join(', ') };
  if (extra.length) return { ok: false, why: 'added ' + extra.join(', ') };
  if (out.length < src.length * 0.5) return { ok: false, why: 'too short' };
  return { ok: true };
}

function polishPitchText_(text) {
  text = String(text || '').trim();
  if (!text) return { ok: false, error: 'EMPTY', message: 'Nothing to rewrite yet.' };
  var cfg = aiConfig_();
  if (!cfg) return { ok: false, error: 'NO_AI', message: 'AI rewriting is not set up (add GEMINI_API_KEY in Script Properties).' };
  var user = 'Rewrite this draft following the rules.\n\nDRAFT:\n' + text;
  var lastWhy = '';
  for (var attempt = 0; attempt < 2; attempt++) {
    var out = cleanAIText_(callAI_(cfg, AI_SYSTEM_PROMPT, attempt === 0 ? user :
      user + '\n\nIMPORTANT: your previous answer was rejected because it ' + lastWhy +
      '. Keep every date label, time and number exactly as in the draft.'));
    var check = factsPreserved(text, out);
    if (check.ok) return { ok: true, text: out, provider: cfg.provider, model: cfg.model };
    lastWhy = check.why;
  }
  return { ok: false, error: 'AI_CHECK', message: 'The AI rewrite changed some facts (' + lastWhy + '), so the standard text was kept.' };
}

/** Run from the editor to check the AI key works. */
function testAI() {
  var draft = 'The 7th wicket from the clubhouse side was prepared as a fresh wicket for the upcoming match.\n' +
    '10th December: Wicket preparation commenced with heavy watering at 6.30 a.m. At 7.00 a.m., the light manual roller was used twice, followed by the medium manual roller twice at 7.30 a.m. At 8.30 a.m., the heavy machine roller was used twice to complete the day\'s preparation.\n' +
    'The playing surface has good grass cover. Upon inspection the surface was found to have good bounce.';
  Logger.log(JSON.stringify(polishPitchText_(draft), null, 2));
}
