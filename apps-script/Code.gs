/**
 * Ranger App – Google Sheet connector (Keswick Red Squirrel Group)
 *
 * Paste this into the group's Google Sheet: Extensions → Apps Script.
 * See README.md for the full set-up steps.
 *
 * The sheet needs these tabs (names can be changed below):
 *   Visits     – one row per visit; the app writes to the columns by their header names
 *   Locations  – LOCATION | GRID REFERENCE | TRUST Y/N   (feeds the app's drop-down)
 *   Users      – Email Address | Name                    (suggested names in the app)
 *   Methods    – optional; column A lists the methods (e.g. Shoot, Trap, Survey)
 */
const VISITS_SHEET = 'Visits';
const LOCATIONS_SHEET = 'Locations';
const USERS_SHEET = 'Users';
const METHODS_SHEET = 'Methods';
const DEFAULT_METHODS = ['Shoot', 'Trap', 'Survey'];
// Add rangers' new map-picked locations to the Locations tab automatically?
const ADD_NEW_LOCATIONS = true;

// Column header in the Visits tab  ->  how to fill it from a record sent by the app
const COLUMNS = [
  ['Timestamp',     r => new Date(r.timestamp)],
  ['Visit Date',    r => isoToDate(r.visitDate)],
  ['Location',      r => r.location],
  ['Method',        r => r.method],
  ['Funds Method',  r => r.fundsMethod],
  ['Reds',          r => num(r.reds)],
  ['Grey Male',     r => num(r.greyMale)],
  ['Grey Female',   r => num(r.greyFemale)],
  ['Grey Unknown',  r => num(r.greyUnknown)],
  ['Hours Worked',  r => num(r.hours)],
  ['Notes',         r => r.notes || ''],
  ['Email address', r => r.email || ''],
  ['TotalGreys',    r => num(r.greyMale) + num(r.greyFemale) + num(r.greyUnknown)],
  ['Quarter',       r => Math.floor((Number(String(r.visitDate).split('-')[1]) - 1) / 3) + 1],
  ['Ranger',        r => r.ranger || ''],
  ['Grid Ref',      r => r.gridRef || ''],
  ['Latitude',      r => r.lat == null ? '' : Number(r.lat)],
  ['Longitude',     r => r.lon == null ? '' : Number(r.lon)],
  ['Entry ID',      r => r.id],
];

function doGet(e) {
  return respond(() => {
    checkKey(e.parameter.key);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const methods = readRows(METHODS_SHEET).map(r => str(r[0])).filter(String);
    return {
      ok: true,
      group: ss.getName(),
      locations: readRows(LOCATIONS_SHEET).map(r => ({ name: str(r[0]), grid: str(r[1]), trust: str(r[2]) })).filter(l => l.name),
      users: readRows(USERS_SHEET).map(r => ({ email: str(r[0]), name: str(r[1]) })).filter(u => u.name),
      methods: methods.length ? methods : DEFAULT_METHODS,
    };
  });
}

function doPost(e) {
  return respond(() => {
    const body = JSON.parse(e.postData.contents);
    checkKey(body.key);
    const records = (body.records || []).filter(r => r && r.id && r.visitDate && r.location).slice(0, 500);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = sheet(VISITS_SHEET, COLUMNS.map(c => c[0]));
      const cols = ensureHeaders(sh, COLUMNS.map(c => c[0]));
      const idCol = cols['Entry ID'];
      const last = sh.getLastRow();
      const existing = new Set(last > 1 ? sh.getRange(2, idCol, last - 1, 1).getValues().map(v => String(v[0])) : []);
      const width = sh.getLastColumn();
      const rows = [], saved = [];
      for (const r of records) {
        saved.push(r.id); // already in the sheet counts as saved, so phones stop resending it
        if (existing.has(r.id)) continue;
        existing.add(r.id);
        const row = new Array(width).fill('');
        for (const [name, fn] of COLUMNS) row[cols[name] - 1] = fn(r);
        rows.push(row);
      }
      if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);
      const locationsAdded = ADD_NEW_LOCATIONS ? addNewLocations(records.filter(r => r.newLocation)) : 0;
      return { ok: true, saved, added: rows.length, locationsAdded };
    } finally {
      lock.releaseLock();
    }
  });
}

function addNewLocations(records) {
  if (!records.length) return 0;
  const sh = sheet(LOCATIONS_SHEET, ['LOCATION', 'GRID REFERENCE ', 'TRUST Y/N']);
  const known = new Set(readRows(LOCATIONS_SHEET).map(r => str(r[0]).toLowerCase()));
  let n = 0;
  for (const r of records) {
    const name = str(r.location);
    if (!name || known.has(name.toLowerCase())) continue;
    known.add(name.toLowerCase());
    sh.appendRow([name, str(r.gridRef), '']);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- helpers
function checkKey(key) {
  const want = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (want && String(key || '') !== want) throw new Error('Wrong access code – ask your organiser for a new setup code.');
}
function respond(fn) {
  let out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function sheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, headers.length).setValues([headers]); sh.setFrozenRows(1); }
  return sh;
}
// Finds each wanted header (ignoring case/spaces); adds any that are missing at the right-hand end.
function ensureHeaders(sh, wanted) {
  const width = Math.max(sh.getLastColumn(), 1);
  const have = sh.getRange(1, 1, 1, width).getValues()[0].map(h => str(h).toLowerCase().replace(/\s+/g, ''));
  const cols = {};
  let next = have.filter(String).length ? have.length + 1 : 1;
  for (const h of wanted) {
    const i = have.indexOf(h.toLowerCase().replace(/\s+/g, ''));
    if (i >= 0) cols[h] = i + 1;
    else { sh.getRange(1, next).setValue(h); cols[h] = next++; }
  }
  return cols;
}
function readRows(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(sh.getLastColumn(), 1)).getValues();
}
function isoToDate(iso) { const p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function str(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

/** Run this once from the editor to check the sheet can be read (see View → Logs). */
function testSetup() {
  const res = JSON.parse(doGet({ parameter: { key: PropertiesService.getScriptProperties().getProperty('ACCESS_CODE') } }).getContent());
  Logger.log('Locations: %s, users: %s, methods: %s', res.locations.length, res.users.length, res.methods.join(', '));
}
