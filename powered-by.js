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

  // ---- what every PRINTED page carries: the word CONFIDENTIAL (top right, and faint across the page) and this credit line at the bottom ----
  // printParts() gives the css + the two fixed blocks (they repeat on every printed page); printHtml() prints a standalone page through a hidden frame
  // (no pop-up, nothing of the live page is printed); livePrint() adds the same blocks to the live page for the length of a print.
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function printParts(label) {
    var word = label || 'Confidential';
    return {
      // the page margin is 0, so the browser has no room for its own header / footer (date, title, the page address): they are not printed
      page: function (landscape) { return '@page{size:A4 ' + (landscape === false ? 'portrait' : 'landscape') + ';margin:0}'; },
      // empty rows at the top and bottom of every printed page (a table head / foot repeats on each page), so the text never runs under the badge or the credit
      shell: function (inner) { return '<table class="pb-shell"><thead><tr><td><div class="pb-sp-top"></div></td></tr></thead><tfoot><tr><td><div class="pb-sp-bot"></div></td></tr></tfoot><tbody><tr><td>' + inner + '</td></tr></tbody></table>'; },
      css: '.pb-shell{width:100%;border-collapse:collapse}.pb-shell>thead>tr>td,.pb-shell>tfoot>tr>td,.pb-shell>tbody>tr>td{padding:0;border:0;background:none}.pb-sp-top{height:10mm}.pb-sp-bot{height:17mm}' +
        // the word sits bottom left, just above the credit line, in plain (not bold) type (owner, 2026-11-04: no watermark)
        '.pb-conf{position:fixed;left:10mm;bottom:10mm;color:#b00020;font:400 10.5px Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase}' +
        '.pb-pfoot{position:fixed;left:10mm;right:10mm;bottom:4mm;border-top:1px solid #bbb;padding-top:3px;font:10px Arial,sans-serif;color:#444;display:flex;justify-content:space-between;gap:16px;background:#fff}.pb-pfoot b{font-weight:700}.pb-pfoot em{font-style:normal}',
      top: '<div class="pb-conf">' + esc(word) + '</div>',
      foot: '<div class="pb-pfoot"><span><b>' + esc(LINES[0]) + '</b></span><span><em>' + esc(LINES[1]) + '</em></span></div>',
    };
  }
  api.printParts = printParts;
  /** print a standalone document: opts = { title, css, body, landscape } ; a frame is used so there is no pop-up to allow */
  api.printHtml = function (opts) {
    var o = opts || {}; var p = printParts(o.label);
    var f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    var d = f.contentWindow.document; d.open();
    var attrs = ''; Object.keys(o.htmlAttrs || {}).forEach(function (k) { attrs += ' ' + k + '="' + esc(o.htmlAttrs[k]) + '"'; });
    d.write('<!doctype html><html' + attrs + '><head><meta charset="utf-8"><title>' + esc(o.title || 'SGH') + '</title><style>' + p.page(o.landscape) + '*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#111;font:12px/1.4 Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{padding:0 10mm}' + p.css + (o.css || '') + '</style></head><body' + (o.bodyClass ? ' class="' + esc(o.bodyClass) + '"' : '') + '>' + p.top + p.shell('<main>' + (o.body || '') + '</main>') + p.foot + '</body></html>');
    d.close();
    var done = false; var go = function () { if (done) return; done = true; try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* blocked */ } setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 60000); };
    var imgs = [].slice.call(d.images || []); var wait = imgs.filter(function (i) { return !i.complete; });
    if (!wait.length) setTimeout(go, 50); else { var n = wait.length; wait.forEach(function (i) { i.onload = i.onerror = function () { if (--n === 0) go(); }; }); setTimeout(go, 4000); }
  };
  /** the same blocks on the LIVE page while it is printed (a page that prints itself): call the returned function after the print */
  api.livePrint = function (label) {
    var p = printParts(label); var st = document.createElement('style');
    st.textContent = '.pb-live{display:none}@media print{' + p.page() + 'html,body{margin:0 !important}body{padding:10mm 10mm 18mm !important}.pb-live{display:block}' + p.css + '}';
    var box = document.createElement('div'); box.className = 'pb-live'; box.innerHTML = p.top + p.foot;
    document.head.appendChild(st); document.body.appendChild(box);
    return function () { if (st.parentNode) st.parentNode.removeChild(st); if (box.parentNode) box.parentNode.removeChild(box); };
  };
})(this);
