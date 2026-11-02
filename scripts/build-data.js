#!/usr/bin/env node
// Builds the study-set JSON files in public/data from the full word lists.
// Usage: node scripts/build-data.js
// The full lists are downloaded into .cache/ (not committed); only the small
// study subsets are written to public/data/.

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');

const SOURCES = {
  csw: {
    label: 'Collins (CSW21)',
    file: 'CSW21.txt',
    url: 'https://raw.githubusercontent.com/scrabblewords/scrabblewords/main/words/British/CSW21.txt',
  },
  nwl: {
    label: 'NWL2023 (North America)',
    file: 'NWL2023.txt',
    url: 'https://raw.githubusercontent.com/scrabblewords/scrabblewords/main/words/North-American/NWL2023.txt',
  },
};

// Standard English tile distribution (blanks ignored for probability).
const TILES = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
};
const VOWELS = new Set('AEIOU');
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`${url} -> ${res.statusCode}`));
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
    }).on('error', reject);
  });
}

function cleanDef(d) {
  return d
    .replace(/\[[^\]]*\]\s*$/, '') // trailing [n -S] grammar block
    .replace(/[{<]([^=}>]+)=[^}>]*[}>]/g, '$1')
    .replace(/[{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function load(file) {
  const words = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf(' ');
    const w = (i < 0 ? line : line.slice(0, i)).trim().toUpperCase();
    if (!/^[A-Z]+$/.test(w)) continue;
    words.set(w, i < 0 ? '' : cleanDef(line.slice(i + 1)));
  }
  return words;
}

const alpha = (w) => [...w].sort().join('');

const choose = (n, k) => {
  if (k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

// Number of ways to draw this exact set of tiles from a full bag.
function combos(word) {
  const counts = {};
  for (const c of word) counts[c] = (counts[c] || 0) + 1;
  let p = 1;
  for (const [c, k] of Object.entries(counts)) p *= choose(TILES[c], k);
  return p;
}

function hooks(word, dict) {
  let front = '';
  let back = '';
  for (const c of ALPHA) {
    if (dict.has(c + word)) front += c;
    if (dict.has(word + c)) back += c;
  }
  return [front, back];
}

// Deterministic PRNG so builds are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hasVowel = (w) => /[AEIOUY]/.test(w);
const vowelCount = (w) => [...w].filter((c) => VOWELS.has(c)).length;

// Make phonies: words that look like they belong in the set but are not valid.
// Words valid in the *other* dictionary are preferred - they are the classic traps.
function makePhonies(words, dict, other, keep, rand, max) {
  const out = new Set();
  const tricky = [];
  for (const w of words) {
    for (let i = 0; i < w.length; i++) {
      for (const c of ALPHA) {
        if (c === w[i]) continue;
        const p = w.slice(0, i) + c + w.slice(i + 1);
        if (dict.has(p) || out.has(p) || !keep(p) || !hasVowel(p)) continue;
        if (other && other.has(p)) tricky.push(p);
        out.add(p);
      }
    }
  }
  const all = [...out];
  // shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const picked = new Set(tricky.slice(0, Math.ceil(max / 3)));
  for (const p of all) {
    if (picked.size >= max) break;
    picked.add(p);
  }
  return [...picked].sort();
}

const SETS = [
  {
    id: 'twos',
    name: '2-letter words',
    short: '2s',
    tip: 'The single most valuable list in Scrabble. Learn them letter by letter: say every 2 that contains A, then B, and so on. Know the hooks too: they let you play parallel to existing words.',
    select: (w) => w.length === 2,
    keep: (p) => p.length === 2,
    allPhonies: true,
  },
  {
    id: 'threes',
    name: '3-letter words',
    short: '3s',
    tip: 'Learn them in small daily batches, most probable racks first. Read the definitions, because a meaning (even a silly one) makes a word much easier to recall. The hooks show which 4s each 3 can become.',
    select: (w) => w.length === 3,
    keep: (p) => p.length === 3,
  },
  {
    id: 'jqxz4',
    name: 'JQXZ 4-letter words',
    short: 'JQXZ 4s',
    tip: 'The power tiles score big on short words. Learn each tile as a family (all the J 4s, then Q, X and Z) and look for the patterns, like the -IZ and -AX endings.',
    select: (w) => w.length === 4 && /[JQXZ]/.test(w),
    keep: (p) => /[JQXZ]/.test(p),
  },
  {
    id: 'vowel4',
    name: 'Three-vowel 4s',
    short: 'Vowel 4s',
    tip: 'Your rescue list for when the rack is full of vowels. Words like AEON, EUOI and OUZO dump three or more vowels in one go.',
    select: (w) => w.length === 4 && vowelCount(w) >= 3,
    keep: (p) => vowelCount(p) >= 3,
  },
  {
    id: 'qnou',
    name: 'Q without U',
    short: 'Q no U',
    tip: 'These save you when you draw a Q with no U. Start with QI, QAT, QADI, QAID and QOPH, then add the longer ones. Their plurals (QATS, QAIDS) count too.',
    select: (w) => w.includes('Q') && !w.includes('U') && w.length <= 8,
    keep: (p) => p.includes('Q') && !p.includes('U'),
  },
  {
    id: 'top7',
    name: 'Top 100 7s',
    short: 'Top 7s',
    tip: 'These are the 100 seven-letter racks you are most likely to draw, so they are the bingos you will see most often. Learn each rack with all its anagrams. Say the letters, find every word, and repeat.',
    top: 7,
  },
  {
    id: 'top8',
    name: 'Top 100 8s',
    short: 'Top 8s',
    tip: 'The 100 most likely eight-letter bingos, which you play through a tile already on the board. Learn them as anagram sets, just like the 7s.',
    top: 8,
  },
];

function build(key, dict, other) {
  const rand = rng(12345);
  const used = new Set(); // alphagram keys already covered by an earlier set
  const defs = {};
  const hk = {};
  const sets = [];

  // index alphagrams by length for top-N lists
  const byAlpha = new Map();
  for (const w of dict.keys()) {
    const a = alpha(w);
    if (!byAlpha.has(a)) byAlpha.set(a, []);
    byAlpha.get(a).push(w);
  }

  for (const def of SETS) {
    let groups;
    if (def.top) {
      groups = [...byAlpha.entries()]
        .filter(([a]) => a.length === def.top)
        .sort((x, y) => combos(y[0]) - combos(x[0]) || (x[0] < y[0] ? -1 : 1))
        .slice(0, 100)
        .map(([a, ws]) => [a, ws.slice().sort()]);
    } else {
      const m = new Map();
      for (const w of dict.keys()) {
        if (!def.select(w)) continue;
        const a = alpha(w);
        if (!m.has(a)) m.set(a, []);
        m.get(a).push(w);
      }
      groups = [...m.entries()]
        .map(([a, ws]) => [a, ws.sort()])
        .sort((x, y) => combos(y[0]) - combos(x[0]) || (x[0] < y[0] ? -1 : 1));
    }

    const allWords = groups.flatMap(([, ws]) => ws);
    const cards = [];
    for (const [a, ws] of groups) {
      const k = `${a.length}:${a}`;
      if (used.has(k)) continue;
      used.add(k);
      cards.push({ a, w: ws, p: combos(a) });
    }
    for (const w of allWords) {
      defs[w] = dict.get(w) || '';
      hk[w] = hooks(w, dict);
    }

    let phonies;
    if (def.allPhonies) {
      phonies = [];
      for (const a of ALPHA) for (const b of ALPHA) {
        const p = a + b;
        if (!dict.has(p) && hasVowel(p)) phonies.push(p);
      }
    } else {
      const keep = def.keep || ((p) => p.length === def.top);
      const max = Math.min(Math.max(allWords.length, 60), 600);
      phonies = makePhonies(allWords, dict, other, keep, rand, max);
    }
    const tricky = other ? phonies.filter((p) => other.has(p)) : [];

    sets.push({
      id: def.id,
      name: def.name,
      short: def.short,
      tip: def.tip,
      words: allWords.length,
      cards,
      phonies,
      tricky,
    });
    console.log(`  ${key} ${def.id}: ${cards.length} cards (${allWords.length} words incl. overlaps), ${phonies.length} phonies (${tricky.length} from other list)`);
  }

  return { dict: key, label: SOURCES[key].label, built: new Date().toISOString().slice(0, 10), sets, defs, hooks: hk };
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const lists = {};
  for (const [key, src] of Object.entries(SOURCES)) {
    const f = path.join(CACHE, src.file);
    if (!fs.existsSync(f)) {
      console.log(`Downloading ${src.url}`);
      await download(src.url, f);
    }
    lists[key] = load(f);
    console.log(`${key}: ${lists[key].size} words`);
  }
  for (const key of Object.keys(SOURCES)) {
    const other = key === 'csw' ? lists.nwl : lists.csw;
    const data = build(key, lists[key], other);
    const file = path.join(OUT, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(data));
    console.log(`Wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
