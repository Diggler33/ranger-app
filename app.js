/* Ranger App – Keswick Red Squirrel Group.
   Visits are stored on the phone (localStorage) and sent to the group's Google Sheet
   through a Google Apps Script web app (see apps-script/Code.gs). */
(() => {
  'use strict';
  const STORE_KEY = 'ranger.v1';
  const KESWICK = [54.6013, -3.1347];
  const COUNT_FIELDS = ['reds', 'greyMale', 'greyFemale', 'greyUnknown', 'hours'];
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- storage
  let state = load();
  function load() {
    const blank = { settings: { api: '', key: '', ranger: '', email: '' }, records: [], config: null, myLocations: [], draft: null };
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.records)) return Object.assign(blank, s, { settings: Object.assign(blank.settings, s.settings) });
    } catch (e) { /* fall through */ }
    return blank;
  }
  let saveWarned = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; }
    catch (e) {
      if (!saveWarned) { saveWarned = true; toast('This phone would not save the data (private browsing?). Use a normal window.', 'err', 6000); }
      return false;
    }
  }

  // ---------------------------------------------------------------- helpers
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const pad = n => String(n).padStart(2, '0');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const ukDate = iso => { const [y, m, d] = String(iso).split('-'); return d ? `${d}/${m}/${y}` : iso; };
  const ukDateTime = iso => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const quarterOf = iso => Math.floor((+String(iso).split('-')[1] - 1) / 3) + 1;
  const totalGreys = r => (+r.greyMale || 0) + (+r.greyFemale || 0) + (+r.greyUnknown || 0);
  function metres(a, b) {
    const R = 6371000, toR = Math.PI / 180, dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const distText = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;

  let toastTimer;
  function toast(msg, kind = '', ms = 3000) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('This phone cannot share its location.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        err => reject(new Error(err.code === 1 ? 'Location is turned off for this app – allow it in your phone settings.' : 'Could not get your location – try again outside.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }

  // ---------------------------------------------------------------- lists
  let locations = [];
  function buildLocations() {
    const src = state.config && state.config.locations && state.config.locations.length ? state.config.locations : DEFAULT_LOCATIONS;
    const seen = new Map();
    for (const l of [...src, ...state.myLocations]) {
      const name = clean(l.name);
      if (!name || seen.has(name.toLowerCase())) continue;
      const grid = clean(l.grid).toUpperCase().replace(/\s/g, '');
      const ll = (l.lat != null && l.lon != null) ? { lat: +l.lat, lon: +l.lon } : OSGrid.toLatLon(grid);
      seen.set(name.toLowerCase(), { name, grid, trust: clean(l.trust).toUpperCase() === 'Y', lat: ll ? ll.lat : null, lon: ll ? ll.lon : null, mine: !!l.mine });
    }
    locations = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }
  const findLoc = name => locations.find(l => l.name.toLowerCase() === clean(name).toLowerCase());
  const methods = () => (state.config && state.config.methods && state.config.methods.length) ? state.config.methods : DEFAULT_METHODS;

  // ---------------------------------------------------------------- record form
  const form = $('#visitForm');
  let current = blankDraft();
  function blankDraft(keep = {}) {
    return Object.assign({ visitDate: todayISO(), location: '', grid: '', lat: null, lon: null, isNew: false,
      method: '', fundsMethod: 'No', reds: 0, greyMale: 0, greyFemale: 0, greyUnknown: 0, hours: 0, notes: '' }, keep);
  }

  function renderLocationSelect() {
    const sel = $('#locSelect');
    const opts = ['<option value="">Choose a location…</option>'];
    for (const l of locations) opts.push(`<option value="${esc(l.name)}">${esc(l.name)}${l.mine ? ' (new)' : ''}</option>`);
    if (current.location && !findLoc(current.location)) opts.push(`<option value="${esc(current.location)}">${esc(current.location)} (new)</option>`);
    sel.innerHTML = opts.join('');
    sel.value = current.location;
  }
  function renderMethodChips() {
    $('#methodChips').innerHTML = methods().map(m => `<button type="button" data-v="${esc(m)}">${esc(m)}</button>`).join('');
  }
  function steppers() {
    for (const el of $$('.stepper')) {
      const f = el.dataset.f, step = +(el.dataset.step || 1);
      el.innerHTML = `<button type="button" class="minus" aria-label="less">−</button>
        <input type="number" inputmode="${step % 1 ? 'decimal' : 'numeric'}" min="0" step="${step}" name="${f}" aria-label="${f}">
        <button type="button" class="plus" aria-label="more">+</button>`;
      el.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const v = Math.max(0, (+current[f] || 0) + (b.classList.contains('plus') ? step : -step));
        current[f] = Math.round(v * 100) / 100;
        paintForm(); keepDraft();
      });
      el.querySelector('input').addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        current[f] = isFinite(v) && v >= 0 ? v : 0;
        $('#totalGreys').textContent = totalGreys(current); keepDraft();
      });
    }
  }
  function paintForm() {
    form.visitDate.value = current.visitDate;
    if ($('#locSelect').value !== current.location) renderLocationSelect();
    for (const f of COUNT_FIELDS) {
      const inp = form.querySelector(`input[name="${f}"]`);
      if (document.activeElement !== inp) inp.value = current[f];
    }
    form.notes.value = current.notes;
    $$('#methodChips button').forEach(b => b.classList.toggle('on', b.dataset.v === current.method));
    $$('#fundsChips button').forEach(b => b.classList.toggle('on', b.dataset.v === current.fundsMethod));
    $('#totalGreys').textContent = totalGreys(current);
    const l = findLoc(current.location);
    $('#locHint').textContent = current.location
      ? `Grid ref ${OSGrid.pretty(current.grid || (l && l.grid) || '') || '–'}${l && l.trust ? ' · Trust site' : ''}${current.isNew ? ' · new location' : ''}`
      : '';
  }
  function keepDraft() { state.draft = current; save(); }

  function setLocation(name, extra = {}) {
    const l = findLoc(name);
    current.location = l ? l.name : clean(name);
    current.grid = extra.grid || (l ? l.grid : '');
    current.lat = extra.lat != null ? extra.lat : (l ? l.lat : null);
    current.lon = extra.lon != null ? extra.lon : (l ? l.lon : null);
    current.isNew = !l || !!l.mine;
    renderLocationSelect(); paintForm(); keepDraft();
  }

  function wireForm() {
    form.visitDate.addEventListener('change', () => { current.visitDate = form.visitDate.value; keepDraft(); });
    $('#locSelect').addEventListener('change', e => setLocation(e.target.value));
    form.notes.addEventListener('input', () => { current.notes = form.notes.value; keepDraft(); });
    $('#methodChips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { current.method = b.dataset.v; paintForm(); keepDraft(); } });
    $('#fundsChips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { current.fundsMethod = b.dataset.v; paintForm(); keepDraft(); } });
    $('#mapBtn').addEventListener('click', openMap);
    $('#nearestBtn').addEventListener('click', async () => {
      const btn = $('#nearestBtn'); btn.disabled = true; btn.textContent = '📍 Finding you…';
      try {
        const me = await getPosition();
        const near = nearest(me, 1)[0];
        if (!near) throw new Error('No locations with grid references.');
        setLocation(near.loc.name, { lat: me.lat, lon: me.lon });
        toast(`${near.loc.name} – ${distText(near.d)} away`, near.d > 1500 ? 'err' : 'ok', 4000);
      } catch (e) { toast(e.message, 'err', 4500); }
      finally { btn.disabled = false; btn.textContent = '📍 Nearest'; }
    });
    $('#clearBtn').addEventListener('click', () => {
      if (!confirm('Clear the form?')) return;
      current = blankDraft({ visitDate: current.visitDate }); keepDraft(); renderLocationSelect(); paintForm();
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const err = $('#formError');
      const problems = [];
      if (!current.visitDate) problems.push('the visit date');
      if (!current.location) problems.push('a location');
      if (!current.method) problems.push('the method');
      if (!clean(state.settings.ranger)) problems.push('your name (in Settings)');
      if (problems.length) {
        err.textContent = 'Please add ' + problems.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
        err.hidden = false; err.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (current.visitDate > todayISO() && !confirm('The visit date is in the future. Save anyway?')) return;
      err.hidden = true;
      const l = findLoc(current.location);
      const rec = {
        id: uid(), timestamp: new Date().toISOString(), visitDate: current.visitDate,
        location: current.location, gridRef: current.grid || (l ? l.grid : ''),
        lat: current.lat ?? (l ? l.lat : null), lon: current.lon ?? (l ? l.lon : null),
        newLocation: current.isNew, method: current.method, fundsMethod: current.fundsMethod,
        reds: +current.reds || 0, greyMale: +current.greyMale || 0, greyFemale: +current.greyFemale || 0, greyUnknown: +current.greyUnknown || 0,
        hours: +current.hours || 0, notes: clean(current.notes),
        ranger: clean(state.settings.ranger), email: clean(state.settings.email), status: 'queued',
      };
      state.records.unshift(rec);
      if (!save()) { state.records.shift(); return; }
      // keep date, location and method for the next visit; reset the counts and notes
      current = blankDraft({ visitDate: current.visitDate, location: current.location, grid: current.grid, lat: current.lat, lon: current.lon,
        isNew: current.isNew, method: current.method, fundsMethod: current.fundsMethod });
      keepDraft(); paintForm(); window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('Visit saved ✓', 'ok');
      sync(false, true);
    });
  }

  // ---------------------------------------------------------------- map
  let map, pin, locLayer, meMarker, pinAt = null;
  function nearest(pt, n = 3) {
    return locations.filter(l => l.lat != null).map(l => ({ loc: l, d: metres(pt, l) })).sort((a, b) => a.d - b.d).slice(0, n);
  }
  function openMap() {
    $('#mapModal').hidden = false; document.body.classList.add('modal-open');
    if (!window.L) { $('#mapInfo').innerHTML = '<p>The map needs an internet connection. You can still pick from the list or use “Nearest to me”.</p>'; return; }
    if (!map) {
      map = L.map('map', { zoomControl: true, attributionControl: true }).setView(KESWICK, 13);
      const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
      const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)' });
      const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
      street.addTo(map);
      L.control.layers({ 'Street': street, 'Topo': topo, 'Satellite': sat }, null, { position: 'topright' }).addTo(map);
      locLayer = L.layerGroup().addTo(map);
      map.on('click', e => setPin(e.latlng.lat, e.latlng.lng, 'tap'));
    }
    drawLocations();
    setTimeout(() => map.invalidateSize(), 60);
    // default to where the ranger is standing
    const sel = findLoc(current.location);
    if (sel && sel.lat != null && !pinAt) setPin(sel.lat, sel.lon, 'list', false);
    locateMe(true);
  }
  function closeMap() { $('#mapModal').hidden = true; document.body.classList.remove('modal-open'); }
  function drawLocations() {
    locLayer.clearLayers();
    for (const l of locations) {
      if (l.lat == null) continue;
      const m = L.circleMarker([l.lat, l.lon], { radius: 9, weight: 2, color: '#fff', fillColor: l.trust ? '#b8461b' : '#24452c', fillOpacity: .9 });
      m.bindTooltip(l.name, { direction: 'top', offset: [0, -8] });
      m.on('click', ev => { L.DomEvent.stopPropagation(ev); setPin(l.lat, l.lon, 'site', true, l); });
      m.addTo(locLayer);
    }
  }
  async function locateMe(initial) {
    $('#mapLocate').disabled = true;
    if (initial && !pinAt) $('#mapInfo').innerHTML = '<p class="hint">Finding your location… or tap the map to drop a pin.</p>';
    try {
      const me = await getPosition();
      if ($('#mapModal').hidden) return;
      if (!meMarker) meMarker = L.marker([me.lat, me.lon], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: -100 }).addTo(map);
      else meMarker.setLatLng([me.lat, me.lon]);
      setPin(me.lat, me.lon, 'gps', true, null, me.acc);
    } catch (e) {
      if (!pinAt) { map.setView(KESWICK, 12); $('#mapInfo').innerHTML = `<p class="hint">${esc(e.message)}<br>Tap the map or a dot to choose a location.</p>`; }
      else toast(e.message, 'err', 4500);
    } finally { $('#mapLocate').disabled = false; }
  }
  function setPin(lat, lon, source, move = true, site = null, acc = null) {
    pinAt = { lat, lon };
    if (!pin) {
      pin = L.marker([lat, lon], { draggable: true, zIndexOffset: 1000, icon: L.divIcon({ className: '', html: '<div class="pin-icon">📍</div>', iconSize: [34, 34], iconAnchor: [17, 32] }) }).addTo(map);
      pin.on('dragend', () => { const p = pin.getLatLng(); setPin(p.lat, p.lng, 'drag', false); });
    } else pin.setLatLng([lat, lon]);
    if (move) map.setView([lat, lon], Math.max(map.getZoom(), 15));
    const grid = OSGrid.fromLatLon(lat, lon);
    const near = nearest(pinAt, 3);
    const where = { gps: `your location${acc ? ` (±${Math.round(acc)} m)` : ''}`, tap: 'pin', drag: 'pin', list: 'current choice', site: 'site' }[source] || 'pin';
    const btns = near.map((n, i) => `<button type="button" class="btn ${i === 0 || (site && site === n.loc) ? 'primary' : ''}" data-use="${esc(n.loc.name)}">
        <span>${esc(n.loc.name)}</span><small>${n.d < 50 ? 'here' : distText(n.d)}</small></button>`).join('');
    $('#mapInfo').innerHTML = `
      <div class="grid">${esc(OSGrid.pretty(grid))} <span class="hint">· ${esc(where)}</span></div>
      <div class="near">${btns || '<p class="hint">No known locations nearby.</p>'}</div>
      <div class="newloc">
        <input id="newLocName" placeholder="…or name a new location here" maxlength="80">
        <button type="button" class="btn" id="newLocBtn">Add</button>
      </div>
      <p class="hint">Tap the map or drag 📍 to move the pin. Dots are known locations (red = Trust sites).</p>`;
    $$('#mapInfo [data-use]').forEach(b => b.addEventListener('click', () => {
      // keep the actual pin position (e.g. your GPS) with the record, and the site's own grid ref
      setLocation(b.dataset.use, { lat: pinAt.lat, lon: pinAt.lon });
      closeMap(); toast(`Location: ${b.dataset.use}`, 'ok');
    }));
    $('#newLocBtn').addEventListener('click', () => {
      const name = clean($('#newLocName').value);
      if (!name) { $('#newLocName').focus(); return; }
      if (findLoc(name)) { setLocation(name, { lat: pinAt.lat, lon: pinAt.lon }); closeMap(); return; }
      state.myLocations.push({ name, grid, lat: pinAt.lat, lon: pinAt.lon, mine: true });
      buildLocations();
      setLocation(name, { grid, lat: pinAt.lat, lon: pinAt.lon });
      closeMap(); toast(`New location: ${name}`, 'ok');
    });
  }

  // ---------------------------------------------------------------- sync with the group sheet
  let syncing = false, lastError = '';
  async function fetchJSON(url, opts = {}, ms = 25000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, Object.assign({ signal: ctl.signal, redirect: 'follow' }, opts));
      const text = await res.text();
      let j; try { j = JSON.parse(text); } catch (e) { throw new Error(res.ok ? 'The sheet sent back something unexpected – is the web app URL right?' : `Sheet error ${res.status}`); }
      if (!j.ok) throw new Error(j.error || 'The sheet refused the request.');
      return j;
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Timed out – weak signal?' : (navigator.onLine === false ? 'No signal right now.' : e.message));
    } finally { clearTimeout(t); }
  }
  const payload = r => ({ id: r.id, timestamp: r.timestamp, visitDate: r.visitDate, location: r.location, gridRef: r.gridRef,
    lat: r.lat, lon: r.lon, newLocation: !!r.newLocation, method: r.method, fundsMethod: r.fundsMethod, reds: r.reds,
    greyMale: r.greyMale, greyFemale: r.greyFemale, greyUnknown: r.greyUnknown, hours: r.hours, notes: r.notes, ranger: r.ranger, email: r.email });

  async function sync(manual = false, afterSave = false) {
    const queue = state.records.filter(r => r.status !== 'sent');
    if (!queue.length) { if (manual) toast('Everything is already sent ✓', 'ok'); updateBadge(); return; }
    if (!state.settings.api) {
      if (manual || afterSave) toast(afterSave ? 'Visit saved on this phone. Connect to the group sheet in Settings to send it.' : 'Not connected to the group sheet yet – see Settings.', '', 4500);
      updateBadge(); return;
    }
    if (syncing) return;
    syncing = true; updateBadge();
    try {
      const j = await fetchJSON(state.settings.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'submit', key: state.settings.key, records: queue.map(payload) }) });
      const ids = new Set(j.saved || []), now = new Date().toISOString();
      state.records.forEach(r => { if (ids.has(r.id)) { r.status = 'sent'; r.sentAt = now; } });
      // once a new location has gone up it lives in the sheet; drop the local copy at the next list refresh
      lastError = ''; save();
      if (manual || afterSave) toast(`Sent to the group sheet ✓ (${ids.size})`, 'ok');
      if (j.locationsAdded) refreshConfig(false);
    } catch (e) {
      lastError = e.message;
      if (manual) toast(`Not sent: ${e.message}`, 'err', 5000);
      else if (afterSave) toast('Visit saved on this phone – it will send when there is signal.', '', 4500);
    } finally { syncing = false; updateBadge(); renderHistory(); }
  }

  async function refreshConfig(manual) {
    if (!state.settings.api) { if (manual) toast('Connect to the group sheet first.', 'err'); return false; }
    try {
      const url = state.settings.api + (state.settings.api.includes('?') ? '&' : '?') + 'action=config&key=' + encodeURIComponent(state.settings.key || '');
      const j = await fetchJSON(url);
      state.config = { locations: j.locations || [], users: j.users || [], methods: j.methods || [], group: j.group || '', fetchedAt: new Date().toISOString() };
      // forget local "new" locations that the sheet now knows about
      const known = new Set(state.config.locations.map(l => clean(l.name).toLowerCase()));
      state.myLocations = state.myLocations.filter(l => !known.has(clean(l.name).toLowerCase()));
      save(); buildLocations(); renderLocationSelect(); renderMethodChips(); paintForm(); renderSettings();
      if (manual) toast(`Connected ✓ ${state.config.locations.length} locations`, 'ok');
      return true;
    } catch (e) {
      if (manual) toast(`Could not reach the sheet: ${e.message}`, 'err', 5000);
      renderSettings(); return false;
    }
  }

  function updateBadge() {
    const b = $('#syncBadge'), n = state.records.filter(r => r.status !== 'sent').length;
    b.className = 'badge ' + (n ? 'waiting' : 'ok');
    b.textContent = syncing ? 'Sending…' : n ? `${n} to send` : (state.records.length ? '✓ All sent' : '✓ Ready');
    b.title = lastError || '';
  }

  // ---------------------------------------------------------------- history page
  function renderHistory() {
    const list = $('#historyList'), recs = state.records;
    const now = new Date(), q = Math.floor(now.getMonth() / 3) + 1, y = now.getFullYear();
    const inQ = recs.filter(r => r.visitDate.startsWith(String(y)) && quarterOf(r.visitDate) === q);
    $('#summary').innerHTML = `
      <div class="red"><b>${inQ.reduce((s, r) => s + (+r.reds || 0), 0)}</b><span>Reds</span></div>
      <div><b>${inQ.reduce((s, r) => s + totalGreys(r), 0)}</b><span>Greys</span></div>
      <div><b>${inQ.reduce((s, r) => s + (+r.hours || 0), 0)}</b><span>Hours</span></div>
      <p>Q${q} ${y} · ${inQ.length} visit${inQ.length === 1 ? '' : 's'} recorded on this phone</p>`;
    if (!recs.length) { list.innerHTML = '<li class="empty">No visits recorded on this phone yet.</li>'; return; }
    list.innerHTML = recs.slice(0, 200).map(r => `
      <li>
        <div class="h-top"><span class="h-loc">${esc(r.location)}</span>
          <span class="pill ${r.status === 'sent' ? 'sent' : 'queued'}">${r.status === 'sent' ? 'Sent' : 'Waiting'}</span></div>
        <div class="h-meta">${esc(ukDate(r.visitDate))} · ${esc(r.method)} · 🐿️ ${r.reds} red · ${totalGreys(r)} grey · ${r.hours} h</div>
        ${r.notes ? `<div class="h-notes">${esc(r.notes)}</div>` : ''}
        ${r.status !== 'sent' ? `<button type="button" class="del" data-del="${esc(r.id)}">Delete</button>` : ''}
      </li>`).join('');
  }
  function wireHistory() {
    $('#historyList').addEventListener('click', e => {
      const b = e.target.closest('[data-del]'); if (!b) return;
      if (!confirm('Delete this visit? It has not been sent, so it will be lost.')) return;
      state.records = state.records.filter(r => r.id !== b.dataset.del); save(); renderHistory(); updateBadge();
    });
    $('#sendNowBtn').addEventListener('click', () => sync(true));
    $('#exportBtn').addEventListener('click', exportCSV);
  }
  async function exportCSV() {
    if (!state.records.length) { toast('No visits to export yet.'); return; }
    const head = ['Timestamp', 'Visit Date', 'Location', 'Method', 'Funds Method', 'Reds', 'Grey Male', 'Grey Female', 'Grey Unknown',
      'Hours Worked', 'Notes', 'Email address', 'TotalGreys', 'Quarter', 'Ranger', 'Grid Ref', 'Latitude', 'Longitude', 'Entry ID'];
    const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [...state.records].reverse().map(r => [ukDateTime(r.timestamp), ukDate(r.visitDate), r.location, r.method, r.fundsMethod,
      r.reds, r.greyMale, r.greyFemale, r.greyUnknown, r.hours, r.notes, r.email, totalGreys(r), quarterOf(r.visitDate), r.ranger,
      r.gridRef, r.lat != null ? (+r.lat).toFixed(6) : '', r.lon != null ? (+r.lon).toFixed(6) : '', r.id].map(cell).join(','));
    const csv = '﻿' + [head.join(','), ...rows].join('\r\n');
    const name = `ranger-visits-${todayISO()}.csv`;
    const file = new File([csv], name, { type: 'text/csv' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Ranger visits' }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------------------------------------------------------------- settings page
  const CODE_PREFIX = 'RANGER1:';
  function makeSetupCode() { return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify({ api: state.settings.api, key: state.settings.key })))); }
  function readSetupCode(code) {
    const m = String(code || '').trim().match(/RANGER1:([A-Za-z0-9+/=_-]+)/);
    if (!m) return null;
    try {
      const o = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
      return o && /^https:\/\//.test(o.api) ? { api: String(o.api), key: String(o.key || '') } : null;
    } catch (e) { return null; }
  }
  async function connect(api, key) {
    state.settings.api = api.trim(); state.settings.key = key.trim(); save();
    if (await refreshConfig(true)) sync(false);
  }
  function renderSettings() {
    $('#rangerName').value = state.settings.ranger; $('#rangerEmail').value = state.settings.email;
    $('#apiUrl').value = state.settings.api; $('#apiKey').value = state.settings.key;
    const users = (state.config && state.config.users) || [];
    $('#userList').innerHTML = users.map(u => `<option value="${esc(u.name)}"></option>`).join('');
    const c = state.config;
    $('#connStatus').innerHTML = !state.settings.api
      ? '⚠️ Not connected. Visits are kept on this phone until you paste the setup code from your group organiser.'
      : `✅ Connected${c && c.fetchedAt ? ` · lists updated ${esc(ukDateTime(c.fetchedAt).slice(0, 16))}` : ''}${lastError ? `<br>Last problem: ${esc(lastError)}` : ''}`;
    $('#aboutInfo').textContent = `${state.records.length} visit(s) on this phone · ${locations.length} locations · version 1`;
  }
  function wireSettings() {
    $('#saveMeBtn').addEventListener('click', () => {
      state.settings.ranger = clean($('#rangerName').value);
      const users = (state.config && state.config.users) || [];
      const u = users.find(x => clean(x.name).toLowerCase() === state.settings.ranger.toLowerCase());
      if (u && u.email && !clean($('#rangerEmail').value)) $('#rangerEmail').value = u.email;
      state.settings.email = clean($('#rangerEmail').value);
      save(); renderSettings(); toast(state.settings.ranger ? `Hello ${state.settings.ranger.split(' ')[0]} 👋` : 'Saved', 'ok');
      $('#formError').hidden = true;
    });
    $('#applyCodeBtn').addEventListener('click', () => {
      const c = readSetupCode($('#setupCode').value);
      if (!c) { toast('That setup code was not recognised – copy the whole thing.', 'err', 4500); return; }
      $('#setupCode').value = ''; connect(c.api, c.key);
    });
    $('#refreshBtn').addEventListener('click', () => refreshConfig(true));
    $('#saveConnBtn').addEventListener('click', () => {
      const api = $('#apiUrl').value.trim();
      if (api && !/^https:\/\/script\.google(usercontent)?\.com\//.test(api)) { toast('That does not look like a Google Apps Script web app URL.', 'err', 4500); return; }
      connect(api, $('#apiKey').value);
    });
    $('#shareSetupBtn').addEventListener('click', async () => {
      if (!state.settings.api) { toast('Save the web app URL first.', 'err'); return; }
      const code = makeSetupCode();
      const link = location.origin + location.pathname + '#setup=' + encodeURIComponent(code);
      const text = `Ranger App (Keswick Red Squirrel Group)\n\n1. Open ${link}\n2. Add it to your Home Screen.\n3. If Settings says "Not connected", paste this setup code there:\n${code}`;
      try {
        if (navigator.share) { await navigator.share({ title: 'Ranger App setup', text }); return; }
      } catch (e) { if (e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(text); toast('Setup message copied – paste it into WhatsApp or email.', 'ok', 4500); }
      catch (e) { prompt('Copy this and send it to your rangers:', text); }
    });
  }

  // ---------------------------------------------------------------- navigation
  function show(page) {
    $$('.page').forEach(p => { p.hidden = p.id !== 'page-' + page; });
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.page === page));
    if (page === 'history') renderHistory();
    if (page === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- start
  function start() {
    // a shared setup link: #setup=RANGER1:...
    const h = decodeURIComponent(location.hash || '');
    const fromLink = h.startsWith('#setup=') ? readSetupCode(h.slice(7)) : null;
    if (h) history.replaceState(null, '', location.pathname + location.search);

    buildLocations();
    if (state.draft) current = Object.assign(blankDraft(), state.draft);
    if (!current.visitDate) current.visitDate = todayISO();
    renderMethodChips(); steppers(); renderLocationSelect(); paintForm();
    wireForm(); wireHistory(); wireSettings();
    $$('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.page)));
    $('#syncBadge').addEventListener('click', () => { show('history'); sync(true); });
    $('#mapClose').addEventListener('click', closeMap);
    $('#mapLocate').addEventListener('click', () => locateMe(false));
    updateBadge();

    if (fromLink) connect(fromLink.api, fromLink.key);
    else if (state.settings.api) { refreshConfig(false); sync(false); }
    if (!state.settings.ranger) setTimeout(() => { show('settings'); toast('Welcome! Start by adding your name.', '', 4000); }, 300);

    window.addEventListener('online', () => sync(false));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(false); });
    setInterval(() => { if (navigator.onLine !== false) sync(false); }, 5 * 60 * 1000);

    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  start();
})();
