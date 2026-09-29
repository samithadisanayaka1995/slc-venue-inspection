// SLC Venue Inspection – app screens (plain JavaScript, runs inside the Android app).
(function () {
  'use strict';
  var L = window.Logic;
  var $app = document.getElementById('app');

  // ================================================================ helpers
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    add(el, Array.prototype.slice.call(arguments, 2));
    return el;
  }
  function add(el, kids) {
    kids.forEach(function (k) {
      if (Array.isArray(k)) return add(el, k);
      if (k == null || k === false) return;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  }
  function addDays(iso, n) { var d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function pretty(iso) { if (!iso) return ''; var d = fromISO(iso); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ================================================================ modal / busy
  var modalClose = null;
  function modal(title, msg, buttons) {
    return new Promise(function (resolve) {
      var root = document.getElementById('modal-root');
      function close(v) { root.innerHTML = ''; modalClose = null; resolve(v); }
      modalClose = function () { close(null); };
      buttons = buttons || [{ label: 'OK', value: true, main: true }];
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'modal-bg', onClick: function (e) { if (e.target === e.currentTarget) close(null); } },
        h('div', { class: 'modal' },
          h('h3', null, title),
          msg ? h('p', null, msg) : null,
          h('div', { class: 'mb' }, buttons.map(function (b) {
            return h('button', { class: (b.danger ? 'danger' : '') + (b.main ? ' main' : ''), onClick: function () { close(b.value); } }, b.label);
          })))));
    });
  }
  function confirmBox(title, msg, okLabel, danger) {
    return modal(title, msg, [{ label: 'Cancel', value: false }, { label: okLabel, value: true, danger: danger, main: !danger }]);
  }
  var busyEl = null;
  function busy(on) {
    if (on && !busyEl) { busyEl = h('div', { class: 'busy' }, h('div', { class: 'spinner' })); document.body.appendChild(busyEl); }
    if (!on && busyEl) { busyEl.remove(); busyEl = null; }
  }

  // ================================================================ phone bridge
  // Inside the Android app, window.Android is provided by the native code.
  var reqId = 0, pending = {};
  window.__bridge = function (id, ok, text) {
    var p = pending[id]; if (!p) return;
    delete pending[id];
    if (ok) p.res(text); else p.rej(new Error(text));
  };
  function httpPost(body) {
    if (window.Android && window.Android.post) {
      return new Promise(function (res, rej) {
        var id = 'r' + (++reqId);
        pending[id] = { res: res, rej: rej };
        window.Android.post(id, window.API_URL, body);
      });
    }
    return fetch(window.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(function (r) { return r.text(); });
  }
  function openUrl(u) {
    if (window.Android && window.Android.openUrl) window.Android.openUrl(u); else window.open(u, '_blank');
  }
  function shareText(t) {
    if (window.Android && window.Android.share) window.Android.share(t);
    else if (navigator.share) navigator.share({ text: t }).catch(function () {});
    else modal('Share', t);
  }

  function ApiError(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function api(action, body) {
    if (!/^https?:\/\//.test(window.API_URL || '')) {
      return Promise.reject(ApiError('CONFIG', 'The app is not connected to Google Drive yet. Add the API_URL variable in GitHub and build again.'));
    }
    var payload = Object.assign({ action: action }, body || {});
    return httpPost(JSON.stringify(payload)).then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) {
        throw ApiError('SERVER', 'Unexpected reply from the Google Drive service. Check the web app deployment (access must be "Anyone").');
      }
      if (!data.ok) throw ApiError(data.error || 'SERVER', data.message || data.error);
      return data;
    }, function () {
      throw ApiError('NETWORK', 'No internet connection. Your work is saved on this phone and will upload later.');
    });
  }

  // ================================================================ local storage
  var S = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) {
        modal('Phone storage full', 'Upload your matches to Drive, then delete old matches from this phone.');
        return false;
      }
    },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  var session = S.get('slc.session', null);
  function setSession(s) { session = s; if (s) S.set('slc.session', s); else S.del('slc.session'); }
  function mkey() { return 'slc.matches.' + String(session.name).toLowerCase(); }
  function allLocal() { return session ? S.get(mkey(), {}) : {}; }
  function getLocal(id) { return allLocal()[id] || null; }
  function writeAll(all) { return S.set(mkey(), all); }

  function saveLocal(match, photoChanged) {
    var all = allLocal();
    var prev = all[match.id];
    var m = Object.assign({}, match, {
      updatedAt: new Date().toISOString(),
      dirty: true,
      photoDirty: !!photoChanged || !!(prev && prev.photoDirty) || !!match.photoDirty,
    });
    delete m._pending;
    all[m.id] = m;
    writeAll(all);
    return m;
  }
  function deleteLocal(id) { var all = allLocal(); delete all[id]; writeAll(all); }

  function forUpload(m) {
    var c = clone(m);
    delete c.dirty; delete c.photoDirty; delete c._pending; delete c._local;
    if (c.photo) { delete c.photo.base64; delete c.photo.thumb; c.photo.hasPhoto = true; }
    return c;
  }
  // After a successful upload the full photo is kept in Drive; the phone keeps a thumbnail.
  function markSynced(id, updatedAt, extra) {
    var all = allLocal(), cur = all[id];
    if (!cur) return null;
    Object.assign(cur, extra || {});
    if (cur.updatedAt === updatedAt) {
      cur.dirty = false; cur.photoDirty = false;
      if (cur.photo) delete cur.photo.base64;
    }
    writeAll(all);
    return cur;
  }
  function syncMatch(m) {
    return api('saveMatch', {
      token: session.token, match: forUpload(m),
      photoBase64: m.photoDirty && m.photo && m.photo.base64 ? m.photo.base64 : '',
    }).then(function () { return markSynced(m.id, m.updatedAt); });
  }
  function syncAll() {
    var all = allLocal(), ids = Object.keys(all).filter(function (id) { return all[id].dirty; });
    var failed = 0;
    return ids.reduce(function (p, id) {
      return p.then(function () {
        return syncMatch(all[id]).catch(function (e) { if (e.code === 'AUTH') throw e; failed++; });
      });
    }, Promise.resolve()).then(function () { return failed; });
  }
  function downloadMatch(id) {
    return api('getMatch', { token: session.token, id: id }).then(function (res) {
      var m = res.match;
      var done = function (thumb) {
        m.photo = res.photoBase64 ? Object.assign({}, m.photo || {}, { thumb: thumb, hasPhoto: true }) : null;
        if (res.index && res.index.reportFileId) {
          m.report = { fileId: res.index.reportFileId, url: res.index.reportUrl, downloadUrl: res.index.downloadUrl, generatedAt: res.index.generatedAt };
        }
        m.dirty = false; m.photoDirty = false;
        var all = allLocal(); all[m.id] = m; writeAll(all);
        return m;
      };
      return res.photoBase64 ? thumbFromBase64(res.photoBase64).then(done) : done('');
    });
  }
  function generateReport(m) {
    var payload = forUpload(m);
    payload.pitchParagraphs = L.pitchParagraphsFor(m);
    payload.dateText = L.matchDateText(m.startDate, m.endDate);
    return api('generateReport', {
      token: session.token, match: payload,
      photoBase64: m.photoDirty && m.photo && m.photo.base64 ? m.photo.base64 : '',
    }).then(function (res) {
      return markSynced(m.id, m.updatedAt, {
        report: { fileId: res.index.reportFileId, url: res.index.reportUrl, downloadUrl: res.index.downloadUrl, generatedAt: res.index.generatedAt },
      });
    });
  }

  // ================================================================ photo
  var BOX = 1760220 / 2438400; // width/height of the photo box in the report
  function loadImg(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('Could not read the photo.')); };
      img.src = src;
    });
  }
  function cropCanvas(img, outW) {
    var w = img.naturalWidth, hh = img.naturalHeight, sx = 0, sy = 0, sw = w, sh = hh;
    if (w / hh > BOX) { sw = Math.round(hh * BOX); sx = Math.round((w - sw) / 2); }
    else { sh = Math.round(w / BOX); sy = Math.round((hh - sh) / 2); }
    var W = Math.min(outW, sw), H = Math.round(W / BOX);
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    return c;
  }
  function processPhotoFile(file) {
    var url = URL.createObjectURL(file);
    return loadImg(url).then(function (img) {
      var full = cropCanvas(img, 900).toDataURL('image/jpeg', 0.72);
      var thumb = cropCanvas(img, 240).toDataURL('image/jpeg', 0.7);
      URL.revokeObjectURL(url);
      return { base64: full.split(',')[1], thumb: thumb, takenAt: new Date().toISOString() };
    });
  }
  function thumbFromBase64(b64) {
    return loadImg('data:image/jpeg;base64,' + b64).then(function (img) { return cropCanvas(img, 240).toDataURL('image/jpeg', 0.7); });
  }
  function pickPhoto(camera) {
    return new Promise(function (res) {
      var inp = document.getElementById('photo-input');
      inp.value = '';
      if (camera) inp.setAttribute('capture', 'environment'); else inp.removeAttribute('capture');
      inp.onchange = function () { res(inp.files && inp.files[0] ? inp.files[0] : null); };
      inp.click();
    });
  }

  // ================================================================ navigation
  var stack = [{ name: 'home', params: {} }];
  if (session) stack.push({ name: 'list', params: {} });
  function top() { return stack[stack.length - 1]; }
  function go(name, params) { stack.push({ name: name, params: params || {} }); render(); }
  function replace(name, params) { leave(stack.pop()); stack.push({ name: name, params: params || {} }); render(); }
  function leave(entry) { if (entry && entry.leave) entry.leave(); }
  function back() {
    if (stack.length <= 1) return false;
    leave(stack.pop()); render(); return true;
  }
  function resetTo(name) { while (stack.length > 1) leave(stack.pop()); if (name !== 'home') stack.push({ name: name, params: {} }); render(); }
  window.appBack = function () {
    if (modalClose) { modalClose(); return true; }
    return back();
  };
  function render() {
    var t = top();
    t.leave = null;
    $app.innerHTML = '';
    $app.appendChild(Views[t.name](t.params, t));
    window.scrollTo(0, t.scrollY || 0);
  }
  function logout() { setSession(null); resetTo('home'); }
  function handleErr(e, title) {
    if (e.code === 'AUTH') { modal('Session expired', 'Please log in again.'); logout(); return; }
    modal(title || 'Something went wrong', e.message);
  }

  // ================================================================ UI pieces
  function header(title, sub, right, onBack) {
    return h('div', { class: 'hdr' },
      h('button', { class: 'back', onClick: onBack || back, 'aria-label': 'Back' }, '‹'),
      h('div', { class: 'ttl' }, h('b', null, title), sub ? h('small', null, sub) : null),
      right || null);
  }
  function card(title, right) {
    var kids = Array.prototype.slice.call(arguments, 2);
    return h('div', { class: 'card' }, title ? h('div', { class: 'card-h' }, h('h3', null, title), right || null) : null, kids);
  }
  function label(text, hint) { return h('label', { class: 'lbl' }, text, hint ? h('small', null, hint) : null); }
  function field(opts) {
    var input = opts.multiline
      ? h('textarea', { class: 'inp', rows: opts.rows || 4, placeholder: opts.placeholder || '' })
      : h('input', { class: 'inp', type: opts.type || 'text', placeholder: opts.placeholder || '', inputmode: opts.inputmode, autocapitalize: opts.autocap });
    input.value = opts.value == null ? '' : opts.value;
    input.addEventListener('input', function () { opts.onInput(input.value); });
    if (opts.onEnter) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') opts.onEnter(); });
    return h('div', { class: 'fld', style: opts.style }, opts.label ? label(opts.label, opts.hint) : null, input);
  }
  function dateField(lbl, value, onChange, clearable) {
    var input = h('input', { class: 'inp', type: 'date' });
    input.value = value || '';
    input.addEventListener('change', function () { onChange(input.value); });
    return h('div', { class: 'fld' }, lbl ? label(lbl) : null,
      h('div', { class: 'row', style: 'align-items:center' }, input,
        clearable ? h('button', { class: 'link', style: 'flex:none;color:var(--red)', onClick: function () { input.value = ''; onChange(''); } }, 'Clear') : null));
  }
  // Single choice; tapping the chosen one clears it (every field is optional).
  function chips(lbl, hint, options, value, onChange) {
    var wrap = h('div', { class: 'chips' });
    var cur = value;
    function draw() {
      wrap.innerHTML = '';
      options.forEach(function (o) {
        wrap.appendChild(h('button', { class: 'chip' + (o === cur ? ' on' : ''), onClick: function () { cur = cur === o ? '' : o; onChange(cur); draw(); } }, o));
      });
    }
    draw();
    return h('div', { class: 'fld' }, lbl ? label(lbl, hint) : null, wrap);
  }
  function stepper(value, onChange) {
    var input = h('input', { type: 'text', inputmode: 'numeric', placeholder: '–' });
    function norm(v) { var n = parseInt(v, 10); return isNaN(n) || n < 0 ? '' : String(Math.min(n, 99)); }
    input.value = norm(value);
    function set(v) { input.value = norm(v); onChange(input.value); }
    input.addEventListener('input', function () { set(input.value.replace(/[^0-9]/g, '')); });
    return h('div', { class: 'stepper' },
      h('button', { onClick: function () { var n = parseInt(input.value, 10); set(isNaN(n) || n <= 1 ? '' : n - 1); } }, '−'),
      input,
      h('button', { onClick: function () { var n = parseInt(input.value, 10); set(isNaN(n) ? 1 : n + 1); } }, '+'));
  }
  function btn(text, cls, onClick) { return h('button', { class: 'btn ' + (cls || 'primary'), onClick: onClick }, text); }
  function badge(text, tone) { return h('span', { class: 'badge ' + (tone || '') }, text); }

  function searchBox(value, placeholder, onChange) {
    var input = h('input', { type: 'search', placeholder: placeholder });
    input.value = value || '';
    input.addEventListener('input', function () { onChange(input.value); });
    return h('div', { class: 'search' }, h('span', null, '🔍'), input,
      h('button', { onClick: function () { input.value = ''; onChange(''); } }, '✕'));
  }
  function sortBar(options, value, onChange) {
    var bar = h('div', { class: 'sortbar' });
    function draw() {
      bar.innerHTML = '';
      bar.appendChild(h('span', null, 'Sort by'));
      options.forEach(function (o) {
        bar.appendChild(h('button', { class: o.key === value ? 'on' : '', onClick: function () { value = o.key; onChange(value); draw(); } }, o.label));
      });
    }
    draw();
    return bar;
  }
  function sortAndFilter(items, key, query) {
    var q = String(query || '').trim().toLowerCase();
    var list = items.filter(function (m) {
      return !q || [m.tournament, m.venue, m.curator, m.startDate, pretty(m.startDate)].some(function (v) { return String(v || '').toLowerCase().indexOf(q) >= 0; });
    });
    var byDateDesc = function (a, b) { return String(b.startDate || '').localeCompare(String(a.startDate || '')); };
    var by = function (k) {
      return function (a, b) { return String(a[k] || '').localeCompare(String(b[k] || ''), undefined, { sensitivity: 'base' }) || byDateDesc(a, b); };
    };
    if (key === 'tournament' || key === 'venue' || key === 'curator') list.sort(by(key));
    else if (key === 'dateAsc') list.sort(function (a, b) { return -byDateDesc(a, b); });
    else list.sort(byDateDesc);
    return list;
  }
  function dateRange(m) { return pretty(m.startDate) + (m.endDate && m.endDate !== m.startDate ? ' – ' + pretty(m.endDate) : ''); }

  // ================================================================ current match (editing)
  var Cur = {
    m: null, timer: null, photoChanged: false,
    load: function (id) { if (!this.m || this.m.id !== id) { this.m = getLocal(id); this.photoChanged = false; } return this.m; },
    touch: function () {
      this.m._pending = true;
      var self = this;
      clearTimeout(this.timer);
      this.timer = setTimeout(function () { self.flush(); }, 500);
    },
    flush: function () {
      clearTimeout(this.timer);
      if (this.m && this.m._pending) { this.m = saveLocal(this.m, this.photoChanged); this.photoChanged = false; }
      return this.m;
    },
  };

  // ================================================================ views
  var Views = {};

  Views.home = function () {
    return h('div', { class: 'home' },
      h('img', { src: 'logo.jpg', alt: '' }),
      h('h1', null, 'Sri Lanka Cricket'),
      h('h2', null, 'Venue Inspection Reporting'),
      h('p', null, 'Day-by-day pitch preparation for domestic tournament matches'),
      h('button', { class: 'tile gold', onClick: function () { go(session ? 'list' : 'login'); } },
        h('span', { class: 'ic' }, '🧑‍🌾'),
        h('span', { class: 'body' }, h('b', null, session ? 'Continue as ' + session.name : 'Curator login'),
          h('small', null, 'Create matches and record daily pitch preparation')),
        h('span', { class: 'ar' }, '›')),
      h('button', { class: 'tile', onClick: function () { go('reports'); } },
        h('span', { class: 'ic' }, '📄'),
        h('span', { class: 'body' }, h('b', null, 'View match reports'),
          h('small', null, 'Open final venue inspection reports – no login needed')),
        h('span', { class: 'ar' }, '›')));
  };

  Views.login = function () {
    var name = '', pw = '';
    var err = h('p', { class: 'err', style: 'display:none' });
    var submit = function () {
      err.style.display = 'none';
      if (!name.trim() || !pw) { err.textContent = 'Enter your name and password.'; err.style.display = 'block'; return; }
      busy(true);
      api('login', { name: name.trim(), password: pw }).then(function (res) {
        busy(false);
        setSession({ name: res.name, token: res.token });
        replace('list');
      }, function (e) { busy(false); err.textContent = e.message; err.style.display = 'block'; });
    };
    return h('div', null, header('Curator login'),
      h('div', { class: 'page' }, card(null, null,
        h('p', { class: 'muted' }, 'Only curators registered by Sri Lanka Cricket can log in. Your user name is your full name as registered.'),
        field({ label: "User name (curator's name)", placeholder: 'e.g. Nuwan Perera', autocap: 'words', onInput: function (v) { name = v; } }),
        field({ label: 'Password', type: 'password', placeholder: 'Password', onInput: function (v) { pw = v; }, onEnter: submit }),
        err,
        btn('Log in', 'primary', submit))));
  };

  var LIST_SORTS = [
    { key: 'date', label: 'Date (newest)' }, { key: 'dateAsc', label: 'Date (oldest)' },
    { key: 'tournament', label: 'Tournament' }, { key: 'venue', label: 'Venue' },
  ];
  Views.list = function (p, entry) {
    if (!session) { setTimeout(function () { replace('login'); }); return h('div'); }
    entry.sort = entry.sort || 'date';
    entry.q = entry.q || '';
    var items = Object.keys(allLocal()).map(function (id) { return Object.assign({ _local: true }, allLocal()[id]); });
    var listEl = h('div', { class: 'page', style: 'padding-top:4px' });
    var note = h('div');
    var openingId = '';
    function draw() {
      listEl.innerHTML = '';
      var list = sortAndFilter(items, entry.sort, entry.q);
      if (!list.length) {
        listEl.appendChild(h('div', { class: 'empty' }, h('div', { style: 'font-size:40px' }, '🏏'), h('b', null, 'No matches yet'), 'Tap "New match" to start a venue inspection sheet.'));
      }
      list.forEach(function (m) {
        var hasReport = m.report || m.reportFileId;
        listEl.appendChild(h('div', { class: 'item', onClick: function () { open(m); } },
          h('div', { class: 'body' },
            h('div', { class: 't' }, m.tournament || 'Untitled tournament'),
            h('div', { class: 'l' }, '📍 ' + (m.venue || '—')),
            h('div', { class: 's' }, '🗓 ' + dateRange(m) + (m.days ? '  ·  ' + m.days.length + ' prep day' + (m.days.length === 1 ? '' : 's') : '')),
            h('div', { class: 'badges' },
              hasReport ? badge('Report ready', 'green') : badge('In progress', 'gold'),
              m.dirty ? badge('Not uploaded', 'red') : null,
              !m._local ? badge('In Drive') : null)),
          h('span', { class: 'chev' }, openingId === m.id ? '…' : '›')));
      });
    }
    function open(m) {
      if (m._local) { go('sheet', { id: m.id }); return; }
      openingId = m.id; draw(); busy(true);
      downloadMatch(m.id).then(function () { busy(false); go('sheet', { id: m.id }); },
        function (e) { busy(false); openingId = ''; draw(); handleErr(e, 'Could not open match'); });
    }
    function refresh() {
      syncAll().then(function (failed) {
        return api('listMyMatches', { token: session.token }).then(function (res) {
          var local = allLocal(), merged = {};
          Object.keys(local).forEach(function (id) { merged[id] = Object.assign({ _local: true }, local[id]); });
          res.matches.forEach(function (r) {
            if (merged[r.id]) {
              if (r.reportFileId && !merged[r.id].report) merged[r.id].report = { fileId: r.reportFileId, url: r.reportUrl, downloadUrl: r.downloadUrl };
            } else merged[r.id] = Object.assign({ _local: false }, r);
          });
          items = Object.keys(merged).map(function (k) { return merged[k]; });
          note.innerHTML = '';
          if (failed) note.appendChild(h('div', { class: 'notice' }, failed + ' match(es) could not be uploaded – will retry.'));
          draw();
        });
      }).catch(function (e) {
        if (e.code === 'AUTH') { handleErr(e); return; }
        note.innerHTML = ''; note.appendChild(h('div', { class: 'notice' }, e.message));
      });
    }
    draw();
    refresh();
    return h('div', null,
      header('My matches', 'Curator: ' + session.name,
        h('button', { class: 'act', onClick: function () {
          confirmBox('Log out', 'Log out of ' + session.name + '?', 'Log out', true).then(function (ok) { if (ok) logout(); });
        } }, 'Log out'), function () { resetTo('home'); }),
      searchBox(entry.q, 'Search tournament, venue or date', function (v) { entry.q = v; draw(); }),
      sortBar(LIST_SORTS, entry.sort, function (v) { entry.sort = v; draw(); }),
      note, listEl,
      h('button', { class: 'fab', onClick: function () { go('matchInfo', {}); } }, '＋  New match'));
  };

  Views.matchInfo = function (p) {
    var editing = !!p.id;
    var m = editing ? clone(getLocal(p.id)) : L.emptyMatch(session.name);
    var multi = !!(m.endDate && m.endDate !== m.startDate);
    var endWrap = h('div');
    var single = btn('Single day', multi ? 'ghost' : 'primary', function () { multi = false; drawSeg(); });
    var multiB = btn('Multi-day', multi ? 'primary' : 'ghost', function () { multi = true; drawSeg(); });
    var startLbl = h('div');
    function drawSeg() {
      single.className = 'btn ' + (multi ? 'ghost' : 'primary');
      multiB.className = 'btn ' + (multi ? 'primary' : 'ghost');
      endWrap.innerHTML = '';
      startLbl.innerHTML = '';
      startLbl.appendChild(dateField(multi ? 'First match day' : 'Match date', m.startDate, function (v) { m.startDate = v; }));
      if (multi) endWrap.appendChild(dateField('Last match day', m.endDate, function (v) { m.endDate = v; }));
    }
    drawSeg();
    function save() {
      m.tournament = (m.tournament || '').trim(); m.venue = (m.venue || '').trim();
      if (!m.tournament || !m.venue || !m.startDate) { modal('Missing details', 'Please enter the tournament name, venue and match date.'); return; }
      if (multi && m.endDate && m.endDate < m.startDate) { modal('Check dates', 'The last match day is before the first match day.'); return; }
      m.endDate = multi ? (m.endDate || m.startDate) : m.startDate;
      var saved = saveLocal(m);
      if (Cur.m && Cur.m.id === saved.id) Cur.m = saved;
      if (editing) back(); else replace('sheet', { id: saved.id });
    }
    return h('div', null, header(editing ? 'Edit match details' : 'New match'),
      h('div', { class: 'page' },
        card('Match', null,
          field({ label: '1. Tournament name', value: m.tournament, placeholder: 'e.g. Major Clubs 3-Day Tournament 2025/26', onInput: function (v) { m.tournament = v; } }),
          field({ label: '2. Venue', value: m.venue, placeholder: 'e.g. Sinhalese Sports Club Ground, Colombo', onInput: function (v) { m.venue = v; } }),
          label('3. Match date / dates'),
          h('div', { class: 'seg' }, single, multiB),
          startLbl, endWrap),
        btn(editing ? 'Save changes' : 'Create match & open inspection sheet', 'gold', save)));
  };

  var SHORT = { light: 'LMR', medium: 'MMR', heavyManual: 'HMR', heavyMachine: 'Machine' };
  function daySummary(d) {
    var bits = [];
    var roll = L.ROLLERS.filter(function (r) { return +d.rolling[r.key].passes > 0 || +d.rolling[r.key].cross > 0; })
      .map(function (r) { var x = d.rolling[r.key]; return SHORT[r.key] + ' ×' + (+x.passes || 0) + (+x.cross ? ' (+' + x.cross + ' cross)' : ''); });
    if (roll.length) bits.push('🛞 ' + roll.join(', '));
    if (+d.watering.times || d.watering.intensity) bits.push('💧 ' + [d.watering.intensity, d.watering.times ? '×' + d.watering.times : ''].filter(Boolean).join(' '));
    if (d.mowing.height) bits.push('✂️ ' + d.mowing.height + ' mm');
    if (d.crease.done) bits.push('📏 Creases');
    if (d.grassCover) bits.push('🌱 ' + d.grassCover);
    if (d.bounce) bits.push('⬆️ ' + d.bounce);
    return bits.length ? bits.join('   ') : 'No entries yet – tap to fill';
  }

  var TABS = [{ key: 'prep', label: 'Pitch prep' }, { key: 'photo', label: 'Photo' }, { key: 'venue', label: 'Venue' }, { key: 'report', label: 'Report' }];

  Views.sheet = function (p, entry) {
    var m = Cur.load(p.id);
    if (!m) { setTimeout(back); return h('div'); }
    entry.tab = entry.tab || 'prep';
    entry.leave = function () {
      var saved = Cur.flush();
      if (saved && saved.dirty) syncMatch(saved).catch(function () {});
    };
    var content = h('div', { class: 'page' });
    var tabsEl = h('div', { class: 'tabs' });
    var saveBtn = h('button', { class: 'act', onClick: uploadNow }, '☁︎ Save');
    function touch() { Cur.touch(); saveBtn.textContent = '☁︎ Save'; }
    function drawTabs() {
      tabsEl.innerHTML = '';
      TABS.forEach(function (t) {
        tabsEl.appendChild(h('button', { class: entry.tab === t.key ? 'on' : '', onClick: function () { Cur.flush(); entry.tab = t.key; drawTabs(); drawContent(); window.scrollTo(0, 0); } },
          t.label + (t.key === 'photo' && m.photo ? ' ✓' : '')));
      });
      saveBtn.textContent = m.dirty || m._pending ? '☁︎ Save' : '☁︎ Saved';
    }
    function drawContent() {
      m = Cur.m;
      content.innerHTML = '';
      add(content, [({ prep: prepTab, photo: photoTab, venue: venueTab, report: reportTab })[entry.tab]()]);
    }
    function uploadNow() {
      busy(true);
      var saved = Cur.flush();
      syncMatch(saved).then(function (fresh) {
        busy(false); Cur.m = fresh; m = fresh; drawTabs();
        modal('Saved to Google Drive', 'All entries for this match are saved in Drive.');
      }, function (e) { busy(false); handleErr(e, 'Not uploaded yet'); });
    }

    // ---------------- Pitch prep
    function prepTab() {
      var pitch = m.pitch;
      return [
        card('Match', h('button', { class: 'link', onClick: function () { Cur.flush(); go('matchInfo', { id: m.id }); } }, 'Edit'),
          h('p', { class: 'info' }, h('span', null, 'Tournament'), m.tournament),
          h('p', { class: 'info' }, h('span', null, 'Venue'), m.venue),
          h('p', { class: 'info' }, h('span', null, 'Date'), L.matchDateText(m.startDate, m.endDate))),
        card('Pitch for this match', null,
          h('div', { class: 'row' },
            field({ label: 'Pitch no.', value: pitch.number, placeholder: '7', style: 'flex:0 0 96px', onInput: function (v) { pitch.number = v; touch(); } }),
            field({ label: 'Location', hint: 'optional', value: pitch.locationRef, placeholder: 'from the clubhouse side', onInput: function (v) { pitch.locationRef = v; touch(); } })),
          chips('Wicket', null, L.WICKET_TYPE, pitch.wicketType, function (v) { pitch.wicketType = v || 'Fresh'; touch(); })),
        h('div', { class: 'sect' }, 'Day-by-day preparation'),
        m.days.map(function (d, i) {
          return h('div', { class: 'day', onClick: function () { Cur.flush(); entry.scrollY = window.scrollY; go('day', { dayId: d.id }); } },
            h('div', { class: 'n' }, String(i + 1)),
            h('div', { class: 'body' },
              h('div', { class: 't' }, 'Day ' + (i + 1) + (d.date ? '  ·  ' + pretty(d.date) : '') + (d.pitchNo ? '  ·  Pitch ' + d.pitchNo : '')),
              h('div', { class: 's' }, daySummary(d))),
            h('span', { class: 'chev', style: 'font-size:26px;color:var(--sub)' }, '›'));
        }),
        h('button', { class: 'addday', onClick: addDay }, h('i', null, '+'), 'Add Day ' + (m.days.length + 1)),
        card('Final pitch assessment', null,
          chips('Cracks on surface', 'optional', L.CRACKS, m.finalAssessment.cracks, function (v) { m.finalAssessment.cracks = v; touch(); }),
          field({ label: 'Closing remarks', hint: 'optional – added at the end of the Pitch section', multiline: true, rows: 3,
            value: m.finalAssessment.remarks, placeholder: 'e.g. Due to overcast conditions the surface may retain slight moisture underneath.',
            onInput: function (v) { m.finalAssessment.remarks = v; touch(); } })),
      ];
    }
    function addDay() {
      var last = m.days[m.days.length - 1];
      var date = last && last.date ? addDays(last.date, 1) : toISO(new Date());
      var d = L.emptyDay(date, (last && last.pitchNo) || m.pitch.number || '');
      m.days.push(d);
      touch(); Cur.flush();
      entry.scrollY = window.scrollY;
      go('day', { dayId: d.id });
    }

    // ---------------- Photo
    function photoTab() {
      var take = function (camera) {
        pickPhoto(camera).then(function (file) {
          if (!file) return;
          busy(true);
          return processPhotoFile(file).then(function (ph) {
            busy(false);
            m.photo = ph; Cur.photoChanged = true; touch(); Cur.flush();
            drawTabs(); drawContent();
          });
        }).catch(function (e) { busy(false); modal('Photo error', e.message); });
      };
      var hasPhoto = m.photo && (m.photo.thumb || m.photo.base64);
      return card('Pitch photo – final day of preparation', null,
        h('p', { class: 'muted' }, 'This photo is placed in the box beside the Pitch and Outfield sections of the report. It is cropped automatically to fit the box.'),
        hasPhoto
          ? h('div', { style: 'text-align:center;margin-bottom:14px' },
              h('img', { class: 'photo', src: m.photo.base64 ? 'data:image/jpeg;base64,' + m.photo.base64 : m.photo.thumb }),
              m.photo.takenAt ? h('small', { style: 'color:var(--sub)' }, 'Captured ' + pretty(m.photo.takenAt.slice(0, 10))) : null)
          : h('button', { class: 'photo-empty', onClick: function () { take(true); } }, h('span', null, '📷'), 'Tap to open camera'),
        btn(hasPhoto ? '📷  Retake photo' : '📷  Open camera', 'primary', function () { take(true); }),
        btn('Choose from gallery', 'ghost', function () { take(false); }),
        hasPhoto ? btn('Remove photo', 'ghost', function () {
          confirmBox('Remove photo?', '', 'Remove', true).then(function (ok) {
            if (!ok) return;
            m.photo = null; Cur.photoChanged = true; touch(); Cur.flush(); drawTabs(); drawContent();
          });
        }) : null);
    }

    // ---------------- Venue
    function venueTab() {
      return L.OTHER_SECTIONS.map(function (sec, i) {
        return card((i + 2) + '. ' + sec.label, null,
          field({ multiline: true, rows: 5, value: m.sections[sec.key], placeholder: 'Observations on ' + sec.label.toLowerCase() + '…',
            onInput: function (v) { m.sections[sec.key] = v; touch(); } }));
      });
    }

    // ---------------- Report
    function reportTab() {
      var autoText = L.paragraphsToText(L.buildPitchParagraphs(m));
      var edited = !!(m.pitchTextOverride && m.pitchTextOverride.trim());
      var stale = edited && m.pitchTextBase && m.pitchTextBase !== autoText;
      var ta = h('textarea', { class: 'inp report-text', placeholder: 'Add preparation days to build the pitch report.' });
      ta.value = edited ? m.pitchTextOverride : autoText;
      ta.addEventListener('input', function () {
        if (!m.pitchTextOverride) m.pitchTextBase = autoText;
        m.pitchTextOverride = ta.value; touch();
      });
      var missing = [];
      if (!m.days.length) missing.push('No preparation days added');
      if (!m.photo) missing.push('No pitch photo');
      L.OTHER_SECTIONS.forEach(function (sec) { if (!String(m.sections[sec.key] || '').trim()) missing.push(sec.label + ' is empty'); });

      function make() {
        busy(true);
        var saved = Cur.flush();
        generateReport(saved).then(function (res) {
          busy(false); Cur.m = res; m = res; drawTabs(); drawContent();
          modal('Report ready', 'The venue inspection report was saved to Google Drive.',
            [{ label: 'Close', value: false }, { label: 'Open report', value: true, main: true }])
            .then(function (o) { if (o) openUrl(res.report.url); });
        }, function (e) { busy(false); handleErr(e, 'Report not generated'); });
      }
      function del() {
        confirmBox('Delete this match?', 'This removes the match, its photo and report from this phone and from Google Drive.', 'Delete', true).then(function (ok) {
          if (!ok) return;
          busy(true);
          api('deleteMatch', { token: session.token, id: m.id }).catch(function (e) {
            if (e.code !== 'NETWORK' && e.code !== 'CONFIG') throw e;
          }).then(function () {
            busy(false);
            clearTimeout(Cur.timer); deleteLocal(m.id); Cur.m = null;
            entry.leave = null; stack.pop(); render();
          }, function (e) { busy(false); handleErr(e, 'Could not delete from Drive'); });
        });
      }
      return [
        card('1. Pitch – report text', edited ? badge('Edited', 'gold') : badge('Auto'),
          h('p', { class: 'muted' }, 'Written automatically from your daily entries. You can correct the wording below before generating.'),
          stale ? h('div', { class: 'warn' }, 'Daily entries changed after you edited this text. Tap “Rewrite from entries” to include the changes.') : null,
          ta,
          edited ? h('div', { style: 'margin-top:10px' }, btn('Rewrite from entries', 'ghost', function () {
            m.pitchTextOverride = ''; m.pitchTextBase = ''; touch(); drawContent();
          })) : null),
        missing.length ? card('Before you generate', null,
          missing.map(function (x) { return h('div', { style: 'color:#8A6500;margin-bottom:4px' }, '• ' + x); }),
          h('p', { class: 'muted', style: 'margin:8px 0 0' }, 'You can still generate – empty parts are left blank.')) : null,
        btn(m.report ? '📄  Regenerate report & save to Drive' : '📄  Generate report & save to Drive', 'gold', make),
        m.report ? h('div', { style: 'margin-top:14px' }, card('Final report', null,
          m.report.generatedAt ? h('p', { class: 'muted' }, 'Generated ' + new Date(m.report.generatedAt).toLocaleString()) : null,
          btn('Open report (Word)', 'primary', function () { openUrl(m.report.url); }),
          btn('Share link', 'ghost', function () { shareText(m.tournament + ' – ' + m.venue + ' venue inspection report: ' + m.report.url); }))) : null,
        h('div', { style: 'height:30px' }),
        btn('Delete match', 'danger', del),
      ];
    }

    drawTabs();
    drawContent();
    return h('div', null,
      header(m.venue || 'Inspection sheet', (m.tournament || '') + (m.startDate ? ' · ' + pretty(m.startDate) : ''), saveBtn),
      tabsEl, content);
  };

  Views.day = function (p, entry) {
    var m = Cur.m;
    var idx = m ? m.days.findIndex(function (d) { return d.id === p.dayId; }) : -1;
    if (idx < 0) { setTimeout(back); return h('div'); }
    var d = m.days[idx];
    entry.leave = function () { Cur.flush(); };
    function touch() { Cur.touch(); }
    function del() {
      confirmBox('Delete Day ' + (idx + 1) + '?', 'This removes all entries for this day.', 'Delete', true).then(function (ok) {
        if (!ok) return;
        m.days.splice(idx, 1); touch(); back();
      });
    }
    return h('div', null,
      header('Day ' + (idx + 1), 'All fields are optional – fill only what was done', h('button', { class: 'act', onClick: back }, 'Done')),
      h('div', { class: 'page' },
        card('1–2. Date & pitch', null,
          dateField('Date', d.date, function (v) { d.date = v; touch(); }, true),
          field({ label: 'Pitch number', hint: 'pitch being prepared for the match', value: d.pitchNo, placeholder: 'e.g. 7', onInput: function (v) { d.pitchNo = v; touch(); } })),
        card('3. Rolling', null,
          h('p', { class: 'muted' }, 'Number of passes with each roller. Add cross-rolling passes if cross rolling was done.'),
          L.ROLLERS.map(function (r) {
            var x = d.rolling[r.key];
            return h('div', { class: 'roller' }, h('b', null, r.label),
              h('div', { class: 'row' },
                h('div', null, h('div', { class: 'cap' }, 'Passes'), stepper(x.passes, function (v) { x.passes = v; touch(); })),
                h('div', null, h('div', { class: 'cap' }, 'Cross rolling passes'), stepper(x.cross, function (v) { x.cross = v; touch(); }))));
          })),
        card('4. Watering', null,
          h('div', { class: 'row fld', style: 'align-items:center' }, h('b', { style: 'font-size:14px' }, 'How many times'),
            stepper(d.watering.times, function (v) { d.watering.times = v; touch(); })),
          chips('Amount', null, L.WATERING_INTENSITY, d.watering.intensity, function (v) { d.watering.intensity = v; touch(); }),
          chips('When', null, L.WATERING_TIMING, d.watering.timing, function (v) { d.watering.timing = v; touch(); })),
        card('5. Mowing', null,
          field({ label: 'Grass height after mowing (mm)', value: d.mowing.height, placeholder: 'e.g. 8', inputmode: 'decimal',
            onInput: function (v) { d.mowing.height = v.replace(/[^0-9.]/g, ''); touch(); } })),
        card('6. Crease marking', null,
          h('label', { class: 'switch' }, h('span', null, 'Crease marking done'),
            h('input', { type: 'checkbox', checked: d.crease.done, onChange: function (e) { d.crease.done = e.target.checked; touch(); } })),
          field({ value: d.crease.notes, placeholder: 'Notes (optional) e.g. popping & return creases marked', onInput: function (v) { d.crease.notes = v; touch(); } })),
        card('7–8. Surface', null,
          chips('Grass cover density on pitch', null, L.GRASS_COVER, d.grassCover, function (v) { d.grassCover = v; touch(); }),
          chips('Bounce', null, L.BOUNCE, d.bounce, function (v) { d.bounce = v; touch(); })),
        card('Other notes for this day', null,
          field({ multiline: true, rows: 3, value: d.notes, placeholder: 'Anything else worth mentioning (weather, covers, repairs…)', onInput: function (v) { d.notes = v; touch(); } })),
        btn('Done', 'primary', back),
        btn('Delete this day', 'danger', del)));
  };

  var REPORT_SORTS = [
    { key: 'date', label: 'Date (newest)' }, { key: 'dateAsc', label: 'Date (oldest)' },
    { key: 'curator', label: 'Curator' }, { key: 'tournament', label: 'Tournament' }, { key: 'venue', label: 'Venue' },
  ];
  Views.reports = function (p, entry) {
    entry.sort = entry.sort || 'date';
    entry.q = entry.q || '';
    var items = entry.items || [];
    var listEl = h('div', { class: 'page', style: 'padding-top:4px' });
    var note = h('div');
    function group(r) { return entry.sort === 'curator' ? r.curator : entry.sort === 'tournament' ? r.tournament : entry.sort === 'venue' ? r.venue : ''; }
    function draw(loading) {
      listEl.innerHTML = '';
      if (loading && !items.length) { listEl.appendChild(h('div', { class: 'empty' }, h('div', { class: 'spinner', style: 'margin:0 auto' }))); return; }
      var list = sortAndFilter(items, entry.sort, entry.q);
      if (!list.length) listEl.appendChild(h('div', { class: 'empty' }, h('b', null, 'No reports found'), entry.q ? 'Try a different search.' : 'Reports appear here once curators generate them.'));
      list.forEach(function (r, i) {
        var g = group(r);
        if (g && (i === 0 || group(list[i - 1]) !== g)) listEl.appendChild(h('div', { class: 'group' }, g));
        listEl.appendChild(h('div', { class: 'item', style: 'display:block' },
          h('div', { onClick: function () { openUrl(r.reportUrl); } },
            h('div', { class: 't' }, r.tournament),
            h('div', { class: 'l' }, '📍 ' + r.venue),
            h('div', { class: 'l' }, '🗓 ' + dateRange(r)),
            h('div', { class: 'l' }, '🧑‍🌾 ' + r.curator)),
          h('div', { class: 'acts' },
            h('button', { onClick: function () { openUrl(r.reportUrl); } }, 'Open'),
            h('button', { onClick: function () { openUrl(r.downloadUrl); } }, 'Download .docx'),
            h('button', { onClick: function () { shareText(r.tournament + ' – ' + r.venue + ' (' + r.curator + '): ' + r.reportUrl); } }, 'Share'))));
      });
    }
    function load() {
      draw(true);
      api('listReports').then(function (res) {
        items = entry.items = res.reports || []; note.innerHTML = ''; draw();
      }, function (e) { note.innerHTML = ''; note.appendChild(h('div', { class: 'notice' }, e.message)); draw(); });
    }
    load();
    return h('div', null,
      header('Match reports', 'Final venue inspection reports', h('button', { class: 'act', onClick: load }, '↻ Refresh')),
      searchBox(entry.q, 'Search curator, tournament, venue or date', function (v) { entry.q = v; draw(); }),
      sortBar(REPORT_SORTS, entry.sort, function (v) { entry.sort = v; draw(); }),
      note, listEl);
  };

  // Save work if the app is sent to the background.
  document.addEventListener('visibilitychange', function () { if (document.hidden) Cur.flush(); });
  window.addEventListener('pagehide', function () { Cur.flush(); });

  render();
})();
