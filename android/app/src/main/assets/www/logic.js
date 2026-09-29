// Shared logic: option lists + the pitch report narrative. Plain browser script.
(function (g) {
// Shared option lists used by the forms and the report narrative.

const ROLLERS = [
  { key: 'light', label: 'Light manual roller', adj: 'light manual' },
  { key: 'medium', label: 'Medium manual roller', adj: 'medium manual' },
  { key: 'heavyManual', label: 'Heavy manual roller', adj: 'heavy manual' },
  { key: 'heavyMachine', label: 'Heavy machine roller', adj: 'heavy machine' },
];

const WATERING_INTENSITY = ['Light', 'Moderate', 'Heavy'];

const WATERING_TIMING = [
  'Start of day',
  'Morning',
  'After rolling',
  'Evening',
];

const GRASS_COVER = ['Bare', 'Sparse', 'Moderate', 'Good', 'Thick'];

const BOUNCE = ['Below average', 'Average', 'Good', 'Excellent'];

const CRACKS = ['None', 'Hairline cracks', 'Small cracks', 'Wide cracks'];

const WICKET_TYPE = ['Fresh', 'Previously used'];

const OTHER_SECTIONS = [
  { key: 'outfield', label: 'Outfield' },
  { key: 'scoreboard', label: 'Scoreboard, Sight screens, Machinery' },
  { key: 'dressingRooms', label: 'Players’ dressing rooms' },
  { key: 'umpiresRoom', label: 'Umpires’ room' },
  { key: 'refereeRoom', label: 'Match referee’s room' },
];

function newId(prefix) {
  return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Current time as "HH:MM" (default for a new rolling / watering entry).
function nowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function emptyRolling(roller, time) {
  return { id: newId('r'), roller: roller, time: time == null ? nowHHMM() : time, passes: '1', cross: false };
}

function emptyWatering(time) {
  return { id: newId('w'), time: time == null ? nowHHMM() : time, intensity: '' };
}

function emptyDay(date, pitchNo) {
  return {
    id: newId('d'),
    date: date || '',
    pitchNo: pitchNo || '',
    rollings: [],   // [{id, roller, time "HH:MM", passes, cross}]
    waterings: [],  // [{id, time "HH:MM", intensity}]
    mowing: { height: '', time: '' },
    crease: { done: false, notes: '' },
    grassCover: '',
    bounce: '',
    notes: '',
  };
}

// Converts days saved by the first app version (one total per roller) to
// the time-stamped entry lists. Safe to call repeatedly.
function normalizeDay(d) {
  if (!d) return d;
  if (!Array.isArray(d.rollings)) {
    d.rollings = [];
    const old = d.rolling || {};
    ROLLERS.forEach((R) => {
      const x = old[R.key];
      if (!x) return;
      if (parseInt(x.passes, 10) > 0) d.rollings.push({ id: newId('r'), roller: R.key, time: '', passes: String(x.passes), cross: false });
      if (parseInt(x.cross, 10) > 0) d.rollings.push({ id: newId('r'), roller: R.key, time: '', passes: String(x.cross), cross: true });
    });
  }
  if (!Array.isArray(d.waterings)) {
    d.waterings = [];
    const w = d.watering || {};
    const n = parseInt(w.times, 10) || (w.intensity ? 1 : 0);
    for (let k = 0; k < n; k++) d.waterings.push({ id: newId('w'), time: '', intensity: w.intensity || '' });
  }
  delete d.rolling;
  delete d.watering;
  if (!d.mowing) d.mowing = { height: '', time: '' };
  if (d.mowing.time == null) d.mowing.time = '';
  if (!d.crease) d.crease = { done: false, notes: '' };
  return d;
}

function emptyMatch(curator) {
  return {
    id: newId('m'),
    curator: curator || '',
    tournament: '',
    venue: '',
    startDate: '',
    endDate: '',
    pitch: { number: '', locationRef: '', wicketType: 'Fresh' },
    days: [],
    finalAssessment: { cracks: '', remarks: '' },
    photo: null, // { uri, base64, driveFileId }
    sections: {
      outfield: '',
      scoreboard: '',
      dressingRooms: '',
      umpiresRoom: '',
      refereeRoom: '',
    },
    pitchTextOverride: '',
    report: null, // { fileId, url, generatedAt }
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    syncState: 'local', // local | synced | pending
  };
}
// Builds the "Pitch" section of the Venue Inspection Report from the
// curator's day-by-day entries. The wording follows the SLC report style:
// an opening line about the wicket, one paragraph per preparation day
// ("10th December: ..."), and a closing assessment of the surface.
// Every field is optional – anything left blank is simply not mentioned.


const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];

function ordinal(n) {
  const v = Math.abs(parseInt(n, 10));
  if (isNaN(v)) return String(n);
  const s = v % 100;
  if (s >= 11 && s <= 13) return v + 'th';
  switch (v % 10) {
    case 1: return v + 'st';
    case 2: return v + 'nd';
    case 3: return v + 'rd';
    default: return v + 'th';
  }
}

function parseISODate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

// "10th December"
function dayMonth(iso) {
  const p = parseISODate(iso);
  if (!p) return '';
  return ordinal(p.d) + ' ' + MONTHS[p.m - 1];
}

// "10th December 2025"
function longDate(iso) {
  const p = parseISODate(iso);
  if (!p) return '';
  return ordinal(p.d) + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
}

// Match date(s) as written in the report header.
function matchDateText(start, end) {
  const a = parseISODate(start);
  const b = parseISODate(end);
  if (!a) return '';
  if (!b || (a.y === b.y && a.m === b.m && a.d === b.d)) return longDate(start);
  if (a.y === b.y && a.m === b.m) {
    return ordinal(a.d) + ' – ' + ordinal(b.d) + ' ' + MONTHS[b.m - 1] + ' ' + b.y;
  }
  if (a.y === b.y) {
    return ordinal(a.d) + ' ' + MONTHS[a.m - 1] + ' – ' + ordinal(b.d) + ' ' + MONTHS[b.m - 1] + ' ' + b.y;
  }
  return longDate(start) + ' – ' + longDate(end);
}

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function num(v) {
  const n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function times(n) {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  if (n <= 10) return NUM_WORDS[n] + ' times';
  return n + ' times';
}

function rounds(n) {
  if (n === 1) return 'one round';
  return (n <= 10 ? NUM_WORDS[n] : n) + ' rounds';
}

function passes(n) {
  if (n === 1) return 'a single pass';
  return (n <= 10 ? NUM_WORDS[n] : n) + ' passes';
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function listJoin(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function clean(s) {
  return String(s || '').trim();
}

function endSentence(s) {
  s = clean(s);
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : s + '.';
}

// "06:30" -> "6.30 a.m.", "13:00" -> "1.00 p.m."
function timeText(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  let h = +m[1];
  const ap = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12 || 12;
  return h + '.' + m[2] + ' ' + ap;
}

function at(t) {
  const tt = timeText(t);
  return tt ? ' at ' + tt : '';
}

// Put a phrase before the final full stop of a sentence.
function beforeStop(sentence, tail) {
  return tail ? sentence.replace(/\.$/, tail + '.') : sentence;
}

// ---------------------------------------------------------------- rolling
// A run of consecutive rolling entries (no watering/mowing in between).
function rollingRunSentences(run, ctx) {
  const out = [];
  const desc = (e) => (e.cross ? e.adj + ' cross rolling' : 'the ' + e.adj + ' roller');
  const first = run[0];
  const t0 = timeText(first.t);
  let lead = t0 ? 'At ' + t0 + ', ' : (ctx.first ? '' : pick(['Thereafter, ', 'Then ', ''], ctx.seed));

  let s1;
  if (first.cross) {
    s1 = lead + first.adj + ' cross rolling was carried out' + (first.passes > 1 ? ' with ' + passes(first.passes) : '');
  } else {
    s1 = lead + 'the ' + first.adj + ' roller was used ' + times(first.passes);
  }
  const second = run[1];
  if (second) {
    if (second.cross) {
      s1 += ', followed by ' + second.adj + ' cross rolling' + (second.passes > 1 ? ' (' + passes(second.passes) + ')' : '') + at(second.t);
    } else {
      s1 += pick([
        ', followed by ' + rounds(second.passes) + ' with the ' + second.adj + ' roller' + at(second.t),
        ', followed by the ' + second.adj + ' roller ' + times(second.passes) + at(second.t),
      ], ctx.seed + 1);
    }
  }
  out.push(cap(s1) + '.');
  run.slice(2).forEach((e, i) => {
    if (e.cross) {
      out.push(cap(e.adj) + ' cross rolling was then carried out' + at(e.t) + (e.passes > 1 ? ' with ' + passes(e.passes) : '') + '.');
    } else {
      out.push(pick([
        'The ' + e.adj + ' roller was then used ' + times(e.passes) + at(e.t) + '.',
        timeText(e.t) ? 'At ' + timeText(e.t) + ', the ' + e.adj + ' roller was used ' + times(e.passes) + '.'
          : cap(passes(e.passes)) + ' ' + (e.passes === 1 ? 'was' : 'were') + ' then made with the ' + e.adj + ' roller.',
      ], ctx.seed + i));
    }
  });
  if (ctx.tail) out[out.length - 1] = beforeStop(out[out.length - 1], ctx.tail);
  return out;
}

// ---------------------------------------------------------------- watering
// A run of consecutive watering entries.
function wateringRunSentences(run, ctx) {
  const out = [];
  // Group neighbours with the same intensity: "Light watering was carried out twice, at 9.00 a.m. and 4.00 p.m."
  const groups = [];
  run.forEach((e) => {
    const g = groups[groups.length - 1];
    if (g && g.intensity === e.intensity) g.items.push(e); else groups.push({ intensity: e.intensity, items: [e] });
  });
  groups.forEach((g, gi) => {
    const kind = g.intensity ? g.intensity + ' watering' : 'watering';
    const n = g.items.length;
    const tts = g.items.map((e) => timeText(e.t)).filter((x, k, arr) => x && arr.indexOf(x) === k);
    const when = tts.length ? ' at ' + listJoin(tts) : '';
    const count = n > 1 ? ' ' + times(n) + (tts.length ? ',' : '') : '';
    const isFirst = ctx.first && gi === 0;
    if (isFirst && ctx.dayIndex === 0) {
      out.push('Wicket preparation commenced with ' + kind + when + (n > 1 ? ', carried out ' + times(n) : '') + '.');
    } else if (isFirst && !tts.length) {
      out.push('The day began with ' + kind + (n > 1 ? ', carried out ' + times(n) : '') + '.');
    } else if (tts.length) {
      out.push(pick([
        cap(kind) + ' was carried out' + count + when + '.',
        cap(kind) + ' was done over the entire wicket area' + count + when + '.',
      ], ctx.seed + gi));
    } else {
      out.push(pick([
        cap(kind) + ' was then carried out' + (n > 1 ? ' ' + times(n) : '') + '.',
        'Then ' + kind + ' was done' + (n > 1 ? ' ' + times(n) : '') + '.',
      ], ctx.seed + gi));
    }
  });
  return out;
}

// ---------------------------------------------------------------- mowing
function mowingSentence(height, prevHeight, seed, t) {
  const h = clean(height);
  if (!h) return '';
  const mm = /mm$/i.test(h) ? h : h + ' mm';
  const p = parseFloat(prevHeight);
  const c = parseFloat(h);
  const when = at(t);
  if (!isNaN(p) && !isNaN(c) && c < p) {
    return pick([
      'Turf grass mowing was carried out' + when + ', bringing the grass height down to ' + mm + '.',
      'Turf grass mowing was completed' + when + ', reducing the grass height to ' + mm + '.',
    ], seed);
  }
  return pick([
    'Turf grass mowing was carried out' + when + ' at a grass height of ' + mm + '.',
    'The turf grass was mowed' + when + ' to a height of ' + mm + '.',
  ], seed);
}

function grassPhrase(v) {
  switch (v) {
    case 'Bare': return 'very little grass cover';
    case 'Sparse': return 'sparse grass cover';
    case 'Moderate': return 'moderate grass cover';
    case 'Good': return 'good grass cover';
    case 'Thick': return 'thick grass cover';
    default: return v ? String(v).toLowerCase() + ' grass cover' : '';
  }
}

function bouncePhrase(v) {
  switch (v) {
    case 'Below average': return 'below average bounce';
    case 'Average': return 'average bounce';
    case 'Good': return 'good bounce';
    case 'Excellent': return 'excellent bounce';
    default: return v ? String(v).toLowerCase() + ' bounce' : '';
  }
}

// ---------------------------------------------------------------- day
// Builds a day's paragraph from its time-stamped activities, in time order.
function dayEvents(day) {
  normalizeDay(day);
  const ev = [];
  day.rollings.forEach((r, i) => {
    const R = ROLLERS.find((x) => x.key === r.roller);
    const n = num(r.passes);
    if (R && n) ev.push({ kind: 'roll', t: clean(r.time), order: i, adj: R.adj, passes: n, cross: !!r.cross });
  });
  day.waterings.forEach((w, i) => {
    ev.push({ kind: 'water', t: clean(w.time), order: 1000 + i, intensity: String(w.intensity || '').toLowerCase() });
  });
  const mow = day.mowing && clean(day.mowing.height);
  if (mow) ev.push({ kind: 'mow', t: clean(day.mowing.time), order: 2000, height: mow });
  // Timed activities in clock order; entries without a time keep the order they were added.
  const timed = ev.filter((e) => e.t).sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : x.order - y.order));
  const untimed = ev.filter((e) => !e.t).sort((x, y) => x.order - y.order);
  return timed.concat(untimed);
}

function daySentences(day, dayIndex, isLastDay, prevHeight, mainPitch, lastObs) {
  const seed = dayIndex * 7 + 3;
  const s = [];

  if (day.pitchNo && mainPitch && String(day.pitchNo) !== String(mainPitch)) {
    s.push('Work was carried out on pitch No. ' + clean(day.pitchNo) + '.');
  }

  const ev = dayEvents(day);
  let lastRoll = -1;
  ev.forEach((e, i) => { if (e.kind === 'roll') lastRoll = i; });

  let i = 0;
  while (i < ev.length) {
    const kind = ev[i].kind;
    let j = i;
    while (j < ev.length && ev[j].kind === kind && kind !== 'mow') j++;
    if (kind === 'mow') j = i + 1;
    const run = ev.slice(i, j);
    const ctx = { first: i === 0, dayIndex: dayIndex, seed: seed + i };
    if (kind === 'roll') {
      if (j - 1 === lastRoll) {
        ctx.tail = isLastDay
          ? pick([' to finalize the preparation', ' to complete the preparation'], seed)
          : (j === ev.length ? pick([" to complete the day's preparation", ' to further consolidate the surface', ''], seed) : '');
      }
      s.push.apply(s, rollingRunSentences(run, ctx));
    } else if (kind === 'water') {
      s.push.apply(s, wateringRunSentences(run, ctx));
    } else {
      s.push(mowingSentence(run[0].height, prevHeight, seed, run[0].t));
    }
    i = j;
  }

  if (day.crease && (day.crease.done || clean(day.crease.notes))) {
    const note = clean(day.crease.notes);
    s.push(note ? endSentence('Crease marking was completed – ' + note) : 'Crease marking was completed.');
  }

  // Grass cover / bounce observed on a day other than the final observation
  if (day.grassCover && lastObs.grassDay !== dayIndex) {
    s.push('The pitch showed ' + grassPhrase(day.grassCover) + ' at this stage.');
  }
  if (day.bounce && lastObs.bounceDay !== dayIndex) {
    s.push('A check of the surface indicated ' + bouncePhrase(day.bounce) + '.');
  }

  if (clean(day.notes)) s.push(endSentence(day.notes));

  // "…at 7.30 a.m.." → "…at 7.30 a.m."
  return s.filter(Boolean).map((x) => x.replace(/([ap]\.m)\.\.(?=\s|$)/g, '$1.'));
}

// Returns an array of paragraphs: { label?: string, text: string }
// label is rendered in bold (e.g. "10th December:").
function buildPitchParagraphs(match) {
  const paras = [];
  const days = (match.days || []).slice();
  const pitch = match.pitch || {};

  // Pitch number: match-level, else the most recent day entry.
  let pitchNo = clean(pitch.number);
  if (!pitchNo) {
    for (let i = days.length - 1; i >= 0; i--) {
      if (clean(days[i].pitchNo)) { pitchNo = clean(days[i].pitchNo); break; }
    }
  }
  const where = clean(pitch.locationRef);
  const fresh = (pitch.wicketType || 'Fresh') === 'Fresh';
  if (pitchNo || where) {
    const subject = pitchNo
      ? (/^\d+$/.test(pitchNo) ? 'The ' + ordinal(pitchNo) + ' wicket' : 'Wicket ' + pitchNo)
      : 'The wicket';
    const loc = where ? ' ' + (/^(from|at|on|near|in)\b/i.test(where) ? where : 'from the ' + where) : '';
    paras.push({
      text: subject + loc + ' was prepared as ' +
        (fresh ? 'a fresh wicket' : 'a previously used wicket') + ' for the upcoming match.',
    });
  }

  // Last day on which grass cover / bounce were recorded → used in the summary.
  const lastObs = { grassDay: -1, bounceDay: -1 };
  days.forEach((d, i) => {
    if (d.grassCover) lastObs.grassDay = i;
    if (d.bounce) lastObs.bounceDay = i;
  });

  let prevHeight = '';
  days.forEach((day, i) => {
    const sentences = daySentences(day, i, i === days.length - 1, prevHeight, pitchNo, lastObs);
    if (day.mowing && clean(day.mowing.height)) prevHeight = clean(day.mowing.height);
    if (!sentences.length) return;
    const label = dayMonth(day.date) || 'Day ' + (i + 1);
    paras.push({ label: label + ':', text: sentences.join(' ') });
  });

  // Closing assessment
  const closing = [];
  const grass = lastObs.grassDay >= 0 ? days[lastObs.grassDay].grassCover : '';
  const bounce = lastObs.bounceDay >= 0 ? days[lastObs.bounceDay].bounce : '';
  const fa = match.finalAssessment || {};
  const cracks = fa.cracks;
  const crackText = cracks && cracks !== 'None'
    ? cracks.toLowerCase().replace('hairline', 'hair line') + ' were visible'
    : cracks === 'None' ? 'no cracks were visible' : '';
  if (grass && crackText) closing.push('The playing surface has ' + grassPhrase(grass) + ' and ' + crackText + '.');
  else if (grass) closing.push('The playing surface has ' + grassPhrase(grass) + '.');
  else if (crackText) closing.push(cap(crackText) + ' on the playing surface.');
  if (bounce) closing.push('Upon inspection the surface was found to have ' + bouncePhrase(bounce) + '.');
  if (clean(fa.remarks)) closing.push(endSentence(fa.remarks));
  if (closing.length) paras.push({ text: closing.join(' ') });

  return paras;
}

function paragraphsToText(paras) {
  return paras.map((p) => (p.label ? p.label + ' ' : '') + p.text).join('\n');
}

// When the curator edits the preview, the text is stored as plain text.
// Convert back to paragraphs, keeping a leading "10th December:" bold.
function textToParagraphs(text) {
  return String(text || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^((?:\d{1,2}(?:st|nd|rd|th)\s+[A-Z][a-z]+|Day\s+\d+)\s*:)\s*(.*)$/.exec(l);
      return m ? { label: m[1], text: m[2] } : { text: l };
    });
}

function pitchParagraphsFor(match) {
  if (clean(match.pitchTextOverride)) return textToParagraphs(match.pitchTextOverride);
  return buildPitchParagraphs(match);
}
g.Logic = {
  ROLLERS, WATERING_INTENSITY, WATERING_TIMING, GRASS_COVER, BOUNCE, CRACKS, WICKET_TYPE, OTHER_SECTIONS,
  emptyDay, emptyMatch, emptyRolling, emptyWatering, normalizeDay, dayEvents, timeText, nowHHMM,
  buildPitchParagraphs, paragraphsToText, textToParagraphs, pitchParagraphsFor,
  matchDateText, longDate, dayMonth, ordinal,
};
if (typeof module !== 'undefined') module.exports = g.Logic;
})(typeof window !== 'undefined' ? window : globalThis);
