// Signed-in user chip (menu: users & access, my account, sign out) and role-based UI trimming.
// The server enforces every permission; this only hides what the user cannot use.
(() => {
  if (window.DASH_STATIC) return;
  const H = { 'X-Requested-With': 'sgh' };
  const css = document.createElement('style');
  css.textContent = `
    body[data-role="user"] #viewersBtn, body[data-role="user"] #dqBtn { display: none !important; }
    .cc-link { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px 0 9px; flex: none; border-radius: 99px; background: #409639; color: #fff !important; text-decoration: none; font-size: 13px; font-weight: 650; white-space: nowrap; box-shadow: 0 8px 18px -10px rgba(0,0,0,.5); transition: background .2s; }
    .cc-link:hover { background: #33802d; }
    @media (max-width: 720px) { .cc-link { width: 36px; padding: 0; justify-content: center; } .cc-link span { display: none; } }
    .me-wrap { position: relative; }
    header.top > .me-wrap { margin-left: auto; flex: none; }
    @media (max-width: 768px) { header.top > .me-wrap { margin-left: 0; align-self: flex-end; } }
    .me-btn { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px 0 4px; border-radius: 99px; border: 1px solid var(--line, #ddd); background: var(--surface, #fff); color: var(--text, #111); cursor: pointer; font: inherit; font-size: 13px; }
    .me-btn:hover { border-color: var(--accent, #2a78d6); }
    .me-av { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--accent, #2a78d6); color: var(--accent-ink, #fff); font-weight: 700; font-size: 12px; }
    .me-name { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .me-menu { position: absolute; right: 0; top: 44px; min-width: 230px; background: var(--surface, #fff); color: var(--text, #111); border: 1px solid var(--line, #ddd); border-radius: 12px; box-shadow: 0 18px 40px -12px rgba(0,0,0,.35); padding: 6px; z-index: 60; }
    .me-menu .who { padding: 10px 12px 8px; border-bottom: 1px solid var(--line, #ddd); margin-bottom: 6px; }
    .me-menu .who b { display: block; } .me-menu .who span { font-size: 12px; color: var(--text-2, #666); }
    .me-menu a, .me-menu button { display: block; width: 100%; text-align: left; padding: 9px 12px; border: 0; background: none; color: inherit; font: inherit; font-size: 13.5px; border-radius: 8px; cursor: pointer; text-decoration: none; }
    .me-menu a:hover, .me-menu button:hover { background: var(--surface-2, #f1f1f1); }
    @media (max-width: 720px) { .me-name { display: none; } }
    @supports (-webkit-touch-callout: none) { .me-btn, .me-menu button, .me-menu a { -webkit-appearance: none; } }
  `;
  document.head.append(css);

  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const mk = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

  /**
   * Usage heartbeat for the administrator's Usage tab: every 15 s while this tab is visible and somebody is
   * really using it (mouse, keyboard, touch or scroll in the last 90 s). It reports the page, the view inside it
   * and the seconds of real use; nothing is sent from a hidden tab or an idle one.
   */
  function track() {
    const rnd = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^a-z0-9-]/gi, '').slice(0, 36);
    let sid = '';
    try { sid = sessionStorage.getItem('sgh-sid') || ''; if (!sid) { sid = rnd(); sessionStorage.setItem('sgh-sid', sid); } } catch { sid = rnd(); }
    let lastInput = Date.now(); let lastTick = Date.now(); let hash = location.hash; let stopped = false;
    for (const ev of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart']) addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
    const send = (forHash = hash) => {
      const now = Date.now();
      const present = !stopped && !document.hidden && now - lastInput < 90000;
      const active = present ? Math.min(60, Math.round((now - lastTick) / 1000)) : 0;
      lastTick = now;
      if (!present) return;
      let branch = 'all';
      try { branch = JSON.parse(localStorage.getItem('branch')) || 'all'; } catch { /* storage unavailable */ }
      fetch('/api/track', { method: 'POST', keepalive: true, headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ sid, page: location.pathname, hash: forHash, branch, active }) })
        .then((r) => { if (r.status === 401) stopped = true; }).catch(() => {});
    };
    setInterval(() => send(), 15000);
    addEventListener('hashchange', () => { const old = hash; send(old); hash = location.hash; send(); });
    document.addEventListener('visibilitychange', () => { lastTick = Date.now(); if (!document.hidden) send(); });
    send();
  }

  fetch('/api/auth/me', { headers: H }).then((r) => (r.ok ? r.json() : null)).then((res) => {
    if (!res || !res.user) return;
    const u = res.user;
    if (u.mustChangePassword) { location.replace('/account.html'); return; }
    document.body.dataset.role = u.role;
    window.SGH_USER = Object.assign(window.SGH_USER || {}, u);
    track();

    if (u.role !== 'admin') {
      const canEdit = u.scopes.some((s) => s.canEdit);
      const canUpload = canEdit || u.scopes.some((s) => s.canUpload);
      // (.btn sets display, so the hidden attribute alone would not hide them)
      if (!canEdit) document.getElementById('addBtn')?.style.setProperty('display', 'none', 'important');
      if (!canUpload) document.getElementById('uploadBtn')?.style.setProperty('display', 'none', 'important');
      const allBranches = u.scopes.some((s) => s.branch === '*') || (u.unlocked || []).includes('incentives');
      const mine = new Set(u.scopes.map((s) => s.branch));
      document.querySelectorAll('#branchSeg button[data-v^="SGH-"]').forEach((b) => {
        if (!allBranches && !mine.has(b.dataset.v)) b.style.display = 'none';
      });
    }

    const menu = mk('div', { className: 'me-menu', hidden: true },
      mk('div', { className: 'who' }, mk('b', {}, u.name), mk('span', {}, `${u.username} · ${u.role === 'admin' ? 'Administrator' : 'User'}`)),
      mk('a', { href: '/' }, 'Command Center'),
      u.role === 'admin' ? mk('a', { href: '/admin.html' }, 'Users & access') : '',
      mk('a', { href: '/account.html' }, 'My account · change password'),
      mk('button', { type: 'button', onclick: async () => { await fetch('/api/auth/logout', { method: 'POST', headers: H }).catch(() => {}); location.replace('/login.html'); } }, 'Sign out'));
    const btn = mk('button', { className: 'me-btn', type: 'button', title: 'Account' },
      mk('span', { className: 'me-av' }, initials(u.name)), mk('span', { className: 'me-name' }, u.name));
    const wrap = mk('div', { className: 'me-wrap' }, btn, menu);
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', () => { menu.hidden = true; });
    const bar = document.querySelector('.top-actions') || document.querySelector('header.top'); // header.top: the Workforce dashboard
    const topbar = document.querySelector('.topbar');
    if (topbar && document.getElementById('addBtn')) {
      // inside the incentives workspace: a badge at the left end of the header, back to the Command Center
      topbar.prepend((() => { const a = mk('a', { className: 'cc-link', href: '/', title: 'Back to the Command Center', 'aria-label': 'Back to the Command Center' }); a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg><span>Command Center</span>'; return a; })());
    }
    bar?.append(wrap);
  }).catch(() => {});
})();
