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

function emptyDay(date, pitchNo) {
  return {
    id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    date: date || '',
    pitchNo: pitchNo || '',
    rolling: {
      light: { passes: '', cross: '' },
      medium: { passes: '', cross: '' },
      heavyManual: { passes: '', cross: '' },
      heavyMachine: { passes: '', cross: '' },
    },
    watering: { times: '', intensity: '', timing: '' },
    mowing: { height: '' },
    crease: { done: false, notes: '' },
    grassCover: '',
    bounce: '',
    notes: '',
  };
}

function emptyMatch(curator) {
  return {
    id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
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

// ---------------------------------------------------------------- watering
function wateringSentence(w, ctx) {
  const n = num(w.times);
  if (!n && !w.intensity) return '';
  const intensity = (w.intensity || '').toLowerCase();
  const kind = intensity ? intensity + ' watering' : 'watering';
  const count = n > 1 ? ' ' + times(n) : '';
  const timing = w.timing === 'Evening' ? ' in the evening'
    : w.timing === 'Morning' ? ' in the morning' : '';

  if (ctx.first && ctx.dayIndex === 0) {
    return 'Wicket preparation commenced with ' + kind + (count ? ', carried out' + count : '') + '.';
  }
  if (ctx.first) {
    return pick([
      'The day began with ' + kind + count + timing + '.',
      cap(kind) + ' was carried out' + count + timing + ' at the start of the day.',
    ], ctx.seed);
  }
  if (ctx.between) {
    return pick([
      'Then ' + kind + ' was done' + count + '.',
      cap(kind) + ' was then carried out' + count + '.',
    ], ctx.seed);
  }
  return pick([
    cap(kind) + ' was carried out' + count + timing + ' over the entire wicket area.',
    cap(kind) + ' was done' + count + timing + ' to close the day.',
    cap(kind) + ' was carried out' + count + timing + '.',
  ], ctx.seed);
}

// ---------------------------------------------------------------- rolling
function manualRollingSentences(list, seed, dayIndex, lead) {
  // list: [{adj, passes, cross}] in roller order
  const out = [];
  if (!list.length) return out;
  const allOnce = list.length >= 2 && list.every((r) => r.passes === 1);
  const prefix = lead ? lead + ' ' : '';

  if (allOnce) {
    const names = list.map((r) => r.adj + ' roller');
    out.push(cap(prefix + pick([
      'the ' + listJoin(names) + ' were used one after another.',
      'the ' + listJoin(names) + ' were each used once.',
    ], seed)));
  } else {
    const first = list[0];
    let s = prefix + 'the ' + first.adj + ' roller was used ' + times(first.passes);
    if (list[1]) {
      const second = list[1];
      s += pick([
        ', followed by ' + rounds(second.passes) + ' with the ' + second.adj + ' roller',
        ', followed by the ' + second.adj + ' roller ' + times(second.passes),
      ], seed + 1);
    }
    out.push(cap(s) + '.');
    list.slice(2).forEach((r, i) => {
      out.push(pick([
        'The ' + r.adj + ' roller was then used ' + times(r.passes) + '.',
        cap(passes(r.passes)) + ' ' + (r.passes === 1 ? 'was' : 'were') + ' then made with the ' + r.adj + ' roller.',
      ], seed + i));
    });
  }
  return out;
}

function crossRollingSentences(list, seed) {
  return list.map((r, i) => {
    const extra = r.cross > 1 ? ' with ' + passes(r.cross) : '';
    return pick([
      cap(r.adj) + ' cross rolling was then carried out' + extra + '.',
      cap(r.adj) + ' cross rolling was completed thereafter' + extra + '.',
    ], seed + i);
  });
}

// ---------------------------------------------------------------- mowing
function mowingSentence(height, prevHeight, seed) {
  const h = clean(height);
  if (!h) return '';
  const mm = /mm$/i.test(h) ? h : h + ' mm';
  const p = parseFloat(prevHeight);
  const c = parseFloat(h);
  if (!isNaN(p) && !isNaN(c) && c < p) {
    return pick([
      'Turf grass mowing was carried out, bringing the grass height down to ' + mm + '.',
      'Turf grass mowing was completed, reducing the grass height to ' + mm + '.',
    ], seed);
  }
  return pick([
    'Turf grass mowing was carried out at a grass height of ' + mm + '.',
    'The turf grass was mowed to a height of ' + mm + '.',
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
function daySentences(day, dayIndex, isLastDay, prevHeight, mainPitch, lastObs) {
  const seed = dayIndex * 7 + 3;
  const s = [];
  const r = day.rolling || {};
  const rollers = ROLLERS.map((R) => ({
    key: R.key,
    adj: R.adj,
    passes: num(r[R.key] && r[R.key].passes),
    cross: num(r[R.key] && r[R.key].cross),
  }));
  const manual = rollers.filter((x) => x.key !== 'heavyMachine' && x.passes > 0);
  const manualCross = rollers.filter((x) => x.key !== 'heavyMachine' && x.cross > 0);
  const machine = rollers.find((x) => x.key === 'heavyMachine');
  const w = day.watering || {};
  const hasWater = num(w.times) > 0 || !!w.intensity;
  const waterFirst = hasWater && (w.timing === 'Start of day' || w.timing === 'Morning');
  const mow = day.mowing && clean(day.mowing.height);

  if (day.pitchNo && mainPitch && String(day.pitchNo) !== String(mainPitch)) {
    s.push('Work was carried out on pitch No. ' + clean(day.pitchNo) + '.');
  }

  if (waterFirst) s.push(wateringSentence(w, { first: true, dayIndex, seed }));

  const lead = !waterFirst && dayIndex > 0 && manual.length
    ? pick(['', 'In the morning', ''], seed) : '';
  s.push(...manualRollingSentences(manual, seed, dayIndex, lead));
  s.push(...crossRollingSentences(manualCross, seed));

  // Mowing sits between manual rolling and the heavy machine roller.
  if (mow) s.push(mowingSentence(mow, prevHeight, seed));

  if (machine.passes > 0) {
    const endings = isLastDay
      ? [' to finalize the preparation', ' to complete the preparation']
      : [" to complete the day's preparation", ' to further consolidate the surface', ''];
    const tail = hasWater && !waterFirst ? '' : pick(endings, seed);
    const then = manual.length || mow ? pick(['then ', ''], seed) : '';
    s.push(pick([
      'The heavy machine roller was ' + then + 'used ' + times(machine.passes) + tail + '.',
      'The heavy machine roller was ' + then + 'used ' + times(machine.passes) + (tail ? tail : ' during the day') + '.',
    ], seed + 2));
  }
  if (machine.cross > 0) {
    s.push('Heavy machine cross rolling was also carried out' +
      (machine.cross > 1 ? ' with ' + passes(machine.cross) : '') + '.');
  }

  if (hasWater && !waterFirst) {
    s.push(wateringSentence(w, { first: s.length === 0, dayIndex, seed }));
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

  return s.filter(Boolean);
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
  emptyDay, emptyMatch, buildPitchParagraphs, paragraphsToText, textToParagraphs, pitchParagraphsFor,
  matchDateText, longDate, dayMonth, ordinal,
};
if (typeof module !== 'undefined') module.exports = g.Logic;
})(typeof window !== 'undefined' ? window : globalThis);
