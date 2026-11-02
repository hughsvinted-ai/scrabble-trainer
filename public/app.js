/* Scrabble Word Trainer: spaced repetition + anagram recall + phony drills. */
(() => {
  'use strict';

  // ---------- constants ----------
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const ROLLOVER_HOUR = 4; // a "day" starts at 4am local time
  const LEARN_STEPS = [1 * MIN, 10 * MIN];
  const RELEARN_STEPS = [10 * MIN];
  const MASTERED_DAYS = 21;
  const SCORES = { A:1,B:3,C:3,D:2,E:1,F:4,G:2,H:4,I:1,J:8,K:5,L:1,M:3,N:1,O:1,P:3,Q:10,R:1,S:1,T:1,U:1,V:4,W:4,X:8,Y:4,Z:10 };
  const DICTS = { csw: 'Collins (CSW21)', nwl: 'NWL2023' };
  const OTHER = { csw: 'NWL', nwl: 'Collins' };

  // ---------- storage (localStorage can throw in private mode) ----------
  const mem = {};
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
      catch { return k in mem ? mem[k] : d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem[k] = v; }
    },
  };

  const settings = Object.assign(
    { dict: 'csw', newPerDay: 15, showCount: true, focus: 'auto', drillLen: 25 },
    store.get('settings', {})
  );
  const saveSettings = () => store.set('settings', settings);

  let data = null;       // loaded dictionary data
  let prog = null;       // progress for current dictionary
  let index = null;      // lookups built from data

  const progKey = () => `progress_${settings.dict}`;
  function loadProgress() {
    prog = Object.assign({ cards: {}, days: {} }, store.get(progKey(), {}));
  }
  let saveTimer = null;
  function saveProgress(now) {
    if (now) { clearTimeout(saveTimer); store.set(progKey(), prog); return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(progKey(), prog), 150);
  }
  window.addEventListener('pagehide', () => prog && store.set(progKey(), prog));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && prog) store.set(progKey(), prog);
  });

  // ---------- dates ----------
  function dayStart(t = Date.now()) {
    const d = new Date(t - ROLLOVER_HOUR * 3600 * 1000);
    d.setHours(0, 0, 0, 0);
    return d.getTime() + ROLLOVER_HOUR * 3600 * 1000;
  }
  function dayKey(t = Date.now()) {
    const d = new Date(dayStart(t));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function today() {
    const k = dayKey();
    if (!prog.days[k]) prog.days[k] = { rev: 0, new: 0, right: 0, drill: 0 };
    return prog.days[k];
  }
  function streak() {
    let n = 0;
    let t = dayStart();
    if (!(prog.days[dayKey(t)] || {}).rev) t -= DAY; // today not done yet: count from yesterday
    for (;;) {
      const d = prog.days[dayKey(t + 2 * 3600 * 1000)];
      if (!d || !(d.rev || d.drill)) break;
      n++; t -= DAY;
    }
    return n;
  }

  // ---------- data ----------
  async function loadData() {
    const res = await fetch(`data/${settings.dict}.json`);
    if (!res.ok) throw new Error('Could not load word data');
    data = await res.json();
    index = { card: new Map(), word: new Map(), sets: new Map() };
    data.sets.forEach((s, i) => {
      s.order = i;
      index.sets.set(s.id, s);
      for (const c of s.cards) {
        c.key = `${s.id}:${c.a}`;
        c.set = s;
        index.card.set(c.key, c);
        for (const w of c.w) if (!index.word.has(w)) index.word.set(w, c);
      }
    });
    loadProgress();
  }

  // ---------- SRS ----------
  const rec = (c) => prog.cards[c.key];
  function status(c) {
    const r = rec(c);
    if (!r) return 'new';
    if (r.s === 'learn' || r.s === 'relearn') return 'learning';
    return r.ivl >= MASTERED_DAYS ? 'mastered' : 'review';
  }
  function setStats(s) {
    const st = { new: 0, learning: 0, review: 0, mastered: 0, due: 0, total: s.cards.length };
    const now = Date.now();
    for (const c of s.cards) {
      st[status(c)]++;
      const r = rec(c);
      if (r && r.due <= now) st.due++;
    }
    st.seen = st.total - st.new;
    return st;
  }

  function fuzz(ivl) {
    if (ivl < 3) return ivl;
    return Math.max(1, Math.round(ivl * (0.95 + Math.random() * 0.1)));
  }

  // grade: 0 again, 1 hard, 2 good, 3 easy. Returns new record (does not mutate).
  function schedule(old, grade, now = Date.now()) {
    const r = old ? { ...old } : { s: 'learn', step: 0, ease: 2.5, ivl: 0, reps: 0, lapses: 0, first: now };
    r.reps++;
    r.last = now;
    const graduate = (days) => {
      r.s = 'review';
      r.step = 0;
      r.ivl = Math.max(1, Math.round(days));
      r.due = dayStart(now) + r.ivl * DAY;
    };
    if (r.s === 'learn' || r.s === 'relearn') {
      const steps = r.s === 'learn' ? LEARN_STEPS : RELEARN_STEPS;
      const base = r.s === 'relearn' ? Math.max(1, r.ivl) : 1;
      if (grade === 0) { r.step = 0; r.due = now + steps[0]; }
      else if (grade === 1) { r.due = now + Math.round(steps[Math.min(r.step, steps.length - 1)] * 1.5); }
      else if (grade === 2) {
        r.step++;
        if (r.step >= steps.length) graduate(base);
        else r.due = now + steps[r.step];
      } else graduate(r.s === 'relearn' ? base + 1 : 4);
    } else {
      if (grade === 0) {
        r.lapses++;
        r.ease = Math.max(1.3, r.ease - 0.2);
        r.ivl = Math.max(1, Math.round(r.ivl * 0.4));
        r.s = 'relearn';
        r.step = 0;
        r.due = now + RELEARN_STEPS[0];
      } else {
        let ivl;
        if (grade === 1) { ivl = Math.max(r.ivl + 1, r.ivl * 1.2); r.ease = Math.max(1.3, r.ease - 0.15); }
        else if (grade === 2) ivl = Math.max(r.ivl + 1, r.ivl * r.ease);
        else { ivl = Math.max(r.ivl + 2, r.ivl * r.ease * 1.3); r.ease += 0.15; }
        graduate(fuzz(Math.min(ivl, 3650)));
      }
    }
    return r;
  }
  function describeDue(r, now = Date.now()) {
    const ms = r.due - now;
    if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`;
    if (ms < DAY) return `${Math.round(ms / (60 * MIN))} h`;
    const d = r.ivl || Math.round(ms / DAY);
    if (d < 31) return `${d} day${d === 1 ? '' : 's'}`;
    if (d < 365) return `${Math.round(d / 30)} mo`;
    return `${(d / 365).toFixed(1)} yr`;
  }

  // ---------- what to study ----------
  function focusSet() {
    if (settings.focus !== 'auto' && index.sets.has(settings.focus)) return index.sets.get(settings.focus);
    return data.sets.find((s) => s.cards.some((c) => !rec(c))) || null;
  }
  function nextNewCards(n) {
    const out = [];
    const order = settings.focus !== 'auto' && index.sets.has(settings.focus)
      ? [index.sets.get(settings.focus), ...data.sets]
      : data.sets;
    const seen = new Set();
    for (const s of order) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      for (const c of s.cards) {
        if (out.length >= n) return out;
        if (!rec(c)) out.push(c);
      }
    }
    return out;
  }
  function dueCards(now = Date.now()) {
    const out = [];
    for (const [key, r] of Object.entries(prog.cards)) {
      if (r.due <= now) {
        const c = index.card.get(key);
        if (c) out.push(c);
      }
    }
    return out.sort((a, b) => rec(a).due - rec(b).due);
  }
  const newLeftToday = () => Math.max(0, settings.newPerDay - today().new);

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tile = (ch, cls = '', attrs = '') => `<button class="t ${cls}" ${attrs}>${ch}<sub>${SCORES[ch] ?? ''}</sub></button>`;
  const tiles = (w, cls = '') => [...w].map((c) => tile(c, cls, 'tabindex="-1"')).join('');
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const STATUS_COLOR = { new: 'var(--new)', learning: 'var(--learning)', review: 'var(--review)', mastered: 'var(--mastered)' };
  function hookHTML(w) {
    const h = data.hooks[w];
    if (!h) return '';
    const [f, b] = h;
    if (!f && !b) return `<span class="hook">no hooks</span>`;
    return `<span class="hook"><b>${f.toLowerCase() || '·'}</b> ${w} <b>${b.toLowerCase() || '·'}</b></span>`;
  }
  function wordItem(w, missed = false) {
    return `<li><div class="wline"><span class="word ${missed ? 'missed' : ''}">${w}</span>${hookHTML(w)}</div>
      <div class="def">${esc(data.defs[w] || '')}</div></li>`;
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
  const app = () => $('#app');
  let keyHandler = null;
  document.addEventListener('keydown', (e) => keyHandler && keyHandler(e));
  function setKeys(fn) { keyHandler = fn; }

  // ---------- router ----------
  const routes = {};
  function go(path) {
    if (location.hash !== '#' + path) location.hash = path;
    else render();
  }
  function render() {
    setKeys(null);
    document.querySelectorAll('.sheet-bg').forEach((el) => el.remove());
    const [name, arg] = (location.hash.slice(1) || 'home').split('/');
    (routes[name] || routes.home)(arg && decodeURIComponent(arg));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  function bar(title, back = 'home', extra = '') {
    return `<div class="bar">${back ? `<button class="iconbtn" data-go="${back}" aria-label="Back">‹</button>` : ''}
      <h1>${title}</h1>${extra}</div>`;
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); }
  });

  // ---------- HOME ----------
  routes.home = () => {
    const due = dueCards().length;
    const nNew = Math.min(newLeftToday(), nextNewCards(newLeftToday()).length);
    const t = today();
    const fs = focusSet();
    const sets = data.sets.map((s, i) => {
      const st = setStats(s);
      const pct = (n) => (100 * n) / st.total;
      const cur = fs && fs.id === s.id;
      const done = st.new === 0 && st.learning === 0;
      return `<div class="set ${cur ? 'current' : ''} ${done && !cur ? 'done' : ''}" data-go="set/${s.id}">
        <div class="num">${done && !cur ? '✓' : i + 1}</div>
        <div class="body">
          <div class="title"><span>${s.name}</span><span class="pill">${cur ? 'Studying' : `${st.seen}/${st.total}`}</span></div>
          <div class="prog"><i class="m" style="width:${pct(st.mastered)}%"></i><i class="r" style="width:${pct(st.review)}%"></i><i class="l" style="width:${pct(st.learning)}%"></i></div>
          <div class="small muted">${s.words} words · ${st.mastered} mastered${st.due ? ` · <b style="color:var(--warn)">${st.due} due</b>` : ''}</div>
        </div></div>`;
    }).join('');

    const nothing = !due && !nNew;
    app().innerHTML = `
      ${bar('Word Trainer', null, `<span class="pill">${DICTS[settings.dict]}</span><button class="iconbtn" data-go="settings" aria-label="Settings">⚙︎</button>`)}
      <div class="card hero">
        <div class="stats">
          <div><b>${due}</b><span>Due</span></div>
          <div><b>${nNew}</b><span>New</span></div>
          <div><b>${streak()}</b><span>Day streak</span></div>
        </div>
        ${nothing
          ? `<p><b>All caught up for today.</b></p><p class="muted small">Run a phony drill to keep sharp, or learn a few extra.</p>
             <div class="row" style="margin-top:12px"><button class="btn" id="extra">+10 new</button><button class="btn primary" data-go="drill">Phony drill</button></div>`
          : `<button class="btn primary block" data-go="study">Start session</button>
             <p class="small muted" style="margin-top:10px">${t.rev ? `${t.rev} reviews done today${t.rev ? ` · ${Math.round((100 * t.right) / t.rev)}% right` : ''}` : fs ? `Next up: <b>${fs.name}</b>` : 'Every set started, nice.'}</p>`}
      </div>
      <div class="grid2">
        <button class="tilebtn" data-go="drill"><span class="ico">✓✗</span><b>Valid or phony?</b><span>Quick-fire judging</span></button>
        <button class="tilebtn" data-go="browse"><span class="ico">📖</span><b>Word lists</b><span>Read, hooks, meanings</span></button>
      </div>
      <div class="card">
        <div class="qhead"><h2>Your path</h2><button class="btn ghost small" data-go="guide" style="min-height:0;padding:4px">How it works</button></div>
        <div class="legend" style="margin:4px 0 6px"><span><i style="background:var(--mastered)"></i>Mastered</span><span><i style="background:var(--review)"></i>Learned</span><span><i style="background:var(--learning)"></i>Learning</span></div>
        ${sets}
      </div>`;
    const ex = $('#extra');
    if (ex) ex.onclick = () => { today().new = Math.max(0, today().new - 10); saveProgress(true); go('study'); };
  };

  // ---------- SET DETAIL ----------
  routes.set = (id) => {
    const s = index.sets.get(id);
    if (!s) return go('home');
    const st = setStats(s);
    const isFocus = settings.focus === s.id;
    app().innerHTML = `
      ${bar(s.name)}
      <div class="card">
        <p>${esc(s.tip)}</p>
        <div class="stats" style="margin-top:14px">
          <div><b>${st.total}</b><span>Racks</span></div>
          <div><b>${st.seen}</b><span>Started</span></div>
          <div><b>${st.mastered}</b><span>Mastered</span></div>
        </div>
        <p class="small muted">${s.words} words grouped into ${st.total} racks (each rack is a set of letters that makes one or more words), most likely racks first.</p>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="btn" data-go="browse/${s.id}">Read list</button>
        <button class="btn" data-go="drill/${s.id}">Phony drill</button>
      </div>
      <button class="btn ${isFocus ? '' : 'primary'} block" id="focus">${isFocus ? 'Go back to priority order' : 'Study this set next'}</button>
      <p class="small muted" style="text-align:center">${isFocus ? 'New cards are coming from this set first.' : 'Normally new cards follow your priority order. This jumps the queue.'}</p>`;
    $('#focus').onclick = () => {
      settings.focus = isFocus ? 'auto' : s.id;
      saveSettings();
      toast(isFocus ? 'Back to priority order' : `New cards will come from ${s.short}`);
      routes.set(id);
    };
  };

  // ---------- STUDY SESSION ----------
  let session = null;
  routes.study = () => {
    const now = Date.now();
    session = {
      reviews: dueCards(now).filter((c) => rec(c).s === 'review'),
      news: nextNewCards(newLeftToday()),
      n: 0,
      done: 0,
      right: 0,
    };
    nextCard();
  };

  function pickNext() {
    const now = Date.now();
    // learning cards that are due now take priority
    const learning = Object.entries(prog.cards)
      .filter(([, r]) => r.s !== 'review')
      .map(([k, r]) => ({ c: index.card.get(k), r }))
      .filter((x) => x.c)
      .sort((a, b) => a.r.due - b.r.due);
    if (learning.length && learning[0].r.due <= now) return { c: learning[0].c, kind: 'quiz' };
    // after a few brand-new cards, quiz them before introducing more
    const fresh = learning.filter((x) => x.r.s === 'learn' && x.r.step === 0 && x.r.due - now <= LEARN_STEPS[0]);
    if (fresh.length >= 3) return { c: fresh[0].c, kind: 'quiz', early: true };
    session.reviews = session.reviews.filter((c) => rec(c) && rec(c).due <= now && rec(c).s === 'review');
    session.news = session.news.filter((c) => !rec(c));
    const wantNew = session.news.length && (session.n % 3 === 2 || !session.reviews.length);
    if (wantNew && newLeftToday() > 0) return { c: session.news[0], kind: 'learn' };
    if (session.reviews.length) return { c: session.reviews[0], kind: 'quiz' };
    // nothing else: bring the next learning card forward rather than make you wait
    if (learning.length && learning[0].r.due - now < 20 * MIN) return { c: learning[0].c, kind: 'quiz', early: true };
    return null;
  }

  function counts() {
    const now = Date.now();
    let learning = 0;
    for (const r of Object.values(prog.cards)) if (r.s !== 'review' && r.due - now < 20 * MIN) learning++;
    const rv = session.reviews.filter((c) => rec(c) && rec(c).due <= now && rec(c).s === 'review').length;
    const nw = Math.min(session.news.filter((c) => !rec(c)).length, newLeftToday());
    return `<div class="counts"><span class="pill" title="New"><b style="color:var(--review)">${nw}</b> new</span><span class="pill"><b style="color:var(--learning)">${learning}</b> learning</span><span class="pill"><b style="color:var(--mastered)">${rv}</b> due</span></div>`;
  }

  function nextCard() {
    const p = pickNext();
    if (!p) return sessionDone();
    session.n++;
    if (p.kind === 'learn') showLearn(p.c);
    else showQuiz(p.c);
  }

  function sessionDone() {
    const t = today();
    app().innerHTML = `${bar('Session complete')}
      <div class="card hero">
        <div class="big">🎉</div>
        <p style="margin-top:10px"><b>${session.done} cards reviewed</b>${session.done ? ` · ${Math.round((100 * session.right) / session.done)}% right first time` : ''}</p>
        <p class="muted small">Today: ${t.rev} reviews, ${t.new} new racks. Day streak: ${streak()}.</p>
        <p class="muted small">Cards you've just learned come back in 10 minutes, then tomorrow. Short gaps first, then longer ones, is how they stick.</p>
      </div>
      <div class="row"><button class="btn" data-go="drill">Phony drill</button><button class="btn primary" data-go="home">Done</button></div>`;
  }

  function showLearn(c) {
    const s = c.set;
    const r = rec(c);
    app().innerHTML = `
      <div class="qhead"><button class="iconbtn" data-go="home" aria-label="Exit">✕</button>${counts()}</div>
      <div class="card">
        <div class="qhead"><span class="pill" style="background:var(--review);color:#fff">NEW · ${s.short}</span><span class="small muted">${c.w.length} word${c.w.length > 1 ? 's' : ''}</span></div>
        <div class="rack big" style="margin:16px 0">${tiles(c.a)}</div>
        <ul class="words">${c.w.map((w) => wordItem(w)).join('')}</ul>
      </div>
      <p class="small muted" style="text-align:center">${learnTip(c)}</p>
      <button class="btn primary block" id="got">Got it, quiz me soon</button>`;
    const done = () => {
      const now = Date.now();
      // enters learning at step 0; first quiz in about a minute
      prog.cards[c.key] = r || { s: 'learn', step: 0, ease: 2.5, ivl: 0, reps: 0, lapses: 0, first: now, due: now + LEARN_STEPS[0] };
      today().new++;
      saveProgress();
      nextCard();
    };
    $('#got').onclick = done;
    setKeys((e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(); } });
  }

  function learnTip(c) {
    const tips = [
      'Say the letters out loud, then the word(s). Linking sound and sight helps it stick.',
      'Make up a silly picture for the meaning. Odd images are easier to remember.',
      'Look at the hooks: the letters that can go in front of or after the word.',
      'Don\'t try to cram it. You\'ll be tested in a minute, then again later. That gap is what makes it stick.',
    ];
    if (c.w.length > 1) tips.unshift(`${c.w.length} words from the same letters. Learn the rack, not just one word.`);
    return tips[Math.floor(Math.random() * tips.length)];
  }

  function showQuiz(c) {
    const r = rec(c);
    const s = c.set;
    const L = c.a.length;
    let rack = [...c.a];
    let built = []; // indices into rack
    const found = new Set();
    let wrong = 0;
    let finished = false;
    const started = Date.now();

    app().innerHTML = `
      <div class="qhead"><button class="iconbtn" data-go="home" aria-label="Exit">✕</button>${counts()}</div>
      <div class="card" id="qcard">
        <div class="qhead"><span class="pill">${s.short}${r && r.s !== 'review' ? ' · learning' : ''}</span>
          <span class="small muted">${settings.showCount ? `Find ${c.w.length === 1 ? 'the word' : `all ${c.w.length} words`}` : 'Find every word'}</span></div>
        <div class="rack" id="rack" style="margin-top:14px"></div>
        <div class="build" id="build"></div>
        <div class="feedback" id="fb"></div>
        <div class="slots" id="slots"></div>
        <div id="after"></div>
      </div>
      <div id="controls">
        <div class="row" style="margin-bottom:10px">
          <button class="btn" id="shuf">⇄ Shuffle</button>
          <button class="btn" id="back">⌫</button>
          <button class="btn" id="clear">Clear</button>
        </div>
        ${settings.showCount
          ? `<button class="btn ghost block" id="give">Show answers</button>`
          : `<div class="row"><button class="btn" id="give">Show answers</button><button class="btn primary" id="done">That's all</button></div>`}
      </div>`;

    const drawRack = () => {
      $('#rack').innerHTML = rack.map((ch, i) => tile(ch, built.includes(i) ? 'used' : '', `data-i="${i}"`)).join('');
      $('#build').innerHTML = built.map((i, j) => tile(rack[i], '', `data-j="${j}"`)).join('');
    };
    const drawSlots = (reveal = false) => {
      const list = settings.showCount || reveal ? c.w : [...found];
      $('#slots').innerHTML = list.map((w) => {
        const f = found.has(w);
        return `<span class="slot ${f ? 'found' : reveal ? 'missed' : ''}">${f || reveal ? w : '•'.repeat(L)}</span>`;
      }).join('');
    };
    const fb = (msg, cls) => { const el = $('#fb'); el.textContent = msg; el.className = 'feedback ' + cls; };

    const submit = () => {
      const w = built.map((i) => rack[i]).join('');
      built = [];
      if (c.w.includes(w)) {
        if (found.has(w)) fb(`${w}: already found`, '');
        else { found.add(w); fb(`✓ ${w}`, 'good'); }
      } else {
        wrong++;
        buzz(60);
        fb(`✗ ${w} isn't valid`, 'bad');
        $('#build').classList.remove('shake'); void $('#build').offsetWidth; $('#build').classList.add('shake');
      }
      drawRack();
      drawSlots();
      if (settings.showCount && found.size === c.w.length) finish(false);
    };
    const add = (i) => {
      if (finished || built.includes(i)) return;
      built.push(i);
      drawRack();
      if (built.length === L) setTimeout(submit, 120);
    };
    const back = () => { if (!finished) { built.pop(); drawRack(); } };

    $('#rack').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) add(+b.dataset.i); };
    $('#build').onclick = (e) => { const b = e.target.closest('[data-j]'); if (b && !finished) { built.splice(+b.dataset.j, 1); drawRack(); } };
    $('#shuf').onclick = () => { if (finished) return; rack = shuffle(rack); built = []; drawRack(); };
    $('#back').onclick = back;
    $('#clear').onclick = () => { built = []; drawRack(); };
    $('#give').onclick = () => finish(true);
    if ($('#done')) $('#done').onclick = () => finish(false);

    setKeys((e) => {
      if (finished) return;
      const k = e.key.toUpperCase();
      if (e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'Escape') { built = []; drawRack(); }
      else if (e.key === 'Enter' && !settings.showCount && !built.length) finish(false);
      else if (k.length === 1 && k >= 'A' && k <= 'Z') {
        const i = rack.findIndex((ch, j) => ch === k && !built.includes(j));
        if (i >= 0) add(i);
      } else if (e.key === ' ') { e.preventDefault(); $('#shuf').click(); }
    });

    function finish(gaveUp) {
      if (finished) return;
      finished = true;
      setKeys(null);
      const missed = c.w.filter((w) => !found.has(w));
      const success = !gaveUp && missed.length === 0;
      const secs = (Date.now() - started) / 1000;
      drawSlots(true);
      $('#controls').innerHTML = '';
      fb(success ? (wrong ? `Got them all, but ${wrong} phony guess${wrong > 1 ? 'es' : ''}` : 'Perfect!') : `Missed ${missed.length}`, success ? 'good' : 'bad');

      const fastLimit = 3 + L * 1.5 + (c.w.length - 1) * 4;
      const recommended = !success ? 0 : wrong ? 1 : secs < fastLimit && r && r.s === 'review' ? 3 : 2;
      const preview = (g) => describeDue(schedule(r, g));
      const list = `<ul class="words" style="margin-top:12px">${c.w.map((w) => wordItem(w, !found.has(w))).join('')}</ul>`;
      const after = success
        ? `<div class="grades">
             <button class="btn ${recommended === 1 ? 'rec' : ''}" data-g="1">Hard<small>${preview(1)}</small></button>
             <button class="btn ${recommended === 2 ? 'primary rec' : ''}" data-g="2">Good<small>${preview(2)}</small></button>
             <button class="btn ${recommended === 3 ? 'primary rec' : ''}" data-g="3">Easy<small>${preview(3)}</small></button>
           </div>`
        : `<div class="row" style="margin-top:12px"><button class="btn ghost" data-g="2">I knew it (mis-tap)</button><button class="btn primary" data-g="0">Next · again in ${preview(0)}</button></div>`;
      $('#after').innerHTML = list + after;
      $('#after').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const grade = (g) => {
        const first = !r || r.s === 'review';
        prog.cards[c.key] = schedule(r, g);
        const t = today();
        t.rev++;
        if (g > 0) t.right++;
        session.done++;
        if (g > 0 && first) session.right++;
        saveProgress();
        nextCard();
      };
      $('#after').onclick = (e) => { const b = e.target.closest('[data-g]'); if (b) grade(+b.dataset.g); };
      setKeys((e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); grade(recommended); }
        else if (success && ['1', '2', '3'].includes(e.key)) grade(+e.key);
      });
    }

    drawRack();
    drawSlots();
  }

  // ---------- PHONY DRILL ----------
  routes.drill = (setId) => {
    const scope = setId && index.sets.has(setId) ? [index.sets.get(setId)] : null;
    let words = [];
    let phonies = [];
    let tricky = new Set();
    let label;
    if (scope) {
      const s = scope[0];
      words = s.cards.flatMap((c) => c.w);
      phonies = s.phonies.slice();
      s.tricky.forEach((p) => tricky.add(p));
      label = s.name;
    } else {
      const started = data.sets.filter((s) => s.cards.some((c) => rec(c)));
      const use = started.length ? started : [data.sets[0]];
      for (const s of use) {
        const cs = started.length ? s.cards.filter((c) => rec(c)) : s.cards;
        words.push(...cs.flatMap((c) => c.w));
        // phonies proportional to what you've started in this set
        const share = Math.max(10, Math.round((s.phonies.length * cs.length) / s.cards.length));
        phonies.push(...shuffle(s.phonies).slice(0, share));
        s.tricky.forEach((p) => tricky.add(p));
      }
      label = started.length ? 'Words you\'ve started' : data.sets[0].name;
    }
    words = [...new Set(words)];
    phonies = [...new Set(phonies)];
    // weight words you've struggled with
    const weighted = words.flatMap((w) => {
      const c = index.word.get(w);
      const r = c && rec(c);
      return r && (r.lapses > 0 || r.s !== 'review') ? [w, w] : [w];
    });
    const N = settings.drillLen;
    const qs = [];
    const usedQ = new Set();
    for (let i = 0; i < N * 4 && qs.length < N; i++) {
      const valid = Math.random() < 0.5;
      const pool = valid ? weighted : phonies;
      if (!pool.length) continue;
      const w = pool[Math.floor(Math.random() * pool.length)];
      if (usedQ.has(w)) continue;
      usedQ.add(w);
      qs.push({ w, valid });
    }

    let i = 0;
    let score = 0;
    const misses = [];
    let locked = false;
    const t0 = Date.now();

    const drawQ = () => {
      if (i >= qs.length) return end();
      locked = false;
      const q = qs[i];
      app().innerHTML = `
        <div class="qhead"><button class="iconbtn" data-go="home" aria-label="Exit">✕</button>
          <span class="pill">${esc(label)}</span><span class="pill"><b>${score}</b>/${i}</span></div>
        <div class="meter"><i style="width:${(100 * i) / qs.length}%"></i></div>
        <div class="card" id="dcard" style="margin-top:12px">
          <div class="drillword">${tiles(q.w)}</div>
          <div class="drillfb" id="dfb"><span class="muted small">Is this a valid word in ${DICTS[settings.dict]}?</span></div>
        </div>
        <div class="drillbtns">
          <button class="btn bad" data-a="0">✗ Phony</button>
          <button class="btn primary" data-a="1">✓ Valid</button>
        </div>
        <p class="small muted" style="text-align:center;margin-top:10px">Trust your first instinct. Speed matters.</p>`;
      $('.drillbtns').onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) answer(b.dataset.a === '1'); };
      setKeys((e) => {
        if (locked) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); i++; drawQ(); } return; }
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'v') answer(true);
        if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'p') answer(false);
      });
    };
    const answer = (saysValid) => {
      if (locked) return;
      locked = true;
      const q = qs[i];
      const ok = saysValid === q.valid;
      const card = $('#dcard');
      card.classList.add(ok ? 'flash-good' : 'flash-bad');
      let info;
      if (q.valid) info = `<b>${q.w}</b> is valid. <span class="muted">${esc(data.defs[q.w] || '')}</span>`;
      else info = `<b>${q.w}</b> is a phony.${tricky.has(q.w) ? ` <span class="muted">(It is valid in ${OTHER[settings.dict]}, though.)</span>` : ''}`;
      $('#dfb').innerHTML = `<div class="${ok ? 'feedback good' : 'feedback bad'}" style="font-size:16px">${ok ? '✓ Correct' : '✗ Wrong'}</div><div class="small">${info}</div>`;
      if (ok) score++;
      else {
        buzz(80);
        misses.push(q);
        // a valid word you didn't recognise: bring its card back for review
        if (q.valid) {
          const c = index.word.get(q.w);
          const r = c && rec(c);
          if (r && r.s === 'review') { r.due = Date.now(); r.ivl = Math.max(1, Math.round(r.ivl * 0.5)); saveProgress(); }
        }
      }
      const t = today();
      t.drill++;
      saveProgress();
      if (ok) setTimeout(() => { if (qs[i] === q) { i++; drawQ(); } }, 850);
      else {
        $('.drillbtns').outerHTML = `<button class="btn block" id="cont">Continue</button>`;
        $('#cont').onclick = () => { i++; drawQ(); };
      }
    };
    const end = () => {
      setKeys(null);
      const secs = Math.round((Date.now() - t0) / 1000);
      const best = store.get('drillBest', {});
      const k = `${settings.dict}:${setId || 'mix'}`;
      const pct = Math.round((100 * score) / qs.length);
      const isBest = !best[k] || pct > best[k];
      if (isBest) { best[k] = pct; store.set('drillBest', best); }
      app().innerHTML = `${bar('Drill complete')}
        <div class="card hero">
          <div class="big">${pct}%</div>
          <p>${score} / ${qs.length} in ${secs}s ${isBest ? '· <b>new best!</b>' : ''}</p>
        </div>
        ${misses.length ? `<div class="card"><h3>Review these</h3><ul class="words">${misses.map((q) =>
          q.valid ? wordItem(q.w) : `<li><span class="word missed">${q.w}</span> <span class="small muted">phony${tricky.has(q.w) ? ` (valid in ${OTHER[settings.dict]})` : ''}</span></li>`
        ).join('')}</ul><p class="small muted">Valid words you missed have been brought forward for review.</p></div>` : ''}
        <div class="row"><button class="btn" data-go="home">Home</button><button class="btn primary" id="again">Go again</button></div>`;
      $('#again').onclick = () => routes.drill(setId);
    };
    drawQ();
  };

  // ---------- BROWSE ----------
  routes.browse = (setId) => {
    const s = index.sets.get(setId) || focusSet() || data.sets[0];
    app().innerHTML = `${bar('Word lists')}
      <div class="chips">${data.sets.map((x) => `<button class="chip ${x.id === s.id ? 'on' : ''}" data-go="browse/${x.id}">${x.short}</button>`).join('')}</div>
      <input type="search" id="q" placeholder="Search ${esc(s.name)}…" autocapitalize="characters" autocomplete="off" spellcheck="false">
      <div class="card" id="list"></div>
      <p class="small muted" style="text-align:center">Tap a word for its meaning and hooks. Dot colour shows your progress.</p>`;
    const byLetter = s.id === 'twos' || s.id === 'threes' || s.id === 'jqxz4' || s.id === 'vowel4' || s.id === 'qnou';
    const words = s.cards.flatMap((c) => c.w.map((w) => ({ w, c })));
    const draw = (q = '') => {
      q = q.toUpperCase().replace(/[^A-Z?]/g, '');
      const match = (w) => !q || w.includes(q);
      let html = '';
      if (byLetter) {
        const groups = {};
        for (const { w, c } of words) {
          if (!match(w)) continue;
          (groups[w[0]] = groups[w[0]] || []).push({ w, c });
        }
        html = Object.keys(groups).sort().map((L) => `<div class="letterrow"><div class="L">${L}</div><div class="ws">${
          groups[L].sort((a, b) => (a.w < b.w ? -1 : 1)).map(({ w, c }) =>
            `<button class="wbtn" data-w="${w}"><i class="dot" style="background:${STATUS_COLOR[status(c)]}"></i><span class="word">${w}</span></button>`
          ).join('')}</div></div>`).join('');
      } else {
        html = s.cards.filter((c) => c.w.some(match)).map((c, n) => `<div class="letterrow"><div class="L small muted" style="font-size:12px;width:28px">${s.cards.indexOf(c) + 1}</div><div>
          <div class="rack" style="justify-content:flex-start;margin:0 0 4px">${tiles(c.a, 'xs')}</div>
          <div class="ws">${c.w.map((w) => `<button class="wbtn" data-w="${w}"><i class="dot" style="background:${STATUS_COLOR[status(c)]}"></i><span class="word">${w}</span></button>`).join('')}</div></div></div>`).join('');
      }
      $('#list').innerHTML = html || '<p class="muted">No matches.</p>';
    };
    draw();
    $('#q').oninput = (e) => draw(e.target.value);
    $('#list').onclick = (e) => { const b = e.target.closest('[data-w]'); if (b) wordSheet(b.dataset.w); };
  };

  function wordSheet(w) {
    const c = index.word.get(w);
    const r = c && rec(c);
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet">
      <div class="rack big" style="margin-bottom:10px">${tiles(w)}</div>
      <ul class="words">${(c ? c.w : [w]).map((x) => wordItem(x)).join('')}</ul>
      <p class="small muted">${c ? `${c.set.name} · ${r ? (r.s === 'review' ? `next review in ${describeDue(r)}` : 'learning') : 'not started yet'}${r && r.lapses ? ` · forgotten ${r.lapses}×` : ''}` : ''}</p>
      <p class="small muted">Hooks: lower-case letters in front of/after the word make longer valid words.</p>
      <button class="btn block" id="closeSheet">Close</button></div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.onclick = (e) => { if (e.target === bg || e.target.id === 'closeSheet') close(); };
  }

  // ---------- GUIDE ----------
  routes.guide = () => {
    app().innerHTML = `${bar('How it works')}
      <div class="card guide">
        <h3>Your priority order</h3>
        <p>New cards come in this order: 2s → 3s → JQXZ 4s → three-vowel 4s → Q without U → top 100 7s → top 100 8s. Inside each set, the racks you're most likely to draw come first. You can jump the queue from any set's page.</p>
        <h3>Memory techniques built in</h3>
        <ul>
          <li><b>Spaced repetition.</b> Each rack comes back just before you'd forget it: 1 min, 10 min, 1 day, then gaps that keep growing (about 2.5× each time you get it right). Get it wrong and the gap resets. This is the best-proven way to remember things for the long term.</li>
          <li><b>Active recall.</b> You're never just shown a word to re-read. You see the tiles and have to come up with the words yourself. Pulling an answer out of memory is what makes it stick.</li>
          <li><b>Learn racks, not words.</b> Words are grouped by their letters (an "alphagram"). That's how they show up on your rack, so you learn every anagram together (e.g. AEINRST).</li>
          <li><b>Phony drills.</b> In a real game you also need to tell a valid word from a fake one, fast. The drill mixes real words with near-miss phonies. Real words you miss are pulled forward for review.</li>
          <li><b>Meaning & hooks.</b> Every word shows its definition and hooks. A meaning, even an odd one, gives your memory something to hold on to, and hooks are how 2s and 3s turn into plays.</li>
          <li><b>Little and often.</b> A daily cap on new cards (${settings.newPerDay}/day, change it in Settings) stops your reviews piling up. 10–15 minutes a day beats an hour once a week.</li>
        </ul>
        <h3>Grading</h3>
        <p>When you find every word, pick <b>Hard</b>, <b>Good</b> or <b>Easy</b>. The app suggests one based on your speed and any phony guesses. Miss a word or show the answers and the card goes back to the start for today.</p>
        <h3>Tips</h3>
        <ul>
          <li>Read a set through once in <b>Word lists</b> before you start it.</li>
          <li>Once the 2s feel easy, turn off "Show number of answers" in Settings. In a real game nobody tells you how many words there are.</li>
          <li>Install it: on iPhone, tap Share → <i>Add to Home Screen</i>. On Android, open the menu → <i>Install app</i>.</li>
          <li>Your progress is saved on this phone. Use Settings → Export now and then to keep a backup.</li>
        </ul>
      </div>`;
  };

  // ---------- SETTINGS ----------
  routes.settings = () => {
    app().innerHTML = `${bar('Settings')}
      <div class="card">
        <div class="field"><label>Dictionary
          <select id="dict" style="width:auto;margin:0">${Object.entries(DICTS).map(([k, v]) => `<option value="${k}" ${k === settings.dict ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <p class="muted">Collins for UK & international play, NWL for North America. Each one keeps its own progress.</p></div>
        <div class="field"><label>New racks per day <span id="npdv">${settings.newPerDay}</span></label>
          <input type="range" id="npd" min="5" max="60" step="5" value="${settings.newPerDay}">
          <p class="muted">15 is a sustainable pace. Each new rack adds a few reviews a day for a while.</p></div>
        <div class="field"><label>Show number of answers <input type="checkbox" class="switch" id="sc" ${settings.showCount ? 'checked' : ''}></label>
          <p class="muted">Turn off for game-like difficulty: you decide when you've found them all.</p></div>
        <div class="field"><label>Phony drill length <span id="dlv">${settings.drillLen}</span></label>
          <input type="range" id="dl" min="10" max="100" step="5" value="${settings.drillLen}"></div>
        <div class="field"><label>New cards come from
          <select id="focus" style="width:auto;margin:0"><option value="auto">Priority order</option>${data.sets.map((s) => `<option value="${s.id}" ${settings.focus === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label></div>
      </div>
      <div class="card">
        <h3>Backup</h3>
        <p class="small muted">Progress lives on this device. Export a file now and then, and import it on a new phone.</p>
        <div class="row" style="margin-top:10px"><button class="btn" id="exp">Export</button><button class="btn" id="imp">Import</button></div>
        <input type="file" id="file" accept="application/json,.json" hidden>
      </div>
      <button class="btn ghost block" id="reset" style="color:var(--bad)">Reset progress for ${DICTS[settings.dict]}</button>
      <p class="small muted" style="text-align:center">Word data: ${esc(data.label)} · built ${data.built}</p>`;

    $('#dict').onchange = async (e) => {
      saveProgress(true);
      settings.dict = e.target.value;
      settings.focus = 'auto';
      saveSettings();
      app().innerHTML = '<div class="loading">Loading…</div>';
      await loadData();
      toast(`Switched to ${DICTS[settings.dict]}`);
      routes.settings();
    };
    $('#npd').oninput = (e) => { settings.newPerDay = +e.target.value; $('#npdv').textContent = e.target.value; saveSettings(); };
    $('#dl').oninput = (e) => { settings.drillLen = +e.target.value; $('#dlv').textContent = e.target.value; saveSettings(); };
    $('#sc').onchange = (e) => { settings.showCount = e.target.checked; saveSettings(); };
    $('#focus').onchange = (e) => { settings.focus = e.target.value; saveSettings(); };
    $('#exp').onclick = () => {
      saveProgress(true);
      const dump = { app: 'scrabble-trainer', v: 1, exported: new Date().toISOString(), settings, progress: {} };
      for (const k of Object.keys(DICTS)) dump.progress[k] = store.get(`progress_${k}`, null);
      const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `word-trainer-backup-${dayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
    $('#imp').onclick = () => $('#file').click();
    $('#file').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const dump = JSON.parse(await f.text());
        if (dump.app !== 'scrabble-trainer' || !dump.progress) throw new Error('bad');
        if (!confirm('Replace the progress on this device with this backup?')) return;
        for (const [k, v] of Object.entries(dump.progress)) if (v && DICTS[k]) store.set(`progress_${k}`, v);
        if (dump.settings) { Object.assign(settings, dump.settings); saveSettings(); }
        await loadData();
        toast('Backup restored');
        go('home');
      } catch { toast('That file is not a Word Trainer backup'); }
    };
    $('#reset').onclick = () => {
      if (!confirm(`Delete all ${DICTS[settings.dict]} progress? This can't be undone.`)) return;
      prog = { cards: {}, days: {} };
      saveProgress(true);
      toast('Progress reset');
      go('home');
    };
  };

  // ---------- boot ----------
  async function boot() {
    try {
      await loadData();
      render();
    } catch (e) {
      app().innerHTML = `<div class="card" style="margin-top:30vh;text-align:center"><p>Couldn't load the word lists.</p><p class="small muted">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Try again</button></div>`;
    }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  boot();
})();
