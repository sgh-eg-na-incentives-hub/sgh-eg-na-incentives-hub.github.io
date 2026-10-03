/* Compensation & Incentives Hub (Doctors & Admin Performance) — live view over a folder of monthly Excel workbooks. */
(() => {
  'use strict';

  const CURRENCY = 'EGP';
  // Static build (GitHub Pages): no server, data comes from an encrypted snapshot file.
  const STATIC = !!window.DASH_STATIC;
  // Years always shown on the timeline (plus any other year found in the data).
  const TIMELINE_YEARS = [2025, 2026, 2027];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  // Allied departments / BD sections are always listed in the menu, even before their data arrives.
  const ALLIED = ['Anesthesia', 'Emergency Room', 'Intensive Care Unit', 'Laboratory', 'Radiation Oncology',
    'Medical Imaging', 'Physiotherapy', 'Pharmacy', 'Home care'];
  const BD_SECTIONS = ['Corporate Sales', 'External Doctors', 'IVP Visiting Professors'];
  // Staff categories (mirrors server/sheetUtil.js). group = where they sit in the menu;
  // incentiveOnly = incentive programmes (analysed by share of the total paid);
  // census = workload data (visits, admissions, operations), never mixed with money.
  // measure = what a programme's "revenue" column really is (sales, collection): shown on its own
  // page against its target, never added to the hospital's revenue. cases = monthly case count.
  // team = one row per month for the whole team (no per-person charts).
  const CATS = [
    { key: 'opd', label: "OPD Dr's (Med 01)", short: 'OPD doctors', unit: 'specialty', color: '--s1', group: 'medical', who: 'doctors' },
    { key: 'residents', label: 'Residents / Registrars (Med 02)', short: 'Residents', unit: 'specialty', color: '--s3', group: 'medical', who: 'residents' },
    { key: 'allied', label: 'Allied / Closed Departments', short: 'Allied / closed', unit: 'department', color: '--s2', group: 'medical', who: 'staff', fixed: ALLIED },
    { key: 'bd', label: 'Business Development', short: 'Business Development', unit: 'section', color: '--s4', group: 'separate', who: 'staff', fixed: BD_SECTIONS, incentiveOnly: true, measure: 'Sales' },
    { key: 'admission', label: 'Admission & Discharge Incentives', short: 'Admission & Discharge', unit: 'department', color: '--s4', group: 'separate', who: 'staff', incentiveOnly: true, cases: true },
    { key: 'patientrel', label: 'Patient Relation Incentives', short: 'Patient Relation', unit: 'department', color: '--s4', group: 'separate', who: 'staff', incentiveOnly: true, cases: true },
    { key: 'legal', label: 'Legal Affairs (0500) Incentives', short: 'Legal Affairs', unit: 'department', color: '--s4', group: 'separate', who: 'staff', incentiveOnly: true },
    { key: 'collection', label: 'CAM Collection Incentives', short: 'CAM Collection', unit: 'team', color: '--s4', group: 'separate', who: 'team', incentiveOnly: true, measure: 'Collection', team: true },
    // basis: its salaries are the base of the quarterly %, and its rows are unnamed staff lines.
    { key: 'quarterly', label: 'Quarterly Incentive', short: 'Quarterly incentive', unit: 'department', color: '--s5', group: 'quarterly', who: 'departments', incentiveOnly: true, quarterly: true, basis: true, perDept: true },
    // other: any other incentive, paid to a person, a department or a group of employees.
    { key: 'other', label: 'Other Incentives', short: 'Other incentives', unit: 'department', color: '--s7', group: 'other', who: 'staff', incentiveOnly: true, other: true },
    { key: 'census', label: "Dr's (Census - Operation)", short: 'Census', unit: 'specialty', color: '--s6', group: 'census', who: 'doctors', census: true },
  ];
  const catOf = (k) => CATS.find((c) => c.key === k);
  const isCensusCat = (k) => !!catOf(k)?.census;
  /** The census files carry operations counts (else every operations figure would be a meaningless 0). */
  const hasOperations = () => state.rows.some((r) => isCensusCat(r.category) && r.operations > 0);
  /** Name of the "revenue" figure on the current page (Revenue, Sales, Collection). */
  const revLabel = () => catOf(state.cat)?.measure || 'Revenue';
  /** Revenue & target of a row as the current page counts them. */
  function setMeasure(o, show) {
    o.revenue = show ? o._revenue : 0;
    o.target = show ? o._target : null;
    o.revPerSalary = safeDiv(o.revenue, o.salary);
    o.revPerCost = safeDiv(o.revenue, o.cost);
    o.achievement = safeDiv(o.revenue, o.target);
  }
  /**
   * BD sales and CAM collection are what those programmes are measured on, not hospital revenue:
   * they count on their own page only (the overview and the other pages see 0).
   */
  function showMeasures() {
    for (const o of state.rows) {
      const c = catOf(o.category);
      if (c?.measure) setMeasure(o, state.cat === o.category);
      // Quarterly lines outside their page: only the incentive counts (not a salary, not a person).
      o._basis = !!c?.basis && state.cat !== o.category;
    }
  }
  /** Other Incentives by reason, largest first: [[reason, amount], …]. */
  function reasonsOf(rows) {
    const m = new Map();
    for (const r of rows) if (r.reason) m.set(r.reason, (m.get(r.reason) || 0) + r.incentives);
    return [...m].sort((a, b) => b[1] - a[1]);
  }
  const deptCount = (rows) => new Set(rows.map((r) => r.specialty)).size;
  /** Targets held by the departments' own lines (closed departments), not by people. */
  const deptTargets = (rows) => { const t = rows.filter((r) => r.target); return t.length > 0 && t.every((r) => r.level); };
  /**
   * Months where a department has its staff lines but not its own figures (revenue, target), while
   * it has them in other months — e.g. a month file without the numbers above the table.
   */
  function monthsMissingFigures(rows) {
    const withFigs = new Set(rows.filter((r) => r.level && (r.revenue || r.target)).map((r) => r.specialty));
    const out = new Map();
    for (const r of rows) {
      if (r.level || !withFigs.has(r.specialty)) continue;
      if (rows.some((x) => x.level && x.specialty === r.specialty && x.period === r.period && (x.revenue || x.target))) continue;
      (out.get(r.period) || out.set(r.period, new Set()).get(r.period)).add(r.specialty);
    }
    return [...out].sort(([a], [b]) => a.localeCompare(b));
  }
  const missingNote = (rows) => { const m = monthsMissingFigures(rows); return m.length ? ` · no department figures (revenue, target) in the files for ${m.map(([p, d]) => `${periodLabel(p)} (${d.size === 1 ? [...d][0] : `${d.size} departments`})`).join(', ')}` : ''; };
  const plural = (n, one, many) => `${nfFull.format(n)} ${n === 1 ? one : many}`;
  /** Cases handled (a monthly figure repeated on every row of the month): counted once per month. */
  function casesOf(rows) {
    const m = new Map();
    for (const r of rows) if (r.cases != null) m.set(`${r.branch}|${r.category}|${r.period}`, Math.max(m.get(`${r.branch}|${r.category}|${r.period}`) || 0, r.cases));
    return m.size ? [...m.values()].reduce((s, v) => s + v, 0) : null;
  }
  const BRANCHES = ['SGH-Cairo', 'SGH-Alex'];
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  // ---------------- state ----------------
  const state = {
    rows: [],
    periods: [],          // months that have data, sorted ('2026-07', ...)
    months: new Set(),    // selected months (empty = all)
    lastClicked: null,
    branch: 'all',        // 'all' | 'SGH-Cairo' | 'SGH-Alex'
    cat: null,            // staff category page ('opd' | 'residents' | 'allied'), null = hospital overview
    dept: null,           // specialty / department page inside the category
    version: 0,
    status: {},
    fileName: '',
    builtAt: null,
    filters: { specialties: new Set(), positions: new Set(), search: '' },
    recSort: { key: 'revenue', dir: -1 },
    specSort: { key: 'revenue', dir: -1 },
    page: 1,
    pageSize: 25,
    topMetric: 'revenue',
    lowMetric: 'revenue',
    bwMetric: 'contribution',
    censusMetric: 'visits',
    triMode: ['month', 'specialty', 'doctor'].includes(store.get('triMode', 'month')) ? store.get('triMode', 'month') : 'month',
    riMode: 'specialty',
    tgMode: 'specialty',
    specOpen: store.get('specOpen', false),
    recOpen: store.get('recOpen', false),
    firstLoad: true,
  };

  // ---------------- formatting ----------------
  const nfFull = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
  const nfCompact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const money = (v) => nfFull.format(v || 0);
  const compact = (v) => (v === null || Number.isNaN(v) ? '—' : nfCompact.format(v || 0));
  const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
  const times = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}×`);
  // Achievement: whole percent, but one decimal just around 100% so 99.6% never reads as "100%".
  const achFmt = (v) => (v == null || !Number.isFinite(v) ? '—' : v >= 0.99 && v < 1.01 ? `${(v * 100).toFixed(1)}%` : `${Math.round(v * 100)}%`);
  const periodLabel = (p) => {
    if (!p || p === 'unknown') return 'Unknown';
    const [y, m] = p.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeDiv = (a, b) => (b ? a / b : null);
  const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const pad2 = (n) => String(n).padStart(2, '0');

  // ---------------- API ----------------
  function adminKey() { try { return sessionStorage.getItem('adminKey') || ''; } catch { return ''; } }
  async function api(method, url, body, extraHeaders = {}) {
    const raw = body instanceof Blob || body instanceof ArrayBuffer;
    const res = await fetch(url, {
      method,
      headers: { ...(raw ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' }), 'x-admin-key': adminKey(), ...extraHeaders },
      body: body == null ? undefined : raw ? body : JSON.stringify(body),
    });
    if (res.status === 401) {
      const ok = await askPassword();
      if (ok) return api(method, url, body, extraHeaders);
      throw new Error('Admin password required.');
    }
    return res.json();
  }

  // ---------------- static snapshot (encrypted) ----------------
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let staticRaw = null; // last data.enc opened (a refresh re-opens it only when it changed)

  async function deriveKey(password, env) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.trim()), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64(env.salt), iterations: env.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
  }
  async function decryptSnapshot(env, key) {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.data));
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  /**
   * Open data.enc with a password or a personal access code -> { data, who }. Version 2 locks the
   * data key once per code; the slot that opens says who this is (name, role, visit log).
   */
  async function openEnvelope(env, password) {
    const key = await deriveKey(password, env);
    if (env.v !== 2) return { data: await decryptSnapshot(env, key), who: { name: null, role: 'viewer', act: null } };
    for (const slot of env.keys) {
      let payload;
      try { payload = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(slot.iv) }, key, b64(slot.data)))); } catch { continue; }
      const dataKey = await crypto.subtle.importKey('raw', b64(payload.k), 'AES-GCM', false, ['decrypt']);
      return { data: await decryptSnapshot(env, dataKey), who: { name: payload.name, role: payload.role || 'viewer', act: payload.act || null } };
    }
    throw new Error('Wrong password');
  }
  const savedName = () => { try { return localStorage.getItem('viewerName') || ''; } catch { return ''; } };
  function unlock(env) {
    return new Promise((resolve) => {
      const screen = $('#lockScreen');
      screen.classList.remove('hidden');
      const input = $('#lockPw');
      const nameIn = $('#lockName');
      setTimeout(() => input.focus(), 50);
      let opened = null;
      const finish = () => { screen.classList.add('hidden'); resolve(opened); };
      $('#lockForm').onsubmit = async (e) => {
        e.preventDefault();
        $('#lockErr').textContent = '';
        if (opened) {
          // Second step (shared password): who is viewing.
          const name = nameIn.value.replace(/\s+/g, ' ').trim();
          if (name.length < 2) { $('#lockErr').textContent = 'Please type your name.'; nameIn.focus(); return; }
          try { localStorage.setItem('viewerName', name); } catch { /* storage unavailable */ }
          opened.who.name = name;
          opened.who.typedName = true;
          finish();
          return;
        }
        $('#lockBtn').disabled = true;
        try {
          opened = await openEnvelope(env, input.value);
          try { sessionStorage.setItem('viewPw', input.value.trim()); } catch { /* storage unavailable */ }
          if (opened.who.name || !opened.who.act) { finish(); return; }
          // Shared password with the visit log on: ask once for a name (remembered on this device).
          const known = savedName();
          if (known) { opened.who.name = known; opened.who.typedName = true; finish(); return; }
          input.classList.add('hidden');
          nameIn.classList.remove('hidden');
          $('#lockLead').textContent = 'Please type your name so the dashboard owner knows who is viewing.';
          $('#lockBtn').textContent = 'Continue';
          setTimeout(() => nameIn.focus(), 50);
        } catch {
          opened = null;
          $('#lockErr').textContent = 'Wrong access code or password.';
          input.select();
        } finally {
          $('#lockBtn').disabled = false;
        }
      };
    });
  }
  async function loadStatic() {
    const res = await fetch(`data.enc?t=${Date.now()}`, { cache: 'no-store' });
    const text = await res.text();
    if (staticRaw && text === staticRaw) return null; // unchanged
    const env = JSON.parse(text);
    let opened = null;
    let saved = '';
    try { saved = sessionStorage.getItem('viewPw') || ''; } catch { /* storage unavailable */ }
    if (saved) {
      try {
        opened = await openEnvelope(env, saved);
        if (!opened.who.name && opened.who.act) {
          if (savedName()) { opened.who.name = savedName(); opened.who.typedName = true; } else opened = null;
        }
      } catch { opened = null; }
    }
    if (!opened) opened = await unlock(env);
    staticRaw = text;
    Viewers.signedIn(opened.who);
    return opened.data;
  }

  // ---------------- viewers: visit heartbeat (online copy) and who's online (admin) ----------------
  const Viewers = (() => {
    // A heartbeat every 4 minutes (the free relay allows ~250 messages a day per network), so
    // "online" = a heartbeat in the last 9 minutes, and session lengths are ± a few minutes.
    const BEAT_MS = 4 * 60000;
    const ONLINE_MS = 9 * 60000;
    const NEW_SESSION_MS = 30 * 60000; // away longer than this -> the next visit is a new session
    let who = null;                    // online copy: who logged in { name, role, act }
    let current = null;
    let lastBeat = 0;
    let data = null;                   // last visit log read
    let offset = 0;                    // sheet clock - this clock
    let tab = 'activity';
    let pollTimer = null;
    if (STATIC) document.body.classList.add('is-static');
    const isAdmin = () => !STATIC || who?.role === 'admin';

    function device() {
      const ua = navigator.userAgent;
      const os = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Other';
      const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
      return `${os} · ${br}`;
    }
    /** One id per visit (per tab); a new one after 30 minutes away. */
    function sessionId() {
      const now = Date.now();
      if (!current) {
        try { current = sessionStorage.getItem('actSid'); lastBeat = Number(sessionStorage.getItem('actLast')) || 0; } catch { /* storage unavailable */ }
      }
      if (!current || now - lastBeat > NEW_SESSION_MS) {
        current = crypto.randomUUID ? crypto.randomUUID() : `${now.toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
      }
      lastBeat = now;
      try { sessionStorage.setItem('actSid', current); sessionStorage.setItem('actLast', String(now)); } catch { /* storage unavailable */ }
      return current;
    }
    // in chunks: a whole uploaded workbook is too many arguments for one fromCharCode call
    const toB64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
    /** Encrypt to a public key (ECDH P-256 + AES-GCM): heartbeats to the admin's, uploads to the upload worker's. */
    async function seal(obj, pubB64 = who.act.pub) {
      const pub = await crypto.subtle.importKey('raw', b64(pubB64), ECDH, false, []);
      const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
      return JSON.stringify({ e: toB64(await crypto.subtle.exportKey('raw', eph.publicKey)), i: toB64(iv), c: toB64(c) });
    }
    const beatBody = () => seal({ sid: sessionId(), name: who.name || 'Unknown', role: who.typedName ? 'shared password' : who.role, device: device(), page: $('#periodLabel')?.textContent || '' });
    let ready = null; // a sealed heartbeat kept ready, so leaving the page can send it at once
    async function beat() {
      if (!who?.act?.relay) return;
      try {
        const body = await beatBody();
        fetch(who.act.relay, { method: 'POST', mode: 'no-cors', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => { /* offline */ });
        ready = await beatBody();
      } catch { /* old browser */ }
    }
    function leaving() {
      if (ready && navigator.sendBeacon) navigator.sendBeacon(who.act.relay, new Blob([ready], { type: 'text/plain' }));
      ready = null;
    }
    function startTracking() {
      setTimeout(() => beat(), 3000); // once the page is drawn, so the log says what they opened
      setInterval(() => { if (document.visibilityState === 'visible') beat(); }, BEAT_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') leaving();
        else if (Date.now() - lastBeat > 60000) beat(); // back after a while (maybe a new session)
      });
      window.addEventListener('pagehide', leaving);
      // What they are looking at: sent a little after they open another page (at most once a minute).
      let t;
      window.addEventListener('hashchange', () => { clearTimeout(t); t = setTimeout(() => { if (Date.now() - lastBeat > 60000) beat(); }, 2500); });
    }

    /** Online copy: called once the code / password opened the data. */
    function signedIn(w) {
      const first = !who;
      who = w;
      if (!first) return;
      if (w.act?.upload) watchUploads();
      if (w.role !== 'admin' && w.act?.relay) startTracking();
      if (isAdmin() && w.act?.admin) startAdmin();
    }

    // ---- admin ----
    const fmtDur = (ms) => {
      const m = Math.round(ms / 60000);
      if (m < 1) return 'under a minute';
      if (m < 60) return `${m} min`;
      return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
    };
    const ago = (ms) => {
      const m = Math.round(ms / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m} min ago`;
      const h = Math.round(m / 60);
      if (h < 24) return `${h} h ago`;
      const d = Math.round(h / 24);
      return `${d} day${d === 1 ? '' : 's'} ago`;
    };
    const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const now = () => Date.now() + offset;

    /** Online copy with an admin code: the history saved at the last publish + the relay's last 12 hours, decrypted here. */
    async function fetchActivity() {
      if (!STATIC) return api('GET', '/api/activity');
      const sessions = {};
      for (const s of who.act.admin.hist || []) sessions[s.sid] = { ...s };
      const priv = await crypto.subtle.importKey('jwk', who.act.admin.priv, ECDH, false, ['deriveKey']);
      const text = await (await fetch(`${who.act.relay}/json?poll=1&since=12h`)).text();
      for (const line of text.split('\n')) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.event !== 'message') continue;
        try {
          const m = JSON.parse(msg.message);
          const epk = await crypto.subtle.importKey('raw', b64(m.e), ECDH, false, []);
          const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: epk }, priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
          const b = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(m.i) }, key, b64(m.c))));
          const t = new Date(msg.time * 1000).toISOString();
          const s = sessions[b.sid];
          if (!s) sessions[b.sid] = { sid: b.sid, name: b.name, role: b.role, device: b.device, page: b.page, started: t, lastSeen: t };
          else {
            if (t < s.started) s.started = t;
            if (t >= s.lastSeen) { s.lastSeen = t; s.page = b.page || s.page; }
          }
        } catch { /* not a heartbeat of ours */ }
      }
      return { configured: true, ok: true, visits: Object.values(sessions) };
    }
    /** One line per person: online now?, last seen, last session, visits and time in 30 days. */
    function people(visits) {
      const by = new Map();
      for (const v of visits) {
        const k = String(v.name || 'Unknown').trim().toLowerCase();
        if (!by.has(k)) by.set(k, []);
        by.get(k).push({ ...v, s: Date.parse(v.started), e: Date.parse(v.lastSeen) });
      }
      const month = now() - 30 * 86400000;
      return [...by.values()].map((list) => {
        list.sort((a, b) => b.e - a.e);
        const last = list[0];
        const recent = list.filter((v) => v.e >= month);
        return {
          name: last.name || 'Unknown', role: last.role, device: last.device, page: last.page,
          online: now() - last.e < ONLINE_MS, last,
          visits30: recent.length, time30: recent.reduce((s, v) => s + (v.e - v.s), 0),
        };
      }).sort((a, b) => b.online - a.online || b.last.e - a.last.e);
    }
    async function refresh() {
      try {
        data = await fetchActivity();
        if (data?.errors) data = { configured: true, ok: false, error: data.errors.join(' ') }; // e.g. not the admin's computer
        if (data?.now) offset = Date.parse(data.now) - Date.now();
      } catch (err) {
        data = { configured: true, ok: false, error: err.message };
      }
      const online = data?.ok ? people(data.visits).filter((p) => p.online) : [];
      const btn = $('#viewersBtn');
      btn.classList.toggle('has-online', online.length > 0);
      $('#viewersText').textContent = !data?.configured ? 'Viewers' : online.length ? `${online.length} online` : 'Viewers';
      btn.title = online.length ? `Online now: ${online.map((p) => p.name).join(', ')}` : 'Who is viewing the online dashboard';
      if ($('#viewersDialog').open && tab === 'activity') renderActivity();
    }
    function startAdmin() {
      $('#viewersBtn').classList.remove('hidden');
      refresh();
      clearInterval(pollTimer);
      pollTimer = setInterval(() => refresh(), 60000);
    }

    function renderActivity() {
      const body = $('#vwBody');
      if (!data) { body.innerHTML = '<div class="vw-empty">Loading…</div>'; return; }
      if (!data.ok) { body.innerHTML = `<div class="vw-empty">Could not read the visit log: ${esc(data.error || 'unknown error')}</div>`; return; }
      const list = people(data.visits);
      const online = list.filter((p) => p.online);
      const rows = list.map((p) => `<tr>
          <td class="name">${esc(p.name)}${p.role === 'shared password' ? ' <span class="tag" title="Logged in with the shared password and typed this name">shared</span>' : ''}</td>
          <td>${p.online ? '<span class="vw-status on"><i></i>Online now</span>' : `<span class="vw-status"><i></i>${ago(now() - p.last.e)}</span>`}</td>
          <td title="${esc(new Date(p.last.e).toString())}">${p.online ? `since ${when(p.last.started)}` : when(p.last.lastSeen)}</td>
          <td>${fmtDur(p.last.e - p.last.s)}${p.online ? ' <span class="muted">(so far)</span>' : ''}</td>
          <td class="num">${p.visits30}</td>
          <td class="num">${fmtDur(p.time30)}</td>
          <td>${esc(p.device || '')}</td>
          <td class="muted">${esc(p.page || '')}</td></tr>`).join('');
      const recent = [...data.visits].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen)).slice(0, 25).map((v) => `<tr>
          <td class="name">${esc(v.name)}</td><td>${when(v.started)}</td><td>${fmtDur(Date.parse(v.lastSeen) - Date.parse(v.started))}</td>
          <td>${esc(v.device || '')}</td><td class="muted">${esc(v.page || '')}</td></tr>`).join('');
      body.innerHTML = `
        <p class="vw-note"><b>${online.length ? `${online.length} online now: ${online.map((p) => esc(p.name)).join(', ')}` : 'Nobody is online right now.'}</b>
          · ${((n) => `${n} ${n === 1 ? 'person' : 'people'}`)(list.filter((p) => p.last.e >= now() - 30 * 86400000).length)} in the last 30 days
          · an open dashboard checks in every 4 minutes, so times are ± a few minutes</p>
        ${data.warning ? `<p class="vw-note">${esc(data.warning)}</p>` : ''}
        ${list.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Name</th><th>Status</th><th>Last on the site</th><th>Last session</th><th class="num">Visits (30 d)</th><th class="num">Time (30 d)</th><th>Device</th><th>Was looking at</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        <h3>Latest visits</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Started</th><th>Length</th><th>Device</th><th>Page</th></tr></thead><tbody>${recent}</tbody></table></div>`
    : '<div class="vw-empty">No visits yet. They appear here as soon as someone opens the online dashboard.</div>'}`;
    }

    async function renderCodes() {
      const body = $('#vwBody');
      const res = await api('GET', '/api/viewers');
      if (!res.ok) { body.innerHTML = `<div class="vw-empty">${esc((res.errors || []).join(' '))}</div>`; return; }
      const site = res.siteUrl || '';
      const rows = res.people.map((p) => `<tr data-id="${esc(p.id)}">
          <td class="name">${esc(p.name)}</td><td>${p.role === 'admin' ? 'Admin' : 'Viewer'}</td>
          <td><span class="vw-code">${esc(p.code)}</span></td><td>${when(p.added)}</td>
          <td class="row-gap"><button class="btn ghost sm" data-copy>Copy message</button><button class="btn ghost sm" data-reset>New code</button><button class="btn ghost sm danger" data-remove>Remove</button></td></tr>`).join('');
      body.innerHTML = `
        <p class="vw-note">Give each person their own code: the dashboard then knows exactly who is viewing, and you can cancel one person without changing everyone’s password.
          ${res.sharedPassword ? 'The shared password keeps working — people who use it are asked to type their name.' : ''}
          <b>New or changed codes reach the online dashboard after you run publish.bat</b> (about 2 minutes).</p>
        <form class="vw-add" id="vwAdd">
          <input name="name" placeholder="Name (e.g. Dr. Ahmed – Finance)" maxlength="60" required />
          <select name="role"><option value="viewer">Viewer</option><option value="admin">Admin (also sees who’s online)</option></select>
          <button class="btn primary sm">Add person</button>
        </form>
        ${res.people.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Role</th><th>Access code</th><th>Added</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="vw-empty">No personal codes yet.</div>'}`;
      $('#vwAdd').onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const r = await api('POST', '/api/viewers', { name: f.get('name'), role: f.get('role') });
        if (!r.ok) { toast((r.errors || []).join(' '), 'err'); return; }
        toast(`${r.person.name}: code ${r.person.code} — run publish.bat to send it online`);
        renderCodes();
      };
      body.querySelectorAll('tr[data-id]').forEach((tr) => {
        const p = res.people.find((x) => x.id === tr.dataset.id);
        tr.querySelector('[data-copy]').onclick = async () => {
          const msg = `Compensation & Incentives Hub\n${site}\nYour personal access code: ${p.code}\n(please don’t share it)`;
          try { await navigator.clipboard.writeText(msg); toast('Copied — paste it in WhatsApp or email'); } catch { prompt('Copy this message:', msg); }
        };
        tr.querySelector('[data-reset]').onclick = async () => {
          if (!confirm(`Give ${p.name} a new code? The old one stops working after the next publish.`)) return;
          await api('PATCH', `/api/viewers/${p.id}`, { resetCode: true });
          renderCodes();
        };
        tr.querySelector('[data-remove]').onclick = async () => {
          if (!confirm(`Remove ${p.name}? Their code stops working after the next publish.`)) return;
          await api('DELETE', `/api/viewers/${p.id}`);
          renderCodes();
        };
      });
    }

    function show(t) {
      tab = t;
      $$('#vwTabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === tab));
      if (tab === 'codes') renderCodes();
      else { renderActivity(); refresh(); }
    }
    $('#vwTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) show(b.dataset.v); });
    $('#vwBody').addEventListener('click', (e) => { const b = e.target.closest('[data-vw-tab]'); if (b) show(b.dataset.vwTab); });
    $('#viewersBtn').addEventListener('click', () => {
      $('#viewersDialog').showModal();
      show('activity');
      clearInterval(pollTimer);
      pollTimer = setInterval(() => refresh(), 20000); // faster while the window is open
    });
    $('#viewersDialog').addEventListener('close', () => { clearInterval(pollTimer); pollTimer = setInterval(() => refresh(), 60000); });
    // The admin's own computer (local dashboard): always the admin.
    if (!STATIC) startAdmin();
    // ---- uploads from the online copy (anyone signed in): encrypted to the upload worker ----
    const canUpload = () => !!(STATIC && who?.act?.upload);
    /** Send one workbook: { branch, category, unit, file } -> the reference its status will carry. */
    async function sendUpload({ branch, category, unit, file }) {
      const u = who.act.upload;
      const ref = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      const body = await seal({ v: 1, ref, branch, category, unit, name: file.name, by: who.name || 'Unknown', data: toB64(await file.arrayBuffer()) }, u.pub);
      const res = await fetch(u.relay, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
      if (!res.ok) throw new Error(`The upload service answered ${res.status} — try again in a minute.`);
      const pending = store.get('pendingUploads', []);
      pending.push({ ref, name: file.name, unit, at: Date.now() });
      store.set('pendingUploads', pending.filter((p) => Date.now() - p.at < 3 * 3600000));
      watchUploads();
      return ref;
    }
    /** Until they are filed: the worker posts { ref, ok, note } to the status channel; tell the person. */
    let watchTimer = null;
    function watchUploads() {
      if (watchTimer || !who?.act?.upload?.status) return;
      const check = async () => {
        const pending = store.get('pendingUploads', []).filter((p) => Date.now() - p.at < 3 * 3600000);
        if (!pending.length) { clearInterval(watchTimer); watchTimer = null; return; }
        let text = '';
        try { text = await (await fetch(`${who.act.upload.status}/json?poll=1&since=3h`)).text(); } catch { return; }
        const done = new Map();
        for (const line of text.split('\n')) { try { const m = JSON.parse(line); const st = JSON.parse(m.message); if (st.ref) done.set(st.ref, st); } catch { /* not a status */ } }
        const left = [];
        for (const p of pending) {
          const st = done.get(p.ref);
          if (!st) { left.push(p); continue; }
          if (st.ok) { toast(`${p.name}: received for ${p.unit} ✓ — the dashboard shows it in about 2 minutes.`, '', 9000); fastRefresh(); } else toast(`${p.name} was not accepted: ${st.note}`, 'err', 12000);
        }
        store.set('pendingUploads', left);
      };
      check();
      watchTimer = setInterval(check, 30000);
    }
    return { signedIn, canUpload, sendUpload, watchUploads, isAdmin };
  })();

  async function loadData() {
    const main = $('#main');
    if (!state.firstLoad) main.classList.add('refreshing');
    try {
      let data;
      if (STATIC) {
        data = await loadStatic();
        if (!data) { main.classList.remove('refreshing'); return; }
        state.builtAt = data.builtAt;
      } else {
        const res = await fetch('/api/data', { cache: 'no-store' });
        data = await res.json();
      }
      const f = data.fields;
      state.rows = data.rows.map((arr) => {
        const o = {};
        for (let i = 0; i < f.length; i++) o[f[i]] = arr[i];
        o.salary = o.salary || 0;
        o.incentives = o.incentives || 0;
        o.branch = o.branch || 'SGH-Cairo';
        o.category = o.category || 'opd';
        o.cost = o.salary + o.incentives;
        // Kept aside: a programme's sales / collection only count on its own page (see showMeasures).
        o._revenue = o.revenue || 0;
        o._target = o.target > 0 ? o.target : null;
        setMeasure(o, true);
        o.key = `${o.branch}|${o.category}|${o.period}|${o.id}`;
        o._search = `${o.name} ${o.id}`.toLowerCase();
        // a person's own figures from the template (IVP Visiting Professors: expenses and net profit)
        if (typeof o.metrics === 'string') { try { o.metrics = JSON.parse(o.metrics); } catch { o.metrics = null; } }
        const fig = (k) => (!o.level && o.metrics && Number.isFinite(Number(o.metrics[k])) && o.metrics[k] !== '' ? Number(o.metrics[k]) : null);
        o.expenses = fig('Total Expenses');
        o.netProfit = fig('Net Profit');
        // Other Incentives: what it was paid for
        if (o.category === 'other') o.reason = o.metrics?.['Incentive Reason'] || null;
        return o;
      });
      state.version = data.version;
      state.fileName = data.file.name;
      state.hasTargets = state.rows.some((r) => r.target);
      refreshPeriods(state.firstLoad);
      applyStatus(data.status);
      setupFormLists();
      render();
      const wasFirst = state.firstLoad;
      state.firstLoad = false;
      lastUpdate = new Date();
      main.classList.remove('loading', 'refreshing');
      setLive(true, wasFirst ? null : 'Updated from Excel');
    } catch (err) {
      console.error(err);
      main.classList.remove('refreshing');
      toast('Could not load data.', 'err');
    }
  }

  const inBranch = (r) => state.branch === 'all' || r.branch === state.branch;
  /** Months with data in the selected branch; keeps the month selection valid (default = latest). */
  function refreshPeriods(reset) {
    state.periods = [...new Set(state.rows.filter(inBranch).map((r) => r.period))].filter((p) => /^\d{4}-\d{2}$/.test(p)).sort();
    for (const p of [...state.months]) if (!state.periods.includes(p)) state.months.delete(p);
    if (reset || (!state.months.size && state.hadSelection)) {
      state.months.clear();
      selectLatestFor(state.cat);
    }
  }
  /**
   * Default selection for a page: its latest month — or latest quarter for the quarterly
   * incentive. The overview uses the latest month of the medical staff data (quarterly
   * incentives sit on quarter-end months only, and a programme paid a month ahead — e.g.
   * BD in August — must not open the overview on a month that is almost empty).
   */
  function selectLatestFor(cat) {
    const c = catOf(cat);
    const monthly = state.rows.filter((r) => inBranch(r) && /^\d{4}-\d{2}$/.test(r.period));
    const medical = monthly.filter((r) => catOf(r.category)?.group === 'medical');
    const rows = cat ? monthly.filter((r) => r.category === cat)
      : medical.length ? medical : monthly.filter((r) => !catOf(r.category)?.quarterly && !isCensusCat(r.category));
    const latest = rows.reduce((m, r) => (r.period > m ? r.period : m), '') || state.periods[state.periods.length - 1];
    if (!latest) return;
    if (c?.quarterly) selectQuarter(yearOf(latest), quarterOf(latest));
    else state.months = new Set([latest]);
  }
  /** Opening a page whose data isn't in the selected months jumps to its latest month/quarter. */
  function ensureDataForPage() {
    if (!state.cat) return;
    const has = (r) => inBranch(r) && r.category === state.cat;
    if (!state.rows.some(has)) return;
    if (!state.rows.some((r) => has(r) && inPeriod(r))) { selectLatestFor(state.cat); return; }
    // The quarterly incentive is read by quarter: a single month becomes its whole quarter.
    const sel = selection();
    if (catOf(state.cat)?.quarterly && sel.kind === 'month') selectQuarter(yearOf(sel.month), quarterOf(sel.month));
  }

  // ---------------- branch switcher ----------------
  state.branch = BRANCHES.includes(store.get('branch', 'all')) ? store.get('branch', 'all') : 'all';
  function renderBranchSeg() {
    $$('#branchSeg button[data-v]').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === state.branch);
      if (b.dataset.v !== 'all') b.classList.toggle('muted-btn', !state.rows.some((r) => r.branch === b.dataset.v));
    });
  }
  $('#branchSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || b.dataset.v === state.branch) return;
    state.branch = b.dataset.v;
    store.set('branch', state.branch);
    const hadMonths = state.months.size;
    refreshPeriods(!hadMonths || ![...state.months].every((p) => state.periods.includes(p)));
    onFilterChange();
  });

  // ---------------- live connection (SSE) ----------------
  function connectLive() {
    if (STATIC) {
      // No server to push updates: re-check the published snapshot every 2 minutes.
      setInterval(loadData, 120000);
      return;
    }
    const es = new EventSource('/api/events');
    es.onopen = () => setLive(true);
    es.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      if (evt.type === 'hello') {
        applyStatus(evt);
        if (evt.version !== state.version) loadData();
      } else if (evt.type === 'data') {
        if (evt.version !== state.version) loadData();
      } else if (evt.type === 'status') {
        applyStatus(evt);
      }
    };
    es.onerror = () => setLive(false);
  }

  let lastUpdate = null;
  function setLive(on, flashMsg) {
    const b = $('#liveBadge');
    b.classList.toggle('on', on);
    b.classList.toggle('off', !on);
    const stamp = STATIC && state.builtAt
      ? new Date(state.builtAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';
    $('#liveText').textContent = STATIC ? `Updated · ${stamp}` : on
      ? `Live · ${lastUpdate ? lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}`
      : 'Reconnecting…';
    if (flashMsg) {
      b.classList.add('flash');
      setTimeout(() => b.classList.remove('flash'), 1500);
      toast(STATIC ? 'New data published — dashboard refreshed' : `${flashMsg} — dashboard refreshed`);
    }
  }

  const canUpload = () => (STATIC ? !!window.DASH_UPLOAD : !state.status.readOnly);
  function applyStatus(s) {
    if (!s) return;
    state.status = { ...state.status, ...s };
    document.body.classList.toggle('readonly', !!state.status.readOnly);
    $('#uploadBtn').classList.toggle('hidden', !canUpload());
    const pb = $('#pendingBadge');
    const n = state.status.pending || 0;
    pb.classList.toggle('hidden', !n);
    pb.textContent = `${n} pending${state.status.locked ? ' · close Excel to save' : ''}`;
    pb.title = state.status.locked
      ? 'The workbook is open in Excel. Queued changes will be written automatically once you close it.'
      : 'Queued changes — click to write them now.';
    if (s.lastError) toast(s.lastError, 'err');
  }

  // ---------------- month selection (timeline) ----------------
  const yearOf = (p) => p.slice(0, 4);
  const monthsOfYear = (y) => state.periods.filter((p) => yearOf(p) === String(y));
  const quarterOf = (p) => Math.ceil(Number(p.slice(5, 7)) / 3);
  const monthsOfQuarter = (y, q) => state.periods.filter((p) => yearOf(p) === String(y) && quarterOf(p) === q);
  function inPeriod(r) { return !state.months.size || state.months.has(r.period); }

  /** What the current month selection is: all / one month / a quarter / a whole year / several months. */
  function selection() {
    const sel = [...state.months].sort();
    if (!sel.length) return { kind: 'all', label: `All months (${state.periods.length})` };
    const years = [...new Set(sel.map(yearOf))];
    const quarters = [...new Set(sel.map((p) => `${yearOf(p)}-Q${quarterOf(p)}`))];
    // A quarter: every month with data in one quarter (quarterly incentives sit on its last month).
    if (quarters.length === 1) {
      const [y, q] = [years[0], quarterOf(sel[0])];
      if (monthsOfQuarter(y, q).length === sel.length && (sel.length > 1 || state.cat === 'quarterly')) {
        return { kind: 'quarter', year: y, q, label: `Q${q} ${y}` };
      }
    }
    if (sel.length === 1) return { kind: 'month', month: sel[0], label: periodLabel(sel[0]) };
    if (years.length === 1) {
      const all = monthsOfYear(years[0]);
      if (all.length === sel.length) return { kind: 'year', year: years[0], label: `${years[0]} (${sel.length} months)` };
    }
    return { kind: 'multi', label: `${sel.length} months · ${periodLabel(sel[0])} – ${periodLabel(sel[sel.length - 1])}` };
  }
  /** Select a quarter's months (Ctrl adds to the selection). */
  function selectQuarter(y, q, add = false) {
    const ms = monthsOfQuarter(y, q);
    if (!ms.length) return;
    if (add) ms.forEach((p) => state.months.add(p)); else state.months = new Set(ms);
    state.hadSelection = true;
  }

  function renderTimeline() {
    const years = [...new Set([...TIMELINE_YEARS, ...state.periods.map((p) => Number(yearOf(p)))])].sort();
    const has = new Set(state.periods);
    $('#tlAll').classList.toggle('on', !state.months.size);
    $('#timeline').innerHTML = years.map((y) => {
      const avail = monthsOfYear(y);
      const selCount = avail.filter((p) => state.months.has(p)).length;
      const full = avail.length && selCount === avail.length;
      return `<div class="tl-year ${selCount ? 'has-sel' : ''} ${avail.length ? '' : 'empty'}">
        <button class="tl-ylabel ${full ? 'on' : ''}" data-year="${y}" ${avail.length ? '' : 'disabled'}
          title="${avail.length ? `Select all of ${y}` : `No data for ${y} yet`}">
          <b>${y}</b><small>${avail.length ? `${avail.length} month${avail.length > 1 ? 's' : ''}` : 'No data yet'}</small>
        </button>
        <div class="tl-quarters">${[1, 2, 3, 4].map((q) => {
          const qm = monthsOfQuarter(y, q);
          const qOn = qm.length && qm.every((p) => state.months.has(p));
          return `<button class="tl-q ${qm.length ? 'has' : ''} ${qOn ? 'on' : ''}" data-y="${y}" data-q="${q}" ${qm.length ? '' : 'disabled'}
            title="${qm.length ? `Select Q${q} ${y} (${MONTHS[(q - 1) * 3]}–${MONTHS[q * 3 - 1]})` : `No data for Q${q} ${y}`}">Q${q}</button>`;
        }).join('')}</div>
        <div class="tl-months">${MONTHS.map((m, i) => {
          const p = `${y}-${pad2(i + 1)}`;
          const ok = has.has(p);
          return `<button class="tl-m ${ok ? 'has' : ''} ${state.months.has(p) ? 'on' : ''}" data-p="${p}" ${ok ? '' : 'disabled'}
            title="${ok ? MONTHS_LONG[i] + ' ' + y : 'No file for ' + MONTHS_LONG[i] + ' ' + y}">${m}</button>`;
        }).join('')}</div>
      </div>`;
    }).join('');
  }

  $('#timeline').addEventListener('click', (e) => {
    const m = e.target.closest('.tl-m');
    const yb = e.target.closest('.tl-ylabel');
    const qb = e.target.closest('.tl-q');
    const multi = e.ctrlKey || e.metaKey;
    if (qb && !qb.disabled) {
      selectQuarter(qb.dataset.y, Number(qb.dataset.q), multi);
    } else if (m && !m.disabled) {
      const p = m.dataset.p;
      if (e.shiftKey && state.lastClicked) {
        const [a, b] = [state.lastClicked, p].sort();
        state.months = new Set(state.periods.filter((x) => x >= a && x <= b));
      } else if (multi) {
        if (state.months.has(p)) state.months.delete(p); else state.months.add(p);
      } else {
        state.months = new Set([p]);
      }
      state.lastClicked = p;
    } else if (yb && !yb.disabled) {
      const ms = monthsOfYear(yb.dataset.year);
      if (multi) ms.forEach((p) => state.months.add(p));
      else state.months = new Set(ms);
    } else return;
    state.hadSelection = state.months.size > 0;
    onFilterChange();
  });
  $('#tlAll').addEventListener('click', () => { state.months.clear(); state.hadSelection = false; onFilterChange(); });

  // ---------------- category / specialty menu & routing ----------------
  // #/                      hospital overview
  // #/c/<cat>               a staff category (opd | residents | allied)
  // #/c/<cat>/<name>        one specialty / department inside it
  function readRoute() {
    const h = location.hash;
    let m = h.match(/^#\/c\/([a-z]+)(?:\/(.+))?$/);
    if (m && catOf(m[1])) return { cat: m[1], dept: m[2] ? decodeURIComponent(m[2]) : null };
    m = h.match(/^#\/mix\/([a-z,]+)$/); // several categories together
    if (m) {
      const keys = m[1].split(',').filter((k) => catOf(k) && !isCensusCat(k));
      if (keys.length >= 2) return { cat: null, dept: null, mix: keys };
      if (keys.length === 1) return { cat: keys[0], dept: null };
    }
    m = h.match(/^#\/specialty\/(.+)$/); // links from the previous version
    if (m) return { cat: 'opd', dept: decodeURIComponent(m[1]) };
    return { cat: null, dept: null };
  }
  const catHref = (cat) => `#/c/${cat}`;
  const deptHref = (name, cat = state.cat || 'opd') => `#/c/${cat}/${encodeURIComponent(name)}`;
  function applyRoute() {
    const r = readRoute();
    state.cat = r.cat;
    state.dept = r.dept;
    state.mix = r.mix ? new Set(r.mix) : null;
    // a department page shows its category's list (the other lists open only when asked)
    if (r.cat && r.dept) state.navOpen.add(r.cat);
  }
  // Menu categories are collapsed by default; remember which ones the viewer opened.
  state.navOpen = new Set(store.get('navOpen', []));
  const saveNavOpen = () => store.set('navOpen', [...state.navOpen]);
  window.addEventListener('hashchange', () => {
    applyRoute();
    ensureDataForPage();
    state.page = 1;
    mSpec.selected.clear(); mSpec.refresh();
    document.body.classList.remove('nav-open');
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  function renderNav() {
    const q = $('#navSearch').value.trim().toLowerCase();
    const branchRows = state.rows.filter(inBranch);
    const rows = branchRows.filter(inPeriod);
    const sel = selection();
    $('#navOverview').classList.toggle('on', !state.cat && !state.mix);
    const chev = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
    const tick = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    // What the small number next to an item shows for each kind of category.
    const measure = (c, g) => (c.census ? `${nfFull.format(g.visits)} visits`
      : c.key === 'residents' ? compact(g.cost) : c.incentiveOnly && !g.revenue ? compact(g.incentives) : compact(g.revenue));
    const moneyInc = rows.filter((r) => !isCensusCat(r.category)).reduce((x, r) => x + (r.incentives || 0), 0);

    /** Items (specialties / departments / sections) of a category in the selected months. */
    function units(c, list) {
      const groups = new Map();
      for (const r of list) {
        if (r.category !== c.key) continue;
        const g = groups.get(r.specialty) || { ids: new Set(), revenue: 0, cost: 0, incentives: 0, visits: 0 };
        g.ids.add(personKey(r)); g.revenue += r.revenue; g.cost += r.cost; g.incentives += r.incentives; g.visits += r.visits || 0;
        groups.set(r.specialty, g);
      }
      for (const d of c.fixed || []) if (!groups.has(d)) groups.set(d, null);
      if (state.cat === c.key && state.dept && !groups.has(state.dept)) groups.set(state.dept, null);
      return [...groups].sort((a, b) => a[0].localeCompare(b[0])).filter(([name]) => !q || name.toLowerCase().includes(q));
    }
    const itemList = (c, items) => items.map(([name, g]) => `<a href="${deptHref(name, c.key)}" class="nav-item ${g ? '' : 'empty'} ${state.cat === c.key && state.dept === name ? 'on' : ''}">
        <span class="nm">${esc(name)}</span><small>${g ? `${g.ids.size} · ${measure(c, g)}` : 'no data'}</small></a>`).join('');
    const people = (key, list = rows) => new Set(list.filter((r) => r.category === key && !r.level).map(personKey)).size; // department / group rows are not people
    /**
     * A category's row: a tick to add it to a combined view, its name with the period's figure
     * and its share of all incentives, and a chevron that opens its list (a double click too).
     */
    const head = (c, open, count) => {
      const g = agg(rows.filter((r) => r.category === c.key));
      const has = g.n || g.incentives || g.visits || g.revenue;
      const fig = c.census ? `${nfFull.format(g.visits)} visits`
        : c.key === 'residents' || (c.incentiveOnly && !g.revenue) ? `${compact(g.incentives)} incentives` : `${compact(g.revenue)} revenue`;
      const share = c.census ? null : safeDiv(g.incentives, moneyInc);
      const picked = pickedCats().has(c.key);
      const word = c.perDept || c.other ? (count === 1 ? 'department' : 'departments') : c.team ? 'team' : c.who;
      return `<div class="nav-cat-head ${state.cat === c.key && !state.dept ? 'on' : ''} ${state.cat === c.key && state.dept ? 'in' : ''} ${open ? 'open' : ''} ${picked ? 'picked' : ''}" data-cat="${c.key}" style="--c:var(${c.color})">
        ${c.census ? '<span class="nav-pick off" title="Workload (visits and admissions), not money: it opens on its own"><i></i></span>'
          : `<button type="button" class="nav-pick" data-pick="${c.key}" aria-pressed="${picked}" title="${picked ? 'Take it out of' : 'Add it to'} the combined view (or Ctrl + click its name)">${tick}</button>`}
        <a class="nav-cat-link" href="${catHref(c.key)}" data-cat-link="${c.key}" title="${esc(c.label)}${share ? ` · ${pct(share, 0)} of all incentives` : ''} · double-click to show its ${pluralUnit(c.unit)}">
          <b>${esc(c.label)}</b>
          <small>${has ? `${c.team ? '' : `${nfFull.format(count)} ${word} · `}${fig}` : 'nothing in the selected months'}</small>
          ${share ? `<span class="nav-bar"><i style="width:${Math.max(3, Math.round(share * 100))}%"></i></span>` : ''}
        </a>
        <button type="button" class="nav-chev" data-expand="${c.key}" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} its ${pluralUnit(c.unit)}">${chev}</button>
      </div>`;
    };

    /** A normal category block: header + (when open) its items. */
    function block(c) {
      const items = units(c, rows);
      const open = q ? items.length > 0 : state.navOpen.has(c.key);
      if (!open) return `<div class="nav-cat">${head(c, false, people(c.key))}</div>`;
      return `<div class="nav-cat">${head(c, true, people(c.key))}<div class="nav-cat-list">${itemList(c, items)
        || (q ? '' : '<p class="muted nav-empty">No data yet</p>')}</div></div>`;
    }

    /** Quarterly incentive: its quarters, and under the selected quarter its departments. */
    function quarterlyBlock(c) {
      const qRows = branchRows.filter((r) => r.category === c.key);
      const quarters = [...new Set(qRows.map((r) => `${yearOf(r.period)}-${quarterOf(r.period)}`))].sort().reverse();
      const items = units(c, rows);
      const open = q ? items.length > 0 : state.navOpen.has(c.key);
      const count = new Set(rows.filter((r) => r.category === c.key).map((r) => r.specialty)).size;
      if (!open) return `<div class="nav-cat">${head(c, false, count)}</div>`;
      const activeQ = state.cat === c.key && sel.kind === 'quarter' ? `${sel.year}-${sel.q}` : null;
      const list = quarters.map((yq) => {
        const [y, qq] = yq.split('-');
        const qr = qRows.filter((r) => `${yearOf(r.period)}-${quarterOf(r.period)}` === yq);
        const on = activeQ === yq;
        return `<a href="${catHref(c.key)}" data-quarter="${yq}" class="nav-item nav-quarter ${on && !state.dept ? 'on' : ''}">
            <span class="nm">Q${qq} ${y}</span><small>${new Set(qr.map((r) => r.specialty)).size} dept. · ${compact(agg(qr).incentives)}</small></a>
          ${on ? `<div class="nav-sub">${itemList(c, items)}</div>` : ''}`;
      }).join('');
      return `<div class="nav-cat">${head(c, true, count)}<div class="nav-cat-list">${list
        || '<p class="muted nav-empty">No quarters yet</p>'}</div></div>`;
    }

    const medical = CATS.filter((c) => c.group === 'medical').map(block).join('');
    // Separate incentives: one collapsible group holding the programmes.
    const sepCats = CATS.filter((c) => c.group === 'separate');
    const sepOpen = q ? sepCats.some((c) => units(c, rows).length) : state.navOpen.has('g:separate') || sepCats.some((c) => c.key === state.cat || pickedCats().has(c.key));
    const sepRows = rows.filter((r) => catOf(r.category)?.group === 'separate');
    const sepCount = new Set(sepRows.map(personKey)).size;
    const separate = `<div class="nav-group ${sepOpen ? 'open' : ''}">
        <a href="#" data-group="separate" class="nav-group-head ${sepOpen ? 'open' : ''} ${catOf(state.cat)?.group === 'separate' ? 'in' : ''}" style="--c:var(--s4)">
          <span class="nav-group-ic"></span><span class="nav-group-txt"><b>Separate incentives</b><small>${sepCats.length} programmes · ${sepCount ? `${sepCount} staff · ` : ''}${compact(agg(sepRows).incentives)}</small></span>${chev}</a>
        ${sepOpen ? `<div class="nav-group-body">${sepCats.map(block).join('')}</div>` : ''}</div>`;
    const quarterly = quarterlyBlock(catOf('quarterly'));
    const other = block(catOf('other'));
    const census = block(catOf('census'));
    const found = peopleMatches(q);
    const peopleHtml = found.length ? `<div class="nav-people"><div class="nav-people-h">People</div>${found.map((r) => `<a href="#" class="nav-item nav-person" data-person="${esc(personKey(r))}"><span class="nm">${esc(r.name)}</span><small>${esc(catOf(r.category)?.short || '')} · ${esc(r.specialty)}</small></a>`).join('')}</div>` : '';
    // the combined view, when several categories are ticked
    const mix = state.mix ? CATS.filter((c) => state.mix.has(c.key)) : [];
    const mixInc = rows.filter((r) => state.mix?.has(r.category)).reduce((x, r) => x + (r.incentives || 0), 0);
    const mixHtml = mix.length ? `<div class="nav-mix"><div class="nav-mix-top"><b>Combined view</b><button type="button" class="nav-mix-clear" data-mix-clear>Clear</button></div>
        <div class="nav-mix-dots">${mix.map((c) => `<span style="--c:var(${c.color})" title="${esc(c.label)}"></span>`).join('')}<small>${mix.length} categories · ${compact(mixInc)} incentives</small></div></div>`
      : '<p class="nav-hint">Tick <span class="nav-hint-tick"></span> to see several categories together</p>';
    $('#navList').innerHTML = `${peopleHtml}${q ? '' : mixHtml}
      <div class="nav-sec">Medical staff</div>${medical}
      <div class="nav-sec">Incentive programmes</div>${separate}${quarterly}${other}
      <div class="nav-sec">Workload</div>${census}`;
  }
  $('#navSearch').addEventListener('input', renderNav);
  /** Categories ticked for the combined view (a single category page counts as its own tick). */
  function pickedCats() {
    if (state.mix) return state.mix;
    return new Set(state.cat && !isCensusCat(state.cat) ? [state.cat] : []);
  }
  const mixHref = (keys) => { const k = CATS.map((c) => c.key).filter((x) => keys.has(x)); return k.length >= 2 ? `#/mix/${k.join(',')}` : k.length ? catHref(k[0]) : '#/'; };
  /** Tick / untick a category: two or more make a combined view, one is its own page. */
  function togglePick(key) {
    if (isCensusCat(key)) return;
    const set = new Set(pickedCats());
    if (set.has(key)) set.delete(key); else set.add(key);
    const href = mixHref(set);
    if (location.hash === href || (href === '#/' && !location.hash)) render(); else location.hash = href;
  }
  function toggleOpen(key) {
    if (state.navOpen.has(key)) state.navOpen.delete(key); else state.navOpen.add(key);
    saveNavOpen();
    renderNav();
  }
  // A category's name opens its page; its list opens only with the chevron or a double click.
  let lastCatClick = { key: null, t: 0 };
  $('#navList').addEventListener('click', (e) => {
    // a person found by the search: their panel (latest month)
    const person = e.target.closest('[data-person]');
    if (person) {
      e.preventDefault();
      // their latest month, the paid record first (not the census workload line)
      const rank = (x) => (isCensusCat(x.category) ? 2 : catOf(x.category)?.group === 'medical' ? 0 : 1);
      const r = state.rows.filter((x) => personKey(x) === person.dataset.person && !x.level).sort((a, b) => b.period.localeCompare(a.period) || rank(a) - rank(b))[0];
      if (r) { document.body.classList.remove('nav-open'); openDoctor(r); }
      return;
    }
    if (e.target.closest('[data-mix-clear]')) { e.preventDefault(); location.hash = '#/'; return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) { e.preventDefault(); togglePick(pick.dataset.pick); return; }
    const exp = e.target.closest('[data-expand]');
    if (exp) { e.preventDefault(); toggleOpen(exp.dataset.expand); return; }
    // "Separate incentives" group: only folds / unfolds.
    const group = e.target.closest('.nav-group-head');
    if (group) { e.preventDefault(); toggleOpen(`g:${group.dataset.group}`); return; }
    // A quarter of the quarterly incentive: select its months and open the quarterly page.
    const qItem = e.target.closest('[data-quarter]');
    if (qItem) {
      e.preventDefault();
      const [y, q] = qItem.dataset.quarter.split('-');
      selectQuarter(y, Number(q));
      if (location.hash !== catHref('quarterly')) location.hash = catHref('quarterly'); else onFilterChange();
      return;
    }
    const link = e.target.closest('[data-cat-link]');
    if (!link) return;
    e.preventDefault();
    const key = link.dataset.catLink;
    if (e.ctrlKey || e.metaKey) { togglePick(key); return; }
    const now = Date.now();
    if (lastCatClick.key === key && now - lastCatClick.t < 450) { lastCatClick = { key: null, t: 0 }; toggleOpen(key); return; }
    lastCatClick = { key, t: now };
    if (location.hash !== catHref(key)) location.hash = catHref(key);
  });
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

  // ---------------- filters ----------------
  function createMulti(el, label, onChange) {
    const selected = new Set();
    el.innerHTML = `<button type="button" aria-haspopup="listbox"><span>All</span></button>
      <div class="menu" role="listbox">
        <input type="search" placeholder="Filter ${label.toLowerCase()}…" />
        <div class="opts"></div>
        <div class="menu-foot"><button type="button" data-a="all">Select all shown</button><button type="button" data-a="clear">Clear</button></div>
      </div>`;
    const btn = $('button', el);
    const input = $('input', el);
    const opts = $('.opts', el);
    let options = [];
    const drawButton = () => {
      $('span', btn).textContent = !selected.size ? 'All' : selected.size === 1 ? [...selected][0] : `${selected.size} selected`;
    };
    const drawOptions = () => {
      const q = input.value.trim().toLowerCase();
      opts.innerHTML = options
        .filter((o) => !q || o.value.toLowerCase().includes(q))
        .map((o) => `<label class="opt"><input type="checkbox" value="${esc(o.value)}" ${selected.has(o.value) ? 'checked' : ''}/>${esc(o.value)}<small>${o.count}</small></label>`)
        .join('') || '<div class="opt muted">No matches</div>';
    };
    btn.addEventListener('click', () => {
      $$('.multi.open').forEach((m) => m !== el && m.classList.remove('open'));
      el.classList.toggle('open');
      if (el.classList.contains('open')) { input.value = ''; drawOptions(); input.focus(); }
    });
    input.addEventListener('input', drawOptions);
    opts.addEventListener('change', (e) => {
      const v = e.target.value;
      if (e.target.checked) selected.add(v); else selected.delete(v);
      drawButton(); onChange();
    });
    $('.menu-foot', el).addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === 'clear') selected.clear();
      else $$('input[type=checkbox]', opts).forEach((c) => selected.add(c.value));
      drawOptions(); drawButton(); onChange();
    });
    return {
      selected,
      setOptions(list) { options = list; if (el.classList.contains('open')) drawOptions(); drawButton(); },
      refresh() { drawButton(); if (el.classList.contains('open')) drawOptions(); },
    };
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi')) $$('.multi.open').forEach((m) => m.classList.remove('open'));
  });

  const onFilterChange = () => { state.page = 1; render(); };
  const mSpec = createMulti($('#fSpecialty'), 'Specialty', onFilterChange);
  const mPos = createMulti($('#fPosition'), 'Position', onFilterChange);
  state.filters.specialties = mSpec.selected;
  state.filters.positions = mPos.selected;

  function setupFormLists() {
    const uniq = (k) => [...new Set(state.rows.map((r) => r[k]))].sort((a, b) => a.localeCompare(b));
    $('#dlPositions').innerHTML = uniq('position').map((v) => `<option value="${esc(v)}">`).join('');
    $('#dlSpecialties').innerHTML = uniq('specialty').map((v) => `<option value="${esc(v)}">`).join('');
  }

  let searchT;
  $('#fSearch').addEventListener('input', (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { state.filters.search = e.target.value.trim().toLowerCase(); onFilterChange(); }, 150);
  });
  $('#resetBtn').addEventListener('click', () => {
    mSpec.selected.clear(); mPos.selected.clear();
    $('#fSearch').value = ''; state.filters.search = '';
    state.months = new Set(state.periods.length ? [state.periods[state.periods.length - 1]] : []);
    mSpec.refresh(); mPos.refresh(); onFilterChange();
  });

  function matches(r, { skipSpec = false, skipPos = false, skipPeriod = false, skipDept = false, skipCat = false } = {}) {
    const f = state.filters;
    if (!inBranch(r)) return false;
    if (!skipPeriod && !inPeriod(r)) return false;
    if (!skipCat && state.cat && r.category !== state.cat) return false;
    // Workload (census) data lives only on its own page; money views never include it.
    if (!state.cat && isCensusCat(r.category)) return false;
    if (!state.cat && state.mix && !state.mix.has(r.category)) return false; // a combined view: its categories
    if (!skipDept && state.dept && r.specialty !== state.dept) return false;
    if (!skipSpec && !state.dept && f.specialties.size && !f.specialties.has(r.specialty)) return false;
    if (!skipPos && f.positions.size && !f.positions.has(r.position)) return false;
    if (f.search && !r._search.includes(f.search)) return false;
    return true;
  }

  function toggleFilter(multi, value) {
    if (multi.selected.has(value) && multi.selected.size === 1) multi.selected.clear();
    else if (multi.selected.has(value)) multi.selected.delete(value);
    else multi.selected.add(value);
    multi.refresh(); onFilterChange();
  }

  function renderChips() {
    const chips = [];
    if (!state.dept) for (const v of state.filters.specialties) chips.push({ k: 'spec', v, label: 'Specialty' });
    for (const v of state.filters.positions) chips.push({ k: 'pos', v, label: 'Position' });
    if (state.filters.search) chips.push({ k: 'search', v: state.filters.search, label: 'Search' });
    $('#chips').innerHTML = chips.map((c) => `<button class="chip" data-k="${c.k}" data-v="${esc(c.v)}"><b>${c.label}:</b> ${esc(c.v)}
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`).join('');
  }
  $('#chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    if (c.dataset.k === 'spec') { mSpec.selected.delete(c.dataset.v); mSpec.refresh(); }
    if (c.dataset.k === 'pos') { mPos.selected.delete(c.dataset.v); mPos.refresh(); }
    if (c.dataset.k === 'search') { $('#fSearch').value = ''; state.filters.search = ''; }
    onFilterChange();
  });

  // ---------------- aggregation ----------------
  // A person = branch + category + ID (the branches may reuse employee IDs).
  // Within a branch an employee ID is one person, even when they appear in several files
  // (e.g. an OPD doctor who also earns Patient Relation incentives).
  const personKey = (r) => `${r.branch}|${r.id}`;
  function agg(rows) {
    const a = { n: 0, revenue: 0, salary: 0, incentives: 0, targetSum: 0, revWithTarget: 0, withTarget: 0, met: 0, visits: 0, admissions: 0, operations: 0 };
    const ids = new Set();
    // A salary is counted once per person per month, however many incentive files list it.
    const salaryOf = new Map();
    // a department's salaries once per month, however many lines it has (Other Incentives: one per reason)
    const deptSalary = new Map();
    for (const r of rows) {
      if (r._basis) { a.incentives += r.incentives; continue; }
      if (r.level) {
        // a department's own figures (closed-department templates): revenue, target, incentives — no person
        a.revenue += r.revenue; a.incentives += r.incentives;
        const dk = `${r.branch}|${r.category}|${r.specialty}|${r.period}`;
        deptSalary.set(dk, Math.max(deptSalary.get(dk) || 0, r.salary || 0));
        if (r.target) { a.targetSum += r.target; a.revWithTarget += r.revenue; a.withTarget++; if (r.revenue >= r.target) a.met++; }
        continue;
      }
      ids.add(personKey(r)); a.revenue += r.revenue; a.incentives += r.incentives;
      const pm = `${personKey(r)}|${r.period}`;
      salaryOf.set(pm, Math.max(salaryOf.get(pm) || 0, r.salary));
      a.visits += r.visits || 0; a.admissions += r.admissions || 0; a.operations += r.operations || 0;
      if (r.target) { a.targetSum += r.target; a.revWithTarget += r.revenue; a.withTarget++; if (r.revenue >= r.target) a.met++; }
    }
    for (const s of salaryOf.values()) a.salary += s;
    for (const v of deptSalary.values()) a.salary += v;
    a.n = salaryOf.size;                       // person-months
    a.doctors = ids.size;
    a.cost = a.salary + a.incentives;
    a.contribution = a.revenue - a.cost;       // revenue after doctors' salaries + incentives
    a.incRate = safeDiv(a.incentives, a.salary);
    a.revRate = safeDiv(a.incentives, a.revenue);
    a.revPerDoc = safeDiv(a.revenue, a.n);   // per doctor-month
    a.roi = safeDiv(a.revenue, a.cost);
    // Achievement only counts doctor-months that have a target.
    a.achievement = safeDiv(a.revWithTarget, a.targetSum);
    return a;
  }
  function groupBy(rows, key) {
    const m = new Map();
    for (const r of rows) {
      // Unnamed quarterly lines count in the monthly totals, not as departments / positions of other pages.
      if (r._basis && key !== 'period') continue;
      if (r.level && key === 'position') continue; // a department row has no position
      const k = r[key];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m].map(([k, list]) => ({ key: k, ...agg(list), rows: list, lines: list.length }));
  }
  /** One entry per doctor, summed over the selected months. */
  function byDoctor(rows) {
    const m = new Map();
    for (const r of rows) {
      if (r._basis || r.level) continue; // unnamed quarterly lines and department rows are not people
      const k = personKey(r);
      let d = m.get(k);
      if (!d) {
        d = { key: k, id: r.id, revenue: 0, incentives: 0, salary: 0, target: 0, revWithTarget: 0, visits: 0, admissions: 0, operations: 0, pay: new Map(), last: r };
        m.set(k, d);
      }
      d.revenue += r.revenue; d.incentives += r.incentives;
      d.pay.set(r.period, Math.max(d.pay.get(r.period) || 0, r.salary)); // one salary per month
      d.visits += r.visits || 0; d.admissions += r.admissions || 0; d.operations += r.operations || 0;
      if (r.target) { d.target += r.target; d.revWithTarget += r.revenue; }
      // Name/position/specialty from the latest month, preferring the main (medical) record.
      if (r.period > d.last.period || (r.period === d.last.period && catOf(r.category)?.group === 'medical')) d.last = r;
    }
    for (const d of m.values()) { d.salary = [...d.pay.values()].reduce((s, v) => s + v, 0); d.months = d.pay.size; delete d.pay; }
    return [...m.values()].map((d) => ({
      ...d, name: d.last.name, position: d.last.position, specialty: d.last.specialty,
      cost: d.salary + d.incentives,
      incentiveRate: safeDiv(d.incentives, d.salary), revPerSalary: safeDiv(d.revenue, d.salary),
      revPerCost: safeDiv(d.revenue, d.salary + d.incentives),
      target: d.target || null, achievement: safeDiv(d.revWithTarget, d.target),
    }));
  }

  // ---------------- render ----------------
  let filtered = [];
  function render() {
    const sel = selection();
    showMeasures();
    filtered = state.rows.filter((r) => matches(r));
    $('#fileName').textContent = state.fileName;
    const where = [state.branch === 'all' ? 'All branches' : state.branch, state.cat && catOf(state.cat).short, state.mix && `Combined: ${CATS.filter((c) => state.mix.has(c.key)).map((c) => c.short).join(' + ')}`, state.dept].filter(Boolean).join(' · ');
    $('#periodLabel').textContent = `${where} · ${sel.label}`;
    // What this page can show: revenue-based cards need revenue (residents have none).
    const hasRevenue = filtered.some((r) => r.revenue > 0)
      || (!filtered.length && state.cat !== 'residents' && !catOf(state.cat)?.incentiveOnly);
    document.body.classList.toggle('in-dept', !!state.dept);
    document.body.classList.toggle('in-overview', !state.cat);
    document.body.classList.toggle('in-mix', !!state.mix);
    document.body.classList.toggle('no-revenue', !hasRevenue);
    document.body.classList.toggle('cat-residents', state.cat === 'residents' && !state.dept);
    document.body.classList.toggle('cat-share', !!catOf(state.cat)?.incentiveOnly);
    document.body.classList.toggle('cat-census', isCensusCat(state.cat));
    document.body.classList.toggle('cat-measure', !!catOf(state.cat)?.measure);
    document.body.classList.toggle('cat-team', !!catOf(state.cat)?.team);
    document.body.classList.toggle('cat-other', !!catOf(state.cat)?.other); // no people: per-person cards hidden
    document.body.classList.toggle('cat-perdept', !!catOf(state.cat)?.perDept); // lines per department: no headcount charts
    // Sales / collection by month now live in the "Target, revenue & incentives" card; this one keeps the cases.
    document.body.classList.toggle('cat-monthly', !!catOf(state.cat)?.cases);
    state.hasRevenue = hasRevenue && !isCensusCat(state.cat);
    const periodRows = state.rows.filter((r) => inBranch(r) && inPeriod(r) && (!state.cat || r.category === state.cat) && (!state.mix || state.mix.has(r.category)) && (!state.dept || r.specialty === state.dept));
    const count = (k) => {
      const m = new Map();
      for (const r of periodRows) m.set(r[k], (m.get(r[k]) || 0) + 1);
      return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([value, n]) => ({ value, count: n }));
    };
    mSpec.setOptions(count('specialty'));
    mPos.setOptions(count('position'));
    $('#fSpecialtyField > span').textContent = state.cat ? cap(catOf(state.cat).unit) : 'Specialty / department';
    // Titles follow the page: doctors (OPD), residents, or staff (allied / mixed).
    const who = state.cat ? catOf(state.cat).who : 'staff';
    const units = state.cat ? pluralUnit(catOf(state.cat).unit) : 'specialties & departments';
    $('#tTop').textContent = `Top 10 ${who}`;
    $('#tLow').textContent = `Lowest 10 ${who}`;
    $('#tBw').textContent = `Strongest & weakest ${units}`;
    $('#tRec').textContent = catOf(state.cat)?.other ? 'Payments' : who[0].toUpperCase() + who.slice(1);
    renderBranchSeg();
    renderTimeline();
    renderNav();
    renderChips();
    renderDataCheckBadge(); // all branches: shown on a branch without data too
    // A branch without data yet (e.g. SGH-Alex before its files are uploaded).
    const branchEmpty = !state.rows.some(inBranch);
    $('#noData').classList.toggle('hidden', !branchEmpty);
    $('#grid').classList.toggle('hidden', branchEmpty);
    $('#kpis').classList.toggle('hidden', branchEmpty);
    if (branchEmpty) {
      // A category / department page still shows its header: the template to download and the
      // upload button are how the branch's first data gets in.
      if (state.cat) renderDeptHeader(); else $('#deptHeader').classList.add('hidden');
      $('#noData').innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg>
        <div><b>${esc(state.branch)} has no data yet</b>
        <p>${state.cat
    ? `Download the template above, fill it in and upload it with the <b>Upload</b> button — ${esc(state.branch)} fills in by itself a few minutes later.`
    : `Open a category or department from the menu on the left: each page has its template to download and an <b>Upload</b> button for ${esc(state.branch)}.`}
        Until then you can switch to <b>SGH-Cairo</b> or <b>All branches</b>.</p></div>`;
      return;
    }
    renderDeptHeader();
    renderKpis();
    renderInsights();
    renderCatTiles();
    renderBranchTable();
    renderBranchCats();
    renderCharts();
    renderSpecTable();
    renderRecTable();
    updateSections();
  }

  const unitOf = () => (state.cat ? catOf(state.cat).unit : 'specialty / department');

  /** Page header, plus an upload button for exactly this page (category / department / quarter). */
  /** A department's own figures over the selected months (summed per label), from its Level rows. */
  function deptFigures(rows) {
    const sum = new Map();
    for (const r of rows) if (r.level && r.metrics) for (const [k, v] of Object.entries(r.metrics)) if (Number.isFinite(Number(v))) sum.set(k, (sum.get(k) || 0) + Number(v));
    return [...sum].map(([label, value]) => ({ label, value }));
  }
  function renderDeptHeader() {
    renderDeptHeaderBody();
    const el = $('#deptHeader');
    if (state.cat && !el.classList.contains('hidden')) {
      const scope = state.rows.filter((r) => inBranch(r) && inPeriod(r) && r.category === state.cat && (!state.dept || r.specialty === state.dept));
      const rev = scope.reduce((x, r) => x + (r.revenue || 0), 0);
      // Sales, expenses and net profit (IVP Visiting Professors: Income, Total Expenses, Net Profit), where the template has them
      const withProfit = scope.filter((r) => r.expenses != null || r.netProfit != null);
      if (withProfit.length) {
        const inc = withProfit.reduce((x, r) => x + (r.revenue || 0), 0);
        const exp = withProfit.reduce((x, r) => x + (r.expenses || 0), 0);
        const np = withProfit.reduce((x, r) => x + (r.netProfit || 0), 0);
        $('.dh-stats', el)?.insertAdjacentHTML('beforeend', `<div class="dh-stat"><span>Total expenses</span><b>${money(exp)}</b><small>${inc ? `${pct(exp / inc, 0)} of ${compact(inc)} ${revLabel().toLowerCase()}` : 'From the template'}</small></div>
          <div class="dh-stat"><span>Net profit</span><b>${money(np)}</b><small>${inc ? `${pct(np / inc, 0)} margin on ${revLabel().toLowerCase()}` : `${revLabel()} − expenses`}</small></div>`);
      }
      const figs = (state.dept || !catOf(state.cat).fixed) && !catOf(state.cat).other ? deptFigures(scope) : [];
      if (figs.length) {
        $('.dh-stats', el)?.insertAdjacentHTML('beforeend', figs.map((f) => `<div class="dh-stat"><span>${esc(f.label)}</span><b>${nfFull.format(f.value)}</b>
          <small>${rev && f.value && !/income|revenue|payment|amount|collect|sales|egp/i.test(f.label) ? `${compact(rev / f.value)} ${CURRENCY} revenue each` : 'From the department template'}</small></div>`).join(''));
      }
    }
    if (el.classList.contains('hidden') || !state.cat) return; // a combined view has no upload of its own
    if (!canUpload()) { addExportButton(el); return; }
    const c = catOf(state.cat);
    const sel = selection();
    const what = state.dept || (c.quarterly && sel.kind === 'quarter' ? `${c.short} · Q${sel.q} ${sel.year}` : c.short);
    const btn = document.createElement('button');
    btn.className = 'btn sm dh-upload';
    btn.dataset.ctxUpload = '';
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>Upload ${esc(what)} file`;
    btn.title = state.dept
      ? `Upload an Excel file for ${state.dept}: its rows replace this ${c.unit}'s rows for the months in the file`
      : `Upload an Excel file for ${c.label}: each month in the file replaces that month`;
    $('.dh-main', el)?.appendChild(btn);
    // The page's Excel template: its department's own, or its category's; a category of fixed
    // departments without one of its own lists theirs.
    const tkey = TemplateCheck.templateKey(state.cat, state.dept);
    const units = (c.fixed || []).filter((u) => TemplateCheck.TEMPLATES[`${state.cat}:${u}`]);
    const icon = '<svg viewBox="0 0 24 24"><path d="M12 4v12M7 11l5 5 5-5M4 20h16"/></svg>';
    let tplHtml = '';
    if (tkey) {
      const label = tkey.includes(':') ? state.dept : c.short;
      tplHtml = `<button class="btn sm ghost" data-tpl="${esc(tkey)}" data-tpl-label="${esc(label)}" title="The Excel template to fill for ${esc(label)}">${icon}Download ${esc(label)} template</button>`;
    } else if (state.cat === 'allied' && state.dept && ALLIED.includes(state.dept)) {
      tplHtml = `<button class="btn sm ghost" data-template="${esc(state.dept)}" title="An Excel file with the columns to fill for ${esc(state.dept)}">${icon}Download ${esc(state.dept)} template</button>`;
    } else if (!state.dept && units.length) {
      tplHtml = `<span class="muted">Templates:</span>${units.map((u) => `<button class="linklike" data-tpl="${esc(`${state.cat}:${u}`)}" data-tpl-label="${esc(u)}">${esc(u)}</button>`).join('')}`;
    }
    if (tplHtml) {
      const tpl = document.createElement('div');
      tpl.className = 'dh-templates';
      tpl.innerHTML = tplHtml;
      $('.dh-main', el)?.appendChild(tpl);
    }
    addExportButton(el);
  }
  /** "Download loaded figures": what the dashboard holds for this page, to check against the files. */
  function addExportButton(el) {
    const b = document.createElement('button');
    b.className = 'btn sm ghost dh-export';
    b.dataset.exportLoaded = '';
    const what = state.dept || catOf(state.cat).short;
    b.title = `An Excel file with every line the dashboard has for ${what} in the selected months (and filters), with totals by month, to compare with your files`;
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM4 10h16M10 4v16"/><path d="M14 15l2 2 3-4"/></svg>Loaded figures';
    ($('.dh-templates', el) || $('.dh-main', el))?.appendChild(b); // next to the template button
  }
  function exportLoaded() {
    const c = catOf(state.cat);
    const rows = state.rows.filter((r) => matches(r)).sort((a, b) => a.period.localeCompare(b.period)
      || String(a.specialty).localeCompare(String(b.specialty)) || (a.level ? 1 : 0) - (b.level ? 1 : 0) || String(a.name).localeCompare(String(b.name)));
    if (!rows.length) { toast('Nothing loaded for this page in the selected months.', 'err'); return; }
    const sel = selection();
    const R = revLabel();
    const has = (f) => rows.some(f);
    const withRev = has((r) => r.revenue); const withTgt = has((r) => r.target); const withCases = has((r) => r.cases != null);
    const withFigs = has((r) => r.level && r.metrics); const withReason = has((r) => r.reason);
    const census = isCensusCat(state.cat); // workload: visits, admissions, operations instead of money
    const [monthOf, yearOfP] = [(p) => (PERIOD_RX.test(p) ? MONTHS_LONG[monthNo(p) - 1] : p), (p) => (PERIOD_RX.test(p) ? Number(p.slice(0, 4)) : null)];
    const figsText = (r) => (r.level && r.metrics ? Object.entries(r.metrics).map(([k, v]) => `${k}: ${Number.isFinite(Number(v)) ? nfFull.format(Number(v)) : v}`).join(' · ') : '');
    const cols = [
      { header: 'Branch', width: 12 }, { header: 'Month', width: 11 }, { header: 'Year', width: 7 },
      { header: 'ID', width: 12 }, { header: 'Name', width: 34 }, { header: 'Position', width: 24 }, { header: cap(c.unit), width: 24 },
      ...(census ? [{ header: 'Visits', width: 10 }, { header: 'Admissions', width: 11 }, { header: 'Operations', width: 11 }]
        : [{ header: 'Incentives', width: 14, type: 'money' }, { header: 'Total Salary', width: 14, type: 'money' }]),
      ...(withRev ? [{ header: R, width: 16, type: 'money' }] : []),
      ...(withTgt ? [{ header: 'Target', width: 16, type: 'money' }, { header: 'Achievement %', width: 13 }] : []),
      ...(withCases ? [{ header: 'Cases (month)', width: 12 }] : []),
      ...(withReason ? [{ header: 'Reason', width: 30 }] : []),
      ...(withFigs ? [{ header: 'Line', width: 12 }, { header: 'Department figures', width: 46 }] : []),
      { header: 'Source file', width: 60 },
    ];
    const line = (r) => [r.branch, monthOf(r.period), yearOfP(r.period), r.level ? '' : r.id, r.name, r.position === 'Unspecified' ? '' : r.position, r.specialty,
      ...(census ? [r.visits ?? null, r.admissions ?? null, r.operations ?? null] : [r.incentives || 0, r.salary || null]),
      ...(withRev ? [r.revenue || null] : []),
      ...(withTgt ? [r.target || null, r.target ? Math.round((r.revenue / r.target) * 1000) / 10 : null] : []),
      ...(withCases ? [r.cases ?? null] : []),
      ...(withReason ? [r.reason || ''] : []),
      ...(withFigs ? [r.level ? 'Department' : 'Person', figsText(r)] : []),
      r.file || ''];
    // totals by month (and department), as the dashboard counts them
    const months = [...new Set(rows.map((r) => r.period))].sort();
    const units = [...new Set(rows.map((r) => r.specialty))].sort();
    const tCols = [
      { header: 'Month', width: 12 }, { header: cap(c.unit), width: 26 }, { header: 'Lines', width: 8 }, { header: 'People', width: 8 },
      ...(census ? [{ header: 'Visits', width: 10 }, { header: 'Admissions', width: 11 }, { header: 'Operations', width: 11 }] : [{ header: 'Incentives', width: 15, type: 'money' }, { header: 'Salaries', width: 15, type: 'money' }]),
      ...(withRev ? [{ header: R, width: 16, type: 'money' }] : []), ...(withTgt ? [{ header: 'Target', width: 16, type: 'money' }, { header: 'Achievement %', width: 13 }] : []),
    ];
    const tRow = (label, unit, list) => { const a = agg(list); return [label, unit, list.length, a.doctors, ...(census ? [a.visits, a.admissions, a.operations] : [a.incentives, a.salary]), ...(withRev ? [a.revenue] : []), ...(withTgt ? [a.targetSum || null, a.targetSum ? Math.round(a.achievement * 1000) / 10 : null] : [])]; };
    const totals = [];
    for (const p of months) {
      const mRows = rows.filter((r) => r.period === p);
      if (units.length > 1) for (const u of units) { const l = mRows.filter((r) => r.specialty === u); if (l.length) totals.push(tRow(periodLabel(p), u, l)); }
      totals.push(tRow(periodLabel(p), units.length > 1 ? 'All' : units[0], mRows));
    }
    if (months.length > 1) totals.push(tRow(sel.label, 'All', rows));
    const blob = XlsxWrite.build({ sheets: [
      { sheet: 'Loaded figures', columns: cols, rows: rows.map(line) },
      { sheet: 'Totals by month', columns: tCols, rows: totals },
    ] });
    const name = [c.short, state.dept, state.branch === 'all' ? 'All branches' : state.branch, sel.label, 'loaded figures'].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    XlsxWrite.save(blob, `${name}.xlsx`);
    toast(`${nfFull.format(rows.length)} lines downloaded (${sel.label}${state.filters.specialties.size || state.filters.positions.size || state.filters.search ? ', with your filters' : ''}) — the second sheet has the totals by month, as the dashboard counts them.`, '', 8000);
  }
  $('#deptHeader').addEventListener('click', (e) => { if (e.target.closest('[data-export-loaded]')) exportLoaded(); });
  function renderDeptHeaderBody() {
    const el = $('#deptHeader');
    if (!state.cat && state.mix) { renderMixHeader(el); return; }
    if (!state.cat) { el.classList.add('hidden'); return; }
    const c = catOf(state.cat);
    const branchRows = state.rows.filter((r) => inBranch(r) && inPeriod(r));
    const hosp = agg(branchRows.filter((r) => !isCensusCat(r.category))); // as on the overview: census is workload, not pay
    const catRows = branchRows.filter((r) => r.category === state.cat);
    const cmp = (label, v, h, fmt, higherIsGood = true, ref = 'Hospital') => {
      const d = v == null ? null : safeDiv(v - h, h);
      const cls = d == null || !higherIsGood ? '' : d >= 0 ? 'up' : 'down';
      return `<div class="dh-stat"><span>${label}</span><b>${fmt(v)}</b>
        <small>${ref} ${fmt(h)}${d == null ? '' : ` · <span class="delta ${cls}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(0)}%</span>`}</small></div>`;
    };
    // Where this page sits: Hospital overview › category › specialty (each level clickable).
    const back = `<nav class="dh-crumbs" aria-label="Breadcrumb"><a href="#/">Hospital overview</a><span class="sep">›</span>${state.dept
      ? `<a href="${catHref(state.cat)}">${esc(c.label)}</a><span class="sep">›</span><span>${esc(state.dept)}</span>`
      : `<span>${esc(c.label)}</span>`}</nav>`;
    el.classList.remove('hidden');
    el.style.borderLeftColor = `var(${c.color})`;
    const stat = (label, value, sub) => `<div class="dh-stat"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
    const title = state.dept ? `${esc(state.dept)} <small class="dh-kind">${esc(c.short)}</small>` : esc(c.label);
    const scope = state.dept ? catRows.filter((r) => r.specialty === state.dept) : catRows;
    const s = agg(scope);
    const pool = agg(catRows);

    if (c.census) {
      // Workload: no money here.
      const num = (v) => nfFull.format(v || 0);
      el.innerHTML = `<div class="dh-main">${back}<h2>${title}</h2>
          <p>${s.doctors} doctor${s.doctors === 1 ? '' : 's'} · ${num(s.visits)} visits · ${num(s.admissions)} admissions${hasOperations() ? ` · ${num(s.operations)} operations` : ''}${state.dept ? ` · ${pct(safeDiv(s.visits, pool.visits))} of all visits` : ''}</p></div>
        <div class="dh-stats">
          ${stat('Visits per doctor / month', safeDiv(s.visits, s.n)?.toFixed(0) ?? '—', state.dept ? `All: ${safeDiv(pool.visits, pool.n)?.toFixed(0) ?? '—'}` : 'OPD visits')}
          ${stat('Admissions per 100 visits', s.visits ? (s.admissions / s.visits * 100).toFixed(1) : '—', state.dept ? `All: ${pool.visits ? (pool.admissions / pool.visits * 100).toFixed(1) : '—'}` : 'Admissions ÷ visits')}
          ${hasOperations() ? stat('Operations per doctor / month', safeDiv(s.operations, s.n)?.toFixed(1) ?? '—', state.dept ? `All: ${safeDiv(pool.operations, pool.n)?.toFixed(1) ?? '—'}` : 'Operations') : ''}
          ${stat('Admissions per doctor / month', safeDiv(s.admissions, s.n)?.toFixed(1) ?? '—', 'Admissions')}
        </div>`;
      return;
    }
    if (c.incentiveOnly) {
      // Incentive programme: how much was paid and to whom (+ its sales / collection against target, or its cases).
      const allInc = agg(branchRows.filter((r) => !isCensusCat(r.category))).incentives;
      const unitsN = new Set(scope.map((r) => r.specialty)).size;
      const m = c.measure;
      const cases = c.cases ? casesOf(scope) : null;
      let people = c.team ? `${c.short} team` : c.perDept ? plural(unitsN, 'department', 'departments') : `${s.doctors} staff${state.dept ? '' : ` in ${unitsN} ${unitsN === 1 ? c.unit : pluralUnit(c.unit)}`}`;
      const extra = [];
      if (c.other) {
        // which departments, and what it was paid for
        const reasons = reasonsOf(scope);
        const top = reasons[0];
        people = state.dept ? plural(reasons.length, 'reason', 'reasons') : `${plural(deptCount(scope), 'department', 'departments')} · ${plural(reasons.length, 'reason', 'reasons')}`;
        extra.push(stat('Incentives ÷ salaries', pct(s.incRate), `Salaries ${compact(s.salary)} ${CURRENCY}`));
        extra.push(stat('Main reason', top ? `<span class="clamp" title="${esc(top[0])}">${esc(top[0])}</span>` : '—', top ? `${compact(top[1])} ${CURRENCY} · ${pct(safeDiv(top[1], s.incentives), 0)} of this page` : 'From the Incentive Reason column'));
      }
      if (m) {
        extra.push(stat(`${m} vs target`, s.targetSum ? achFmt(s.achievement) : '—', s.targetSum ? `${compact(s.revWithTarget)} of ${compact(s.targetSum)}` : 'No target in the files'));
        extra.push(stat(`Incentive ÷ ${m.toLowerCase()}`, pct(s.revRate, 2), `${m} ${compact(s.revenue)} ${CURRENCY}`));
      } else if (c.cases) {
        extra.push(stat('Cases handled', cases == null ? '—' : nfFull.format(cases), 'Number of reports in the monthly files'));
        extra.push(stat('Incentive per case', cases ? compact(s.incentives / cases) : '—', `${CURRENCY} · incentives ÷ cases`));
      }
      el.innerHTML = `<div class="dh-main">${back}<h2>${title}</h2>
          <p>${people} · incentives ${compact(s.incentives)} ${CURRENCY}${cases != null ? ` · ${nfFull.format(cases)} cases` : ''}
          · ${state.dept ? `${pct(safeDiv(s.incentives, pool.incentives))} of ${esc(c.short)}` : `${pct(safeDiv(s.incentives, allInc))} of all incentives paid`}</p></div>
        <div class="dh-stats">
          ${stat('Total incentives', compact(s.incentives), state.dept ? `${pct(safeDiv(s.incentives, pool.incentives))} of the programme` : `${selection().label}`)}
          ${extra.length ? extra.join('') : stat('Incentives ÷ salaries', pct(s.incRate), state.dept ? `Programme: ${pct(pool.incRate)}` : `Salaries ${compact(s.salary)}`)}
          ${extra.length ? '' : c.perDept
    ? stat('Average incentive / department', compact(safeDiv(s.incentives, unitsN)), state.dept ? `Programme: ${compact(safeDiv(pool.incentives, new Set(catRows.map((r) => r.specialty)).size))}` : plural(unitsN, 'department', 'departments'))
    : stat('Average incentive / person', compact(safeDiv(s.incentives, s.doctors)), state.dept ? `Programme: ${compact(safeDiv(pool.incentives, pool.doctors))}` : `${s.doctors} people`)}
          ${stat('Share of all incentives', pct(safeDiv(s.incentives, allInc)), 'All categories, selected period')}
        </div>`;
      return;
    }

    if (!state.dept) {
      // Category page: its size and weight in the hospital.
      const cat = agg(catRows);
      const units = new Set(catRows.map((r) => r.specialty)).size;
      const sub = state.cat === 'residents'
        ? `${cat.doctors} residents / registrars in ${units} specialties · ${pct(safeDiv(cat.cost, hosp.cost))} of the hospital’s staff cost`
        : `${cat.doctors} staff in ${plural(units, c.unit === 'department' ? 'department' : 'specialty', c.unit === 'department' ? 'departments' : 'specialties')} · ${pct(safeDiv(cat.revenue, hosp.revenue))} of revenue · ${pct(safeDiv(cat.cost, hosp.cost))} of staff cost`;
      const opdInc = agg(branchRows.filter((r) => r.category === 'opd')).incentives;
      el.innerHTML = `<div class="dh-main">${back}<h2>${esc(c.label)}</h2><p>${sub}</p></div>
        <div class="dh-stats">${state.cat === 'residents'
    ? `${cmp('Average cost / person / month', safeDiv(cat.cost, cat.n), safeDiv(hosp.cost, hosp.n), compact, false)}
           <div class="dh-stat"><span>Incentives</span><b>${compact(cat.incentives)}</b><small>${pct(safeDiv(cat.incentives, opdInc))} of OPD doctors’ incentives</small></div>
           ${cmp('Incentive ÷ salary', cat.incRate, hosp.incRate, (v) => pct(v), false)}
           <div class="dh-stat"><span>Salaries</span><b>${compact(cat.salary)}</b><small>${pct(safeDiv(cat.salary, hosp.salary))} of all salaries</small></div>`
    : `${cmp('Revenue per person', cat.revPerDoc, hosp.revPerDoc, compact)}
           ${cmp('Revenue ÷ staff cost', cat.roi, hosp.roi, times)}
           ${cmp('Incentive ÷ salary', cat.incRate, hosp.incRate, (v) => pct(v), false)}
           <div class="dh-stat"><span>Target achievement</span><b>${cat.targetSum ? pct(cat.achievement, 0) : '—'}</b><small>${cat.targetSum ? `${compact(cat.revWithTarget)} of ${compact(cat.targetSum)}` : 'No targets yet'}</small></div>`}</div>`;
      return;
    }

    // Specialty / department page.
    const unitRows = catRows;
    const specs = groupBy(unitRows, 'specialty').sort((a, b) => b.revenue - a.revenue);
    const rank = specs.findIndex((g) => g.key === state.dept) + 1;
    const dep = agg(unitRows.filter((r) => r.specialty === state.dept));
    const catAgg = agg(unitRows);
    const ref = c.short;
    // selected months where this department's file had no figures above the table (revenue, target)
    const gaps = monthsMissingFigures(state.rows.filter((r) => inBranch(r) && r.category === state.cat))
      .filter(([p, d]) => d.has(state.dept) && state.months.has(p)).map(([p]) => periodLabel(p));
    if (gaps.length && !dep.revenue) { dep.revPerDoc = null; dep.roi = null; }
    if (state.cat === 'residents') {
      const opd = agg(branchRows.filter((r) => r.category === 'opd' && r.specialty === state.dept));
      el.innerHTML = `<div class="dh-main">${back}<h2>${esc(state.dept)} <small class="dh-kind">residents / registrars</small></h2>
          <p>${dep.doctors} resident${dep.doctors === 1 ? '' : 's'} · cost ${compact(dep.cost)} · incentives ${compact(dep.incentives)}
          (${pct(safeDiv(dep.incentives, opd.incentives))} of this specialty’s OPD incentives)</p></div>
        <div class="dh-stats">
          ${cmp('Average salary', safeDiv(dep.salary, dep.n), safeDiv(catAgg.salary, catAgg.n), compact, false, 'All residents')}
          ${cmp('Average incentive', safeDiv(dep.incentives, dep.n), safeDiv(catAgg.incentives, catAgg.n), compact, false, 'All residents')}
          <div class="dh-stat"><span>OPD doctors in ${esc(state.dept)}</span><b>${opd.doctors}</b><small>Revenue ${compact(opd.revenue)}</small></div>
          <div class="dh-stat"><span>Specialty cost incl. residents</span><b>${compact(opd.cost + dep.cost)}</b><small>Revenue ÷ cost ${times(safeDiv(opd.revenue, opd.cost + dep.cost))}</small></div>
        </div>`;
      return;
    }
    const res = state.cat === 'opd' ? agg(branchRows.filter((r) => r.category === 'residents' && r.specialty === state.dept)) : null;
    const resLine = res && res.n
      ? ` · residents: ${res.doctors} (cost ${compact(res.cost)}, ${pct(safeDiv(res.incentives, dep.incentives))} of these incentives)` : '';
    el.innerHTML = `
      <div class="dh-main">${back}
        <h2>${esc(state.dept)}</h2>
        <p>${dep.doctors} ${state.cat === 'allied' ? 'staff' : `doctor${dep.doctors === 1 ? '' : 's'}`} · ${rank ? `#${rank} of ${specs.length} ${c.unit === 'department' ? 'departments' : 'specialties'} by revenue` : 'no data in the selected months'}
          · ${pct(safeDiv(dep.revenue, hosp.revenue))} of hospital revenue · ${pct(safeDiv(dep.cost, hosp.cost))} of staff cost${resLine}</p>
      </div>
      <div class="dh-stats">
        ${cmp('Revenue per person', dep.revPerDoc, catAgg.revPerDoc, compact, true, ref)}
        ${cmp('Revenue ÷ staff cost', dep.roi, catAgg.roi, times, true, ref)}
        ${cmp('Incentive ÷ salary', dep.incRate, catAgg.incRate, (v) => pct(v), false, ref)}
        ${res && res.n
    ? `<div class="dh-stat"><span>Revenue ÷ cost incl. residents</span><b>${times(safeDiv(dep.revenue, dep.cost + res.cost))}</b><small>Cost with residents ${compact(dep.cost + res.cost)}</small></div>`
    : `<div class="dh-stat"><span>Target achievement</span><b>${dep.targetSum ? pct(dep.achievement, 0) : '—'}</b><small>${gaps.length ? `No department figures in the file for ${gaps.join(', ')}` : dep.targetSum ? `${compact(dep.revWithTarget)} of ${compact(dep.targetSum)}` : 'No targets yet'}</small></div>`}
      </div>`;
  }

  /** A combined view: the categories in it (each removable), and what each brings to the total. */
  function renderMixHeader(el) {
    const cats = CATS.filter((c) => state.mix.has(c.key));
    const rows = state.rows.filter((r) => inBranch(r) && inPeriod(r) && state.mix.has(r.category));
    const all = agg(rows);
    const hosp = agg(state.rows.filter((r) => inBranch(r) && inPeriod(r) && !isCensusCat(r.category)));
    el.classList.remove('hidden');
    el.style.borderLeftColor = 'var(--accent)';
    const measured = cats.filter((c) => c.measure);
    el.innerHTML = `<div class="dh-main"><nav class="dh-crumbs" aria-label="Breadcrumb"><a href="#/">Hospital overview</a><span class="sep">›</span><span>Combined view</span></nav>
        <h2>${cats.map((c) => esc(c.short)).join(' + ')}</h2>
        <div class="mix-chips">${cats.map((c) => `<span class="mix-chip" style="--c:var(${c.color})"><i></i>${esc(c.label)}<button type="button" data-unpick="${c.key}" aria-label="Take ${esc(c.short)} out" title="Take it out">×</button></span>`).join('')}</div>
        <p>${nfFull.format(all.doctors)} people · incentives ${compact(all.incentives)} ${CURRENCY} · salaries ${compact(all.salary)} · staff cost ${compact(all.cost)}${all.revenue ? ` · revenue ${compact(all.revenue)}` : ''} · ${pct(safeDiv(all.incentives, hosp.incentives), 0)} of all incentives paid${measured.length ? ` · ${measured.map((c) => c.short).join(' and ')} ${measured.length > 1 ? 'are' : 'is'} measured on ${measured.map((c) => c.measure.toLowerCase()).join(' / ')}, shown on ${measured.length > 1 ? 'their' : 'its'} own page` : ''}</p></div>
      <div class="dh-stats mix-stats">${cats.map((c) => {
        const a = agg(rows.filter((r) => r.category === c.key));
        return `<div class="dh-stat" style="--c:var(${c.color})"><span><i></i>${esc(c.short)}</span><b>${compact(a.incentives)}</b><small>${pct(safeDiv(a.incentives, all.incentives), 0)} of these incentives · cost ${compact(a.cost)}</small><em class="mix-bar"><i style="width:${Math.round((safeDiv(a.incentives, all.incentives) || 0) * 100)}%"></i></em></div>`;
      }).join('')}</div>`;
  }
  $('#deptHeader').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unpick]');
    if (b) togglePick(b.dataset.unpick);
  });

  /** Overview: one tile per staff category. */
  function renderCatTiles() {
    if (state.cat) return;
    const rows = state.rows.filter((r) => inBranch(r) && inPeriod(r));
    const opdInc = agg(rows.filter((r) => r.category === 'opd')).incentives;
    const allInc = agg(rows.filter((r) => !isCensusCat(r.category))).incentives;
    // A category with files for other months just had nothing in these months (e.g. the quarterly incentive in July).
    const everHas = (href) => { const k = decodeURIComponent(href.split('/')[2] || ''); return state.rows.some((r) => inBranch(r) && (r.category === k || catOf(r.category)?.group === k)); };
    const tile = (href, color, label, sub, lines, has) => `<a class="cat-tile ${has ? '' : 'empty'}" href="${href}">
        <h3><i style="background:var(${color})"></i>${esc(label)}</h3>
        <div class="ct-sub">${has ? sub : everHas(href) ? `Nothing paid in ${esc(selection().label)}` : 'No data yet — upload its files'}</div>
        <dl>${lines.map(([k, v]) => `<dt>${k}</dt><dd>${has ? v : '—'}</dd>`).join('')}</dl></a>`;
    const medical = CATS.filter((c) => c.group === 'medical').map((c) => {
      const a = agg(rows.filter((r) => r.category === c.key));
      const units = new Set(rows.filter((r) => r.category === c.key).map((r) => r.specialty)).size;
      const lines = c.key === 'residents'
        ? [['Salaries', compact(a.salary)], ['Incentives', compact(a.incentives)], ['Share of OPD incentives', pct(safeDiv(a.incentives, opdInc))], ['Total cost', compact(a.cost)]]
        : [['Revenue', compact(a.revenue)], ['Staff cost', compact(a.cost)], ['Net contribution', compact(a.contribution)], ['Revenue ÷ cost', times(a.roi)],
          ['Target achievement', a.targetSum ? pct(a.achievement, 0) : '—']];
      return tile(catHref(c.key), c.color, c.label, `${a.doctors} ${a.doctors === 1 ? 'person' : 'people'} · ${units} ${units === 1 ? c.unit : pluralUnit(c.unit)}`, lines, rows.some((r) => r.category === c.key)); // department rows count too (no people)
    });
    // Separate incentives: one tile, a line per programme (each links to its page from the menu).
    const sep = CATS.filter((c) => c.group === 'separate');
    const sepRows = rows.filter((r) => catOf(r.category)?.group === 'separate');
    const sepAgg = agg(sepRows);
    const sepTile = tile(catHref(sep.find((c) => rows.some((r) => r.category === c.key))?.key || 'bd'), '--s4', 'Separate Incentives',
      `${sepAgg.doctors} people · ${pct(safeDiv(sepAgg.incentives, allInc))} of all incentives`,
      [...sep.map((c) => [c.short, compact(agg(sepRows.filter((r) => r.category === c.key)).incentives)]), ['Total', compact(sepAgg.incentives)]], sepAgg.n > 0);
    const qc = catOf('quarterly');
    const qa = agg(rows.filter((r) => r.category === 'quarterly').map((r) => ({ ...r, _basis: false })));
    const qTile = tile(catHref('quarterly'), qc.color, qc.label, `${qa.doctors} people · ${new Set(rows.filter((r) => r.category === 'quarterly').map((r) => r.specialty)).size} departments`,
      [['Incentives', compact(qa.incentives)], ['Salaries', compact(qa.salary)], ['Incentives ÷ salaries', pct(qa.incRate)], ['Share of all incentives', pct(safeDiv(qa.incentives, allInc))]], qa.n > 0);
    // Census is workload, not money: its tile shows counts.
    const cc = catOf('census');
    const ca = agg(rows.filter((r) => r.category === 'census'));
    const cTile = tile(catHref('census'), cc.color, cc.label, `${ca.doctors} doctors`,
      [['OPD visits', nfFull.format(ca.visits)], ['Admissions', nfFull.format(ca.admissions)], ...(hasOperations() ? [['Operations', nfFull.format(ca.operations)]] : []),
        ['Admissions per 100 visits', ca.visits ? (ca.admissions / ca.visits * 100).toFixed(1) : '—']], ca.n > 0);
    const oc = catOf('other');
    const oRows = rows.filter((r) => r.category === 'other');
    const oa = agg(oRows);
    const oTop = reasonsOf(oRows)[0];
    const oTile = tile(catHref('other'), oc.color, oc.label, `${plural(deptCount(oRows), 'department', 'departments')} · ${plural(reasonsOf(oRows).length, 'reason', 'reasons')}`,
      [['Incentives', compact(oa.incentives)], ['Salaries', compact(oa.salary)], ['Incentives ÷ salaries', pct(oa.incRate)],
        ['Main reason', oTop ? esc(oTop[0]) : '—'], ['Share of all incentives', pct(safeDiv(oa.incentives, allInc))]], oRows.length > 0);
    // a combined view: only its categories' tiles
    const keep = (keys) => !state.mix || keys.some((k) => state.mix.has(k));
    const medKeys = CATS.filter((c) => c.group === 'medical').map((c) => c.key);
    $('#catTiles').innerHTML = [...medical.filter((t, i) => keep([medKeys[i]])), keep(sep.map((c) => c.key)) ? sepTile : '', keep(['quarterly']) ? qTile : '', keep(['other']) ? oTile : '', state.mix ? '' : cTile].join('');
  }

  /** Overview with "All branches": the two branches side by side. */
  function renderBranchTable() {
    const show = !state.cat && state.branch === 'all';
    $('#branchCard').classList.toggle('hidden', !show);
    if (!show) return;
    const rows = state.rows.filter((r) => inPeriod(r) && !isCensusCat(r.category) && (!state.mix || state.mix.has(r.category))); // as the overview totals
    const line = (name, a) => `<tr data-branch="${esc(name)}"><td class="name">${esc(name)}</td>${a.n
      ? `<td class="num">${a.doctors}</td><td class="num">${money(a.revenue)}</td><td class="num">${money(a.salary)}</td><td class="num">${money(a.incentives)}</td>
         <td class="num">${money(a.contribution)}</td><td class="num">${times(a.roi)}</td><td class="num">${a.targetSum ? pct(a.achievement, 0) : '—'}</td>`
      : '<td colspan="7" class="muted">No data yet — upload this branch’s files</td>'}</tr>`;
    $('#branchTable').innerHTML = `<thead><tr><th>Branch</th><th class="num">Staff</th><th class="num">Revenue</th><th class="num">Salaries</th>
      <th class="num">Incentives</th><th class="num">Net contribution</th><th class="num">Rev ÷ cost</th><th class="num">Target achv.</th></tr></thead>
      <tbody>${BRANCHES.map((b) => line(b, agg(rows.filter((r) => r.branch === b)))).join('')}</tbody>
      <tfoot>${line('Total', agg(rows))}</tfoot>`;
  }
  $('#branchTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-branch]');
    if (!tr || !BRANCHES.includes(tr.dataset.branch)) return;
    $(`#branchSeg button[data-v="${tr.dataset.branch}"]`).click();
  });

  function renderKpis() {
    const a = agg(filtered);
    const sel = selection();
    let prev = null;
    let prevRows = [];
    if (sel.kind === 'month') {
      // Compare with the calendar month before (only if its file exists), never a distant month.
      const [yy, mm] = sel.month.split('-').map(Number);
      const pp = mm === 1 ? `${yy - 1}-12` : `${yy}-${pad2(mm - 1)}`;
      if (state.periods.includes(pp)) {
        prevRows = state.rows.filter((r) => matches(r, { skipPeriod: true }) && r.period === pp);
        // nothing on this page that month (e.g. Legal is paid every 3 months): nothing to compare with
        if (prevRows.length) { prev = agg(prevRows); prev.label = periodLabel(pp); }
      }
    } else if (sel.kind === 'quarter') {
      // Quarter vs the quarter before (Q1 compares with Q4 of the previous year).
      const [py, pq] = sel.q === 1 ? [Number(sel.year) - 1, 4] : [Number(sel.year), sel.q - 1];
      prevRows = state.rows.filter((r) => matches(r, { skipPeriod: true }) && yearOf(r.period) === String(py) && quarterOf(r.period) === pq);
      if (prevRows.length) { prev = agg(prevRows); prev.label = `Q${pq} ${py}`; }
    } else if (sel.kind === 'year') {
      const py = String(Number(sel.year) - 1);
      prevRows = state.rows.filter((r) => matches(r, { skipPeriod: true }) && r.period.startsWith(`${py}-`));
      if (prevRows.length) { prev = agg(prevRows); prev.label = py; }
    }
    const c = catOf(state.cat);
    if (c?.cases) {
      a.cases = casesOf(filtered); a.incPerCase = safeDiv(a.incentives, a.cases);
      if (prev) { prev.cases = casesOf(prevRows); prev.incPerCase = safeDiv(prev.incentives, prev.cases); }
    }
    if (c?.team) {
      // One row per month for the whole team: count months instead of people.
      a.months = new Set(filtered.filter((r) => r.incentives > 0).map((r) => r.period)).size;
      if (prev) prev.months = new Set(prevRows.filter((r) => r.incentives > 0).map((r) => r.period)).size;
    }
    // Overview: the quarterly incentive is paid in quarter-end months only — say so next to the incentives.
    a.notes = {};
    if (!state.cat) {
      const qInc = (rows) => rows.filter((r) => r.category === 'quarterly').reduce((x, r) => x + r.incentives, 0);
      const qNow = qInc(filtered);
      const qPrev = prev ? qInc(prevRows) : 0;
      if (qPrev && !qNow) a.notes.incentives = `${prev.label} included ${compact(qPrev)} of quarterly incentive`;
      else if (qNow) a.notes.incentives = `Includes ${compact(qNow)} of quarterly incentive`;
    }
    const units = new Set(filtered.filter((r) => !r._basis).map((r) => r.specialty)).size;
    const multiMonth = sel.kind !== 'month' && new Set(filtered.map((r) => r.period)).size > 1;
    const whoWord = state.cat ? catOf(state.cat).who : 'staff';
    const who = whoWord[0].toUpperCase() + whoWord.slice(1);
    const unitWord = state.cat ? pluralUnit(catOf(state.cat).unit) : 'specialties & departments';
    const perMonth = multiMonth ? ' / month' : '';
    a.costPerHead = safeDiv(a.cost, a.n);
    const common = [
      catOf(state.cat)?.perDept
        ? { label: 'Departments', v: nfFull.format(units), foot: state.dept ? `${state.dept}` : 'Departments paid in the selection', key: 'depts', type: 'num' }
        : { label: who, v: nfFull.format(a.doctors), foot: state.dept ? `${state.dept}` : `${units} ${units === 1 && state.cat ? catOf(state.cat).unit : unitWord}`, key: 'doctors', type: 'num' },
    ];
    if (isCensusCat(state.cat)) {
      // Workload view. Revenue per visit uses the same doctors' OPD revenue in the same months.
      const people = new Set(filtered.map((r) => `${personKey(r)}|${r.period}`));
      const opdRev = state.rows.filter((r) => r.category === 'opd' && people.has(`${personKey(r)}|${r.period}`)).reduce((s, r) => s + r.revenue, 0);
      a.visitsPerDoc = safeDiv(a.visits, a.n); a.admRate = safeDiv(a.admissions, a.visits); a.opsPerDoc = safeDiv(a.operations, a.n);
      a.revPerVisit = safeDiv(opdRev, a.visits);
      if (prev) { prev.visitsPerDoc = safeDiv(prev.visits, prev.n); prev.admRate = safeDiv(prev.admissions, prev.visits); prev.opsPerDoc = safeDiv(prev.operations, prev.n); }
      const ops = hasOperations();
      a.admPerDoc = safeDiv(a.admissions, a.n);
      if (prev) prev.admPerDoc = safeDiv(prev.admissions, prev.n);
      renderKpiTiles(a, prev, [
        ...common,
        { label: 'OPD visits', v: nfFull.format(a.visits), key: 'visits', type: 'pctchg', good: 1 },
        { label: 'Admissions', v: nfFull.format(a.admissions), key: 'admissions', type: 'pctchg', good: 1 },
        ops ? { label: 'Operations', v: nfFull.format(a.operations), key: 'operations', type: 'pctchg', good: 1 }
          : { label: 'Admissions per 100 visits', v: a.admRate == null ? '—' : (a.admRate * 100).toFixed(1), key: 'admRate', type: 'pp', footDefault: 'Admissions ÷ OPD visits' },
        { label: `Visits per doctor${perMonth}`, v: a.visitsPerDoc == null ? '—' : a.visitsPerDoc.toFixed(0), key: 'visitsPerDoc', type: 'pctchg', good: 1 },
        ops ? { label: 'Admissions per 100 visits', v: a.admRate == null ? '—' : (a.admRate * 100).toFixed(1), key: 'admRate', type: 'pp', footDefault: 'Admissions ÷ OPD visits' }
          : { label: `Admissions per doctor${perMonth}`, v: a.admPerDoc == null ? '—' : a.admPerDoc.toFixed(1), key: 'admPerDoc', type: 'pctchg', good: 1 },
        ...(ops ? [{ label: `Operations per doctor${perMonth}`, v: a.opsPerDoc == null ? '—' : a.opsPerDoc.toFixed(1), key: 'opsPerDoc', type: 'pctchg', good: 1 }] : []),
        { label: 'Revenue per visit', v: a.revPerVisit == null ? '—' : compact(a.revPerVisit), unit: a.revPerVisit == null ? '' : CURRENCY, key: 'revPerVisit', footDefault: opdRev ? 'Their OPD revenue ÷ visits' : 'Needs OPD revenue for the same doctors' },
      ]);
      return;
    }
    if (c?.measure) {
      // Programme measured on sales / collection against a target.
      const m = c.measure.toLowerCase();
      const head = c.team
        ? [{ label: 'Months with incentives', v: nfFull.format(a.months), foot: `${new Set(filtered.map((r) => r.period)).size} month(s) in the selection`, key: 'months', type: 'pctchg' }]
        : common;
      a.perHead = safeDiv(a.incentives, c.team ? a.months : a.n);
      if (prev) prev.perHead = safeDiv(prev.incentives, c.team ? prev.months : prev.n);
      renderKpiTiles(a, prev, [
        ...head,
        { label: `Actual ${m}`, v: compact(a.revenue), unit: CURRENCY, title: money(a.revenue), key: 'revenue', type: 'pctchg', good: 1 },
        { label: `${c.measure} target`, v: a.targetSum ? compact(a.targetSum) : '—', unit: a.targetSum ? CURRENCY : '', title: a.targetSum ? money(a.targetSum) : '', key: 'targetSum', type: 'pctchg' },
        { label: 'Target achievement', v: a.targetSum ? achFmt(a.achievement) : '—', key: 'achievement', type: 'pp', good: 1, footDefault: `Actual ${m} ÷ target` },
        { label: 'Total incentives', v: compact(a.incentives), unit: CURRENCY, title: money(a.incentives), key: 'incentives', type: 'pctchg' },
        { label: `Incentive ÷ ${m}`, v: pct(a.revRate, 2), key: 'revRate', type: 'pp', footDefault: `Incentives per 100 of ${m}` },
        a.salary
          ? { label: 'Total salaries', v: compact(a.salary), unit: CURRENCY, title: money(a.salary), key: 'salary', type: 'pctchg' }
          : { label: `Average incentive${perMonth}`, v: compact(a.perHead), unit: CURRENCY, key: 'perHead', type: 'pctchg' },
        a.salary
          ? { label: 'Incentive ÷ salary', v: pct(a.incRate), key: 'incRate', type: 'pp' }
          : { label: `${c.measure} per person${perMonth}`, v: compact(a.revPerDoc), unit: CURRENCY, key: 'revPerDoc', type: 'pctchg', good: 1 },
      ]);
      return;
    }
    if (c?.cases) {
      a.casesPerHead = safeDiv(a.cases, a.n); a.avgInc = safeDiv(a.incentives, a.n);
      if (prev) { prev.casesPerHead = safeDiv(prev.cases, prev.n); prev.avgInc = safeDiv(prev.incentives, prev.n); }
      renderKpiTiles(a, prev, [
        ...common,
        { label: 'Cases handled', v: a.cases == null ? '—' : nfFull.format(a.cases), key: 'cases', type: 'pctchg', good: 1, footDefault: 'Number of reports in the monthly files' },
        { label: 'Incentive per case', v: a.incPerCase == null ? '—' : compact(a.incPerCase), unit: a.incPerCase == null ? '' : CURRENCY, key: 'incPerCase', type: 'pctchg', footDefault: 'Incentives ÷ cases' },
        { label: 'Total incentives', v: compact(a.incentives), unit: CURRENCY, title: money(a.incentives), key: 'incentives', type: 'pctchg' },
        { label: 'Total salaries', v: compact(a.salary), unit: CURRENCY, title: money(a.salary), key: 'salary', type: 'pctchg' },
        { label: 'Incentive ÷ salary', v: pct(a.incRate), key: 'incRate', type: 'pp' },
        { label: `Cases per person${perMonth}`, v: a.casesPerHead == null ? '—' : a.casesPerHead.toFixed(0), key: 'casesPerHead', type: 'pctchg', good: 1 },
        { label: `Average incentive${perMonth}`, v: compact(a.avgInc), unit: CURRENCY, key: 'avgInc', type: 'pctchg' },
      ]);
      return;
    }
    if (c?.other) {
      // Other incentives: paid to departments, each for a reason.
      const figs = (rows) => {
        const reasons = reasonsOf(rows);
        const depts = deptCount(rows);
        return { depts, reasonsN: reasons.length, payments: rows.length, perDept: safeDiv(rows.reduce((x, r) => x + r.incentives, 0), depts), topShare: reasons.length ? safeDiv(reasons[0][1], rows.reduce((x, r) => x + r.incentives, 0)) : null, top: reasons[0] };
      };
      Object.assign(a, figs(filtered));
      if (prev) Object.assign(prev, figs(prevRows));
      renderKpiTiles(a, prev, [
        { label: 'Total incentives', v: compact(a.incentives), unit: CURRENCY, title: money(a.incentives), key: 'incentives', type: 'pctchg' },
        { label: 'Total salaries', v: compact(a.salary), unit: CURRENCY, title: money(a.salary), key: 'salary', type: 'pctchg' },
        { label: 'Incentive ÷ salary', v: pct(a.incRate), key: 'incRate', type: 'pp' },
        { label: 'Departments', v: nfFull.format(a.depts), key: 'depts', type: 'pctchg', footDefault: 'Departments paid' },
        { label: 'Average per department', v: compact(a.perDept), unit: CURRENCY, key: 'perDept', type: 'pctchg', footDefault: 'Incentives ÷ departments' },
        { label: 'Reasons', v: nfFull.format(a.reasonsN), key: 'reasonsN', type: 'pctchg', footDefault: 'Different reasons paid for' },
        { label: 'Main reason', v: a.top ? `<span class="clamp" title="${esc(a.top[0])}">${esc(a.top[0])}</span>` : '—', key: 'mainReason', footDefault: a.top ? `${compact(a.top[1])} ${CURRENCY} · ${pct(a.topShare, 0)} of the total` : 'From the Reason column' },
        { label: 'Payments', v: nfFull.format(a.payments), key: 'payments', type: 'pctchg', footDefault: 'Lines in the files (department × reason)' },
      ]);
      return;
    }
    const tiles = state.hasRevenue ? [
      ...common,
      { label: 'Total revenue', v: compact(a.revenue), unit: CURRENCY, title: money(a.revenue), key: 'revenue', type: 'pctchg', good: 1 },
      { label: 'Total salaries', v: compact(a.salary), unit: CURRENCY, title: money(a.salary), key: 'salary', type: 'pctchg' },
      { label: 'Total incentives', v: compact(a.incentives), unit: CURRENCY, title: money(a.incentives), key: 'incentives', type: 'pctchg' },
      { label: 'Incentive ÷ salary', v: pct(a.incRate), key: 'incRate', type: 'pp' },
      { label: 'Incentive ÷ revenue', v: pct(a.revRate, 2), key: 'revRate', type: 'pp' },
      { label: `Revenue per person${perMonth}`, v: compact(a.revPerDoc), unit: CURRENCY, title: money(a.revPerDoc), key: 'revPerDoc', type: 'pctchg', good: 1 },
      { label: 'Revenue ÷ staff cost', v: times(a.roi), key: 'roi', type: 'pctchg', good: 1, footDefault: 'Revenue per 1 of salary + incentives' },
    ] : [
      // No revenue (residents): cost and incentive view.
      ...common,
      { label: 'Total salaries', v: compact(a.salary), unit: CURRENCY, title: money(a.salary), key: 'salary', type: 'pctchg' },
      { label: 'Total incentives', v: compact(a.incentives), unit: CURRENCY, title: money(a.incentives), key: 'incentives', type: 'pctchg' },
      { label: 'Total cost', v: compact(a.cost), unit: CURRENCY, title: money(a.cost), key: 'cost', type: 'pctchg', footDefault: 'Salary + incentives' },
      { label: 'Incentive ÷ salary', v: pct(a.incRate), key: 'incRate', type: 'pp' },
      { label: `Cost per ${c?.perDept ? 'department' : 'person'}${perMonth}`, v: compact(a.costPerHead), unit: CURRENCY, title: money(a.costPerHead), key: 'costPerHead', type: 'pctchg' },
      { label: `Average salary${c?.perDept ? ' per department' : ''}${perMonth}`, v: compact(safeDiv(a.salary, a.n)), unit: CURRENCY, key: 'avgSalary', type: 'pctchg' },
      { label: `Average incentive${c?.perDept ? ' per department' : ''}${perMonth}`, v: compact(safeDiv(a.incentives, a.n)), unit: CURRENCY, key: 'avgInc', type: 'pctchg' },
    ];
    a.avgSalary = safeDiv(a.salary, a.n); a.avgInc = safeDiv(a.incentives, a.n);
    if (prev) { prev.costPerHead = safeDiv(prev.cost, prev.n); prev.avgSalary = safeDiv(prev.salary, prev.n); prev.avgInc = safeDiv(prev.incentives, prev.n); }
    renderKpiTiles(a, prev, tiles);
  }
  const pluralUnit = (u) => ({ specialty: 'specialties', department: 'departments', section: 'sections' }[u] || `${u}s`);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  /** A KPI's value for one month group (for its sparkline): the aggregate's own field, or derived the same way as the tile. */
  function kpiValue(key, g) {
    if (typeof g[key] === 'number' || g[key] === null) return g[key];
    const n = g.n;
    switch (key) {
      case 'costPerHead': return safeDiv(g.cost, n);
      case 'avgSalary': return safeDiv(g.salary, n);
      case 'avgInc': case 'perHead': return safeDiv(g.incentives, n);
      case 'visitsPerDoc': return safeDiv(g.visits, n);
      case 'admRate': return safeDiv(g.admissions, g.visits);
      case 'opsPerDoc': return safeDiv(g.operations, n);
      case 'admPerDoc': return safeDiv(g.admissions, n);
      case 'cases': return casesOf(g.rows);
      case 'incPerCase': return safeDiv(g.incentives, casesOf(g.rows));
      case 'casesPerHead': return safeDiv(casesOf(g.rows), n);
      default: return undefined;
    }
  }
  /** 12-point trend line (de-emphasis grey) with the selected period's point in the accent. */
  function sparkline(values, hi) {
    const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v != null && Number.isFinite(p.v));
    if (pts.length < 3) return '';
    const W = 88; const H = 30; const pad = 4;
    const min = Math.min(...pts.map((p) => p.v)); const max = Math.max(...pts.map((p) => p.v));
    const x = (i) => pad + (i / Math.max(1, values.length - 1)) * (W - pad * 2);
    const y = (v) => (max === min ? H / 2 : H - pad - ((v - min) / (max - min)) * (H - pad * 2));
    let d = ''; let prev = -2;
    for (const p of pts) { d += `${p.i === prev + 1 ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`; prev = p.i; }
    const dot = pts.find((p) => p.i === hi) || pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/><circle cx="${x(dot.i).toFixed(1)}" cy="${y(dot.v).toFixed(1)}" r="3.5"/></svg>`;
  }

  /**
   * KPI tiles: the four headline figures first and largest (headcount last of them), the ratios
   * below. Each shows the change vs the previous month / quarter / year, a trend line over the
   * months on the timeline, and — for revenue — progress against target.
   */
  function renderKpiTiles(a, prev, tiles) {
    // Headcount is context, not the headline: move it to the end of the first row.
    if (tiles.length > 4 && ['doctors', 'months'].includes(tiles[0].key)) tiles = [...tiles.slice(1, 4), tiles[0], ...tiles.slice(4)];
    // Trend up to the selected period (a later month, e.g. one programme paid ahead, is not history yet).
    const allMonths = fillMonths(groupBy(state.rows.filter((r) => matches(r, { skipPeriod: true })), 'period'));
    const selIdx = allMonths.map((g, i) => (state.months.has(g.key) ? i : -1)).filter((i) => i >= 0);
    const hi = selIdx.length ? selIdx[selIdx.length - 1] : allMonths.length - 1;
    const months = allMonths.slice(Math.max(0, hi - 11), hi + 1); // at most 12 points
    const notes = a.notes || {};
    $('#kpis').innerHTML = tiles.map((t, idx) => {
      let foot = t.foot || t.footDefault || '';
      if (prev && t.key !== 'doctors' && prev[t.key] != null && a[t.key] != null) {
        let d; let txt;
        if (t.type === 'pp') { d = Math.round((a[t.key] - prev[t.key]) * 1000) / 10; txt = `${d > 0 ? '+' : ''}${d.toFixed(1)} pp`; }
        else { d = safeDiv(a[t.key] - prev[t.key], prev[t.key]); if (d != null) d = Math.round(d * 1000) / 1000; txt = d == null ? '' : `${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%`; }
        if (txt) {
          // colour only where up is clearly good or bad; the arrow always shows the direction
          const cls = !t.good ? '' : d > 0 ? 'up' : d < 0 ? 'down' : '';
          const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '';
          foot = `<span class="delta ${cls}">${arrow} ${txt}</span> vs ${prev.label}`;
        }
      } else if (prev && t.key === 'doctors') {
        const d = a.doctors - prev.doctors;
        foot = `${t.foot} · ${d >= 0 ? '+' : ''}${d} vs ${prev.label}`;
      }
      const primary = idx < 4;
      const series = months.length >= 3 && kpiValue(t.key, months[0] || {}) !== undefined ? months.map((g) => kpiValue(t.key, g)) : null;
      // Revenue against target: the progress bar says at a glance how close it is.
      const target = t.key === 'revenue' && a.targetSum > 0
        ? `<div class="kpi-progress ${a.achievement >= 1 ? 'over' : ''}" title="${achFmt(a.achievement)} of the target (${money(a.revWithTarget)} of ${money(a.targetSum)} ${CURRENCY})"><i style="width:${Math.min(100, (a.achievement || 0) * 100).toFixed(1)}%"></i></div>
           <div class="ctx"><b>${achFmt(a.achievement)}</b> of ${compact(a.targetSum)} target</div>` : '';
      return `<div class="kpi ${primary ? 'primary' : 'secondary'}" ${t.title ? `title="${t.title} ${CURRENCY}"` : ''}>
        <div class="label">${t.label}</div>
        <div class="value-row"><div class="value">${t.v}${t.unit && t.v !== '—' ? `<small>${t.unit}</small>` : ''}</div>${series ? sparkline(series, months.length - 1) : ''}</div>
        ${target}
        <div class="foot">${foot}</div>
        ${notes[t.key] ? `<div class="note">${notes[t.key]}</div>` : ''}</div>`;
    }).join('');
  }

  // ---------------- key insights ----------------
  /** The comparison period the KPI tiles use: the month / quarter / year before the selection. */
  function previousPeriod() {
    const sel = selection();
    let rows = []; let label = '';
    if (sel.kind === 'month') {
      const [yy, mm] = sel.month.split('-').map(Number);
      const pp = mm === 1 ? `${yy - 1}-12` : `${yy}-${pad2(mm - 1)}`;
      if (state.periods.includes(pp)) { rows = state.rows.filter((r) => matches(r, { skipPeriod: true }) && r.period === pp); label = periodLabel(pp); }
    } else if (sel.kind === 'quarter') {
      const [py, pq] = sel.q === 1 ? [Number(sel.year) - 1, 4] : [Number(sel.year), sel.q - 1];
      rows = state.rows.filter((r) => matches(r, { skipPeriod: true }) && yearOf(r.period) === String(py) && quarterOf(r.period) === pq);
      label = `Q${pq} ${py}`;
    } else if (sel.kind === 'year') {
      const py = String(Number(sel.year) - 1);
      rows = state.rows.filter((r) => matches(r, { skipPeriod: true }) && r.period.startsWith(`${py}-`));
      label = py;
    }
    return rows.length ? { rows, label } : null;
  }

  /**
   * A few plain sentences on what stands out, each computed from the rows on screen (the same
   * aggregates as the tiles and charts). Nothing is shown that the data doesn't support.
   */
  function renderInsights() {
    const list = [];
    const add = (tone, html) => list.push({ tone, html });
    const c = catOf(state.cat);
    const sel = selection();
    const cur = agg(filtered);
    const pv = previousPeriod();
    const p = pv ? agg(pv.rows) : null;
    const unit = state.dept ? 'person' : c ? c.unit : 'specialty';
    const units = state.dept ? 'people' : c ? pluralUnit(c.unit) : 'specialties';
    const R = revLabel();
    const link = (name) => `<a href="${unitHref(name)}"><b>${esc(name)}</b></a>`;
    const who = (d) => `<b>${esc(d.name)}</b>`;
    const chg = (now, before) => { const d = safeDiv(now - before, before); return d == null ? null : d; };
    const sgn = (d, digits = 1) => `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(digits)}%`;
    const ico = { pos: '▲', neg: '▼', info: 'i', neu: '•' };
    // units (or people inside a specialty) of the current and previous period
    const groupsOf = (rows) => (state.dept
      ? byDoctor(rows).map((d) => ({ key: d.key, name: d.name, revenue: d.revenue, incentives: d.incentives, targetSum: d.target || 0, revWithTarget: d.revWithTarget, achievement: d.achievement, visits: d.visits, ref: d }))
      : groupBy(rows, 'specialty').map((g) => ({ ...g, name: g.key })));
    const nameOf = (g) => (state.dept ? who(g) : link(g.name));
    const now = groupsOf(filtered);
    const before = pv ? new Map(groupsOf(pv.rows).map((g) => [state.dept ? g.key : g.name, g])) : null;

    if (!filtered.length) {
      add('neu', `No data for <b>${esc(sel.label)}</b> with the current filters — a month without a file means nothing was paid.`);
    } else if (isCensusCat(state.cat)) {
      if (p && p.visits) { const d = chg(cur.visits, p.visits); add(d >= 0 ? 'pos' : 'neg', `<b>${nfFull.format(cur.visits)} OPD visits</b>, ${sgn(d)} vs ${pv.label} (${nfFull.format(p.visits)}).`); }
      const top = [...now].sort((a, b) => b.visits - a.visits)[0];
      if (top && cur.visits && !state.dept) add('info', `${nameOf(top)} has the most visits: ${nfFull.format(top.visits)} (${pct(safeDiv(top.visits, cur.visits))} of all visits).`);
      if (cur.visits) {
        const rate = cur.admissions / cur.visits * 100;
        const prate = p && p.visits ? p.admissions / p.visits * 100 : null;
        add('info', `<b>${rate.toFixed(1)} admissions per 100 visits</b>${prate != null ? ` (${pv.label}: ${prate.toFixed(1)})` : ''} · ${nfFull.format(cur.admissions)} admissions in total.`);
      }
      const doc = byDoctor(filtered).sort((a, b) => b.visits - a.visits)[0];
      if (doc && doc.visits) add('neu', `Busiest doctor: ${who(doc)} with ${nfFull.format(doc.visits)} visits (${esc(doc.specialty)}).`);
    } else if (state.hasRevenue) {
      // 1. against target
      if (cur.targetSum) {
        const byUnit = deptTargets(filtered); // closed departments: the target is the department's
        const people = byUnit ? groupBy(filtered.filter((r) => r.target), 'specialty') : byDoctor(filtered.filter((r) => r.target));
        const met = people.filter((d) => d.achievement >= 1).length;
        const word = byUnit ? (people.length === 1 ? 'department' : 'departments') : met === 1 ? 'person' : 'people';
        add(cur.achievement >= 1 ? 'pos' : 'neg', `<b>${achFmt(cur.achievement)} of target</b> — ${compact(cur.revWithTarget)} of ${compact(cur.targetSum)} ${CURRENCY}${c?.team ? '' : `; ${met} of ${people.length} ${word} met their target`}.`);
      }
      // 2. change vs the previous period
      if (p && p.revenue) { const d = chg(cur.revenue, p.revenue); add(d >= 0 ? 'pos' : 'neg', `<b>${R} ${sgn(d)}</b> vs ${pv.label}: ${compact(cur.revenue)} against ${compact(p.revenue)}.`); }
      if (!c?.team) {
        // 3. where it comes from
        const earners = now.filter((g) => g.revenue > 0).sort((a, b) => b.revenue - a.revenue);
        if (earners.length > 1) add('info', `${nameOf(earners[0])} brings the most ${R.toLowerCase()}: ${compact(earners[0].revenue)} (${pct(safeDiv(earners[0].revenue, cur.revenue))} of the total).`);
        // 4. biggest movers vs the previous period
        if (before && earners.length > 1) {
          const moves = earners.map((g) => ({ g, d: g.revenue - (before.get(state.dept ? g.key : g.name)?.revenue || 0), had: before.has(state.dept ? g.key : g.name) })).filter((m) => m.had);
          const up = [...moves].sort((a, b) => b.d - a.d)[0];
          const down = [...moves].sort((a, b) => a.d - b.d)[0];
          const parts = [];
          if (up && up.d > 0) parts.push(`biggest increase ${nameOf(up.g)} +${compact(up.d)}`);
          if (down && down.d < 0) parts.push(`biggest drop ${nameOf(down.g)} −${compact(-down.d)}`);
          if (parts.length) add('neu', `vs ${pv.label}: ${parts.join('; ')}.`);
        }
        // 5. furthest below target
        const tg = now.filter((g) => g.targetSum > 0).map((g) => ({ g, a: g.revWithTarget / g.targetSum }));
        if (tg.length > 1) {
          const low = [...tg].sort((a, b) => a.a - b.a)[0];
          const below = tg.filter((x) => x.a < 1).length;
          if (low.a < 1) add('neg', `Furthest below target: ${nameOf(low.g)} at ${achFmt(low.a)} (−${compact(low.g.targetSum - low.g.revWithTarget)}) · ${below} of ${tg.length} ${units} below target.`);
          else add('pos', `Every ${unit} with a target met it in ${esc(sel.label)}.`);
        }
      }
      // 6. what was paid for it
      const q = !state.cat ? filtered.filter((r) => r.category === 'quarterly').reduce((x, r) => x + r.incentives, 0) : 0;
      add('info', `Incentives paid: <b>${compact(cur.incentives)}</b> = ${pct(cur.revRate, 2)} of ${R.toLowerCase()}${p && p.revenue ? ` (${pv.label}: ${pct(p.revRate, 2)})` : ''}${c?.measure ? '' : `; staff cost returns <b>${times(cur.roi)}</b> in ${R.toLowerCase()}`}${q ? ` · includes ${compact(q)} of quarterly incentive` : ''}.`);
    } else {
      // incentive programmes and residents: what was paid, to whom, against salaries
      if (p && p.incentives) { const d = chg(cur.incentives, p.incentives); add('info', `<b>Incentives ${compact(cur.incentives)} ${CURRENCY}</b>, ${sgn(d)} vs ${pv.label} (${compact(p.incentives)}).`); }
      else if (c?.other || c?.perDept) add('info', `<b>Incentives ${compact(cur.incentives)} ${CURRENCY}</b> in ${esc(sel.label)}, paid to ${plural(deptCount(filtered), 'department', 'departments')}.`);
      else add('info', `<b>Incentives ${compact(cur.incentives)} ${CURRENCY}</b> in ${esc(sel.label)}, paid to ${cur.doctors} ${cur.doctors === 1 ? 'person' : 'people'}.`);
      if (c?.other) {
        const rs = reasonsOf(filtered);
        if (rs.length) add('neu', `Paid for ${plural(rs.length, 'reason', 'reasons')}: ${rs.slice(0, 3).map(([k, v]) => `<b>${esc(k)}</b> ${compact(v)} (${pct(safeDiv(v, cur.incentives), 0)})`).join(', ')}${rs.length > 3 ? ', …' : ''}.`);
      }
      const payees = now.filter((g) => g.incentives > 0).sort((a, b) => b.incentives - a.incentives);
      if (payees.length > 1) add('neu', `${nameOf(payees[0])} received the largest share: ${compact(payees[0].incentives)} (${pct(safeDiv(payees[0].incentives, cur.incentives))}).`);
      if (cur.salary) add('neu', `Incentives equal <b>${pct(cur.incRate)}</b> of salaries${p && p.salary ? ` (${pv.label}: ${pct(p.incRate)})` : ''}.`);
      if (c?.cases) {
        const cs = casesOf(filtered); const pcs = pv ? casesOf(pv.rows) : null;
        if (cs) add(pcs && cs < pcs ? 'neg' : 'pos', `<b>${nfFull.format(cs)} cases</b>${pcs ? ` (${sgn(chg(cs, pcs))} vs ${pv.label})` : ''} · incentive per case ${compact(cur.incentives / cs)} ${CURRENCY}${pcs && p.incentives ? ` (${pv.label}: ${compact(p.incentives / pcs)})` : ''}.`);
      }
      if (state.cat === 'residents' && !state.dept) {
        const opd = agg(state.rows.filter((r) => inBranch(r) && inPeriod(r) && r.category === 'opd'));
        if (opd.incentives) add('neu', `Residents’ incentives are <b>${pct(safeDiv(cur.incentives, opd.incentives))}</b> of the OPD doctors’ incentives in the same period.`);
      }
      const top = byDoctor(filtered).sort((a, b) => b.incentives - a.incentives)[0];
      if (top && top.incentives && !c?.team && !c?.basis) add('neu', `Highest individual incentive: ${who(top)} ${compact(top.incentives)} (${esc(top.specialty)}).`);
    }
    $('#insightsNote').textContent = `What stands out in ${sel.label}${pv ? `, compared with ${pv.label}` : ''} · drawn from the data on this page`;
    $('#insights').innerHTML = list.slice(0, 6).map((i) => `<li><span class="ins-ico ${i.tone}">${ico[i.tone]}</span><div>${i.html}</div></li>`).join('');
    $('#insightsCard').classList.toggle('hidden', !list.length);
  }

  /** A section heading shows only when at least one of its cards is on this page. */
  function updateSections() {
    for (const h of $$('#grid .section-title')) {
      let el = h.nextElementSibling;
      let any = false;
      while (el && !el.classList.contains('section-title')) {
        if (el.getClientRects().length) any = true; // display:none (this page doesn't use the card) has no boxes
        el = el.nextElementSibling;
      }
      h.classList.toggle('hidden', !any);
    }
  }

  // ---------------- charts ----------------
  const charts = {};
  function chart(id) {
    if (!charts[id]) {
      const el = document.getElementById(id);
      charts[id] = echarts.init(el, null, { renderer: 'canvas' });
      new ResizeObserver(() => charts[id].resize()).observe(el);
    }
    return charts[id];
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function theme() {
    return {
      text: css('--text'), text2: css('--text-2'), muted: css('--muted'), grid: css('--grid'), axis: css('--axis'),
      surface: css('--surface'), border: css('--border'), s1: css('--s1'), s2: css('--s2'), s3: css('--s3'), neutral: css('--neutral-mark'),
      // What each measure is drawn in, on every chart (see styles.css).
      mRev: css('--m-rev'), mTarget: css('--m-target'), mSalary: css('--m-salary'), mInc: css('--m-inc'),
      pos: css('--pos'), neg: css('--neg'), accentSoft: css('--accent-soft'),
    };
  }
  /**
   * Month axis where the selected months' labels are bold and underlined in the accent — every
   * month's marks stay at full strength, so the trend reads as a whole.
   */
  const monthCatAxis = (t, keys, labels) => {
    const sel = (i) => state.months.size && state.months.size < keys.length && state.months.has(keys[i]);
    return {
      type: 'category', data: labels,
      axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
      axisLabel: {
        color: t.muted, fontSize: 11, hideOverlap: true,
        formatter: (v, i) => (sel(i) ? `{s|${v}}` : v),
        rich: { s: { color: t.text, fontWeight: 700, fontSize: 11, borderColor: css('--accent'), borderWidth: 0, padding: [0, 0, 2, 0] } },
      },
    };
  };
  function base(t) {
    return {
      animationDuration: 250,
      animationDurationUpdate: 250,
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: t.text2 },
      tooltip: {
        backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, padding: [8, 12],
        textStyle: { color: t.text, fontSize: 12.5 },
        extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);',
      },
    };
  }
  const valueAxis = (t, fmt = compact) => ({
    type: 'value',
    axisLabel: { color: t.muted, formatter: fmt, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid } },
    axisLine: { show: false }, axisTick: { show: false },
  });
  const catAxis = (t, data, width = 150) => ({
    type: 'category', data, inverse: true,
    axisLabel: { color: t.text2, fontSize: 11.5, width, overflow: 'truncate' },
    axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
  });
  const tipRow = (color, label, value) =>
    `<div style="display:flex;gap:14px;justify-content:space-between;align-items:center"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>${label}</span><b>${value}</b></div>`;
  const tipHead = (t, d) => `<b>${esc(d.name)}</b><div style="color:${t.muted};margin-bottom:4px">${esc(d.position)} · ${esc(d.specialty)}${d.months > 1 ? ` · ${d.months} months` : ''}</div>`;
  const shadowTip = (t) => ({ ...base(t).tooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.grid, opacity: 0.4 } } });
  function emptyChart(id, msg) {
    const c = chart(id);
    c.clear();
    c.setOption({ title: { text: msg, left: 'center', top: 'middle', textStyle: { color: theme().muted, fontSize: 13, fontWeight: 'normal' } } });
  }
  function setHeight(id, px) {
    const el = document.getElementById(id);
    if (el.style.height !== `${px}px`) { el.style.height = `${px}px`; chart(id).resize(); }
  }
  function niceCeil(v) {
    if (!(v > 0)) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((c) => c >= v);
  }

  function renderCharts() {
    const t = theme();
    renderBreakdown(t);
    renderRanking(t, 'cTop', state.topMetric, 'top');
    renderRanking(t, 'cLow', state.lowMetric, 'low');
    renderShare(t);
    renderIncShare(t);
    renderCensus(t);
    renderMonthly(t);
    renderTri(t);
    renderBestWorst(t);
    renderRevInc(t);
    renderTargets(t);
    renderRoi(t);
    renderPositions(t);
    renderHist(t);
    renderTrend(t);
    renderYtd(t);
    renderAlign(t);
    renderHeat();
    renderUnitCost();
  }

  /** Category of a specialty/department name on the overview (where categories are mixed). */
  function catForUnit(name) {
    const rows = state.rows.filter((r) => r.specialty === name && inBranch(r));
    return (rows.find((r) => r.revenue > 0) || rows[0] || {}).category || 'opd';
  }
  const unitHref = (name) => deptHref(name, state.cat || catForUnit(name));

  /** Overview/category: revenue & cost per specialty or department. Specialty page: per person. Same order in both charts. */
  function renderBreakdown(t) {
    let groups;
    const inDept = !!state.dept;
    const unit = unitOf();
    const rev = state.hasRevenue;
    $('#tRev').textContent = inDept ? (rev ? `${revLabel()} by person` : 'Cost by person') : rev ? `${revLabel()} by ${unit}` : `Headcount by ${unit}`;
    $('#tRevSub').textContent = inDept ? 'Click a bar for details' : `Click a bar to open the ${unit === 'department' ? 'department' : 'page'}`;
    $('#tCost').textContent = inDept ? 'Staff cost by person' : `Staff cost by ${unit}`;
    const order = (a, b) => (rev ? b.revenue - a.revenue : inDept ? b.cost - a.cost : b.doctors - a.doctors || b.cost - a.cost);
    if (inDept) {
      const people = byDoctor(filtered).sort(order);
      // Hundreds of bars can't be read: the largest 30, the rest are in the table below.
      groups = people.slice(0, 30)
        .map((d) => ({ ...d, label: truncate(d.name, 28), cost: d.salary + d.incentives, incRate: d.incentiveRate, value: rev ? d.revenue : d.salary + d.incentives }));
      if (people.length > 30) $('#tRevSub').textContent = `Largest 30 of ${people.length} · the full list is in the table below`;
    } else {
      groups = groupBy(state.rows.filter((r) => matches(r, { skipSpec: true })), 'specialty')
        // Overview: units that earn revenue; programmes without revenue are analysed on their own pages.
        .filter((g) => !rev || state.cat || g.revenue > 0)
        .sort(order).map((g) => ({ ...g, label: g.key, value: rev ? g.revenue : g.doctors }));
    }
    // A single unit would be a one-bar chart: the KPI tiles already carry that number.
    const single = !inDept && groups.length <= 1;
    const noPeopleRev = inDept && rev && !groups.some((g) => g.revenue > 0); // the department's revenue, not theirs
    $('#cRevSpec').closest('article').classList.toggle('hidden', single || noPeopleRev);
    $('#cCost').closest('article').classList.toggle('hidden', single);
    $('#cCost').closest('article').classList.toggle('span-12', noPeopleRev);
    $('#cCost').closest('article').classList.toggle('span-6', !noPeopleRev);
    if (noPeopleRev) groups.sort((a, b) => b.cost - a.cost);
    if (single) return;
    const sel = state.filters.specialties;
    const h = Math.max(320, groups.length * 24 + 70);
    setHeight('cRevSpec', h); setHeight('cCost', h);
    if (!groups.length) { emptyChart('cRevSpec', 'No data for the current filters'); emptyChart('cCost', 'No data'); return; }
    const isOn = (g) => inDept || !sel.size || sel.has(g.key);
    const names = groups.map((g) => g.label);
    const labelW = inDept ? 180 : 150;

    chart('cRevSpec').setOption({
      ...base(t),
      // top matches the cost chart (which has a legend) so both charts' rows line up
      grid: { left: 8, right: 56, top: 28, bottom: 24, containLabel: true },
      tooltip: {
        ...shadowTip(t),
        formatter: (ps) => {
          const g = groups[ps[0].dataIndex];
          if (!rev) {
            return inDept
              ? `${tipHead(t, g)}${tipRow(t.s1, 'Cost', money(g.cost))}${tipRow(t.muted, 'Salary', money(g.salary))}${tipRow(t.muted, 'Incentives', money(g.incentives))}`
              : `<b>${esc(g.key)}</b><br/>${tipRow(t.s1, 'People', g.doctors)}${tipRow(t.muted, 'Cost', money(g.cost))}${tipRow(t.muted, 'Cost / person', compact(safeDiv(g.cost, g.n)))}`;
          }
          return inDept
            ? `${tipHead(t, g)}${tipRow(t.s1, 'Revenue', `${money(g.revenue)} ${CURRENCY}`)}${tipRow(t.muted, 'Revenue ÷ salary', times(g.revPerSalary))}`
            : `<b>${esc(g.key)}</b><br/>${tipRow(t.s1, 'Revenue', `${money(g.revenue)} ${CURRENCY}`)}${tipRow(t.muted, 'People', g.doctors)}${tipRow(t.muted, 'Revenue / person', compact(g.revPerDoc))}`;
        },
      },
      xAxis: valueAxis(t, rev || inDept ? compact : (v) => v),
      yAxis: catAxis(t, names, labelW),
      series: [{
        type: 'bar', barMaxWidth: 14, barCategoryGap: '30%',
        data: groups.map((g) => ({ value: g.value, itemStyle: { color: isOn(g) ? t.mRev : t.neutral, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: t.text2, fontSize: 11, formatter: (p) => (rev || inDept ? compact(p.value) : p.value) },
      }],
    }, true);

    chart('cCost').setOption({
      ...base(t),
      legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 } },
      grid: { left: 8, right: 16, top: 28, bottom: 24, containLabel: true },
      tooltip: {
        ...shadowTip(t),
        formatter: (ps) => {
          const g = groups[ps[0].dataIndex];
          return `<b>${esc(inDept ? g.name : g.key)}</b><br/>${tipRow(t.mSalary, 'Salary', money(g.salary))}${tipRow(t.mInc, 'Incentives', money(g.incentives))}${tipRow(t.muted, 'Total cost', money(g.cost))}${tipRow(t.muted, 'Incentive ÷ salary', pct(g.incRate))}`;
        },
      },
      xAxis: valueAxis(t),
      yAxis: catAxis(t, names, labelW),
      series: [
        { name: 'Salary', type: 'bar', stack: 'c', barMaxWidth: 14, color: t.mSalary,
          itemStyle: { borderColor: t.surface, borderWidth: 1 },
          data: groups.map((g) => ({ value: g.salary, itemStyle: { opacity: isOn(g) ? 1 : 0.28 } })) },
        { name: 'Incentives', type: 'bar', stack: 'c', barMaxWidth: 14, color: t.mInc,
          itemStyle: { borderColor: t.surface, borderWidth: 1, borderRadius: [0, 4, 4, 0] },
          data: groups.map((g) => ({ value: g.incentives, itemStyle: { opacity: isOn(g) ? 1 : 0.28 } })) },
      ],
    }, true);

    for (const id of ['cRevSpec', 'cCost']) {
      const c = chart(id);
      c.off('click');
      c.on('click', (p) => {
        const g = groups[p.dataIndex];
        if (!g) return;
        if (inDept) openDoctor(g.last);
        else location.hash = unitHref(g.key);
      });
    }
  }

  /** Incentive programmes: each department's (or person's) share of the total paid, and incentives ÷ salaries. */
  function renderIncShare(t) {
    const c = catOf(state.cat);
    if (!c?.incentiveOnly) return;
    const unit = state.dept ? 'person' : c.unit;
    $('#tIncShare').textContent = state.dept ? `Share of ${state.dept}’s incentives by person` : `Share of total incentives by ${unit}`;
    const total = filtered.reduce((s, r) => s + r.incentives, 0);
    const items = (state.dept
      ? byDoctor(filtered).map((d) => ({ label: truncate(d.name, 26), inc: d.incentives, salary: d.salary, n: 1, ref: d }))
      : groupBy(filtered, 'specialty').map((g) => ({ label: g.key, inc: g.incentives, salary: g.salary, n: g.doctors })))
      .map((i) => ({ ...i, share: safeDiv(i.inc, total), incSal: safeDiv(i.inc, i.salary) }))
      .sort((a, b) => b.inc - a.inc).slice(0, 30);
    $('#incShareNote').textContent = total
      ? `${compact(total)} ${CURRENCY} paid in the selected period · incentives ÷ salaries overall ${pct(safeDiv(total, agg(filtered).salary))}`
      : 'No incentives in the selected period';
    // One department / section only: 100% of the total says nothing the tiles don't.
    $('#cIncShare').closest('article').classList.toggle('hidden', items.length <= 1 && !state.dept);
    if (items.length <= 1 && !state.dept) return;
    const h = Math.max(260, items.length * 24 + 40);
    setHeight('cIncShare', h); setHeight('cIncSal', h);
    if (!items.length) { emptyChart('cIncShare', 'No data for the current filters'); emptyChart('cIncSal', 'No data'); return; }
    const tip = (ps) => {
      const i = items[ps[0].dataIndex];
      return `<b>${esc(i.ref ? i.ref.name : i.label)}</b>${tipRow(t.s1, 'Incentives', `${money(i.inc)} ${CURRENCY}`)}${tipRow(t.s1, 'Share of total', pct(i.share))}${tipRow(t.s2, 'Salaries', money(i.salary))}${tipRow(t.s2, 'Incentives ÷ salaries', pct(i.incSal))}${i.ref ? '' : tipRow(t.muted, 'People', i.n)}`;
    };
    const bars = (id, key, color, fmt) => chart(id).setOption({
      ...base(t),
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...shadowTip(t), formatter: tip },
      xAxis: { ...valueAxis(t, (v) => `${Math.round(v * 100)}%`), show: false },
      yAxis: catAxis(t, items.map((i) => i.label), 160),
      series: [{
        type: 'bar', barMaxWidth: 14, color, itemStyle: { borderRadius: [0, 4, 4, 0] },
        data: items.map((i) => i[key] ?? 0),
        label: { show: true, position: 'right', color: t.text2, fontSize: 11, formatter: (p) => fmt(items[p.dataIndex]) },
      }],
    }, true);
    bars('cIncShare', 'share', t.mInc, (i) => `${pct(i.share, 1)} · ${compact(i.inc)}`);
    bars('cIncSal', 'incSal', t.mSalary, (i) => (i.incSal == null ? 'no salary' : pct(i.incSal, 1)));
    for (const id of ['cIncShare', 'cIncSal']) {
      const ch = chart(id);
      ch.off('click');
      ch.on('click', (p) => { const i = items[p.dataIndex]; if (!i) return; if (i.ref) openDoctor(i.ref.last); else location.hash = deptHref(i.label); });
    }
  }

  /** Dr's census / operation: workload by specialty, top doctors, admission rate and monthly trend. */
  function renderCensus(t) {
    if (!isCensusCat(state.cat)) return;
    $('#censusMetric button[data-v="operations"]').classList.toggle('hidden', !hasOperations());
    const m = !hasOperations() && state.censusMetric === 'operations' ? 'visits' : state.censusMetric;
    const label = { visits: 'visits', admissions: 'admissions', operations: 'operations' }[m];
    const inDept = !!state.dept;
    $('#tCensusSpec').textContent = inDept ? `Workload by doctor · ${label}` : `Workload by specialty · ${label}`;
    const groups = inDept
      ? byDoctor(filtered).map((d) => ({ label: truncate(d.name, 26), ...d, ref: d }))
      : groupBy(filtered, 'specialty').map((g) => ({ label: g.key, ...g }));
    groups.sort((a, b) => (b[m] || 0) - (a[m] || 0));
    setHeight('cCensusSpec', Math.max(300, groups.length * 24 + 50));
    const num = (v) => nfFull.format(v || 0);
    if (!groups.length) emptyChart('cCensusSpec', 'No census data for the current filters');
    else {
      chart('cCensusSpec').setOption({
        ...base(t),
        grid: { left: 8, right: 60, top: 8, bottom: 24, containLabel: true },
        tooltip: { ...shadowTip(t), formatter: (ps) => { const g = groups[ps[0].dataIndex]; return `<b>${esc(g.ref ? g.ref.name : g.label)}</b>${tipRow(t.s1, 'Visits', num(g.visits))}${tipRow(t.s3, 'Admissions', num(g.admissions))}${tipRow(t.s2, 'Operations', num(g.operations))}${g.ref ? '' : tipRow(t.muted, 'Doctors', g.doctors)}`; } },
        xAxis: valueAxis(t, num),
        yAxis: catAxis(t, groups.map((g) => g.label), 170),
        series: [{ type: 'bar', barMaxWidth: 14, color: t.s1, itemStyle: { borderRadius: [0, 4, 4, 0] }, data: groups.map((g) => g[m] || 0),
          label: { show: true, position: 'right', color: t.text2, fontSize: 11, formatter: (p) => num(p.value) } }],
      }, true);
      const c = chart('cCensusSpec');
      c.off('click');
      c.on('click', (p) => { const g = groups[p.dataIndex]; if (!g) return; if (g.ref) openDoctor(g.ref.last); else location.hash = deptHref(g.label); });
    }
    // Top 10 doctors by the chosen measure.
    const top = byDoctor(filtered).filter((d) => d[m] > 0).sort((a, b) => b[m] - a[m]).slice(0, 10);
    $('#censusTopNote').textContent = `By ${label}`;
    if (!top.length) emptyChart('cCensusTop', 'No data');
    else {
      chart('cCensusTop').setOption({
        ...base(t),
        grid: { left: 8, right: 56, top: 8, bottom: 24, containLabel: true },
        tooltip: { ...base(t).tooltip, trigger: 'item', formatter: (p) => { const d = top[p.dataIndex]; return `${tipHead(t, d)}${tipRow(t.s1, 'Visits', num(d.visits))}${tipRow(t.s3, 'Admissions', num(d.admissions))}${tipRow(t.s2, 'Operations', num(d.operations))}`; } },
        xAxis: valueAxis(t, num),
        yAxis: catAxis(t, top.map((d) => truncate(d.name, 26)), 170),
        series: [{ type: 'bar', barMaxWidth: 16, color: t.s1, itemStyle: { borderRadius: [0, 4, 4, 0] }, data: top.map((d) => d[m]),
          label: { show: true, position: 'right', color: t.text2, fontSize: 11, formatter: (p) => num(p.value) } }],
      }, true);
      const c = chart('cCensusTop');
      c.off('click');
      c.on('click', (p) => openDoctor(top[p.dataIndex].last));
    }
    // Admissions per 100 visits by specialty.
    const rate = groupBy(filtered, 'specialty').filter((g) => g.visits > 0)
      .map((g) => ({ label: g.key, v: g.admissions / g.visits * 100, g })).sort((a, b) => b.v - a.v);
    if (!rate.length) emptyChart('cCensusRate', 'Needs visits and admissions');
    else {
      setHeight('cCensusRate', Math.max(300, rate.length * 24 + 50));
      chart('cCensusRate').setOption({
        ...base(t),
        grid: { left: 8, right: 50, top: 8, bottom: 24, containLabel: true },
        tooltip: { ...shadowTip(t), formatter: (ps) => { const r = rate[ps[0].dataIndex]; return `<b>${esc(r.label)}</b>${tipRow(t.s3, 'Admissions per 100 visits', r.v.toFixed(1))}${tipRow(t.muted, 'Visits', num(r.g.visits))}${tipRow(t.muted, 'Admissions', num(r.g.admissions))}`; } },
        xAxis: valueAxis(t, (v) => v.toFixed(0)),
        yAxis: catAxis(t, rate.map((r) => r.label), 160),
        series: [{ type: 'bar', barMaxWidth: 14, color: t.s3, itemStyle: { borderRadius: [0, 4, 4, 0] }, data: rate.map((r) => r.v),
          label: { show: true, position: 'right', color: t.text2, fontSize: 11, formatter: (p) => p.value.toFixed(1) } }],
      }, true);
    }
    // Monthly workload: three small charts, one per measure (never two scales on one axis).
    const months = fillMonths(groupBy(state.rows.filter((r) => matches(r, { skipPeriod: true })), 'period'));
    const ops = hasOperations();
    $('#censusTrendNote').textContent = months.length < 2 ? 'Only one month so far — the trend fills in as months are added.' : `Visits${ops ? ', admissions and operations' : ' and admissions'} per month · selected months in bold`;
    $('#cCensusTO').classList.toggle('hidden', !ops);
    $('#cCensusTO').closest('.trend-wrap').classList.toggle('three', ops);
    for (const [id, key, color, title] of [['cCensusTV', 'visits', t.s1, 'Visits'], ['cCensusTA', 'admissions', t.s3, 'Admissions'], ...(ops ? [['cCensusTO', 'operations', t.s2, 'Operations']] : [])]) {
      if (!months.length) { emptyChart(id, 'No data'); continue; }
      chart(id).setOption({
        ...base(t),
        title: { text: title, left: 0, top: 0, textStyle: { color: t.text2, fontSize: 12.5, fontWeight: 600 } },
        grid: { left: 8, right: 12, top: 30, bottom: 24, containLabel: true },
        tooltip: { ...base(t).tooltip, trigger: 'axis', valueFormatter: num },
        xAxis: monthCatAxis(t, months.map((g) => g.key), months.map((g) => periodLabel(g.key))),
        yAxis: valueAxis(t, num),
        series: [{ type: 'line', color, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 8, itemStyle: { borderColor: t.surface, borderWidth: 2 }, areaStyle: { color, opacity: 0.08 },
          data: months.map((g) => (g.n ? g[key] : null)) }],
      }, true);
    }
  }

  /** Residents page: residents' incentives as a share of the OPD doctors' incentives, per specialty. */
  function renderShare(t) {
    if (state.cat !== 'residents' || state.dept) return;
    const res = groupBy(filtered, 'specialty');
    const opdRows = state.rows.filter((r) => inBranch(r) && inPeriod(r) && r.category === 'opd');
    const items = res.map((g) => {
      const opd = agg(opdRows.filter((r) => r.specialty === g.key));
      return { key: g.key, res: g.incentives, opd: opd.incentives, share: safeDiv(g.incentives, opd.incentives), n: g.doctors, opdN: opd.doctors };
    }).sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
    setHeight('cShare', Math.max(260, items.length * 24 + 50));
    if (!items.length) return emptyChart('cShare', 'No residents data for the current filters');
    chart('cShare').setOption({
      ...base(t),
      grid: { left: 8, right: 60, top: 8, bottom: 24, containLabel: true },
      tooltip: {
        ...shadowTip(t),
        formatter: (ps) => {
          const it = items[ps[0].dataIndex];
          return `<b>${esc(it.key)}</b>${tipRow(t.s3, 'Residents’ incentives', `${money(it.res)} (${it.n})`)}${tipRow(t.s1, 'OPD doctors’ incentives', `${money(it.opd)} (${it.opdN})`)}${tipRow(t.muted, 'Share', it.share == null ? 'no OPD incentives' : pct(it.share))}`;
        },
      },
      xAxis: valueAxis(t, (v) => `${Math.round(v * 100)}%`),
      yAxis: catAxis(t, items.map((i) => i.key), 160),
      series: [{
        type: 'bar', barMaxWidth: 14, color: t.s3, itemStyle: { borderRadius: [0, 4, 4, 0] },
        data: items.map((i) => i.share ?? 0),
        label: { show: true, position: 'right', color: t.text2, fontSize: 11, formatter: (p) => (items[p.dataIndex].share == null ? 'no OPD' : pct(p.value)) },
      }],
    }, true);
    const c = chart('cShare');
    c.off('click');
    c.on('click', (p) => { const it = items[p.dataIndex]; if (it) location.hash = deptHref(it.key, 'residents'); });
  }

  /** Top 10 (highest) or lowest 10 doctors by a metric. */
  function renderRanking(t, id, metric, dir) {
    // Without people's revenue (residents; closed departments, whose revenue is the department's)
    // the ranking is by incentives; hide the revenue options.
    const all = byDoctor(filtered);
    const peopleRev = all.some((d) => d.revenue > 0);
    const seg = dir === 'top' ? '#topMetric' : '#lowMetric';
    $$(`${seg} button[data-v="revenue"], ${seg} button[data-v="revPerSalary"]`).forEach((b) => b.classList.toggle('hidden', !peopleRev));
    if (!peopleRev && (metric === 'revenue' || metric === 'revPerSalary')) {
      metric = 'incentives';
      $$(`${seg} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === 'incentives'));
    }
    // With 10 people or fewer the top list already shows everyone: the "lowest" card would repeat it.
    if (dir === 'low') {
      const few = all.length <= 10;
      $('#lowCard').classList.toggle('hidden', few);
      $('#topCard').classList.toggle('span-12', few);
      $('#topCard').classList.toggle('span-6', !few);
      const whoWord = state.cat ? catOf(state.cat).who : 'staff';
      $('#tTop').textContent = few ? `All ${all.length} ${whoWord}, ranked` : `Top 10 ${whoWord}`;
      if (few) return;
    }
    // Revenue measures only rank people who earn revenue (residents / programme staff have none).
    const revMetric = metric === 'revenue' || metric === 'revPerSalary';
    const docs = all.filter((d) => d[metric] != null && (metric !== 'revPerSalary' || d.salary > 0) && (!revMetric || d.revenue > 0));
    const list = docs.sort((a, b) => (dir === 'top' ? b[metric] - a[metric] : a[metric] - b[metric])).slice(0, 10);
    const fmt = metric === 'incentiveRate' ? (v) => pct(v, 0) : metric === 'revPerSalary' ? times : compact;
    if (!list.length) return emptyChart(id, 'No data for the current filters');
    const color = revMetric ? t.mRev : t.mInc;
    setHeight(id, Math.max(200, list.length * 32 + 56));
    chart(id).setOption({
      ...base(t),
      grid: { left: 8, right: 56, top: 8, bottom: 24, containLabel: true },
      tooltip: {
        ...base(t).tooltip, trigger: 'item',
        formatter: (p) => {
          const d = list[p.dataIndex];
          return `${tipHead(t, d)}${tipRow(t.mRev, 'Revenue', money(d.revenue))}${tipRow(t.mInc, 'Incentives', money(d.incentives))}${tipRow(t.muted, 'Incentive %', pct(d.incentiveRate))}${tipRow(t.muted, 'Salary', money(d.salary))}${tipRow(t.muted, 'Revenue ÷ salary', times(d.revPerSalary))}`;
        },
      },
      xAxis: valueAxis(t, fmt),
      yAxis: catAxis(t, list.map((d) => truncate(d.name, 26)), 170),
      series: [{
        type: 'bar', barMaxWidth: 16, color, itemStyle: { borderRadius: [0, 4, 4, 0] },
        data: list.map((d) => d[metric]),
        label: { show: true, position: 'right', color: t.text2, fontSize: 11, formatter: (p) => fmt(p.value) },
      }],
    }, true);
    const c = chart(id);
    c.off('click');
    c.on('click', (p) => openDoctor(list[p.dataIndex].last));
  }

  /** Simple view of value for money: doctors grouped by revenue earned per 1 EGP they cost. */
  function renderRoi(t) {
    // Only people who earn revenue: for everyone else "revenue per 1 EGP of cost" is 0 by definition.
    const docs = byDoctor(filtered).filter((d) => d.cost > 0 && d.revenue > 0);
    const noRoi = !docs.length && filtered.some((r) => r.level && r.revenue > 0); // revenue is the departments'
    $('#roiCard').classList.toggle('hidden', noRoi);
    $('#histCard').classList.toggle('span-12', noRoi); $('#histCard').classList.toggle('span-6', !noRoi);
    const edges = [0, 5, 10, 15, 20, 30, Infinity];
    const labels = edges.slice(0, -1).map((e, i) => (edges[i + 1] === Infinity ? `${e}× +` : `${e}–${edges[i + 1]}×`));
    const bins = labels.map(() => []);
    for (const d of docs) {
      const i = edges.findIndex((e, k) => d.revPerCost >= e && d.revPerCost < edges[k + 1]);
      if (i >= 0) bins[i].push(d);
    }
    const avg = agg(filtered).roi;
    $('#roiNote').textContent = docs.length
      ? `${docs.length} people with revenue · cost = salary + incentives · on average they bring ${times(avg)} their cost · bars = number of people`
      : 'Cost = salary + incentives';
    if (!docs.length) return emptyChart('cRoi', 'No data for the current filters');
    chart('cRoi').setOption({
      ...base(t),
      grid: { left: 8, right: 12, top: 24, bottom: 30, containLabel: true },
      tooltip: {
        ...shadowTip(t),
        formatter: (ps) => {
          const b = [...bins[ps[0].dataIndex]].sort((x, y) => y.revPerCost - x.revPerCost);
          const names = b.slice(0, 8).map((d) => `<div style="display:flex;justify-content:space-between;gap:14px;color:${t.text2}"><span>${esc(truncate(d.name, 30))}</span><b>${times(d.revPerCost)}</b></div>`).join('');
          return `<b>Brings ${labels[ps[0].dataIndex]} their cost</b>${tipRow(t.mRev, 'People', b.length)}${names}${b.length > 8 ? `<div style="color:${t.muted}">+${b.length - 8} more</div>` : ''}`;
        },
      },
      xAxis: { type: 'category', data: labels, name: 'Revenue ÷ cost', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.muted, fontSize: 11 },
        axisLabel: { color: t.muted, fontSize: 11 }, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false } },
      yAxis: { ...valueAxis(t, (v) => v), minInterval: 1 },
      series: [{
        type: 'bar', barCategoryGap: '22%', barMaxWidth: 48, color: t.mRev, itemStyle: { borderRadius: [4, 4, 0, 0] },
        data: bins.map((b) => b.length),
        label: { show: true, position: 'top', color: t.text2, fontSize: 11, formatter: (p) => (p.value ? p.value : '') },
      }],
    }, true);
  }

  /** Top 5 and bottom 5 specialties by net contribution (revenue − doctor cost), revenue or revenue ÷ cost. */
  function renderBestWorst(t) {
    if (state.dept) return;
    const m = state.bwMetric;
    // Only units that earn revenue: a programme without revenue (CAM, Admission…) is not "weak".
    const groups = groupBy(state.rows.filter((r) => matches(r, { skipSpec: true })), 'specialty')
      .filter((g) => g[m] != null && g.revenue > 0).sort((a, b) => b[m] - a[m]);
    const n = Math.min(5, Math.floor(groups.length / 2)) || Math.min(5, groups.length);
    const best = groups.slice(0, n);
    const worst = groups.slice(-n).reverse().filter((g) => !best.includes(g));
    const fmt = m === 'roi' ? times : compact;
    const draw = (id, list, color) => {
      if (!list.length) return emptyChart(id, 'Not enough specialties');
      chart(id).setOption({
        ...base(t),
        grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
        tooltip: {
          ...shadowTip(t),
          formatter: (ps) => {
            const g = list[ps[0].dataIndex];
            return `<b>${esc(g.key)}</b> <span style="color:${t.muted}">${g.doctors} doctors</span>${tipRow(t.mRev, 'Revenue', money(g.revenue))}${tipRow(t.muted, 'Doctor cost', money(g.cost))}${tipRow(color(g.contribution), 'Net contribution', money(g.contribution))}${tipRow(t.muted, 'Revenue ÷ cost', times(g.roi))}${tipRow(t.muted, 'Margin after doctor cost', pct(safeDiv(g.contribution, g.revenue)))}`;
          },
        },
        xAxis: { ...valueAxis(t, fmt), show: false },
        yAxis: catAxis(t, list.map((g) => g.key), 150),
        series: [{
          type: 'bar', barMaxWidth: 18,
          data: list.map((g) => ({ value: g[m], itemStyle: { color: color(g[m]), borderRadius: g[m] < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] } })),
          label: { show: true, position: 'right', color: t.text2, fontSize: 11.5, fontWeight: 600, formatter: (p) => fmt(p.value) },
        }],
      }, true);
      const c = chart(id);
      c.off('click');
      c.on('click', (p) => { const g = list[p.dataIndex]; if (g) location.hash = unitHref(g.key); });
    };
    // Net contribution: blue when positive, red only when negative (a low but positive one is not a loss).
    const colorOf = (v) => (m === 'contribution' ? (v < 0 ? t.neg : t.pos) : t.mRev);
    draw('cBest', best, colorOf);
    draw('cWorst', worst, colorOf);
  }

  /**
   * Are incentives in line with revenue? One dot per specialty (or doctor): revenue across,
   * incentives up, one axis each (a scatter, not two scales on one chart). The line is the average
   * incentive per 1 EGP of revenue: dots above it are paid more incentive per EGP than average.
   */
  function renderRevInc(t) {
    // closed departments: the revenue is the department's, so there are no people to plot
    const noPeopleRev = !byDoctor(filtered).some((d) => d.revenue > 0);
    const byDoc = !noPeopleRev && (state.riMode === 'doctor' || !!state.dept);
    $$('#riMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === (byDoc ? 'doctor' : 'specialty')));
    $('#riMode').classList.toggle('hidden', !!state.dept || noPeopleRev);
    const unit = state.cat ? catOf(state.cat).unit : 'specialty';
    const R = revLabel();
    const items = (byDoc
      ? byDoctor(filtered).map((d) => ({ label: d.name, revenue: d.revenue, incentives: d.incentives, n: 1, ref: d }))
      : groupBy(filtered, 'specialty').map((g) => ({ label: g.key, revenue: g.revenue, incentives: g.incentives, n: g.doctors, g })))
      .filter((i) => i.revenue > 0);
    $('#riCard').classList.toggle('hidden', items.length < 2);
    const totRev = items.reduce((x, i) => x + i.revenue, 0);
    const avg = safeDiv(items.reduce((x, i) => x + i.incentives, 0), totRev) || 0;
    $('#riNote').textContent = items.length
      ? `Each dot is a ${byDoc ? 'person' : unit} · the line = their average, ${pct(avg, 2)} of ${R.toLowerCase()} paid as incentives (${byDoc ? 'people' : pluralUnit(unit)} with ${R.toLowerCase()} only) · above the line = more incentive per 1 EGP than average`
      : `Needs ${R.toLowerCase()}`;
    if (!items.length) return emptyChart('cRevInc', `No ${R.toLowerCase()} for the current filters`);
    // Label only the few furthest from the line (in EGP) and the two largest.
    const dev = (i) => i.incentives - avg * i.revenue;
    const labelled = new Set([...items].sort((a, b) => Math.abs(dev(b)) - Math.abs(dev(a))).slice(0, byDoc ? 5 : 6)
      .concat([...items].sort((a, b) => b.revenue - a.revenue).slice(0, 2)));
    const maxN = Math.max(1, ...items.map((i) => i.n));
    const size = (i) => (byDoc ? 10 : 10 + 14 * Math.sqrt(i.n / maxN));
    const maxX = niceCeil(Math.max(...items.map((i) => i.revenue)));
    const point = (i) => ({
      value: [i.revenue, i.incentives], name: i.label, symbolSize: size(i),
      label: { show: labelled.has(i), formatter: truncate(i.label, 22), position: 'top', color: t.text2, fontSize: 11 },
    });
    const dot = (name, list, color) => ({
      name, type: 'scatter', data: list.map(point), color,
      itemStyle: { opacity: 0.85, borderColor: t.surface, borderWidth: 2 },
      emphasis: { focus: 'self', scale: 1.25 },
      labelLayout: { hideOverlap: true },
    });
    const tip = (p) => {
      const i = items.find((x) => x.label === p.name);
      if (!i) return '';
      const d = dev(i);
      return `<b>${esc(i.label)}</b>${byDoc ? '' : `<div style="color:${t.muted};margin-bottom:4px">${i.n} people</div>`}`
        + tipRow(t.mRev, R, money(i.revenue)) + tipRow(t.mInc, 'Incentives paid', money(i.incentives))
        + tipRow(t.muted, `Incentives ÷ ${R.toLowerCase()}`, `${pct(safeDiv(i.incentives, i.revenue), 2)} (average ${pct(avg, 2)})`)
        + tipRow(t.muted, 'vs the average rate', `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}`);
    };
    chart('cRevInc').setOption({
      ...base(t),
      legend: { top: 0, left: 0, icon: 'circle', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 } },
      grid: { left: 16, right: 30, top: 44, bottom: 40, containLabel: true },
      tooltip: { ...base(t).tooltip, trigger: 'item', formatter: tip },
      xAxis: { ...valueAxis(t), max: maxX, name: R, nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: t.muted, fontSize: 11 } },
      yAxis: { ...valueAxis(t), name: 'Incentives paid', nameLocation: 'middle', nameGap: 48, nameTextStyle: { color: t.muted, fontSize: 11 } },
      series: [
        { ...dot('More incentive per EGP than average', items.filter((i) => dev(i) > 0), t.mInc),
          markLine: { silent: true, symbol: 'none', lineStyle: { color: t.axis, width: 1, type: 'solid' },
            label: { formatter: `Average ${pct(avg, 2)}`, position: 'insideEndTop', color: t.muted, fontSize: 11 },
            data: [[{ coord: [0, 0] }, { coord: [maxX, avg * maxX] }]] } },
        dot('Less than average', items.filter((i) => dev(i) <= 0), t.mRev),
      ],
    }, true);
    const c = chart('cRevInc');
    c.off('click');
    c.on('click', (p) => {
      const i = items.find((x) => x.label === p.name);
      if (!i) return;
      if (i.ref) openDoctor(i.ref.last); else location.hash = unitHref(i.label);
    });
  }

  /**
   * Target vs actual revenue (sales / collection on those pages) with the achievement % on each
   * revenue bar, and beside it the incentives paid — same rows / months in both charts, each with
   * its own axis (never two scales on one chart).
   */
  function renderTri(t) {
    if (!state.hasRevenue) return;
    const R = revLabel();
    const inDept = !!state.dept;
    const team = !!catOf(state.cat)?.team; // one row a month: only the monthly view means something
    const mode = team ? 'month' : inDept && state.triMode === 'specialty' ? 'doctor' : state.triMode;
    $('#triMode').classList.toggle('hidden', team);
    $$('#triMode button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === mode);
      if (b.dataset.v === 'specialty') b.classList.toggle('hidden', inDept);
      if (b.dataset.v === 'specialty') b.textContent = `By ${state.cat ? catOf(state.cat).unit : 'specialty'}`;
      if (b.dataset.v === 'doctor') b.textContent = `By ${catOf(state.cat)?.who === 'doctors' || !state.cat ? 'doctor' : 'person'}`;
    });
    $('#tTri').textContent = `Target, ${R.toLowerCase()} & incentives`;
    $('#tTriA').textContent = `Target vs ${R.toLowerCase()} · label = achievement`;
    $('#tTriB').textContent = 'Incentives paid';

    // Summary for the selected months.
    const a = agg(filtered);
    const gap = a.revWithTarget - a.targetSum;
    $('#triSummary').innerHTML = [
      ['Target', a.targetSum ? compact(a.targetSum) : '—', '', a.targetSum ? money(a.targetSum) : ''],
      [`${R} (with a target)`, a.targetSum ? compact(a.revWithTarget) : '—', '', a.targetSum ? money(a.revWithTarget) : ''],
      ['Achievement', a.targetSum ? achFmt(a.achievement) : '—', a.targetSum ? (a.achievement >= 1 ? 'good' : 'bad') : '', ''],
      ['Gap to target', a.targetSum ? `${gap >= 0 ? '+' : '−'}${compact(Math.abs(gap))}` : '—', a.targetSum ? (gap >= 0 ? 'good' : 'bad') : '', a.targetSum ? money(gap) : ''],
      ['Incentives paid', compact(a.incentives), '', money(a.incentives)],
      [`Incentives ÷ ${R.toLowerCase()}`, pct(a.revRate, 2), '', ''],
    ].map(([k, v, cls, full]) => `<div class="tg-stat ${cls}" ${full ? `title="${full} ${CURRENCY}"` : ''}><span>${k}</span><b>${v}</b></div>`).join('');

    let items;
    const horizontal = mode !== 'month';
    if (mode === 'month') {
      items = fillMonths(groupBy(state.rows.filter((r) => matches(r, { skipPeriod: true })), 'period'))
        .map((g) => ({ label: periodLabel(g.key), key: g.key, g }));
      const allRows = state.rows.filter((r) => matches(r, { skipPeriod: true }));
      $('#triNote').textContent = `Each month: target and actual ${R.toLowerCase()}, and the incentives paid · achievement counts ${deptTargets(allRows) ? 'departments' : state.cat === 'opd' || !state.cat ? 'doctors' : 'people'} with a target · ✓ = target met · click a month to select it${missingNote(allRows)}`;
    } else if (mode === 'specialty') {
      items = groupBy(filtered, 'specialty').filter((g) => g.revenue > 0 || g.targetSum > 0)
        .sort((x, y) => y.revenue - x.revenue).map((g) => ({ label: g.key, key: g.key, g }));
      $('#triNote').textContent = `Selected months · sorted by ${R.toLowerCase()} · click a bar to open it`;
    } else {
      const docs = byDoctor(filtered).filter((d) => d.revenue > 0 || d.target > 0).sort((x, y) => y.revenue - x.revenue);
      const top = inDept ? docs : docs.slice(0, 30);
      items = top.map((d) => ({
        label: truncate(d.name, 24), key: d.key, ref: d,
        g: { revenue: d.revenue, revWithTarget: d.revWithTarget, targetSum: d.target || 0, achievement: d.achievement, incentives: d.incentives, doctors: 1 },
      }));
      $('#triNote').textContent = `Selected months · ${inDept || docs.length <= 30 ? 'everyone' : `top 30 of ${docs.length}`} by ${R.toLowerCase()} · click a bar for the person`;
    }
    const h = horizontal ? Math.max(300, items.length * 30 + 70) : 320;
    setHeight('cTriA', h); setHeight('cTriB', h);
    if (!items.length) { emptyChart('cTriA', 'No data for the current filters'); emptyChart('cTriB', 'No data'); return; }
    const labels = items.map((i) => i.label);
    const ach = (g) => (g.targetSum ? g.revWithTarget / g.targetSum : null);
    const tip = (ps) => {
      const it = items[ps[0].dataIndex];
      const g = it.g;
      const x = ach(g);
      return `<b>${esc(it.ref ? it.ref.name : it.label)}</b>${tipRow(t.mTarget, 'Target', g.targetSum ? money(g.targetSum) : '—')}`
        + `${tipRow(t.mRev, R, money(g.revenue))}${g.targetSum && g.revWithTarget !== g.revenue ? tipRow(t.muted, `${R} with a target`, money(g.revWithTarget)) : ''}`
        + `${tipRow(t.muted, 'Achievement', x == null ? '—' : achFmt(x))}${g.targetSum ? tipRow(t.muted, 'Gap', `${g.revWithTarget >= g.targetSum ? '+' : '−'}${money(Math.abs(g.revWithTarget - g.targetSum))}`) : ''}`
        + `${tipRow(t.mInc, 'Incentives paid', money(g.incentives))}${tipRow(t.muted, `Incentives ÷ ${R.toLowerCase()}`, pct(safeDiv(g.incentives, g.revenue), 2))}`;
    };
    const catAx = horizontal ? catAxis(t, labels, mode === 'doctor' ? 170 : 150)
      : monthCatAxis(t, items.map((i) => i.key), labels);
    const valAx = valueAxis(t);
    const radius = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
    const layout = (right) => ({ grid: { left: 8, right, top: 34, bottom: 24, containLabel: true }, xAxis: horizontal ? valAx : catAx, yAxis: horizontal ? catAx : valAx });
    chart('cTriA').setOption({
      ...base(t),
      ...layout(horizontal ? 60 : 16),
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 } },
      tooltip: { ...shadowTip(t), formatter: tip },
      series: [
        { name: 'Target', type: 'bar', barMaxWidth: horizontal ? 10 : 22, barGap: '12%', color: t.mTarget,
          itemStyle: { borderRadius: radius }, data: items.map((i) => i.g.targetSum || 0) },
        { name: R, type: 'bar', barMaxWidth: horizontal ? 10 : 22, color: t.mRev,
          itemStyle: { borderRadius: radius }, data: items.map((i) => i.g.revenue),
          // The achievement rides the revenue bar in text ink; a check mark says the target was met.
          label: { show: true, position: horizontal ? 'right' : 'top', fontSize: 11, fontWeight: 600, color: t.text2,
            formatter: (p) => { const x = ach(items[p.dataIndex].g); return x == null ? '' : `${achFmt(x)}${x >= 1 ? ' ✓' : ''}`; } },
          labelLayout: { hideOverlap: true } },
      ],
    }, true);
    chart('cTriB').setOption({
      ...base(t),
      ...layout(horizontal ? 56 : 16),
      tooltip: { ...shadowTip(t), formatter: tip },
      series: [{
        name: 'Incentives', type: 'bar', barMaxWidth: horizontal ? 12 : 26, color: t.mInc,
        itemStyle: { borderRadius: radius }, data: items.map((i) => i.g.incentives),
        label: { show: horizontal || items.length <= 8, position: horizontal ? 'right' : 'top', color: t.text2, fontSize: 11, formatter: (p) => (p.value ? compact(p.value) : '') },
      }],
    }, true);
    for (const id of ['cTriA', 'cTriB']) {
      const c = chart(id);
      c.off('click');
      c.on('click', (p) => {
        const it = items[p.dataIndex];
        if (!it) return;
        if (it.ref) openDoctor(it.ref.last);
        else if (mode === 'specialty') location.hash = unitHref(it.key);
        else if (mode === 'month') { state.months = new Set([it.key]); state.hadSelection = true; onFilterChange(); }
      });
    }
  }
  $('#triMode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    state.triMode = b.dataset.v;
    store.set('triMode', state.triMode);
    renderTri(theme());
  });

  function renderTargets(t) {
    const withTarget = filtered.filter((r) => r.target);
    const has = withTarget.length > 0;
    $('#tgEmpty').classList.toggle('hidden', has);
    $('#cTarget').classList.toggle('hidden', !has);
    $('#tgMode').classList.toggle('hidden', !has || !!state.dept || !withTarget.some((r) => !r.level && r.target));
    if (!has) {
      $('#tgSummary').innerHTML = '';
      $('#tgNote').textContent = state.hasTargets
        ? 'None of the doctors in the current selection has a target'
        : 'Revenue achieved against each doctor’s monthly target';
      return;
    }
    const a = agg(withTarget);
    const docs = byDoctor(withTarget);
    const unitTargets = !docs.length && deptTargets(withTarget); // closed departments
    const unitGroups = unitTargets ? groupBy(withTarget, 'specialty') : [];
    const metDocs = unitTargets ? unitGroups.filter((g) => g.achievement >= 1).length : docs.filter((d) => d.achievement >= 1).length;
    // the staff cost behind that revenue: everyone in those departments
    const costAgg = unitTargets ? agg(filtered.filter((r) => unitGroups.some((g) => g.key === r.specialty))) : a;
    // With a single specialty / section the people inside it are the comparison.
    const oneUnit = new Set(withTarget.map((r) => r.specialty)).size <= 1;
    const byDoc = state.tgMode === 'doctor' || !!state.dept || oneUnit;
    const unit = byDoc && !unitTargets ? 'person' : state.cat ? catOf(state.cat).unit : 'specialty';
    $('#tgNote').textContent = `How far each ${unit} is above or below its monthly target · bars start at the target (100%) · label = achievement`;
    $('#tgSummary').innerHTML = [
      ['Achievement', achFmt(a.achievement), a.achievement >= 1 ? 'good' : 'bad'],
      [`${revLabel()} vs target`, `${compact(a.revWithTarget)} / ${compact(a.targetSum)}`, ''],
      ['Gap to target', `${a.revWithTarget >= a.targetSum ? '+' : '−'}${compact(Math.abs(a.revWithTarget - a.targetSum))}`, a.revWithTarget >= a.targetSum ? 'good' : 'bad'],
      ['Met their target', `${metDocs} of ${unitTargets ? `${unitGroups.length} ${unitGroups.length === 1 ? 'department' : 'departments'}` : docs.length}`, ''],
      catOf(state.cat)?.measure
        ? [`Incentive ÷ ${revLabel().toLowerCase()}`, pct(a.revRate, 2), '']
        : ['Staff cost for this revenue', `${compact(costAgg.cost)} (${times(safeDiv(a.revWithTarget, costAgg.cost))} return)`, ''],
    ].map(([k, v, cls]) => `<div class="tg-stat ${cls}"><span>${k}</span><b>${v}</b></div>`).join('');
    $$('#tgMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === (byDoc ? 'doctor' : 'specialty')));
    const items = byDoc && docs.length
      ? docs.map((d) => ({ label: truncate(d.name, 26), ach: d.achievement, revenue: d.revWithTarget, target: d.target, cost: d.cost, ref: d }))
      : groupBy(withTarget, 'specialty').map((g) => ({ label: g.key, ach: g.achievement, revenue: g.revWithTarget, target: g.targetSum, cost: g.cost, n: g.doctors }));
    items.sort((x, y) => y.ach - x.ach);
    setHeight('cTarget', Math.max(220, items.length * 24 + 70));
    // Variance: 0 = on target; the bar grows right (above) or left (below) by the percentage points.
    const v = (i) => i.ach - 1;
    const lim = niceCeil(Math.max(0.2, ...items.map((i) => Math.abs(v(i)))));
    const pts = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.round(Math.abs(x) * 100)}%`;
    const bar = (above) => ({
      name: above ? 'Above target' : 'Below target', type: 'bar', stack: 'v', barMaxWidth: 14, color: above ? t.pos : t.neg,
      itemStyle: { borderRadius: above ? [0, 4, 4, 0] : [4, 0, 0, 4] },
      data: items.map((i) => ((v(i) >= 0) === above ? v(i) : '-')),
      label: { show: true, position: above ? 'right' : 'left', color: t.text2, fontSize: 11, formatter: (p) => achFmt(items[p.dataIndex].ach) },
    });
    chart('cTarget').setOption({
      ...base(t),
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 }, data: ['Above target', 'Below target'] },
      grid: { left: 8, right: 52, top: 40, bottom: 24, containLabel: true },
      tooltip: {
        ...shadowTip(t),
        formatter: (ps) => {
          const it = items[ps[0].dataIndex];
          return `<b>${esc(it.ref ? it.ref.name : it.label)}</b>${tipRow(it.ach >= 1 ? t.pos : t.neg, 'Achievement', `${achFmt(it.ach)} (${pts(v(it))} vs target)`)}${tipRow(t.muted, revLabel(), money(it.revenue))}${tipRow(t.muted, 'Target', money(it.target))}${tipRow(t.muted, 'Gap', `${it.revenue >= it.target ? '+' : '−'}${money(Math.abs(it.revenue - it.target))}`)}${tipRow(t.muted, 'Cost (salary + incentives)', money(it.cost))}`;
        },
      },
      // a little air beyond the longest bars so their labels stay inside the plot
      xAxis: { ...valueAxis(t, pts), min: -Math.min(1, lim) - 0.12, max: lim + 0.12, splitNumber: 4, axisLabel: { ...valueAxis(t, pts).axisLabel, showMinLabel: false, showMaxLabel: false } },
      yAxis: { ...catAxis(t, items.map((i) => i.label), byDoc ? 180 : 150), axisLine: { show: false } },
      series: [
        { ...bar(true), markLine: { silent: true, symbol: 'none', lineStyle: { color: t.text2, width: 1, type: 'solid' }, label: { formatter: 'Target', position: 'start', distance: 6, color: t.text2, fontSize: 11 }, data: [{ xAxis: 0 }] } },
        bar(false),
      ],
    }, true);
    const c = chart('cTarget');
    c.off('click');
    c.on('click', (p) => {
      const it = items[p.dataIndex];
      if (!it) return;
      if (it.ref) openDoctor(it.ref.last); else location.hash = unitHref(it.label);
    });
  }

  function renderPositions(t) {
    if (catOf(state.cat)?.other) { renderReasons(t); return; }
    $('#posCard h2').textContent = 'Headcount by position';
    $('#posCard header p').textContent = 'Click a bar to filter';
    const rows = state.rows.filter((r) => matches(r, { skipPos: true }));
    const all = groupBy(rows, 'position').sort((a, b) => b.doctors - a.doctors);
    // The 12 largest positions, the long tail of one-off titles folded into "Other" (listed in its tooltip).
    const TOP = 12;
    const tail = all.length > TOP + 1 ? all.slice(TOP) : [];
    const groups = tail.length ? [...all.slice(0, TOP), { key: `Other (${tail.length} positions)`, other: tail, doctors: tail.reduce((s, g) => s + g.doctors, 0) }] : all;
    const sel = state.filters.positions;
    setHeight('cPos', Math.max(140, groups.length * 26 + 50));
    if (!groups.length) return emptyChart('cPos', 'No data for the current filters');
    chart('cPos').setOption({
      ...base(t),
      grid: { left: 8, right: 40, top: 8, bottom: 24, containLabel: true },
      tooltip: {
        ...shadowTip(t),
        formatter: (ps) => {
          const g = groups[ps[0].dataIndex];
          if (g.other) return `<b>${esc(g.key)}</b>${g.other.slice(0, 12).map((o) => tipRow(t.muted, esc(o.key), o.doctors)).join('')}${g.other.length > 12 ? `<div style="color:${t.muted}">+${g.other.length - 12} more</div>` : ''}`;
          return `<b>${esc(g.key)}</b><br/>${tipRow(t.mRev, 'People', g.doctors)}${tipRow(t.muted, 'Avg salary', money(g.salary / g.n))}${state.hasRevenue ? tipRow(t.muted, 'Avg revenue', money(g.revPerDoc)) : ''}${tipRow(t.muted, 'Incentive ÷ salary', pct(g.incRate))}`;
        },
      },
      xAxis: { ...valueAxis(t, (v) => v), minInterval: 1 },
      yAxis: catAxis(t, groups.map((g) => g.key), 190),
      series: [{
        type: 'bar', barMaxWidth: 14,
        data: groups.map((g) => ({ value: g.doctors, itemStyle: { color: g.other ? t.neutral : !sel.size || sel.has(g.key) ? t.mRev : t.neutral, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: t.text2, fontSize: 11 },
      }],
    }, true);
  }

  /** Other Incentives: what it was paid for, in the position chart's place. */
  function renderReasons(t) {
    const reasons = reasonsOf(filtered);
    const total = reasons.reduce((x, [, v]) => x + v, 0);
    $('#posCard h2').textContent = 'Incentives by reason';
    $('#posCard header p').textContent = 'What the other incentives were paid for';
    setHeight('cPos', Math.max(140, reasons.length * 26 + 50));
    if (!reasons.length) { emptyChart('cPos', 'No reasons in the files for the current filters'); return; }
    chart('cPos').setOption({
      ...base(t),
      grid: { left: 8, right: 56, top: 8, bottom: 24, containLabel: true },
      tooltip: {
        ...shadowTip(t),
        formatter: (ps) => { const [k, v] = reasons[ps[0].dataIndex]; return `<b>${esc(k)}</b><br/>${tipRow(t.mInc, 'Incentives', money(v))}${tipRow(t.muted, 'Share', pct(safeDiv(v, total), 0))}`; },
      },
      xAxis: valueAxis(t, compact),
      yAxis: catAxis(t, reasons.map(([k]) => k), 190),
      series: [{
        type: 'bar', barMaxWidth: 14,
        data: reasons.map(([, v]) => ({ value: v, itemStyle: { color: t.mInc, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', color: t.text2, fontSize: 11, formatter: (p) => compact(p.value) },
      }],
    }, true);
  }

  function renderHist(t) {
    const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, Infinity];
    const labels = edges.slice(0, -1).map((e, i) => (edges[i + 1] === Infinity ? `${e * 100}%+` : `${e * 100}–${edges[i + 1] * 100}%`));
    const bins = labels.map(() => []);
    for (const r of filtered) {
      if (r.level) continue;
      const v = r.incentiveRate ?? safeDiv(r.incentives, r.salary);
      if (v == null) continue;
      const i = edges.findIndex((e, k) => v >= e && v < edges[k + 1]);
      if (i >= 0) bins[i].push(r);
    }
    // Without salaries in the files (e.g. Business Development) there is no incentive rate to show.
    const noRates = filtered.length && bins.every((b) => !b.length);
    $('#cHist').closest('article').classList.toggle('hidden', !!noRates);
    if (noRates) return;
    if (!filtered.length) return emptyChart('cHist', 'No data for the current filters');
    chart('cHist').setOption({
      ...base(t),
      grid: { left: 8, right: 12, top: 24, bottom: 30, containLabel: true },
      tooltip: {
        ...shadowTip(t),
        formatter: (ps) => {
          const b = bins[ps[0].dataIndex];
          const names = b.slice(0, 6).map((r) => `<div style="color:${t.text2}">${esc(truncate(r.name, 34))}</div>`).join('');
          return `<b>Incentive rate ${labels[ps[0].dataIndex]}</b>${tipRow(t.mInc, 'Person-months', b.length)}${names}${b.length > 6 ? `<div style="color:${t.muted}">+${b.length - 6} more</div>` : ''}`;
        },
      },
      xAxis: { type: 'category', data: labels, axisLabel: { color: t.muted, fontSize: 10.5, rotate: 30 }, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false } },
      yAxis: { ...valueAxis(t, (v) => v), minInterval: 1 },
      series: [{
        type: 'bar', barCategoryGap: '18%', barMaxWidth: 48, color: t.mInc, itemStyle: { borderRadius: [4, 4, 0, 0] },
        data: bins.map((b) => b.length),
        label: { show: true, position: 'top', color: t.text2, fontSize: 11, formatter: (p) => (p.value ? p.value : '') },
      }],
    }, true);
  }

  /**
   * Months a trend shows: from the branch's first month to this page's last one, every month —
   * a month without a file shows 0 (nothing was paid). The quarterly incentive: quarter ends only.
   */
  function monthAxis() {
    const mine = state.rows.filter((r) => inBranch(r) && /^\d{4}-\d{2}$/.test(r.period)
      && (state.cat ? r.category === state.cat : state.mix ? state.mix.has(r.category) : !catOf(r.category)?.quarterly && !isCensusCat(r.category)));
    if (!mine.length || !state.periods.length) return [];
    const end = mine.reduce((m, r) => (r.period > m ? r.period : m), '');
    const out = [];
    let [y, m] = state.periods[0].split('-').map(Number);
    for (let p = state.periods[0]; p <= end; p = `${y}-${pad2(m)}`) {
      out.push(p);
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return catOf(state.cat)?.quarterly ? out.filter((p) => Number(p.slice(5)) % 3 === 0) : out;
  }
  /** Month groups (from groupBy) with the missing months of monthAxis() added as zeros. */
  function fillMonths(groups) {
    const have = new Map(groups.filter((g) => g.key !== 'unknown').map((g) => [g.key, g]));
    for (const p of monthAxis()) if (!have.has(p)) have.set(p, { key: p, ...agg([]), rows: [] });
    return [...have.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Admission & Discharge by month: cases handled and incentive per case (sales / collection by month are in the target card). */
  function renderMonthly(t) {
    const c = catOf(state.cat);
    if (!c?.cases) return;
    const groups = fillMonths(groupBy(state.rows.filter((r) => matches(r, { skipPeriod: true })), 'period'));
    const labels = groups.map((g) => periodLabel(g.key));
    if (!groups.length) { emptyChart('cMonA', 'No data'); emptyChart('cMonB', 'No data'); return; }
    const small = (title) => ({
      ...base(t),
      title: { text: title, left: 0, top: 0, textStyle: { color: t.text2, fontSize: 12.5, fontWeight: 600 } },
      grid: { left: 8, right: 16, top: 34, bottom: 24, containLabel: true },
      xAxis: monthCatAxis(t, groups.map((g) => g.key), labels),
    });
    const bars = (vals, color, fmt) => ({
      type: 'bar', barMaxWidth: 34,
      data: vals.map((v) => ({ value: v, itemStyle: { color, borderRadius: [4, 4, 0, 0] } })),
      label: { show: groups.length <= 8, position: 'top', color: t.text2, fontSize: 11, formatter: (p) => (p.value == null ? '' : fmt(p.value)) },
    });
    if (c.cases) {
      groups.forEach((g) => { g.cases = casesOf(g.rows); g.perCase = g.cases ? g.incentives / g.cases : null; });
      $('#tMonthly').textContent = 'Cases & incentive per case';
      $('#monthlyNote').textContent = 'Cases = “Number of report” in each month’s file · a month without a file shows 0';
      chart('cMonA').setOption({
        ...small('Cases handled'),
        yAxis: valueAxis(t, (v) => nfFull.format(v)),
        tooltip: { ...shadowTip(t), formatter: (ps) => { const g = groups[ps[0].dataIndex]; return `<b>${labels[ps[0].dataIndex]}</b>${tipRow(t.s1, 'Cases', nfFull.format(g.cases || 0))}${tipRow(t.muted, 'Incentives', money(g.incentives))}${tipRow(t.muted, 'Staff', g.doctors)}`; } },
        series: [bars(groups.map((g) => g.cases || 0), t.s1, (v) => nfFull.format(v))],
      }, true);
      chart('cMonB').setOption({
        ...small(`Incentive per case (${CURRENCY})`),
        yAxis: valueAxis(t),
        tooltip: { ...shadowTip(t), formatter: (ps) => { const g = groups[ps[0].dataIndex]; return `<b>${labels[ps[0].dataIndex]}</b>${tipRow(t.mInc, 'Incentive per case', g.perCase == null ? '—' : money(g.perCase))}${tipRow(t.muted, 'Incentives', money(g.incentives))}${tipRow(t.muted, 'Cases', nfFull.format(g.cases || 0))}`; } },
        series: [bars(groups.map((g) => (g.perCase == null ? 0 : g.perCase)), t.mInc, compact)],
      }, true);
      return;
    }
  }

  /**
   * Staff cost & efficiency by month. Left: what the staff cost, salary (the base) + incentives
   * (paid on top), stacked. Right, one line: revenue per 1 EGP of that cost where there is revenue
   * (revenue by month itself is in "Target, revenue & incentives"), else the headcount.
   */
  function renderTrend(t) {
    const rows = state.rows.filter((r) => matches(r, { skipPeriod: true }));
    const groups = fillMonths(groupBy(rows, 'period'));
    const keys = groups.map((g) => g.key);
    const labels = groups.map((g) => periodLabel(g.key));
    const rev = state.hasRevenue;
    // months whose file has no salary column (while other months have salaries)
    const noSalary = groups.some((g) => g.salary > 0) ? groups.filter((g) => g.incentives > 0 && !g.salary) : [];
    const R = revLabel();
    const isMeasure = !!catOf(state.cat)?.measure;
    const byDept = !!(catOf(state.cat)?.other || catOf(state.cat)?.perDept); // paid per department, not per person
    $('#tTrend').textContent = isMeasure ? 'Staff cost & incentive rate' : rev ? 'Staff cost & efficiency' : byDept ? 'Staff cost & departments paid' : 'Staff cost & headcount';
    $('#trendNote').textContent = groups.length < 2
      ? 'Only one month so far — the trend fills in as months are added.'
      : `Salary + incentives per month, and ${isMeasure ? `incentives per 100 EGP of ${R.toLowerCase()}` : rev ? `${R.toLowerCase()} per 1 EGP of that cost` : byDept ? 'the number of departments paid' : 'the number of people paid'} · a month without a file shows 0${missingNote(rows)}${noSalary.length ? ` · no salaries in the file for ${noSalary.map((g) => periodLabel(g.key)).join(', ')}` : ''}`;
    if (!groups.length) { emptyChart('cTrendRev', 'No data'); emptyChart('cTrendCost', 'No data'); return; }
    const xAxis = monthCatAxis(t, keys, labels);
    const title = (text) => ({ text, left: 0, top: 0, textStyle: { color: t.text2, fontSize: 12.5, fontWeight: 600 } });
    const grid = { left: 8, right: 16, top: 34, bottom: 24, containLabel: true };
    chart('cTrendCost').setOption({
      ...base(t), grid, xAxis, yAxis: valueAxis(t),
      title: title('Staff cost'),
      legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 } },
      tooltip: { ...shadowTip(t), formatter: (ps) => {
        const g = groups[ps[0].dataIndex];
        return `<b>${labels[ps[0].dataIndex]}</b>${tipRow(t.mSalary, 'Salary', money(g.salary))}${tipRow(t.mInc, 'Incentives', money(g.incentives))}${tipRow(t.muted, 'Total cost', money(g.cost))}${tipRow(t.muted, 'Incentive ÷ salary', pct(g.incRate))}`;
      } },
      series: [
        // 2px surface gap between the stacked parts, rounded only at the top of the column
        { name: 'Salary', type: 'bar', stack: 'c', barMaxWidth: 34, color: t.mSalary, itemStyle: { borderColor: t.surface, borderWidth: 1 }, data: groups.map((g) => g.salary) },
        { name: 'Incentives', type: 'bar', stack: 'c', barMaxWidth: 34, color: t.mInc, itemStyle: { borderColor: t.surface, borderWidth: 1, borderRadius: [4, 4, 0, 0] },
          data: groups.map((g) => g.incentives),
          label: { show: groups.length <= 8, position: 'top', color: t.text2, fontSize: 11, formatter: (p) => (groups[p.dataIndex].cost ? compact(groups[p.dataIndex].cost) : '') } },
      ],
    }, true);
    // Programmes measured on sales / collection: the incentive rate, not a "return" on their staff cost.
    const measure = !!catOf(state.cat)?.measure;
    const heads = (g) => (byDept ? deptCount(g.rows) : g.doctors);
    const val = (g) => (measure ? g.revRate : rev ? g.roi : heads(g));
    const fmt = measure ? (v) => pct(v, 2) : rev ? times : (v) => nfFull.format(v || 0);
    const last = groups.map((g, i) => (val(g) != null && (rev ? g.revenue > 0 : heads(g) > 0) ? i : -1)).filter((i) => i >= 0).pop();
    chart('cTrendRev').setOption({
      ...base(t), grid, xAxis,
      yAxis: { ...valueAxis(t, measure ? (v) => `${(v * 100).toFixed(2)}%` : rev ? (v) => `${v}×` : (v) => v), min: rev ? 0 : undefined, minInterval: rev ? undefined : 1 },
      title: title(measure ? `Incentives per 100 EGP of ${R.toLowerCase()}` : rev ? `${R} per 1 EGP of staff cost` : byDept ? 'Departments paid' : 'People paid'),
      tooltip: { ...base(t).tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.axis } }, formatter: (ps) => {
        const g = groups[ps[0].dataIndex];
        if (measure) return `<b>${labels[ps[0].dataIndex]}</b>${tipRow(t.mInc, `Incentives ÷ ${R.toLowerCase()}`, pct(g.revRate, 2))}${tipRow(t.muted, R, money(g.revenue))}${tipRow(t.muted, 'Incentives', money(g.incentives))}`;
        return rev
          ? `<b>${labels[ps[0].dataIndex]}</b>${tipRow(t.mRev, `${R} ÷ staff cost`, times(g.roi))}${tipRow(t.muted, R, money(g.revenue))}${tipRow(t.muted, 'Staff cost', money(g.cost))}`
          : byDept ? `<b>${labels[ps[0].dataIndex]}</b>${tipRow(t.mRev, 'Departments paid', heads(g))}${tipRow(t.muted, 'Cost per department', money(safeDiv(g.cost, heads(g))))}`
            : `<b>${labels[ps[0].dataIndex]}</b>${tipRow(t.mRev, 'People paid', g.doctors)}${tipRow(t.muted, 'Cost per person', money(safeDiv(g.cost, g.n)))}`;
      } },
      series: [{
        type: 'line', color: t.mRev, lineStyle: { width: 2 }, symbol: 'circle', symbolSize: 8, connectNulls: false,
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        areaStyle: { color: t.mRev, opacity: 0.08 },
        // a month without data is a gap in the line, not a drop to 0
        data: groups.map((g) => ((rev ? g.revenue > 0 : heads(g) > 0) ? val(g) : null)),
        // the latest value labelled at the end of the line
        label: { show: true, position: 'top', color: t.text, fontSize: 11, fontWeight: 600, formatter: (p) => (p.dataIndex === last ? fmt(p.value) : '') },
      }],
    }, true);
  }

  // ======================= executive views =======================
  // Year to date & outlook, incentive vs result, achievement by month, cost per unit of work,
  // everything paid to one person, the data check (admin) and the monthly summary.
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PERIOD_RX = /^\d{4}-\d{2}$/;
  const monthNo = (p) => Number(p.slice(5, 7));
  const prevMonth = (p) => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`; };
  /** A row as a page counts it: sales / collection only on their own page; quarterly lines as a basis elsewhere. */
  const asOnPage = (r, cat) => {
    const c = catOf(r.category);
    const show = !c?.measure || cat === r.category;
    return { ...r, revenue: show ? r._revenue : 0, target: show ? r._target : null, _basis: !!c?.basis && cat !== r.category };
  };
  /** The year these views look at: the latest selected month's, else the latest month with data. */
  function focusYear(rows) {
    const sel = [...state.months].sort();
    if (sel.length) return yearOf(sel[sel.length - 1]);
    const ps = rows.map((r) => r.period).filter((p) => PERIOD_RX.test(p)).sort();
    return ps.length ? yearOf(ps[ps.length - 1]) : String(new Date().getFullYear());
  }
  /**
   * The months of a year that are complete for these rows: every category paid in most months
   * (3 of 4) is in. A month with only some files (two programmes paid ahead) is partial.
   */
  function completeMonths(rows, year) {
    const byMonth = new Map();
    for (const r of rows) {
      if (!PERIOD_RX.test(r.period) || yearOf(r.period) !== year) continue;
      (byMonth.get(r.period) || byMonth.set(r.period, new Set()).get(r.period)).add(r.category);
    }
    const months = [...byMonth.keys()].sort();
    const freq = new Map();
    for (const s of byMonth.values()) for (const c of s) freq.set(c, (freq.get(c) || 0) + 1);
    const core = [...freq].filter(([, n]) => n >= Math.max(1, months.length * 0.75)).map(([c]) => c);
    const complete = months.filter((p) => core.every((c) => byMonth.get(p).has(c)));
    return { months, complete, core, partial: months.filter((p) => !complete.includes(p)) };
  }
  /**
   * Year to date and a year-end outlook: what the complete months add up to, and the months left
   * at the pace of the last 3 months (months without a payment count as 0, so programmes paid
   * every quarter are spread over it). `upTo` stops the year at that month (the monthly summary).
   */
  function ytdModel(scoped, year, upTo = null) {
    const { complete, partial } = completeMonths(scoped, year);
    const done = complete.filter((p) => !upTo || p <= upTo);
    if (!done.length) return null;
    const last = done[done.length - 1];
    const remaining = 12 - monthNo(last);
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
    const per = new Map(months.map((p) => [p, agg(scoped.filter((r) => r.period === p))]));
    const upToLast = months.filter((p) => p <= last);
    const sum = (list, k) => list.reduce((x, p) => x + (per.get(p)[k] || 0), 0);
    const keys = ['revenue', 'targetSum', 'revWithTarget', 'incentives', 'salary', 'cost'];
    const ytd = Object.fromEntries(keys.map((k) => [k, sum(upToLast, k)]));
    const recent = upToLast.slice(-3);
    const pace = Object.fromEntries(keys.map((k) => [k, sum(recent, k) / recent.length]));
    const proj = Object.fromEntries(keys.map((k) => [k, ytd[k] + pace[k] * remaining]));
    return {
      year, last, remaining, months, per, ytd, pace, proj, recent,
      partial: partial.filter((p) => p > last && (!upTo || p <= upTo)),
      achievement: safeDiv(ytd.revWithTarget, ytd.targetSum),
      projAchievement: safeDiv(proj.revWithTarget, proj.targetSum),
    };
  }
  const monthSpan = (m) => (monthNo(m.last) === 1 ? `Jan ${m.year}` : `Jan–${MONTH_ABBR[monthNo(m.last) - 1]} ${m.year}`);

  function renderYtd(t) {
    const card = $('#ytdCard');
    const scoped = state.rows.filter((r) => matches(r, { skipPeriod: true }));
    const m = scoped.length && !isCensusCat(state.cat) ? ytdModel(scoped, focusYear(scoped)) : null;
    card.classList.toggle('hidden', !m);
    if (!m) return;
    const R = revLabel();
    const rev = state.hasRevenue && m.ytd.revenue > 0;
    const hasTarget = rev && m.ytd.targetSum > 0;
    const left = m.remaining;
    const need = hasTarget && left ? (m.proj.targetSum - m.ytd.revWithTarget) / left : null;
    $('#ytdTitle').textContent = `${m.year}: year to date & year-end outlook`;
    $('#ytdNote').textContent = `${monthSpan(m)} (${monthNo(m.last)} month${monthNo(m.last) === 1 ? '' : 's'}) · ${left
      ? `the ${left} month${left === 1 ? '' : 's'} left at the pace of ${m.recent.map((p) => MONTH_ABBR[monthNo(p) - 1]).join(', ')}`
      : 'the whole year is in'}${hasTarget && left ? ' · the target at the same pace' : ''}${m.partial.length
      ? ` · ${m.partial.map(periodLabel).join(', ')} not counted yet: only some of its files are in` : ''} · the whole year, whatever months are selected`;
    const stat = (label, value, sub, cls = '') => `<div class="tg-stat ${cls}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
    const items = [];
    if (rev) {
      items.push(stat(`${R} year to date`, compact(m.ytd.revenue), hasTarget ? `${achFmt(m.achievement)} of ${compact(m.ytd.targetSum)} target` : monthSpan(m), hasTarget ? (m.achievement >= 1 ? 'good' : 'bad') : ''));
      if (left) items.push(stat(`${R} by year end`, compact(m.proj.revenue), hasTarget ? `${achFmt(m.projAchievement)} of the year’s target at this pace` : `${compact(m.pace.revenue)} a month at this pace`, hasTarget ? (m.projAchievement >= 1 ? 'good' : 'bad') : ''));
      if (need != null) items.push(stat('To reach the year’s target', `${compact(Math.max(0, need))}<em>/month</em>`, need <= m.pace.revenue ? `on track: ${compact(m.pace.revenue)} a month lately` : `${pct(safeDiv(need - m.pace.revenue, m.pace.revenue), 0)} more than the last 3 months`, need <= m.pace.revenue ? 'good' : 'bad'));
    }
    items.push(stat('Incentives year to date', compact(m.ytd.incentives), rev ? `${pct(safeDiv(m.ytd.incentives, m.ytd.revenue), 2)} of ${R.toLowerCase()}` : m.ytd.salary ? `${pct(safeDiv(m.ytd.incentives, m.ytd.salary))} of salaries` : monthSpan(m)));
    if (left) items.push(stat('Incentives by year end', compact(m.proj.incentives), `${compact(m.pace.incentives)} a month at this pace`));
    if (m.ytd.cost) items.push(stat('Staff cost year to date', compact(m.ytd.cost), rev ? `${R} ÷ staff cost ${times(safeDiv(m.ytd.revenue, m.ytd.cost))}` : 'Salaries + incentives'));
    $('#ytdSummary').innerHTML = items.join('');

    // cumulative lines: actual to the last complete month, the outlook dashed to December
    const lastIdx = monthNo(m.last) - 1;
    const cum = (k) => { let s = 0; return m.months.map((p, i) => { s += i <= lastIdx ? m.per.get(p)[k] || 0 : m.pace[k]; return s; }); };
    const split = (arr) => [arr.map((v, i) => (i <= lastIdx ? v : null)), arr.map((v, i) => (i >= lastIdx ? v : null))];
    const labels = MONTH_ABBR;
    const grid = { left: 8, right: 16, top: 40, bottom: 24, containLabel: true };
    const xAxis = { type: 'category', data: labels, boundaryGap: false, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 11 } };
    const line = (name, data, color, dashed = false, width = 2) => ({
      name, type: 'line', data, color, connectNulls: false, symbol: 'circle', symbolSize: dashed ? 0 : 7, showSymbol: !dashed,
      lineStyle: { width, type: dashed ? 'dashed' : 'solid' }, itemStyle: { borderColor: t.surface, borderWidth: 2 },
    });
    const lastLabel = (arr, fmt) => ({ show: true, position: 'top', color: t.text, fontSize: 11, fontWeight: 600, formatter: (p) => (p.dataIndex === 11 || (!left && p.dataIndex === lastIdx) ? fmt(p.value) : '') });
    const draw = (id, title, key, color, withTarget) => {
      const [act, out] = split(cum(key));
      const series = [line(title, act, color), { ...line('Outlook', out, color, true), label: lastLabel(out, compact) }];
      if (withTarget) {
        const [ta, to] = split(cum('targetSum'));
        series.unshift(line('Target', ta, t.mTarget, false, 2), { ...line('Target (same pace)', to, t.mTarget, true), label: lastLabel(to, compact) });
      }
      chart(id).setOption({
        ...base(t), grid, xAxis, yAxis: valueAxis(t),
        title: { text: `${title} · cumulative`, left: 0, top: 0, textStyle: { color: t.text2, fontSize: 12.5, fontWeight: 600 } },
        legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 }, data: series.map((s) => s.name).filter((n) => !/Target \(/.test(n)) },
        tooltip: {
          ...base(t).tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.axis } },
          formatter: (ps) => {
            const i = ps[0].dataIndex;
            const rows = ps.filter((p) => p.value != null && !(i === lastIdx && /Outlook|same pace/.test(p.seriesName)))
              .map((p) => tipRow(p.color, p.seriesName, money(p.value))).join('');
            return `<b>${labels[i]} ${m.year}${i > lastIdx ? ' · outlook' : ''}</b>${rows}`;
          },
        },
        series,
      }, true);
    };
    const wrap = $('#ytdCard .ytd-wrap');
    wrap.classList.toggle('one', !rev);
    $('#cYtdInc').classList.toggle('hidden', !rev);
    if (rev) { draw('cYtdRev', R, 'revenue', t.mRev, hasTarget); draw('cYtdInc', 'Incentives', 'incentives', t.mInc, false); } else draw('cYtdRev', 'Incentives', 'incentives', t.mInc, false);
    chart('cYtdRev').resize(); if (rev) chart('cYtdInc').resize();
  }

  /** Does the incentive follow the result? Each person with a target: achievement across, incentive ÷ salary up. */
  let alignPeople = [];
  function renderAlign(t) {
    const card = $('#alignCard');
    const people = state.hasRevenue ? byDoctor(filtered.filter((r) => !r.level && r.target > 0)).filter((d) => d.target > 0 && d.salary > 0) : [];
    card.classList.toggle('hidden', people.length < 4);
    if (people.length < 4) return;
    const rate = (d) => d.incentives / d.salary;
    const rates = people.map(rate).sort((a, b) => a - b);
    const mid = rates.length % 2 ? rates[(rates.length - 1) / 2] : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;
    const w = (l) => safeDiv(l.reduce((x, d) => x + d.incentives, 0), l.reduce((x, d) => x + d.salary, 0));
    const low = people.filter((d) => d.achievement < 0.8);
    const near = people.filter((d) => d.achievement >= 0.8 && d.achievement < 1);
    const met = people.filter((d) => d.achievement >= 1);
    const paidNoResult = people.filter((d) => d.achievement < 1 && rate(d) > mid);
    const resultNoPay = people.filter((d) => d.achievement >= 1 && rate(d) < mid);
    const who = state.cat ? catOf(state.cat).who : 'people';
    const stat = (label, value, sub, cls = '') => `<div class="tg-stat ${cls}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
    const n = (l) => `${l.length} ${l.length === 1 ? 'person' : 'people'}`;
    $('#alignSummary').innerHTML = [
      stat('Below 80% of target', n(low), `paid ${pct(w(low))} of salary`),
      stat('80–100% of target', n(near), `paid ${pct(w(near))} of salary`),
      stat('Target met', n(met), `paid ${pct(w(met))} of salary`, 'good'),
      stat('Below target, paid above the median', n(paidNoResult), paidNoResult.length ? 'worth a look' : 'none', paidNoResult.length ? 'bad' : ''),
      stat('Target met, paid below the median', n(resultNoPay), resultNoPay.length ? 'worth a look' : 'none'),
    ].join('');
    const lowW = w(low); const metW = w(met);
    $('#alignVerdict').innerHTML = low.length && met.length
      ? (metW > lowW
        ? `<b>Yes, mostly.</b> Those who met their target were paid <b>${pct(metW)}</b> of their salary in incentives, those below 80% of it <b>${pct(lowW)}</b> — ${times(safeDiv(metW, lowW))} as much.`
        : `<b>Not clearly.</b> Those below 80% of their target were paid <b>${pct(lowW)}</b> of their salary in incentives, as much as or more than those who met it (<b>${pct(metW)}</b>).`)
      : `${people.length} ${who} with a target in the selected months.`;
    $('#alignNote').textContent = `${selection().label} · each dot is one of ${people.length} ${who} with a target · across: target achievement · up: incentives ÷ salary · lines: the target (100%) and the median incentive (${pct(mid)})`;
    const cap = 200;
    const pt = (d) => ({ value: [Math.min(d.achievement * 100, cap), rate(d) * 100], d });
    const inLine = people.filter((d) => !paidNoResult.includes(d) && !resultNoPay.includes(d));
    alignPeople = people;
    const ser = (name, list, color) => ({ name, type: 'scatter', symbolSize: 10, data: list.map(pt), itemStyle: { color, opacity: 0.85, borderColor: t.surface, borderWidth: 1 } });
    const maxY = Math.max(10, ...people.map((d) => rate(d) * 100));
    chart('cAlign').setOption({
      ...base(t),
      grid: { left: 8, right: 24, top: 36, bottom: 30, containLabel: true },
      legend: { top: 0, right: 0, icon: 'circle', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 } },
      tooltip: {
        ...base(t).tooltip, trigger: 'item',
        formatter: (p) => {
          const d = p.data.d;
          return `${tipHead(t, d)}${tipRow(t.mRev, 'Target achievement', achFmt(d.achievement))}${tipRow(t.mInc, 'Incentives ÷ salary', pct(rate(d)))}${tipRow(t.muted, 'Incentives', money(d.incentives))}${tipRow(t.muted, 'Salary', money(d.salary))}${tipRow(t.muted, `${revLabel()} / target`, `${compact(d.revWithTarget)} / ${compact(d.target)}`)}${d.achievement * 100 > cap ? `<div style="color:${t.muted}">Shown at ${cap}%</div>` : ''}`;
        },
      },
      xAxis: { type: 'value', min: 0, max: Math.min(cap, niceCeil(Math.max(120, ...people.map((d) => d.achievement * 100)))), name: 'Target achievement', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: t.muted, fontSize: 11 }, axisLabel: { color: t.muted, formatter: (v) => `${v}%`, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'value', min: 0, max: niceCeil(maxY), axisLabel: { color: t.muted, formatter: (v) => `${v}%`, fontSize: 11 }, splitLine: { lineStyle: { color: t.grid } } },
      series: [
        { ...ser('In line', inLine, t.neutral), markLine: { silent: true, symbol: 'none', lineStyle: { color: t.axis, type: 'dashed', width: 1.5 }, label: { color: t.muted, fontSize: 11 }, data: [{ xAxis: 100, label: { formatter: 'Target', position: 'end' } }, { yAxis: mid * 100, label: { formatter: `Median ${pct(mid)}`, position: 'insideEndTop' } }] } },
        ser('Below target, paid above the median', paidNoResult, t.neg),
        ser('Target met, paid below the median', resultNoPay, t.pos),
      ],
    }, true);
    const c = chart('cAlign');
    c.off('click');
    c.on('click', (p) => p.data?.d && openDoctor(p.data.d.last));
  }

  /** Target achievement by unit and month, weakest first; a person per line on a specialty page. */
  const HEAT_STEPS = [[0.7, 'lo', 72], [0.85, 'lo', 48], [0.95, 'lo', 28], [1, 'lo', 14], [1.05, 'hi', 14], [1.15, 'hi', 28], [1.3, 'hi', 48], [Infinity, 'hi', 72]];
  const heatCell = (v) => { const s = HEAT_STEPS.find(([hi]) => v < hi); return { cls: `${s[1]}${s[2] >= 48 ? ' strong' : ''}`, mix: s[2] }; };
  function renderHeat() {
    const card = $('#heatCard');
    const all = state.rows.filter((r) => matches(r, { skipPeriod: true }));
    const year = focusYear(all);
    const rows = state.hasRevenue ? all.filter((r) => r.target > 0 && yearOf(r.period) === year) : [];
    card.classList.toggle('hidden', !rows.length);
    if (!rows.length) return;
    const byPerson = !!state.dept && rows.some((r) => !r.level);
    const keyOf = byPerson ? personKey : (r) => r.specialty;
    const months = [...new Set(rows.map((r) => r.period))].sort();
    const units = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const u = units.get(k) || units.set(k, { key: k, label: byPerson ? r.name : r.specialty, cat: r.category, rows: [] }).get(k);
      u.rows.push(r);
    }
    const ach = (list) => { const a = agg(list); return a.targetSum ? { v: a.revWithTarget / a.targetSum, a } : null; };
    const list = [...units.values()].map((u) => ({ ...u, ytd: ach(u.rows) })).filter((u) => u.ytd).sort((a, b) => a.ytd.v - b.ytd.v);
    const unitWord = byPerson ? 'person' : state.cat ? catOf(state.cat).unit : 'specialty';
    $('#heatTitle').textContent = `Target achievement by ${byPerson ? 'person' : unitWord.split(' / ')[0]} and month · ${year}`;
    $('#heatNote').textContent = `${list.length} ${byPerson ? (list.length === 1 ? 'person' : 'people') : list.length === 1 ? unitWord : pluralUnit(unitWord)} with a target · weakest first · ${revLabel().toLowerCase()} ÷ target in each month · click a cell to open it`;
    const sel = state.months;
    const td = (u, p, r) => {
      if (!r) return '<td class="hc none">—</td>';
      const { cls, mix } = heatCell(r.v);
      return `<td class="hc ${cls}" style="--mix:${mix}%" data-unit="${esc(u.key)}" data-p="${p}" title="${esc(u.label)} · ${periodLabel(p)}: ${achFmt(r.v)} (${compact(r.a.revWithTarget)} of ${compact(r.a.targetSum)})">${achFmt(r.v)}</td>`;
    };
    const total = { key: '__all', label: 'All', rows };
    const line = (u, cls = '') => `<tr class="${cls}"><th class="hl" title="${esc(u.label)}">${esc(u.label)}</th>${months.map((p) => td(u, p, ach(u.rows.filter((r) => r.period === p)))).join('')}${td(u, 'ytd', ach(u.rows))}</tr>`;
    $('#heatTable').innerHTML = `<thead><tr><th></th>${months.map((p) => `<th class="${sel.has(p) ? 'sel' : ''}">${MONTH_ABBR[monthNo(p) - 1]}</th>`).join('')}<th>Year</th></tr></thead>
      <tbody>${list.length > 1 ? line(total, 'total') : ''}${list.map((u) => line(u)).join('')}</tbody>`;
    $('#heatLegend').innerHTML = [['< 70%', 'lo', 72], ['70–85', 'lo', 48], ['85–95', 'lo', 28], ['95–100', 'lo', 14], ['100–105', 'hi', 14], ['105–115', 'hi', 28], ['115–130', 'hi', 48], ['> 130%', 'hi', 72]]
      .map(([l, c, m]) => `<span class="hl-sw ${c}" style="--mix:${m}%"></span><span>${l}</span>`).join('');
    card._heat = { byPerson, units, rows };
  }
  $('#heatTable').addEventListener('click', (e) => {
    const cell = e.target.closest('td[data-unit]');
    const h = $('#heatCard')._heat;
    if (!cell || !h) return;
    const { unit, p } = cell.dataset;
    if (h.byPerson) {
      const rs = h.rows.filter((r) => personKey(r) === unit && (p === 'ytd' || r.period === p)).sort((a, b) => b.period.localeCompare(a.period));
      if (rs[0]) openDoctor(rs[0]);
      return;
    }
    if (p !== 'ytd') state.months = new Set([p]);
    if (unit === '__all') { onFilterChange(); return; }
    const u = h.units.get(unit);
    const href = deptHref(unit, state.cat || u?.cat || catForUnit(unit));
    if (location.hash === href) onFilterChange(); else location.hash = href;
  });

  /** Cost per unit of work: a department's volume (tests, operations, visits…) against its money. */
  const MONEY_LABEL = /income|revenue|payment|amount|collect|sales|egp/i;
  const volumeOf = (r) => {
    if (!r.level || !r.metrics) return null;
    const e = Object.entries(r.metrics).find(([l, v]) => !MONEY_LABEL.test(l) && Number.isFinite(Number(v)) && Number(v) > 0);
    return e ? { label: e[0], value: Number(e[1]) } : null;
  };
  function spark(values, color = 'var(--m-inc)', hi = -1, W = 88) {
    const nums = values.filter((x) => Number.isFinite(x));
    if (nums.length < 2) return '';
    const H = W > 100 ? 34 : 24; const lo = Math.min(...nums); const span = Math.max(...nums) - lo || 1;
    const xy = values.map((x, i) => (Number.isFinite(x) ? [2 + (i / (values.length - 1)) * (W - 4), H - 3 - ((x - lo) / span) * (H - 6)] : null));
    let d = ''; let pen = false;
    for (const q of xy) { if (!q) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`; pen = true; }
    const lastI = xy.map((q, i) => (q ? i : -1)).filter((i) => i >= 0).pop();
    const mark = (i, fill) => (xy[i] ? `<circle cx="${xy[i][0].toFixed(1)}" cy="${xy[i][1].toFixed(1)}" r="2.6" style="fill:${fill}"/>` : '');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}" fill="none" style="stroke:${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>${mark(lastI, color)}${hi >= 0 && hi !== lastI ? mark(hi, 'var(--text)') : ''}</svg>`;
  }
  function renderUnitCost() {
    const card = $('#unitCard');
    const all = state.cat ? state.rows.filter((r) => matches(r, { skipPeriod: true })) : [];
    const withVol = all.filter(volumeOf);
    card.classList.toggle('hidden', !withVol.length);
    if (!withVol.length) return;
    const year = focusYear(all);
    const months = [...new Set(withVol.filter((r) => yearOf(r.period) === year).map((r) => r.period))].sort();
    const inSel = (p) => !state.months.size || state.months.has(p);
    const cell = (unit, p) => {
      const rs = all.filter((r) => r.specialty === unit && r.period === p);
      const v = rs.map(volumeOf).find(Boolean);
      if (!v) return null;
      const a = agg(rs);
      return { label: v.label, vol: v.value, rev: a.revenue, inc: a.incentives, cost: a.cost, people: a.doctors };
    };
    const per = (c, k) => (c && c.vol ? c[k] / c.vol : null);
    const sum = (cells) => { const ok = cells.filter(Boolean); if (!ok.length) return null; const o = { label: ok[0].label, vol: 0, rev: 0, inc: 0, cost: 0, people: Math.max(...ok.map((c) => c.people)), months: ok.length }; for (const c of ok) { o.vol += c.vol; o.rev += c.rev; o.inc += c.inc; o.cost += c.cost; } return o; };
    const money2 = (v) => (v == null ? '—' : v >= 100 ? nfFull.format(Math.round(v)) : v.toFixed(v >= 10 ? 1 : 2));
    const selIdx = months.findIndex((p) => state.months.size === 1 && state.months.has(p));
    if (!state.dept) {
      const units = [...new Set(withVol.map((r) => r.specialty))].sort();
      const lines = units.map((u) => {
        const cs = months.map((p) => cell(u, p));
        const s = sum(months.filter(inSel).map((p, i) => cs[months.indexOf(p)]));
        return { u, cs, s };
      }).filter((x) => x.s);
      $('#unitNote').textContent = `${selection().label} · per unit of each department’s own measure, from the figures above its table · months without the figure are left out · the line: incentive per unit through ${year}`;
      $('#unitTable').innerHTML = `<thead><tr><th>Department</th><th>Measure</th><th class="num">Volume</th><th class="num">Revenue / unit</th><th class="num">Incentive / unit</th><th class="num">Staff cost / unit</th><th class="num">Revenue ÷ staff cost</th><th>Incentive / unit by month</th></tr></thead>
        <tbody>${lines.map(({ u, cs, s }) => `<tr data-unit="${esc(u)}"><td class="name">${esc(u)}</td><td><span class="tag">${esc(s.label)}</span></td><td class="num">${nfFull.format(Math.round(s.vol))}</td>
          <td class="num">${money2(s.rev / s.vol)}</td><td class="num"><b>${money2(s.inc / s.vol)}</b></td><td class="num">${money2(s.cost / s.vol)}</td><td class="num">${times(safeDiv(s.rev, s.cost))}</td>
          <td>${spark(cs.map((c) => per(c, 'inc')), 'var(--m-inc)', selIdx)}</td></tr>`).join('')}</tbody>`;
    } else {
      const cs = months.map((p) => cell(state.dept, p));
      const s = sum(months.filter(inSel).map((p) => cs[months.indexOf(p)]));
      const label = cs.find(Boolean)?.label || 'unit';
      $('#unitNote').textContent = `Per unit of “${label}”, from the figures above the department’s table · selected months highlighted`;
      $('#unitTable').innerHTML = `<thead><tr><th>Month</th><th class="num">${esc(label)}</th><th class="num">Revenue / unit</th><th class="num">Incentive / unit</th><th class="num">Staff cost / unit</th><th class="num">Staff</th></tr></thead>
        <tbody>${months.map((p, i) => { const c = cs[i]; return `<tr class="${inSel(p) ? 'sel' : ''}"><td>${periodLabel(p)}</td>${c ? `<td class="num">${nfFull.format(c.vol)}</td><td class="num">${money2(per(c, 'rev'))}</td><td class="num"><b>${money2(per(c, 'inc'))}</b></td><td class="num">${money2(per(c, 'cost'))}</td><td class="num">${c.people}</td>` : '<td class="num muted" colspan="5">No figure in the file</td>'}</tr>`; }).join('')}</tbody>
        ${s && s.months > 1 ? `<tfoot><tr><td>${esc(selection().label)}</td><td class="num">${nfFull.format(Math.round(s.vol))}</td><td class="num">${money2(s.rev / s.vol)}</td><td class="num">${money2(s.inc / s.vol)}</td><td class="num">${money2(s.cost / s.vol)}</td><td class="num">${s.people}</td></tr></tfoot>` : ''}`;
    }
  }
  $('#unitTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-unit]');
    if (tr) location.hash = deptHref(tr.dataset.unit, state.cat);
  });

  /** Branches side by side by category (overview, all branches). */
  function renderBranchCats() {
    const el = $('#branchCatTable');
    if (!el || $('#branchCard').classList.contains('hidden')) return;
    const rows = state.rows.filter((r) => inPeriod(r) && !isCensusCat(r.category) && (!state.mix || state.mix.has(r.category)));
    const has = BRANCHES.filter((b) => rows.some((r) => r.branch === b));
    const cats = CATS.filter((c) => !c.census && rows.some((r) => r.category === c.key));
    const head = (label) => BRANCHES.map((b) => `<th class="num">${label}<small>${esc(b.replace('SGH-', ''))}</small></th>`).join('');
    el.innerHTML = `<thead><tr><th>Category</th>${head('Incentives')}${head('Revenue / measure')}${head('Staff')}${head('Target achv.')}</tr></thead>
      <tbody>${cats.map((c) => {
        const byB = BRANCHES.map((b) => { const list = rows.filter((r) => r.branch === b && r.category === c.key); const a = agg(list.map((r) => asOnPage(r, c.key))); return { a, list }; });
        const col = (f) => byB.map(({ a, list }) => `<td class="num">${list.length ? f(a, list) : '<span class="muted">—</span>'}</td>`).join('');
        return `<tr data-cat="${c.key}"><td class="name">${esc(c.label)}</td>${col((a) => compact(a.incentives))}${col((a) => (a.revenue ? `${compact(a.revenue)}${c.measure ? ` <small class="muted">${esc(c.measure.toLowerCase())}</small>` : ''}` : '—'))}${col((a, list) => (c.perDept || c.other ? `${deptCount(list)} dept.` : nfFull.format(a.doctors)))}${col((a) => (a.targetSum ? achFmt(a.achievement) : '—'))}</tr>`;
      }).join('')}</tbody>`;
    $('#branchCatNote').textContent = has.length < BRANCHES.length
      ? `${BRANCHES.filter((b) => !has.includes(b)).join(', ')}: no data yet — the columns fill in as its files are uploaded`
      : 'Each category in each branch, for the selected months · click a row to open the category';
  }
  $('#branchCatTable').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-cat]');
    if (tr) location.hash = catHref(tr.dataset.cat);
  });

  // ---------------- data check (admin) ----------------
  let dqCache = { version: null, list: [] };
  function dataIssues() {
    if (dqCache.version === state.version && dqCache.rows === state.rows) return dqCache.list;
    const out = [];
    const add = (level, title, detail, where = {}) => out.push({ level, title, detail, ...where });
    const rows = state.rows.filter((r) => PERIOD_RX.test(r.period));
    const label = (c) => catOf(c)?.short || c;
    const at = (r) => ({ branch: r.branch, cat: r.category, dept: null, period: r.period });
    // no ID / name, negative amounts
    for (const r of rows) {
      if (!r.level && (!r.id || !r.name)) add('error', 'A line without ID or name', `${label(r.category)} · ${r.specialty} · ${periodLabel(r.period)} · ${r.file}`, at(r));
      if ([r.salary, r.incentives, r._revenue].some((v) => v < 0)) add('error', 'A negative amount', `${r.name} (${r.id}) · ${label(r.category)} · ${periodLabel(r.period)}`, at(r));
    }
    // groups by branch · category · month
    const groups = new Map();
    for (const r of rows) { if (isCensusCat(r.category)) continue; const k = `${r.branch}|${r.category}|${r.period}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
    const keyList = [...groups.keys()].sort();
    for (const k of keyList) {
      const [branch, cat, period] = k.split('|');
      const list = groups.get(k);
      const people = list.filter((r) => !r.level);
      const where = { branch, cat, dept: null, period };
      // the same person twice in a month of a programme
      const seen = new Map();
      for (const r of people) { const id = String(r.id); (seen.get(id) || seen.set(id, []).get(id)).push(r); }
      for (const [id, l] of seen) if (l.length > 1 && !catOf(cat)?.basis && !catOf(cat)?.other) add(new Set(l.map((r) => r.specialty)).size > 1 ? 'info' : 'warn', new Set(l.map((r) => r.specialty)).size > 1 ? 'Paid in two sections in one month' : 'The same person twice in one month', `${l[0].name} (${id}) · ${label(cat)} · ${periodLabel(period)}: ${l.map((r) => `${r.specialty} ${money(r.incentives)}`).join(' + ')}`, where);
      // a month copied from the month before
      const prev = groups.get(`${branch}|${cat}|${prevMonth(period)}`);
      if (prev && people.length >= 5) {
        const sig = new Set(prev.filter((r) => !r.level).map((r) => `${r.id}:${Math.round(r.incentives)}`));
        const same = people.filter((r) => sig.has(`${r.id}:${Math.round(r.incentives)}`)).length;
        if (same / people.length >= 0.8) add('error', 'A month looks copied from the month before', `${label(cat)} · ${periodLabel(period)}: ${same} of ${people.length} people have exactly the same incentive as in ${periodLabel(prevMonth(period))}`, where);
      }
      // salaries missing while the programme has them in other months
      if (people.length && people.every((r) => !r.salary) && people.some((r) => r.incentives > 0)) {
        const others = keyList.filter((x) => x !== k && x.startsWith(`${branch}|${cat}|`)).some((x) => groups.get(x).some((r) => !r.level && r.salary > 0));
        if (others) add('warn', 'No salaries in a month', `${label(cat)} · ${periodLabel(period)}: the file has incentives but no salaries (other months have them)`, where);
      }
      // nothing paid in a month
      if (list.length && list.every((r) => !r.incentives) && !catOf(cat)?.census) add('info', 'Nothing paid in a month', `${label(cat)} · ${periodLabel(period)}: every amount is 0`, where);
      // incentive far above salary
      const big = people.filter((r) => r.salary > 0 && r.incentives > 3 * r.salary);
      if (big.length) add('info', 'Incentives above 3× the salary', `${label(cat)} · ${periodLabel(period)}: ${big.slice(0, 3).map((r) => `${r.name} ${money(r.incentives)} on ${money(r.salary)}`).join(' · ')}${big.length > 3 ? ` · +${big.length - 3} more` : ''}`, where);
    }
    // department figures missing (closed departments)
    for (const b of BRANCHES) {
      for (const c of CATS) {
        const list = rows.filter((r) => r.branch === b && r.category === c.key);
        for (const [p, d] of monthsMissingFigures(list)) add('warn', 'Department figures missing', `${label(c.key)} · ${periodLabel(p)}: ${[...d].join(', ')} — revenue / target above the table`, { branch: b, cat: c.key, dept: d.size === 1 ? [...d][0] : null, period: p });
      }
    }
    // one ID, several names
    const names = new Map();
    for (const r of rows) { if (r.level || !r.id) continue; const k = `${r.branch}|${r.id}`; (names.get(k) || names.set(k, new Map()).get(k)).set(String(r.name).trim().toLowerCase(), r); }
    for (const [k, m] of names) if (m.size > 1) { const l = [...m.values()]; add('warn', 'One ID, several names', `${k.split('|')[1]}: ${l.map((r) => r.name).join(' / ')}`, at(l[l.length - 1])); }
    // a latest month with only some programmes
    for (const b of BRANCHES) {
      const list = rows.filter((r) => r.branch === b && !isCensusCat(r.category));
      const years = [...new Set(list.map((r) => yearOf(r.period)))];
      for (const y of years) {
        const { partial } = completeMonths(list, y);
        for (const p of partial) {
          const cats = [...new Set(list.filter((r) => r.period === p).map((r) => label(r.category)))];
          add('info', 'A month with only some programmes', `${b} · ${periodLabel(p)}: only ${cats.join(', ')} so far — the overview counts it as it is`, { branch: b, cat: null, dept: null, period: p });
        }
      }
    }
    const order = { error: 0, warn: 1, info: 2 };
    out.sort((a, b) => order[a.level] - order[b.level] || String(b.period).localeCompare(String(a.period)));
    dqCache = { version: state.version, rows: state.rows, list: out };
    return out;
  }
  function renderDataCheckBadge() {
    const btn = $('#dqBtn');
    const show = Viewers.isAdmin() && state.rows.length > 0;
    btn.classList.toggle('hidden', !show);
    if (!show) return;
    const list = dataIssues();
    const serious = list.filter((i) => i.level !== 'info').length;
    $('#dqText').textContent = serious ? `Data check · ${serious}` : 'Data check ✓';
    btn.classList.toggle('attn', serious > 0);
  }
  function openDataCheck() {
    const list = dataIssues();
    const groups = [['error', 'Needs fixing'], ['warn', 'Worth checking'], ['info', 'For information']];
    const counts = Object.fromEntries(groups.map(([k]) => [k, list.filter((i) => i.level === k).length]));
    $('#dqBody').innerHTML = `<div class="dq-counts">${groups.map(([k, l]) => `<span class="dq-count ${k}"><b>${counts[k]}</b> ${l.toLowerCase()}</span>`).join('')}</div>
      ${list.length ? groups.filter(([k]) => counts[k]).map(([k, l]) => `<h3 class="dq-h">${l}</h3><ul class="dq-list">${list.filter((i) => i.level === k).map((i) => {
        const idx = list.indexOf(i);
        return `<li class="${k}"><div><b>${esc(i.title)}</b><small>${esc(i.detail)}</small></div>${i.period ? `<button class="btn sm ghost" data-dq="${idx}">Open</button>` : ''}</li>`;
      }).join('')}</ul>`).join('') : '<p class="muted">Nothing to report: the files look complete and consistent.</p>'}
      <p class="muted dq-foot">Checked on every load, over all branches and months: lines without ID or name, negative amounts, the same person twice in a month, months copied from the month before, months without salaries or without the departments’ figures, one ID with several names, and months with only some programmes.</p>`;
    $('#dqBody').onclick = (e) => {
      const b = e.target.closest('[data-dq]');
      if (!b) return;
      const i = list[Number(b.dataset.dq)];
      $('#dqDialog').close();
      if (state.branch !== 'all' && i.branch && state.branch !== i.branch) $(`#branchSeg button[data-v="${i.branch}"]`)?.click();
      state.months = new Set([i.period]);
      const href = i.cat ? (i.dept ? deptHref(i.dept, i.cat) : catHref(i.cat)) : '#/';
      if (location.hash === href || (href === '#/' && !location.hash)) onFilterChange(); else location.hash = href;
    };
    $('#dqDialog').showModal();
  }
  $('#dqBtn').addEventListener('click', openDataCheck);

  // ---------------- monthly summary (one page, printable) ----------------
  function openSummary(month = null) {
    const branch = state.branch;
    const base0 = state.rows.filter((r) => (branch === 'all' || r.branch === branch) && !isCensusCat(r.category) && PERIOD_RX.test(r.period));
    if (!base0.length) { toast('No data for this branch yet.', 'err'); return; }
    const years = [...new Set(base0.map((r) => yearOf(r.period)))].sort();
    const completeAll = years.flatMap((y) => completeMonths(base0, y).complete);
    const allMonths = [...new Set(base0.map((r) => r.period))].sort();
    const sel = [...state.months].sort();
    const m = month || (sel.length === 1 ? sel[0] : completeAll[completeAll.length - 1] || allMonths[allMonths.length - 1]);
    const pm = prevMonth(m);
    const view = (list) => list.map((r) => asOnPage(r, null));
    const mRows = base0.filter((r) => r.period === m);
    const pRows = base0.filter((r) => r.period === pm);
    const a = agg(view(mRows));
    const p = pRows.length ? agg(view(pRows)) : null;
    const chg = (x, y) => (p && y ? safeDiv(x - y, y) : null);
    const delta = (d, good = true, pp = false) => (d == null ? '' : `<span class="delta ${good === null ? '' : (d >= 0) === good ? 'up' : 'down'}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${pp ? `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pp` : `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%`}</span>`);
    const kpi = (label, value, foot) => `<div class="sum-kpi"><span>${label}</span><b>${value}</b><small>${foot}</small></div>`;
    const vs = p ? ` vs ${periodLabel(pm)}` : '';
    const kpis = [
      kpi('Revenue', `${compact(a.revenue)} <em>${CURRENCY}</em>`, `${a.targetSum ? `${achFmt(a.achievement)} of target · ` : ''}${delta(chg(a.revenue, p?.revenue))}${vs}`),
      kpi('Incentives paid', `${compact(a.incentives)} <em>${CURRENCY}</em>`, `${pct(a.revRate, 2)} of revenue · ${delta(chg(a.incentives, p?.incentives), null)}${vs}`),
      kpi('Salaries', `${compact(a.salary)} <em>${CURRENCY}</em>`, `${delta(chg(a.salary, p?.salary), null)}${vs}`),
      kpi('Incentives ÷ salaries', pct(a.incRate), `${p ? delta(a.incRate - p.incRate, null, true) : ''}${vs}`),
      kpi('Revenue ÷ staff cost', times(a.roi), `staff cost ${compact(a.cost)} ${CURRENCY}`),
      kpi('Staff paid', nfFull.format(a.doctors), `${p ? `${a.doctors - p.doctors >= 0 ? '+' : ''}${a.doctors - p.doctors}` : ''}${vs}`),
    ].join('');
    // by category
    const cats = CATS.filter((c) => !c.census && mRows.some((r) => r.category === c.key));
    const catRow = (c) => {
      const list = mRows.filter((r) => r.category === c.key);
      const x = agg(list.map((r) => asOnPage(r, c.key)));
      const px = agg(pRows.filter((r) => r.category === c.key).map((r) => asOnPage(r, c.key)));
      const staff = c.perDept || c.other ? `${deptCount(list)} dept.` : nfFull.format(x.doctors);
      return `<tr><td class="name"><i class="dot" style="background:var(${c.color})"></i>${esc(c.label)}</td><td class="num">${staff}</td>
        <td class="num">${x.revenue ? `${compact(x.revenue)}${c.measure ? ` <small class="muted">${esc(c.measure.toLowerCase())}</small>` : ''}` : '—'}</td>
        <td class="num">${x.targetSum ? achFmt(x.achievement) : '—'}</td><td class="num"><b>${compact(x.incentives)}</b></td>
        <td class="num">${x.salary ? pct(x.incRate) : '—'}</td><td class="num">${px.incentives ? delta(safeDiv(x.incentives - px.incentives, px.incentives), null) : '<span class="muted">—</span>'}</td></tr>`;
    };
    // programmes paid every month that are not in yet (not the quarterly / occasional ones)
    const core = completeMonths(base0, yearOf(m)).core;
    const missing = CATS.filter((c) => core.includes(c.key) && !mRows.some((r) => r.category === c.key));
    // units against target (each programme as its own page counts it)
    const units = groupBy(mRows.map((r) => asOnPage(r, r.category)).filter((r) => r.target > 0), 'specialty')
      .filter((g) => g.targetSum > 0).map((g) => ({ ...g, v: g.revWithTarget / g.targetSum, cat: g.rows[0].category }));
    const best = [...units].sort((x, y) => y.v - x.v).slice(0, 5);
    const worst = [...units].sort((x, y) => x.v - y.v).slice(0, 5);
    const unitList = (l) => l.map((g) => `<li><span>${esc(g.key)} <small class="muted">${esc(catOf(g.cat)?.short || '')}</small></span><b class="${g.v >= 1 ? 'up' : 'down'}">${achFmt(g.v)}</b><small>${g.revWithTarget >= g.targetSum ? '+' : '−'}${compact(Math.abs(g.revWithTarget - g.targetSum))}</small></li>`).join('');
    // the year so far
    const ytd = ytdModel(view(base0), yearOf(m), m);
    // highlights
    const hl = [];
    if (units.length) { const metN = units.filter((g) => g.v >= 1).length; hl.push(`<b>${metN} of ${units.length}</b> specialties / departments with a target met it; overall <b>${achFmt(a.achievement)}</b> (${compact(a.revWithTarget)} of ${compact(a.targetSum)}).`); }
    if (p) {
      const byCat = CATS.filter((c) => !c.census && (mRows.some((r) => r.category === c.key) || pRows.some((r) => r.category === c.key))).map((c) => { const x = agg(mRows.filter((r) => r.category === c.key).map((r) => asOnPage(r, null))).incentives; const y = agg(pRows.filter((r) => r.category === c.key).map((r) => asOnPage(r, null))).incentives; return { c, d: x - y }; }).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      const top = byCat[0];
      if (top && Math.abs(top.d) > 0) hl.push(`Incentives ${a.incentives >= p.incentives ? 'rose' : 'fell'} <b>${compact(Math.abs(a.incentives - p.incentives))}</b> vs ${periodLabel(pm)}, mostly <b>${esc(top.c.short)}</b> (${top.d >= 0 ? '+' : '−'}${compact(Math.abs(top.d))}).`);
      const sp = groupBy(view(mRows).filter((r) => r.revenue), 'specialty').map((g) => { const q = agg(view(pRows).filter((r) => r.specialty === g.key)); return { k: g.key, d: g.revenue - q.revenue }; }).sort((x, y) => y.d - x.d);
      if (sp.length > 1) hl.push(`Biggest revenue rise: <b>${esc(sp[0].k)}</b> (+${compact(sp[0].d)}); biggest drop: <b>${esc(sp[sp.length - 1].k)}</b> (${sp[sp.length - 1].d < 0 ? '−' : '+'}${compact(Math.abs(sp[sp.length - 1].d))}).`);
    }
    const q = mRows.filter((r) => catOf(r.category)?.quarterly).reduce((x, r) => x + r.incentives, 0);
    if (q) hl.push(`Includes <b>${compact(q)}</b> of quarterly incentive (Q${quarterOf(m)}).`);
    if (ytd && ytd.remaining && ytd.ytd.targetSum) hl.push(`Year to date <b>${achFmt(ytd.achievement)}</b> of target; at the pace of the last 3 months the year ends at <b>${achFmt(ytd.projAchievement)}</b>.`);
    const notes = Viewers.isAdmin() ? dataIssues().filter((i) => i.period === m && i.level !== 'info' && (branch === 'all' || i.branch === branch)) : [];
    const trend = allMonths.filter((x) => yearOf(x) === yearOf(m) && x <= m);
    const revSeries = trend.map((x) => agg(view(base0.filter((r) => r.period === x))).revenue);
    const incSeries = trend.map((x) => agg(view(base0.filter((r) => r.period === x))).incentives);
    const mi = trend.indexOf(m);
    $('#sumBody').innerHTML = `
      <header class="sum-head">
        <div><div class="sum-brand">Compensation &amp; Incentives Hub · Doctors &amp; Admin Performance</div><h2>Monthly summary · ${periodLabel(m)}</h2>
          <div class="sum-sub">${branch === 'all' ? 'All branches' : esc(branch)} · prepared ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${p ? ` · compared with ${periodLabel(pm)}` : ''}</div></div>
        <div class="sum-actions no-print">
          <select id="sumMonth" aria-label="Month">${[...allMonths].reverse().map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${periodLabel(x)}${completeAll.includes(x) ? '' : ' (partial)'}</option>`).join('')}</select>
          <button class="btn primary" id="sumPrint"><svg viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg>Print / PDF</button>
          <button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </div>
      </header>
      ${completeAll.includes(m) ? '' : `<p class="sum-warn">Only some programmes are in for ${periodLabel(m)} so far — the totals cover what has been uploaded.</p>`}
      <section class="sum-kpis">${kpis}</section>
      <section class="sum-two">
        <div class="sum-block"><h3>Highlights</h3><ul class="sum-hl">${hl.map((x) => `<li>${x}</li>`).join('') || '<li class="muted">Not enough data for highlights.</li>'}</ul>
          <div class="sum-sparks"><div><span>Revenue · Jan–${MONTH_ABBR[monthNo(m) - 1]} ${yearOf(m)}</span>${spark(revSeries, 'var(--m-rev)', mi, 180)}</div><div><span>Incentives · Jan–${MONTH_ABBR[monthNo(m) - 1]} ${yearOf(m)}</span>${spark(incSeries, 'var(--m-inc)', mi, 180)}</div></div></div>
        <div class="sum-block"><h3>Year to date · ${yearOf(m)}</h3>${ytd ? `<dl class="sum-dl">
          <div><dt>Revenue</dt><dd>${compact(ytd.ytd.revenue)}${ytd.ytd.targetSum ? ` <small>${achFmt(ytd.achievement)} of target</small>` : ''}</dd></div>
          <div><dt>Incentives</dt><dd>${compact(ytd.ytd.incentives)} <small>${pct(safeDiv(ytd.ytd.incentives, ytd.ytd.revenue), 2)} of revenue</small></dd></div>
          <div><dt>Staff cost</dt><dd>${compact(ytd.ytd.cost)} <small>revenue ÷ cost ${times(safeDiv(ytd.ytd.revenue, ytd.ytd.cost))}</small></dd></div>
          ${ytd.remaining ? `<div><dt>Outlook for the year</dt><dd>${compact(ytd.proj.revenue)} revenue · ${compact(ytd.proj.incentives)} incentives <small>at the pace of the last 3 months</small></dd></div>` : ''}
        </dl>` : '<p class="muted">—</p>'}</div>
      </section>
      <section class="sum-block"><h3>By category</h3><table class="data sum-table"><thead><tr><th>Category</th><th class="num">Staff</th><th class="num">Revenue / measure</th><th class="num">Target achv.</th><th class="num">Incentives</th><th class="num">Inc. ÷ salary</th><th class="num">Incentives${p ? ` vs ${MONTH_ABBR[monthNo(pm) - 1]}` : ''}</th></tr></thead>
        <tbody>${cats.map(catRow).join('')}</tbody>
        <tfoot><tr><td>Hospital</td><td class="num">${nfFull.format(a.doctors)}</td><td class="num">${compact(a.revenue)}</td><td class="num">${a.targetSum ? achFmt(a.achievement) : '—'}</td><td class="num">${compact(a.incentives)}</td><td class="num">${pct(a.incRate)}</td><td class="num">${p ? delta(chg(a.incentives, p.incentives), null) : ''}</td></tr></tfoot></table>
        ${missing.length ? `<p class="sum-note">Not in yet for ${periodLabel(m)}: ${missing.map((c) => esc(c.short)).join(', ')}.</p>` : ''}</section>
      ${units.length ? `<section class="sum-two"><div class="sum-block"><h3>Best against target</h3><ol class="sum-rank">${unitList(best)}</ol></div><div class="sum-block"><h3>Furthest below target</h3><ol class="sum-rank">${unitList(worst)}</ol></div></section>` : ''}
      ${notes.length ? `<section class="sum-block"><h3>Data notes</h3><ul class="sum-hl">${notes.slice(0, 6).map((i) => `<li><b>${esc(i.title)}</b> — ${esc(i.detail)}</li>`).join('')}</ul></section>` : ''}
      <footer class="sum-foot">Figures from the files in “Source of the Incentive”. Revenue excludes Business Development sales and CAM collection (their own measures); quarterly incentives count in the month they are paid. Salary is counted once per person per month.</footer>`;
    const dlg = $('#sumDialog');
    if (!dlg.open) dlg.showModal();
    $('#sumMonth').onchange = (e) => openSummary(e.target.value);
    $('#sumPrint').onclick = () => { document.body.classList.add('print-summary'); window.print(); };
    $('[data-close]', dlg).onclick = () => dlg.close();
  }
  window.addEventListener('afterprint', () => document.body.classList.remove('print-summary'));
  $('#sumBtn').addEventListener('click', () => openSummary());

  // ---------------- everything paid to one person ----------------
  let docAllChart = null;
  function personSection(r) {
    const key = personKey(r);
    const all = state.rows.filter((x) => personKey(x) === key && !x.level && PERIOD_RX.test(x.period));
    const year = yearOf(r.period);
    const mine = all.filter((x) => yearOf(x.period) === year);
    if (!mine.length) return { html: '', draw: () => {} };
    const months = [...new Set(mine.map((x) => x.period))].sort();
    const cats = CATS.filter((c) => mine.some((x) => x.category === c.key));
    const paid = cats.filter((c) => !c.census);
    const sal = new Map(); for (const x of mine) sal.set(x.period, Math.max(sal.get(x.period) || 0, x.salary || 0));
    const salary = [...sal.values()].reduce((s, v) => s + v, 0);
    const inc = mine.reduce((s, x) => s + (x.incentives || 0), 0);
    const byCat = paid.map((c) => ({ c, v: mine.filter((x) => x.category === c.key).reduce((s, x) => s + (x.incentives || 0), 0) })).filter((x) => x.v > 0);
    const visits = mine.reduce((s, x) => s + (x.visits || 0), 0);
    const rowsHtml = months.map((p) => {
      const l = mine.filter((x) => x.period === p);
      const i = l.reduce((s, x) => s + (x.incentives || 0), 0);
      const rev = l.filter((x) => !catOf(x.category)?.measure).reduce((s, x) => s + (x._revenue || 0), 0);
      const t = l.filter((x) => !catOf(x.category)?.measure && x._target).reduce((s, x) => s + x._target, 0);
      const tr = l.filter((x) => !catOf(x.category)?.measure && x._target).reduce((s, x) => s + (x._revenue || 0), 0);
      return `<tr class="${p === r.period ? 'sel' : ''}"><td>${MONTH_ABBR[monthNo(p) - 1]}</td><td>${l.filter((x) => !isCensusCat(x.category)).map((x) => `<span class="tag" style="border-left:3px solid var(${catOf(x.category).color})">${esc(catOf(x.category).short)}</span>`).join(' ')}</td>
        <td class="num">${money(sal.get(p))}</td><td class="num"><b>${money(i)}</b></td><td class="num">${rev ? compact(rev) : '—'}</td><td class="num">${t ? achFmt(tr / t) : '—'}</td>${visits ? `<td class="num">${nfFull.format(l.reduce((s, x) => s + (x.visits || 0), 0)) || '—'}</td>` : ''}</tr>`;
    }).join('');
    const html = `<section class="doc-all">
      <h3>Everything paid to ${esc(r.name.split(' ')[0])} in ${year}</h3>
      <div class="doc-all-sum">
        <div><span>Incentives</span><b>${compact(inc)}</b><small>${months.length} month${months.length === 1 ? '' : 's'}</small></div>
        <div><span>Salaries</span><b>${compact(salary)}</b><small>once per month</small></div>
        <div><span>Incentive ÷ salary</span><b>${pct(safeDiv(inc, salary))}</b><small>${paid.length} programme${paid.length === 1 ? '' : 's'}</small></div>
      </div>
      ${byCat.length > 1 ? `<div class="doc-all-cats">${byCat.map(({ c, v }) => `<span><i style="background:var(${c.color})"></i>${esc(c.short)} <b>${compact(v)}</b></span>`).join('')}</div>` : ''}
      ${months.length > 1 ? '<div class="doc-all-chart" id="docAllChart"></div>' : ''}
      <div class="table-wrap"><table class="data compact"><thead><tr><th>Month</th><th>Paid from</th><th class="num">Salary</th><th class="num">Incentives</th><th class="num">Revenue</th><th class="num">Target</th>${visits ? '<th class="num">Visits</th>' : ''}</tr></thead><tbody>${rowsHtml}</tbody></table></div>
    </section>`;
    const draw = () => {
      if (months.length < 2) return;
      const t = theme();
      if (docAllChart) docAllChart.dispose();
      docAllChart = echarts.init($('#docAllChart'));
      docAllChart.setOption({
        ...base(t),
        grid: { left: 4, right: 8, top: 28, bottom: 20, containLabel: true },
        legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 } },
        tooltip: { ...shadowTip(t), valueFormatter: money },
        xAxis: { type: 'category', data: months.map((p) => MONTH_ABBR[monthNo(p) - 1]), axisLabel: { color: t.muted }, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false } },
        yAxis: valueAxis(t),
        series: byCat.map(({ c }, i) => ({
          name: c.short, type: 'bar', stack: 'inc', barMaxWidth: 26, color: css(c.color),
          itemStyle: { borderColor: t.surface, borderWidth: 1, borderRadius: i === byCat.length - 1 ? [4, 4, 0, 0] : 0 },
          data: months.map((p) => mine.filter((x) => x.period === p && x.category === c.key).reduce((s, x) => s + (x.incentives || 0), 0) || null),
        })),
      });
    };
    return { html, draw };
  }
  /** People matching the menu search (name or ID): opens their panel. */
  function peopleMatches(q) {
    if (q.length < 2) return [];
    const seen = new Map();
    for (const r of state.rows) {
      if (!inBranch(r) || r.level || !r._search.includes(q)) continue;
      const k = personKey(r);
      const cur = seen.get(k);
      if (!cur || r.period > cur.period || (r.period === cur.period && isCensusCat(cur.category) && !isCensusCat(r.category))) seen.set(k, r);
    }
    // names starting with the search first, then the rest
    const starts = (r) => (String(r.name).toLowerCase().startsWith(q) || String(r.id).startsWith(q) ? 0 : 1);
    return [...seen.values()].sort((a, b) => starts(a) - starts(b) || String(a.name).localeCompare(String(b.name))).slice(0, 8);
  }

  // ---------------- tables ----------------
  const specCols = () => (!state.hasRevenue ? [
    // No revenue (residents, incentive programmes): what each department was paid and its share of the total.
    { key: 'key', label: state.dept ? 'Position' : state.cat ? cap(catOf(state.cat).unit) : 'Specialty / department' },
    catOf(state.cat)?.perDept || catOf(state.cat)?.other
      ? { key: 'lines', label: catOf(state.cat)?.other ? 'Payments' : 'Lines', num: true, fmt: (v) => v }
      : { key: 'doctors', label: cap(state.cat ? catOf(state.cat).who : 'people'), num: true, fmt: (v) => v },
    { key: 'salary', label: 'Salaries', num: true, fmt: money },
    { key: 'incentives', label: 'Incentives', num: true, bar: true, barKey: 'incentives' },
    { key: 'share', label: 'Share of incentives', num: true, fmt: (v) => pct(v) },
    { key: 'incRate', label: 'Inc ÷ salary', num: true, fmt: (v) => pct(v) },
    { key: 'avgInc', label: 'Avg incentive / person', num: true, fmt: money },
    { key: 'cost', label: 'Total cost', num: true, fmt: money },
  ] : [
    { key: 'key', label: state.dept ? 'Position' : state.cat ? cap(catOf(state.cat).unit) : 'Specialty / department' },
    { key: 'doctors', label: 'Doctors', num: true, fmt: (v) => v },
    { key: 'revenue', label: revLabel(), num: true, bar: true, barKey: 'revenue' },
    { key: 'salary', label: 'Salary', num: true, fmt: money },
    { key: 'incentives', label: 'Incentives', num: true, fmt: money },
    { key: 'incRate', label: 'Inc ÷ salary', num: true, fmt: (v) => pct(v) },
    { key: 'revRate', label: 'Inc ÷ revenue', num: true, fmt: (v) => pct(v, 2) },
    { key: 'revPerDoc', label: 'Rev / doctor', num: true, fmt: money },
    { key: 'contribution', label: 'Net contribution', num: true, fmt: money },
    { key: 'roi', label: 'Rev ÷ cost', num: true, fmt: times },
    ...(state.hasTargets ? [{ key: 'achievement', label: 'Target achv.', num: true, fmt: (v) => pct(v, 0) }] : []),
  ]);
  let specGroups = [];
  function sortBy(list, { key, dir }) {
    return list.sort((a, b) => {
      const x = a[key]; const y = b[key];
      if (typeof x === 'string' || typeof y === 'string') return String(x ?? '').localeCompare(String(y ?? '')) * dir;
      return ((x ?? -Infinity) - (y ?? -Infinity)) * dir;
    });
  }
  const thead = (cols, sort) => `<thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}" data-k="${c.key}">${c.label}${sort.key === c.key ? `<span class="arrow">${sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>`;

  function renderSpecTable() {
    const cols = specCols();
    const groupKey = state.dept ? 'position' : 'specialty';
    const totalInc = filtered.reduce((s, r) => s + r.incentives, 0);
    const groups = groupBy(filtered, groupKey).map((g) => ({ ...g, share: safeDiv(g.incentives, totalInc), avgInc: safeDiv(g.incentives, g.doctors) }));
    if (!cols.some((c) => c.key === state.specSort.key)) state.specSort = { key: cols[2].bar ? cols[2].key : 'incentives', dir: -1 };
    specGroups = sortBy(groups, state.specSort);
    // Ranked by revenue, or by incentives where there is no revenue.
    const mk = state.hasRevenue ? 'revenue' : 'incentives';
    const byRev = [...specGroups].filter((g) => !state.hasRevenue || g.revenue > 0).sort((a, b) => b[mk] - a[mk]);
    const noun = state.dept ? 'position' : 'specialt';
    const unitWord = state.cat ? catOf(state.cat).unit : 'specialty';
    const plural = (n) => (state.dept ? `${n} position${n === 1 ? '' : 's'}` : `${n} ${n === 1 ? unitWord : pluralUnit(unitWord)}`);
    $('#specTitle').textContent = state.dept ? `Position summary · ${state.dept}`
      : state.cat ? `${cap(catOf(state.cat).unit)} summary` : 'Specialty & department summary';
    const what = state.hasRevenue ? `highest ${revLabel().toLowerCase()}` : 'most incentives';
    $('#specNote').innerHTML = byRev.length
      ? `${plural(byRev.length)}${state.hasRevenue ? '' : ` · total incentives <b>${money(totalInc)}</b> ${CURRENCY}`} · ${what}: <b>${esc(byRev[0].key)}</b> (${compact(byRev[0][mk])})${byRev.length > 1
        ? ` · lowest: <b>${esc(byRev[byRev.length - 1].key)}</b> (${compact(byRev[byRev.length - 1][mk])})` : ''}`
      : `No ${noun} data for the current filters`;
    const card = $('#specCard');
    card.classList.toggle('open', state.specOpen);
    $('#specToggle').setAttribute('aria-expanded', String(state.specOpen));
    $('#specToggle span').textContent = state.specOpen ? 'Hide details' : 'Show details';
    if (!state.specOpen) return;
    const barKey = cols.find((c) => c.bar)?.barKey || 'revenue';
    const max = Math.max(1, ...specGroups.map((g) => g[barKey]));
    const total = agg(filtered);
    total.share = totalInc ? 1 : null;
    total.avgInc = safeDiv(total.incentives, total.doctors);
    const cell = (c, g) => {
      if (c.key === 'key') return `<td class="name">${esc(g.key)}</td>`;
      if (c.bar) return `<td class="num"><div class="bar-cell">${money(g[barKey])}<span class="track"><i style="width:${(g[barKey] / max) * 100}%"></i></span></div></td>`;
      return `<td class="num">${c.fmt(g[c.key])}</td>`;
    };
    $('#specTable').innerHTML = thead(cols, state.specSort)
      + `<tbody>${specGroups.map((g) => `<tr data-g="${esc(g.key)}">${cols.map((c) => cell(c, g)).join('')}</tr>`).join('')}</tbody>`
      + `<tfoot><tr><td>Total</td>${cols.slice(1).map((c) => `<td class="num">${c.bar ? money(total[barKey]) : c.fmt(total[c.key])}</td>`).join('')}</tr></tfoot>`;
  }
  $('#recToggle').addEventListener('click', () => {
    state.recOpen = !state.recOpen;
    store.set('recOpen', state.recOpen);
    renderRecTable();
  });
  $('#specToggle').addEventListener('click', () => {
    state.specOpen = !state.specOpen;
    store.set('specOpen', state.specOpen);
    renderSpecTable();
  });
  $('#specTable').addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (th) {
      const k = th.dataset.k;
      state.specSort = { key: k, dir: state.specSort.key === k ? -state.specSort.dir : (k === 'key' ? 1 : -1) };
      return renderSpecTable();
    }
    const tr = e.target.closest('tr[data-g]');
    if (!tr) return;
    if (state.dept) toggleFilter(mPos, tr.dataset.g);
    else location.hash = unitHref(tr.dataset.g);
  });

  const REC_COLS = [
    { key: 'id', label: 'ID', num: true, fmt: (v) => v },
    { key: 'name', label: 'Name' },
    { key: 'position', label: 'Position' },
    { key: 'specialty', label: 'Specialty / dept.' },
    { key: 'category', label: 'Category', fmt: (v) => catOf(v)?.short || v, overviewOnly: true },
    { key: 'branch', label: 'Branch', fmt: (v) => v, allBranchesOnly: true },
    { key: 'period', label: 'Month', fmt: periodLabel, multiOnly: true },
    { key: 'salary', label: 'Salary', num: true, fmt: money },
    { key: 'incentives', label: 'Incentives', num: true, fmt: money },
    { key: 'incentiveRate', label: 'Inc %', num: true, fmt: (v) => pct(v, 0) },
    { key: 'revenue', label: 'Revenue', num: true, fmt: money, revenueOnly: true },
    { key: 'revenueRate', label: 'Rev %', num: true, fmt: (v) => pct(v, 1), revenueOnly: true },
    { key: 'cost', label: 'Cost', num: true, fmt: money },
    { key: 'revPerCost', label: 'Rev ÷ cost', num: true, fmt: times, revenueOnly: true },
    { key: 'target', label: 'Target', num: true, fmt: (v) => (v ? money(v) : '—'), targetOnly: true },
    { key: 'achievement', label: 'Achv.', num: true, fmt: (v) => pct(v, 0), targetOnly: true },
    { key: 'reason', label: 'Reason', fmt: (v) => esc(v || '—'), otherOnly: true },
    { key: 'expenses', label: 'Expenses', num: true, fmt: (v) => (v == null ? '—' : money(v)), profitOnly: true },
    { key: 'netProfit', label: 'Net profit', num: true, fmt: (v) => (v == null ? '—' : money(v)), profitOnly: true },
    { key: 'cases', label: 'Month cases', num: true, fmt: (v) => (v == null ? '—' : nfFull.format(v)), casesOnly: true },
    { key: 'visits', label: 'Visits', num: true, fmt: (v) => nfFull.format(v || 0), censusOnly: true },
    { key: 'admissions', label: 'Admissions', num: true, fmt: (v) => nfFull.format(v || 0), censusOnly: true },
    { key: 'operations', label: 'Operations', num: true, fmt: (v) => nfFull.format(v || 0), censusOnly: true },
  ];
  // Pay columns are not shown on the census (workload) page.
  const PAY_KEYS = new Set(['salary', 'incentives', 'incentiveRate', 'revenue', 'revenueRate', 'cost', 'revPerCost', 'target', 'achievement']);
  let recSorted = [];
  function renderRecTable() {
    const hasProfit = filtered.some((r) => r.expenses != null || r.netProfit != null);
    const cols = REC_COLS.filter((c) => (!c.profitOnly || hasProfit) && (!c.otherOnly || state.cat === 'other') && (!c.multiOnly || selection().kind !== 'month') && (!c.targetOnly || state.hasTargets)
      && (!c.overviewOnly || !state.cat) && (!c.allBranchesOnly || state.branch === 'all') && (!c.revenueOnly || state.hasRevenue)
      && (!c.casesOnly || catOf(state.cat)?.cases)
      && (isCensusCat(state.cat) ? !PAY_KEYS.has(c.key) : !c.censusOnly))
      // "Revenue" is Sales / Collection on those programmes' pages.
      .map((c) => (c.key === 'revenue' && catOf(state.cat)?.measure ? { ...c, label: catOf(state.cat).measure } : c));
    recSorted = sortBy([...filtered], state.recSort);
    const card = $('#recCard');
    card.classList.toggle('open', state.recOpen);
    $('#recToggle').setAttribute('aria-expanded', String(state.recOpen));
    $('#recToggle span').textContent = state.recOpen ? 'Hide details' : 'Show details';
    const tot = agg(filtered);
    const whoWord = state.cat ? catOf(state.cat).who : 'people';
    const summary = isCensusCat(state.cat)
      ? `${nfFull.format(tot.visits)} visits · ${nfFull.format(tot.admissions)} admissions · ${nfFull.format(tot.operations)} operations`
      : `${state.hasRevenue ? `${revLabel().toLowerCase()} ${compact(tot.revenue)} · ` : ''}incentives ${compact(tot.incentives)} · cost ${compact(tot.cost)} (salary + incentives)`;
    $('#recNote').innerHTML = filtered.length
      ? `${nfFull.format(tot.doctors)} ${whoWord} · ${summary} · press <b>Show details</b> for the full list`
      : 'Nobody matches the current filters';
    const pages = Math.max(1, Math.ceil(recSorted.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.pageSize;
    const slice = recSorted.slice(start, start + state.pageSize);
    $('#recCount').textContent = `· ${nfFull.format(recSorted.length)}`;
    const td = (c, r) => {
      if (c.key === 'name') return `<td class="name" title="${esc(r.name)}">${esc(r.name)}</td>`;
      if (c.key === 'position' || c.key === 'specialty') return `<td><span class="tag">${esc(r[c.key])}</span></td>`;
      return `<td class="${c.num ? 'num' : ''}">${c.fmt(r[c.key])}</td>`;
    };
    $('#recTable').innerHTML = thead(cols, state.recSort).replace('</tr></thead>', '<th></th></tr></thead>')
      + `<tbody>${slice.map((r) => `<tr data-key="${esc(r.key)}">${cols.map((c) => td(c, r)).join('')}
        <td class="act"><button data-edit title="Edit" aria-label="Edit"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg></button></td></tr>`).join('')
      || `<tr><td colspan="${cols.length + 1}" class="muted" style="text-align:center;padding:28px">No doctors match the current filters</td></tr>`}</tbody>`;
    renderPager(pages, start, slice.length);
  }
  function renderPager(pages, start, shown) {
    const p = state.page;
    const nums = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - p) <= 1) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    $('#pager').innerHTML = `<span>Showing ${recSorted.length ? start + 1 : 0}–${start + shown} of ${nfFull.format(recSorted.length)}</span>
      <div class="pg">
        <select id="pageSize">${[25, 50, 100, 250].map((n) => `<option ${n === state.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button data-p="${p - 1}" ${p <= 1 ? 'disabled' : ''} aria-label="Previous">‹</button>
        ${nums.map((n) => (n === '…' ? '<span>…</span>' : `<button data-p="${n}" class="${n === p ? 'on' : ''}">${n}</button>`)).join('')}
        <button data-p="${p + 1}" ${p >= pages ? 'disabled' : ''} aria-label="Next">›</button>
      </div>`;
  }
  $('#pager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (b && !b.disabled) { state.page = Number(b.dataset.p); renderRecTable(); }
  });
  $('#pager').addEventListener('change', (e) => {
    if (e.target.id === 'pageSize') { state.pageSize = Number(e.target.value); state.page = 1; renderRecTable(); }
  });
  $('#recTable').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-k]');
    if (th) {
      const k = th.dataset.k;
      const isText = ['name', 'position', 'specialty', 'period'].includes(k);
      state.recSort = { key: k, dir: state.recSort.key === k ? -state.recSort.dir : (isText ? 1 : -1) };
      return renderRecTable();
    }
    const tr = e.target.closest('tr[data-key]');
    if (!tr) return;
    const r = state.rows.find((x) => x.key === tr.dataset.key);
    if (!r) return;
    if (e.target.closest('[data-edit]')) openForm(r); else openDoctor(r);
  });

  // ---------------- CSV export ----------------
  function downloadCsv(name, header, rows) {
    const q = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = `﻿${[header, ...rows].map((r) => r.map(q).join(',')).join('\r\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $$('[data-export]').forEach((b) => b.addEventListener('click', () => {
    const sel = selection();
    const tag = [state.dept, sel.kind === 'all' ? 'all-months' : sel.kind === 'month' ? sel.month : sel.kind === 'year' ? sel.year : 'selection']
      .filter(Boolean).join('_').replace(/[^\w-]+/g, '-');
    if (b.dataset.export === 'records') {
      downloadCsv(`doctors_${tag}.csv`,
        ['Month', 'ID', 'Name', 'Position', 'Specialty', 'Salary', 'Incentives', 'IncentiveRate', 'Revenue', 'RevenueRate'],
        recSorted.map((r) => [r.period, r.id, r.name, r.position, r.specialty, r.salary, r.incentives,
          r.incentiveRate?.toFixed(4), r.revenue, r.revenueRate?.toFixed(4)]));
    } else {
      downloadCsv(`${state.dept ? 'positions' : 'specialties'}_${tag}.csv`,
        [state.dept ? 'Position' : 'Specialty', 'Doctors', 'Revenue', 'Salary', 'Incentives', 'IncentiveToSalary', 'IncentiveToRevenue', 'RevenuePerDoctor', 'RevenueToCost'],
        specGroups.map((g) => [g.key, g.doctors, g.revenue, g.salary, g.incentives, g.incRate?.toFixed(4), g.revRate?.toFixed(4), g.revPerDoc?.toFixed(0), g.roi?.toFixed(2)]));
    }
  }));

  // ---------------- doctor details ----------------
  let docChart;
  function openDoctor(r) {
    const person = personSection(r);
    // Compare with the same month, branch and staff category.
    const peers = state.rows.filter((x) => x.period === r.period && x.branch === r.branch && x.category === r.category);
    const specPeers = peers.filter((x) => x.specialty === r.specialty);
    const rank = (list, k) => [...list].sort((a, b) => b[k] - a[k]).findIndex((x) => x.key === r.key) + 1;
    const specAgg = agg(specPeers);
    const history = state.rows.filter((x) => String(x.id) === String(r.id) && x.branch === r.branch && x.category === r.category).sort((a, b) => a.period.localeCompare(b.period));
    const vsAvg = (v, avg) => {
      const d = safeDiv(v - avg, avg);
      return d == null ? '' : `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d * 100).toFixed(0)}%</span> vs specialty avg`;
    };
    $('#docBody').innerHTML = `
      <div class="doc-head">
        <div><h2>${esc(r.name)}</h2><div class="doc-meta">#${esc(r.id)} · ${esc(r.position)}<br/><a href="${deptHref(r.specialty, r.category)}" class="doc-link">${esc(r.specialty)}</a> · ${esc(catOf(r.category)?.short || r.category)} · ${esc(r.branch)} · ${periodLabel(r.period)}</div></div>
        <button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="doc-grid">
        <div class="kpi"><div class="label">Revenue</div><div class="value">${compact(r.revenue)}<small>${CURRENCY}</small></div><div class="foot">${vsAvg(r.revenue, specAgg.revPerDoc)}</div></div>
        <div class="kpi"><div class="label">Incentives</div><div class="value">${compact(r.incentives)}<small>${CURRENCY}</small></div><div class="foot">${vsAvg(r.incentives, specAgg.incentives / specAgg.n)}</div></div>
        <div class="kpi"><div class="label">Salary</div><div class="value">${compact(r.salary)}<small>${CURRENCY}</small></div><div class="foot">${money(r.salary)}</div></div>
        <div class="kpi"><div class="label">Revenue ÷ salary</div><div class="value">${times(r.revPerSalary)}</div><div class="foot">Specialty: ${times(safeDiv(specAgg.revenue, specAgg.salary))}</div></div>
        <div class="kpi"><div class="label">Incentive ÷ salary</div><div class="value">${pct(r.incentiveRate)}</div><div class="foot">Specialty: ${pct(specAgg.incRate)}</div></div>
        <div class="kpi"><div class="label">Incentive ÷ revenue</div><div class="value">${pct(r.revenueRate, 2)}</div><div class="foot">Specialty: ${pct(specAgg.revRate, 2)}</div></div>
        <div class="kpi"><div class="label">Cost to hospital</div><div class="value">${compact(r.cost)}<small>${CURRENCY}</small></div><div class="foot">Salary + incentives</div></div>
        <div class="kpi"><div class="label">Revenue ÷ cost</div><div class="value">${times(r.revPerCost)}</div><div class="foot">Specialty: ${times(specAgg.roi)}</div></div>
        ${r.target ? `
        <div class="kpi"><div class="label">Monthly target</div><div class="value">${compact(r.target)}<small>${CURRENCY}</small></div><div class="foot">Gap ${r.revenue >= r.target ? '+' : ''}${compact(r.revenue - r.target)}</div></div>
        <div class="kpi"><div class="label">Target achievement</div><div class="value">${pct(r.achievement, 0)}</div><div class="foot">${r.achievement >= 1 ? '<span class="delta up">▲ Target met</span>' : '<span class="delta down">▼ Below target</span>'}</div></div>` : ''}
      </div>
      <div class="doc-rank">
        <div><span>Revenue rank in ${esc(r.specialty)}</span><b>${rank(specPeers, 'revenue')} / ${specPeers.length}</b></div>
        <div><span>Revenue rank overall</span><b>${rank(peers, 'revenue')} / ${peers.length}</b></div>
        <div><span>Incentives rank overall</span><b>${rank(peers, 'incentives')} / ${peers.length}</b></div>
      </div>
      ${history.length > 1 ? '<div class="doc-hist" id="docHist"></div>' : '<p class="muted" style="font-size:12.5px;margin-top:16px">Monthly history appears here once this doctor has more than one month of data.</p>'}
      ${person.html}
      <footer style="display:flex;gap:8px;margin-top:18px"><span class="spacer"></span><button class="btn" id="docEdit">Edit record</button></footer>`;
    const dlg = $('#docDialog');
    dlg.showModal();
    $('#docEdit').onclick = () => { dlg.close(); openForm(r); };
    person.draw();
    $('.doc-link', dlg).onclick = () => dlg.close();
    if (history.length > 1) {
      const t = theme();
      if (docChart) docChart.dispose();
      docChart = echarts.init($('#docHist'));
      docChart.setOption({
        ...base(t),
        grid: { left: 4, right: 8, top: 24, bottom: 20, containLabel: true },
        title: { text: history.some((h) => h.revenue > 0) ? 'Revenue by month' : 'Incentives by month', textStyle: { color: t.text2, fontSize: 12, fontWeight: 600 } },
        legend: history.some((h) => h.target) ? { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.text2 } } : undefined,
        tooltip: { ...base(t).tooltip, trigger: 'axis', valueFormatter: money },
        xAxis: { type: 'category', data: history.map((h) => periodLabel(h.period)), axisLabel: { color: t.muted, hideOverlap: true }, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false } },
        yAxis: valueAxis(t),
        series: history.some((h) => h.revenue > 0)
          ? [{ name: 'Revenue', type: 'line', color: t.mRev, lineStyle: { width: 2 }, symbolSize: 8, itemStyle: { borderColor: t.surface, borderWidth: 2 }, data: history.map((h) => h.revenue) },
            ...(history.some((h) => h.target) ? [{ name: 'Target', type: 'line', color: t.mTarget, lineStyle: { width: 2 }, symbolSize: 6, data: history.map((h) => h.target || null) }] : [])]
          : [{ name: 'Incentives', type: 'line', color: t.mInc, lineStyle: { width: 2 }, symbolSize: 8, itemStyle: { borderColor: t.surface, borderWidth: 2 }, data: history.map((h) => h.incentives) }],
      });
    }
  }

  // ---------------- add / edit form ----------------
  const form = $('#recForm');
  const dlg = $('#recDialog');
  let editing = null;
  function openForm(r = null) {
    editing = r;
    form.reset();
    $('#formErrors').textContent = '';
    $$('input', form).forEach((i) => i.classList.remove('invalid'));
    $('#dlgTitle').textContent = r ? 'Edit record' : 'Add record';
    $('#deleteBtn').classList.toggle('hidden', !r);
    const f = form.elements;
    if (r) {
      f.period.value = r.period; f.id.value = r.id; f.name.value = r.name; f.position.value = r.position;
      f.specialty.value = r.specialty; f.salary.value = r.salary; f.incentives.value = r.incentives; f.revenue.value = r.revenue;
      f.branch.value = r.branch; f.category.value = r.category;
    } else {
      const sel = selection();
      f.period.value = sel.kind === 'month' ? sel.month : (state.periods[state.periods.length - 1] || new Date().toISOString().slice(0, 7));
      f.branch.value = state.branch !== 'all' ? state.branch : 'SGH-Cairo';
      f.category.value = state.cat || 'opd';
      if (state.dept) f.specialty.value = state.dept;
      else if (state.filters.specialties.size === 1) f.specialty.value = [...state.filters.specialties][0];
    }
    updateCalc();
    dlg.showModal();
    setTimeout(() => (r ? f.name : f.id).focus(), 50);
  }
  function updateCalc() {
    const f = form.elements;
    const s = Number(f.salary.value) || 0; const i = Number(f.incentives.value) || 0; const v = Number(f.revenue.value) || 0;
    $('#calcIR').textContent = s ? pct(i / s) : '—';
    $('#calcRR').textContent = v ? pct(i / v, 2) : '—';
  }
  form.addEventListener('input', updateCalc);
  $('#addBtn').addEventListener('click', () => openForm());
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $('#docDialog').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) $('#docDialog').close();
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const errs = [];
    $$('input', form).forEach((i) => i.classList.remove('invalid'));
    for (const k of ['period', 'id', 'name', 'position', 'specialty']) {
      if (!f[k].value.trim()) { f[k].classList.add('invalid'); errs.push(`${f[k].closest('label').querySelector('span').textContent.replace(' *', '')} is required.`); }
    }
    for (const k of ['salary', 'incentives', 'revenue']) {
      if (f[k].value !== '' && (Number.isNaN(Number(f[k].value)) || Number(f[k].value) < 0)) { f[k].classList.add('invalid'); errs.push(`${k} must be a non-negative number.`); }
    }
    if (errs.length) { $('#formErrors').textContent = errs.join('\n'); return; }
    const body = {
      period: f.period.value, id: f.id.value.trim(), name: f.name.value, position: f.position.value, specialty: f.specialty.value,
      salary: f.salary.value, incentives: f.incentives.value, revenue: f.revenue.value,
      branch: f.branch.value, category: f.category.value,
    };
    const btn = $('#saveBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = editing
        ? await api('PUT', `/api/records/${encodeURIComponent(editing.period)}/${encodeURIComponent(editing.id)}?file=${encodeURIComponent(editing.file || '')}`, body)
        : await api('POST', '/api/records', body);
      if (!res.ok) { $('#formErrors').textContent = (res.errors || ['Save failed']).join('\n'); return; }
      dlg.close();
      if (res.status === 'written') toast(editing ? 'Record updated in Excel ✓' : 'Record added to Excel ✓');
      else toast(res.message, 'warn', 7000);
    } catch (err) {
      $('#formErrors').textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Save to Excel';
    }
  });

  $('#deleteBtn').addEventListener('click', async () => {
    if (!editing) return;
    if (!confirm(`Delete ${editing.name} (${periodLabel(editing.period)}) from the Excel workbook?\nA backup is kept in the backups folder.`)) return;
    try {
      const res = await api('DELETE', `/api/records/${encodeURIComponent(editing.period)}/${encodeURIComponent(editing.id)}?file=${encodeURIComponent(editing.file || '')}`);
      if (!res.ok) { $('#formErrors').textContent = (res.errors || ['Delete failed']).join('\n'); return; }
      dlg.close();
      if (res.status === 'written') toast('Record deleted from Excel'); else toast(res.message, 'warn', 7000);
    } catch (err) { $('#formErrors').textContent = err.message; }
  });

  $('#pendingBadge').addEventListener('click', async () => {
    try {
      const res = await api('POST', '/api/pending/flush');
      if (res.written) { toast('Queued changes written to Excel ✓'); return; }
      toast(res.reason || 'Still waiting for the workbook to be closed.', 'warn', 6000);
      if (!state.status.locked && confirm('Discard the queued changes instead?')) {
        await api('DELETE', '/api/pending');
        toast('Queued changes discarded');
      }
    } catch (err) { toast(err.message, 'err'); }
  });

  // ---------------- upload monthly files ----------------
  const up = { items: [] };
  const upDlg = $('#upDialog');
  const CAT_FOLDER = {
    opd: 'OPD', residents: 'Residents', allied: 'Allied', quarterly: 'Quarterly', census: 'Census',
    bd: 'Separate/Business Development', admission: 'Separate/Admission & Discharge', patientrel: 'Separate/Patient Relation', legal: 'Separate/Legal Affairs',
    collection: 'Separate/CAM Collection', other: 'Other Incentives',
  };
  const defaultYear = () => (state.periods.length ? yearOf(state.periods[state.periods.length - 1]) : String(new Date().getFullYear()));
  // Existing file for a month of this item's branch (and category, when one is chosen).
  const fileForPeriod = (p, it) => {
    const rows = state.rows.filter((r) => r.period === p && r.branch === it.branch && (it.category === 'auto' || r.category === it.category));
    return rows.length ? { file: rows[0].file, rows: rows.length } : null;
  };
  const targetPath = (p, it) => {
    const existing = fileForPeriod(p, it);
    if (existing && existing.file) return existing.file;
    const [y, m] = p.split('-');
    const file = it.category === 'quarterly' ? `Q${Math.ceil(Number(m) / 3)}` : MONTHS_LONG[Number(m) - 1];
    return `${it.branch}/${it.category === 'auto' ? '(detected)' : CAT_FOLDER[it.category]}/${y}/${file}.xlsx`;
  };
  /** Online copy: a department page whose files anyone signed in may upload (for now: Allied / closed departments). */
  // Every page with a prepared template (a department page when its category has fixed ones).
  const relayUpload = (ctx) => !!(ctx && Viewers.canUpload() && TemplateCheck.templateKey(ctx.category, ctx.unit)
    && (!catOf(ctx.category).fixed || ctx.unit));

  // ---------------- department templates ----------------
  const TEMPLATE_COLUMNS = [
    { header: 'Branch', width: 12 }, { header: 'Month', width: 11 }, { header: 'Year', width: 8 }, { header: 'ID', width: 10 },
    { header: 'Name', width: 34 }, { header: 'Position', width: 28 }, { header: 'Department', width: 22 },
    { header: 'Incentives', width: 13, type: 'money' }, { header: 'Total Salary', width: 14, type: 'money' },
  ];
  /**
   * The upload template of one department, named after it: Branch, Month, Year and Department filled
   * in; the people it had in its latest month listed (ID, name, position) so only the two amounts
   * are typed; spare rows for new people. Rows left without an ID and name are ignored on upload.
   */
  // The templates prepared for each page (public/templates/). A department without its own file gets
  // a generated one with the standard columns.
  // The templates prepared for each page are listed in template-check.js (public/templates/). An
  // Allied department without its own file gets a generated one with the standard columns.
  async function downloadPrepared(key, label) {
    const file = key && TemplateCheck.TEMPLATES[key];
    if (!file) return false;
    const res = await fetch(`templates/${encodeURIComponent(file)}`);
    if (!res.ok) return false;
    XlsxWrite.save(await res.blob(), `${label} - Template.xlsx`);
    toast(`${label} template downloaded — fill it in and upload it from this page. Uploading a month again replaces it.`, '', 8000);
    return true;
  }
  async function downloadTemplate(dept) {
    if (await downloadPrepared(TemplateCheck.templateKey('allied', dept), dept)) return;
    const branch = state.branch !== 'all' ? state.branch : 'SGH-Cairo';
    const sel = selection();
    const period = sel.kind === 'month' ? sel.month : state.periods[state.periods.length - 1] || `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}`;
    const [y, m] = period.split('-');
    const month = MONTHS_LONG[Number(m) - 1];
    const mine = state.rows.filter((r) => r.branch === branch && r.category === 'allied' && r.specialty === dept && /^\d{4}-\d{2}$/.test(r.period) && r.period <= period);
    const latest = mine.reduce((x, r) => (r.period > x ? r.period : x), '');
    const people = byDoctor(mine.filter((r) => r.period === latest)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const rows = [
      ...people.map((d) => [branch, month, Number(y), d.id, d.name, d.position === 'Unspecified' ? '' : d.position, dept, null, null]),
      ...Array.from({ length: Math.max(10, 20 - people.length) }, () => [branch, month, Number(y), '', '', '', dept, null, null]),
    ];
    XlsxWrite.save(XlsxWrite.build({ sheet: dept, columns: TEMPLATE_COLUMNS, rows }), `${dept} - ${month} ${y}.xlsx`);
    toast(`${dept} template for ${month} ${y}${people.length ? ` with its ${people.length} people from ${periodLabel(latest)}` : ''} — fill Incentives and Total Salary, then upload it here.`, '', 8000);
  }
  $('#deptHeader').addEventListener('click', (e) => {
    const b = e.target.closest('[data-template]');
    if (b) downloadTemplate(b.dataset.template);
    const c = e.target.closest('[data-tpl]');
    if (c) downloadPrepared(c.dataset.tpl, c.dataset.tplLabel);
  });

  /**
   * ctx (from a page's own upload button): { branch, category, unit? }. With a unit, each month in
   * the file replaces only that department's rows; without, each month replaces the whole month.
   */
  function openUpload(ctx = null) {
    up.items = [];
    up.ctx = ctx;
    $('#upErrors').textContent = '';
    const c = ctx && catOf(ctx.category);
    const ctxBox = $('#upCtx');
    ctxBox.classList.toggle('hidden', !ctx);
    if (ctx) {
      ctxBox.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg><div>
        <b>Uploading for: ${esc(ctx.branch)} · ${esc(c.label)}${ctx.unit ? ` › ${esc(ctx.unit)}` : ''}</b>
        <small>${ctx.unit
    ? `The month is read from the file’s month / ReportDate column. For each month in the file, <b>${esc(ctx.unit)}</b>’s rows are replaced by the new ones — the other ${pluralUnit(c.unit)} stay as they are. Re-uploading the same month replaces it again.`
    : `The month is read from the file’s month / ReportDate column. Each month in the file replaces that month of ${esc(c.short)}. Re-uploading the same month replaces it again.`}</small></div>`;
    }
    up.relay = relayUpload(ctx);
    document.body.classList.toggle('relay-up', up.relay);
    if (up.relay) {
      document.body.classList.remove('static-up');
      $('#upGithub').classList.add('hidden');
      renderUploadList();
      upDlg.showModal();
      return;
    }
    if (STATIC && window.DASH_UPLOAD) {
      // Online copy: GitHub's own upload page (the owner is signed in there) — no token needed.
      // The publish workflow files each workbook under <branch>/<category>/<year>/<Month>.xlsx and rebuilds.
      const { repo, branch, dir } = window.DASH_UPLOAD;
      const url = (...parts) => `https://github.com/${repo}/upload/${encodeURIComponent(branch)}/${[...dir.split('/'), ...parts].map(encodeURIComponent).join('/')}`;
      if (ctx) {
        // Straight to this page's folder; fixed departments / sections have their own folder,
        // so a file there needs no department column.
        const fixed = (c.fixed || []).includes(ctx.unit);
        const parts = [ctx.branch, ...CAT_FOLDER[ctx.category].split('/'), ...(fixed ? [ctx.unit] : [])];
        $('#upGhFolders').innerHTML = `<div class="up-gh-branch"><b>${esc(ctx.branch)} · ${esc(c.label)}${fixed ? ` › ${esc(ctx.unit)}` : ''}</b>
          <div class="row-gap"><a class="btn primary" data-gh href="${url(...parts)}" target="_blank" rel="noopener">Open the upload page for ${esc(ctx.unit || c.short)}</a></div>
          ${ctx.unit && !fixed ? `<p class="muted" style="margin:8px 0 0;font-size:12.5px">Include a <b>SPECIALTY</b> (department) column with “${esc(ctx.unit)}” in the file so its rows are matched to ${esc(ctx.unit)}; the other ${pluralUnit(c.unit)} are kept.</p>` : ''}</div>`;
      } else {
        $('#upGhFolders').innerHTML = BRANCHES.map((b) => `<div class="up-gh-branch"><b>${esc(b)}</b><div class="row-gap">
            ${CATS.map((k) => `<a class="btn sm" data-gh href="${url(b, ...CAT_FOLDER[k.key].split('/'))}" target="_blank" rel="noopener">${esc(k.short)}</a>`).join('')}
            <a class="btn sm ghost" data-gh href="${url(b)}" target="_blank" rel="noopener" title="Category is detected from the file">Auto-detect category</a>
          </div></div>`).join('');
      }
      document.body.classList.add('static-up');
      $('#upGithub').classList.remove('hidden');
      upDlg.showModal();
      return;
    }
    renderUploadList();
    upDlg.showModal();
  }
  // A page's own upload button: that branch, category and (on a department page) department.
  $('#deptHeader').addEventListener('click', (e) => {
    if (!e.target.closest('[data-ctx-upload]')) return;
    openUpload({ branch: state.branch !== 'all' ? state.branch : 'SGH-Cairo', category: state.cat, unit: state.dept || null });
  });
  // Template sheets, read once, to check uploads against.
  const templateGrids = {};
  function templateGrid(key) {
    if (!templateGrids[key]) {
      templateGrids[key] = fetch(`templates/${encodeURIComponent(TemplateCheck.TEMPLATES[key])}`)
        .then((res) => { if (!res.ok) throw new Error('template not found'); return res.arrayBuffer(); })
        .then((buf) => XlsxSniff.grid(buf))
        .catch((err) => { delete templateGrids[key]; throw err; });
    }
    return templateGrids[key];
  }
  /**
   * The strict check of a page's upload (the upload worker repeats it): every template column, the
   * figures above the table filled in, and each row complete with a real branch (this one), month
   * and year. A file that fails is not accepted; the reasons are listed in the upload window.
   */
  async function checkItem(item) {
    const key = TemplateCheck.templateKey(item.category, item.unit);
    item.error = null;
    let tpl;
    try { tpl = await templateGrid(key); } catch { item.error = 'The template of this page could not be loaded — check the connection and add the file again.'; return; }
    const name = key.includes(':') ? item.unit : catOf(item.category).short;
    const res = TemplateCheck.validate(item.grid, tpl, { branch: item.branch, unit: item.unit, name });
    if (!res.ok) { item.error = `Not accepted — correct the file and add it again:\n${TemplateCheck.summary(res.errors)}`; item.period = null; return; }
    const [mn, y] = res.month.split(' ');
    item.rows = res.rows;
    item.kind = 'month';
    // a quarter is kept on its last month (Q2 -> June)
    item.period = `${y}-${pad2(/^Q[1-4]$/.test(mn) ? Number(mn[1]) * 3 : MONTHS_LONG.indexOf(mn) + 1)}`;
    item.quarter = /^Q[1-4]$/.test(mn) ? res.month : null;
    item.source = 'content';
    item.checked = true;
  }
  async function addFiles(files) {
    for (const file of files) {
      if (!/\.(xlsx|xlsm)$/i.test(file.name)) { up.items.push({ file, error: 'Only .xlsx / .xlsm files' }); continue; }
      const item = {
        file, period: null, source: null, rows: 0,
        branch: up.ctx?.branch || (state.branch !== 'all' ? state.branch : 'SGH-Cairo'),
        category: up.ctx?.category || state.cat || 'auto',
        unit: up.ctx?.unit || null,
      };
      up.items.push(item);
      // A page with a prepared template: the file must be that template, complete and correct.
      if (up.ctx && TemplateCheck.templateKey(item.category, item.unit)) {
        try { item.grid = await XlsxSniff.grid(file); await checkItem(item); } catch (err) { item.error = `The file could not be read as Excel (${err.message}).`; }
        continue;
      }
      try {
        const info = await XlsxSniff.inspect(file);
        item.rows = info.rows;
        item.periods = info.periods;
        item.kind = info.kind;
        item.months = Object.keys(info.periods || {}).sort();
        if (item.months.length > 1) item.kind = 'multi'; // split into month files by the server
        if (info.period) { item.period = info.period; item.source = 'content'; }
      } catch (err) { item.error = err.message; }
      if (!item.error && !item.period && item.kind !== 'targets') {
        const p = XlsxSniff.periodFromName(file.name, defaultYear());
        if (p) { item.period = p; item.source = 'name'; }
      }
    }
    renderUploadList();
  }
  function renderUploadList() {
    const counts = {};
    up.items.forEach((it) => {
      if (it.error || it.kind === 'targets') return;
      for (const p of it.kind === 'multi' ? it.months : [it.period].filter(Boolean)) {
        const k = `${it.branch}|${it.category}|${p}`;
        counts[k] = (counts[k] || 0) + 1;
      }
    });
    const cnt = (it, p) => counts[`${it.branch}|${it.category}|${p}`] || 0;
    const years = [...new Set([...TIMELINE_YEARS, ...state.periods.map((p) => Number(yearOf(p)))])].sort();
    const rm = (i) => `<button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    // Where the file goes: branch, and staff category (auto = decided per row by the server).
    const where = (it, i, withCat = true) => `<div class="up-where">
        <select data-b="${i}" title="Branch">${BRANCHES.map((b) => `<option ${b === it.branch ? 'selected' : ''}>${b}</option>`).join('')}</select>
        ${up.ctx ? `<span class="tag">${esc(catOf(it.category)?.short || it.category)}${it.unit ? ` › ${esc(it.unit)}` : ''}</span>` : withCat ? `<select data-c="${i}" title="Category"><option value="auto" ${it.category === 'auto' ? 'selected' : ''}>Auto-detect category</option>
          ${CATS.map((c) => `<option value="${c.key}" ${c.key === it.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>` : ''}
      </div>`;
    $('#upList').innerHTML = up.items.map((it, i) => {
      if (it.error) {
        return `<div class="up-item err"><div class="up-file"><b>${esc(it.file.name)}</b><small>${esc(it.error)}</small></div>${rm(i)}</div>`;
      }
      if (it.kind === 'targets') {
        // One targets export can cover every month; the server reads the months from it.
        return `<div class="up-item">
          <div class="up-file"><b>${esc(it.file.name)}</b><small>${it.rows} people → <code>${esc(`${it.branch}/Targets/${it.file.name}`)}</code></small>${where(it, i, false)}</div>
          <div class="up-month"><span class="up-fixed">Targets file <small>months are read from the file</small></span></div>
          <div class="up-status"><span class="up-badge ok">Targets</span></div>${rm(i)}
        </div>`;
      }
      // Rows this unit already has in a month (department uploads replace just those).
      const unitRows = (p) => state.rows.filter((r) => r.period === p && r.branch === it.branch && r.category === it.category && r.specialty === it.unit).length;
      if (it.kind === 'multi') {
        // One file with many months: each month becomes its own file (replacing that month).
        const replaces = it.category === 'auto' ? 0 : it.months.filter((p) => (it.unit ? unitRows(p) : fileForPeriod(p, it))).length;
        const dup = it.months.some((p) => cnt(it, p) > 1);
        return `<div class="up-item">
          <div class="up-file"><b>${esc(it.file.name)}</b><small>${it.rows} rows → ${it.unit ? `${esc(it.unit)} in ${it.months.length} months` : `split into ${it.months.length}+ files (by month${it.category === 'auto' ? ' and category' : ''})`}</small>${where(it, i)}</div>
          <div class="up-month"><span class="up-fixed">${periodLabel(it.months[0])} – ${periodLabel(it.months[it.months.length - 1])} <small>${it.months.length} months, from ReportDate</small></span></div>
          <div class="up-status">${dup ? '<span class="up-badge err">Another file has the same month</span>'
            : replaces ? `<span class="up-badge warn">${it.months.length - replaces} new · ${replaces} replaced</span>` : '<span class="up-badge ok">Ready</span>'}</div>${rm(i)}
        </div>`;
      }
      const [y, m] = (it.period || `${defaultYear()}-00`).split('-');
      const existing = it.period && it.category !== 'auto' && fileForPeriod(it.period, it);
      const dup = it.period && cnt(it, it.period) > 1;
      const monthCtl = it.source === 'content'
        ? `<span class="up-fixed">${it.quarter || periodLabel(it.period)} <small>${it.checked ? 'checked against the template' : 'from ReportDate'}</small></span>`
        : `<select data-m="${i}"><option value="">Month…</option>${MONTHS_LONG.map((mn, k) => `<option value="${pad2(k + 1)}" ${pad2(k + 1) === m ? 'selected' : ''}>${mn}</option>`).join('')}</select>
           <select data-y="${i}">${years.map((yy) => `<option ${String(yy) === y ? 'selected' : ''}>${yy}</option>`).join('')}</select>`;
      const had = it.unit && it.period ? unitRows(it.period) : 0;
      const status = !it.period ? '<span class="up-badge warn">Choose the month</span>'
        : dup ? '<span class="up-badge err">Two files for the same month</span>'
          : it.unit ? (had ? `<span class="up-badge warn">Replaces ${esc(it.unit)}’s ${had} rows</span>` : `<span class="up-badge ok">New for ${esc(it.unit)}</span>`)
            : existing ? `<span class="up-badge warn">Replaces ${esc(existing.file || '')} (${existing.rows} rows)</span>`
              : '<span class="up-badge ok">Ready</span>';
      return `<div class="up-item">
        <div class="up-file"><b>${esc(it.file.name)}</b><small>${it.rows} rows${it.period ? ` → <code>${esc(targetPath(it.period, it))}</code>` : ''}</small>${where(it, i)}</div>
        <div class="up-month">${monthCtl}</div>
        <div class="up-status">${status}</div>${rm(i)}
      </div>`;
    }).join('');
    const valid = up.items.filter((it) => !it.error);
    $('#upSubmit').disabled = !valid.length || valid.some((it) => (it.kind === 'multi' ? it.months.some((p) => cnt(it, p) > 1)
      : it.kind !== 'targets' && (!it.period || cnt(it, it.period) > 1)));
    $('#upSubmit').textContent = valid.length > 1 ? `Upload ${valid.length} files` : 'Upload';
  }
  $('#upList').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { up.items.splice(Number(rm.dataset.rm), 1); renderUploadList(); }
  });
  $('#upList').addEventListener('change', (e) => {
    const d = e.target.dataset;
    const it = up.items[Number(d.m ?? d.y ?? d.b ?? d.c)];
    if (!it) return;
    if (d.b != null) { it.branch = e.target.value; if (it.grid) { checkItem(it).then(renderUploadList); return; } } else if (d.c != null) it.category = e.target.value;
    else {
      const row = e.target.closest('.up-item');
      const m = $('[data-m]', row).value;
      const y = $('[data-y]', row).value;
      it.period = m ? `${y}-${m}` : null;
      it.source = 'manual';
    }
    renderUploadList();
  });
  $('#upInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  $('#uploadBtn').addEventListener('click', () => openUpload());
  // After opening GitHub's upload page, look for the rebuilt snapshot more often for ~8 minutes.
  $('#upGhFolders').addEventListener('click', (e) => {
    if (!e.target.closest('[data-gh]')) return;
    fastRefresh();
    toast('After you click “Commit changes” on GitHub, this dashboard updates by itself in about 2–3 minutes.', '', 7000);
  });

  async function uploadToServer(it) {
    const q = new URLSearchParams({
      name: it.file.name, branch: it.branch, category: it.category,
      ...(it.unit ? { unit: it.unit } : {}), ...(it.period ? { period: it.period } : {}),
    });
    return api('POST', `/api/upload?${q}`, it.file);
  }

  // Online copy, a department page: each file is encrypted and handed to the upload worker, which
  // files it into the department's folder; the dashboard rebuilds a few minutes later.
  async function uploadThroughRelay(items) {
    const btn = $('#upSubmit');
    btn.disabled = true;
    $('#upErrors').textContent = '';
    const sent = [];
    try {
      for (const it of items) {
        btn.textContent = `Sending ${it.file.name}…`;
        if (it.file.size > 4 * 1024 * 1024) throw new Error(`${it.file.name} is larger than 4 MB.`);
        await Viewers.sendUpload({ branch: it.branch, category: it.category, unit: it.unit, file: it.file });
        sent.push(it.file.name);
      }
      upDlg.close();
      toast(`Sent: ${sent.join(', ')} — it is filed into ${items[0].unit || catOf(items[0].category).short} within about 5–10 minutes (a month uploaded before is replaced) and the dashboard updates by itself. You can close this page.`, '', 12000);
    } catch (err) {
      $('#upErrors').textContent = `${sent.length ? `Sent: ${sent.join(', ')}\n` : ''}${err.message}`;
    } finally {
      btn.disabled = false;
      renderUploadList();
    }
  }
  /** Look for the rebuilt snapshot more often for the next ~8 minutes. */
  function fastRefresh() {
    let n = 0;
    const fast = setInterval(() => { loadData(); if (++n >= 24) clearInterval(fast); }, 20000);
  }

  // Local / network server: files go straight into the data folder.
  $('#upForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const items = up.items.filter((it) => !it.error && (it.period || it.kind === 'targets'));
    if (!items.length) return;
    if (up.relay) return uploadThroughRelay(items);
    const btn = $('#upSubmit');
    btn.disabled = true;
    $('#upErrors').textContent = '';
    const done = [];
    try {
      for (const it of items) {
        btn.textContent = `Uploading ${it.kind === 'targets' ? 'targets' : it.kind === 'multi' ? `${it.months.length} months` : periodLabel(it.period)}…`;
        const res = await uploadToServer(it);
        if (!res.ok) throw new Error(`${it.file.name}: ${(res.errors || ['Upload failed']).join(' ')}`);
        done.push(res.kind === 'targets' ? `${res.note} → ${res.file}`
          : res.kind === 'unit' ? `${res.note}${res.errors ? ` · Not saved: ${res.errors.join(' ')}` : ''}`
          : res.kind === 'multi' ? `${it.file.name}: ${res.note}${res.errors ? ` Not saved: ${res.errors.join(' ')}` : ''}`
            : `${periodLabel(res.period || it.period)} → ${res.file}${res.replaced ? ' (replaced)' : ''}`);
      }
      upDlg.close();
      toast(`Uploaded: ${done.join(' · ')}`, '', 8000);
    } catch (err) {
      $('#upErrors').textContent = `${done.length ? `Uploaded: ${done.join(', ')}\n` : ''}${err.message}`;
    } finally {
      btn.disabled = false;
      renderUploadList();
    }
  });

  // ---------------- password prompt ----------------
  function askPassword() {
    return new Promise((resolve) => {
      const d = $('#pwDialog');
      const f = $('#pwForm');
      f.reset(); $('#pwErr').textContent = '';
      const onSubmit = async (e) => {
        e.preventDefault();
        const pw = f.elements.pw.value;
        const res = await fetch('/api/auth/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }).then((r) => r.json());
        if (!res.ok) { $('#pwErr').textContent = 'Wrong password.'; return; }
        try { sessionStorage.setItem('adminKey', pw); } catch { /* storage unavailable */ }
        cleanup(); d.close(); resolve(true);
      };
      const onClose = () => { cleanup(); resolve(false); };
      const cleanup = () => { f.removeEventListener('submit', onSubmit); d.removeEventListener('close', onClose); };
      f.addEventListener('submit', onSubmit);
      d.addEventListener('close', onClose);
      d.showModal();
    });
  }

  // ---------------- misc ----------------
  function toast(msg, kind = '', ms = 3500) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function segControl(id, key, id2) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      state[key] = b.dataset.v;
      $$(`${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      renderRanking(theme(), id2, state[key], key === 'topMetric' ? 'top' : 'low');
    });
  }
  segControl('#topMetric', 'topMetric', 'cTop');
  segControl('#lowMetric', 'lowMetric', 'cLow');
  // Simple toggles that just store a value and redraw one chart.
  for (const [id, key, draw] of [['#bwMetric', 'bwMetric', renderBestWorst], ['#riMode', 'riMode', renderRevInc], ['#tgMode', 'tgMode', renderTargets], ['#censusMetric', 'censusMetric', renderCensus]]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      state[key] = b.dataset.v;
      $$(`${id} button`).forEach((x) => x.classList.toggle('on', x === b));
      draw(theme());
    });
  }
  // The butterfly chart sizes its panels from the card width.
  let riWidth = 0;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w !== riWidth && state.rows.length) { riWidth = w; renderRevInc(theme()); }
  }).observe(document.getElementById('cRevInc'));

  chart('cPos').on('click', (p) => { if (!catOf(state.cat)?.other && !/^Other \(\d+ positions\)$/.test(p.name)) toggleFilter(mPos, p.name); });

  $('#themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme-set', true);
    try { localStorage.setItem('theme', root.dataset.theme); } catch { /* storage unavailable */ }
    renderCharts();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderCharts());

  applyRoute();
  loadData().then(connectLive);
})();
