/* The portal's credit line, in ONE place: every page shows it at the bottom right of its footer (the green bar,
   or a thin footer added for pages without one), and every Excel file the portal makes carries it in the page
   footer, bottom left, in small type (xlsx-write.js in the browser, server/branding.js on the server).
   Change the words here only. */
(function (root) {
  'use strict';
  var LINES = ['Powered By: Total Rewards & Payroll Management | HR Sector', 'Strategic HR Vision & Precision'];
  // Excel header / footer codes: &L = left section, &"font,style", &8 = size 8 pt, && = a literal "&".
  var amp = function (s) { return s.replace(/&/g, '&&'); };
  var EXCEL_FOOTER = '&L&"Calibri,Bold"&8' + amp(LINES[0]) + '\n&"Calibri,Italic"&7' + amp(LINES[1]);
  var api = { LINES: LINES, EXCEL_FOOTER: EXCEL_FOOTER };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.PoweredBy = api;
  if (typeof document === 'undefined') return;

  var CSS = [
    'footer.foot .wrap.pb-wrap{height:auto;min-height:46px;padding-top:10px;padding-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:6px 24px;flex-wrap:wrap}',
    '.pb-credit{display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1.35;margin-left:auto}',
    '.pb-credit b{font-weight:700}',
    '.pb-credit em{font-style:normal;opacity:.85;font-size:12.5px;letter-spacing:.04em}',
    'footer.pb-foot{margin-top:28px;padding:12px 24px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(127,127,127,.25);font-size:12.5px;color:inherit;opacity:.78;display:flex;justify-content:flex-end;clear:both}',
    'footer.pb-foot .pb-credit em{font-size:11.5px}',
    '@media (max-width:720px){footer.foot .wrap.pb-wrap{flex-direction:column;align-items:flex-start}footer.foot .pb-credit{align-items:flex-start;text-align:left;margin-left:0}footer.pb-foot{justify-content:flex-start;padding-left:16px;padding-right:16px}footer.pb-foot .pb-credit{align-items:flex-start;text-align:left;margin-left:0}}',
  ].join('\n');

  function credit() {
    var s = document.createElement('span'); s.className = 'foot-credit pb-credit';
    var b = document.createElement('b'); b.textContent = LINES[0];
    var e = document.createElement('em'); e.textContent = LINES[1];
    s.appendChild(b); s.appendChild(e);
    return s;
  }
  function mount() {
    if (document.querySelector('.foot-credit')) return;   // the page already carries it (Productivity Matrix)
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var wrap = document.querySelector('footer.foot .wrap');
    if (wrap) {
      if (!wrap.querySelector('.foot-copy')) {
        var copy = document.createElement('span'); copy.className = 'foot-copy';
        while (wrap.firstChild) copy.appendChild(wrap.firstChild);
        wrap.appendChild(copy);
      }
      wrap.classList.add('pb-wrap');
      wrap.appendChild(credit());
      return;
    }
    var f = document.createElement('footer'); f.className = 'pb-foot';
    f.appendChild(credit());
    document.body.appendChild(f);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})(this);
