/* Compensation & Incentives Hub: the page you are looking at -> EDITABLE PowerPoint slides (window.PptxBuild).
   Figure tiles become text boxes, tables PowerPoint tables (long ones run over several slides, heading row repeated,
   cell colours kept), charts native PowerPoint charts made from each ECharts chart's own data (bar, line, stacked,
   combined, scatter); only a chart kind PowerPoint has no match for is added as a picture.
   Needs window.PptxGenJS (pptxgen.bundle.js). Loaded by app.js only when the PowerPoint button is pressed. */
(function () {
  'use strict';
window.PptxBuild = (() => {
  const W = 13.333, H = 7.5, M = 0.4, AW = W - 2 * M, BOTTOM = H - 0.5;
  const NAVY = '1F3A5F', INK = '0B0B0B', GREY = '6B6A64', FONT = 'Calibri';
  const shown = (el) => el && !el.closest('.hidden') && el.offsetHeight > 2 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  function hex(c) {
    if (!c || typeof c !== 'string') return null;
    c = c.trim();
    let m = c.match(/^#([0-9a-f]{3})$/i);
    if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase();
    m = c.match(/^#([0-9a-f]{6})/i);
    if (m) return m[1].toUpperCase();
    m = c.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
    if (m) {
      const a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      if (a < 0.05) return null;
      // a see-through colour is shown over white: mix it the same way
      return [m[1], m[2], m[3]].map((v) => Math.round(255 - (255 - Number(v)) * a).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    return null;
  }

  // ---- tiles (KPI cards, small figure boxes) ----
  const TILE_SETS = '.kpis, .dh-stats, .tg-summary, .sc-kpis, .cat-tiles, .ytd-summary';
  function tileOf(el) {
    const lines = (el.innerText || '').split('\n').map(clean).filter(Boolean);
    if (!lines.length) return null;
    const LAB = '.label, :scope > span, h3, h4', VAL = '.value, :scope > b, b, strong';
    // text of an element with a space between its parts ("12.4M" + "EGP" -> "12.4M EGP")
    const words = (n) => clean([...n.childNodes].map((c) => (c.nodeType === 3 ? c.nodeValue : (c.tagName === 'svg' ? '' : words(c)))).join(' '));
    const lab = el.querySelector(LAB), val = el.querySelector(VAL);
    const label = (lab && words(lab)) || lines[0];
    const value = (val && words(val)) || (lines[1] || '');
    // what is left once the label and the value are taken out, one line per part
    const copy = el.cloneNode(true);
    copy.querySelector(LAB)?.remove(); copy.querySelector(VAL)?.remove();
    copy.querySelectorAll('svg, .kpi-progress').forEach((n) => n.remove());
    const rest = [...copy.children].map(words).filter((l) => l && l !== label && l !== value);
    if (!copy.children.length && words(copy)) rest.push(words(copy));
    return { label, value, rest: rest.join('\n') };
  }
  function drawTiles(pptx, s, tiles, y) {
    const perRow = Math.min(tiles.length, tiles.length > 8 ? 6 : tiles.length > 4 ? 4 : tiles.length) || 1;
    const gap = 0.15, tw = (AW - gap * (perRow - 1)) / perRow, th = 1.0;
    tiles.forEach((t, i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      const x = M + c * (tw + gap), yy = y + r * (th + gap);
      s.addShape(pptx.ShapeType.roundRect, { x, y: yy, w: tw, h: th, rectRadius: 0.08, fill: { color: 'F5F7FA' }, line: { color: 'D9DEE5', width: 0.75 } });
      s.addText([
        { text: t.label, options: { fontSize: 9, color: GREY, breakLine: true } },
        { text: t.value || ' ', options: { fontSize: 17, bold: true, color: NAVY, breakLine: !!t.rest } },
        ...(t.rest ? [{ text: t.rest, options: { fontSize: 8, color: GREY } }] : []),
      ], { x: x + 0.05, y: yy + 0.03, w: tw - 0.1, h: th - 0.06, valign: 'top', fontFace: FONT, fit: 'shrink', margin: 4 });
    });
    return y + Math.ceil(tiles.length / perRow) * (th + gap);
  }

  // ---- charts: the ECharts option -> a PowerPoint chart ----
  const val = (d) => {
    if (d == null || d === '-') return null;
    if (typeof d === 'number') return Number.isFinite(d) ? d : null;
    if (Array.isArray(d)) return val(d[d.length - 1]);
    if (typeof d === 'object') return val(d.value);
    const n = Number(d); return Number.isFinite(n) ? n : null;
  };
  const colorOf = (se) => hex(typeof se.itemStyle?.color === 'string' ? se.itemStyle.color : null) || hex(typeof se.color === 'string' ? se.color : (Array.isArray(se.color) ? se.color[0] : null)) || hex(se.lineStyle?.color);
  const axisTextOpts = { catAxisLabelFontSize: 8, valAxisLabelFontSize: 8, catAxisLabelColor: GREY, valAxisLabelColor: GREY, valGridLine: { color: 'E5E7EB', size: 0.5 }, catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT };
  function chartSpec(pptx, inst) {
    const o = inst.getOption();
    const series = (o.series || []).filter((se) => se && (se.data || []).length);
    if (!series.length) return null;
    const xa = (o.xAxis || [])[0], ya = (o.yAxis || [])[0];
    const legend = series.length > 1;
    const names = series.map((se, i) => clean(se.name) || `Series ${i + 1}`);
    // scatter: one shared X list, every series has its points and blanks elsewhere
    if (series.every((se) => se.type === 'scatter')) {
      const xs = [], ys = series.map(() => []);
      series.forEach((se, k) => se.data.forEach((d) => {
        const p = Array.isArray(d) ? d : (Array.isArray(d?.value) ? d.value : null);
        if (!p) return;
        xs.push(Number(p[0])); ys.forEach((arr, j) => arr.push(j === k ? Number(p[1]) : null));
      }));
      if (!xs.length) return null;
      return { types: pptx.ChartType.scatter, data: [{ name: clean(xa?.name) || 'X', values: xs }, ...ys.map((v, j) => ({ name: names[j], values: v }))],
        opts: { ...axisTextOpts, lineSize: 0, lineDataSymbolSize: 7, showLegend: legend, legendPos: 'b', legendFontSize: 8,
          chartColors: series.map((se, i) => colorOf(se) || ['2E6DB4', 'D9534F', '5CB85C', 'F0AD4E'][i % 4]),
          showValAxisTitle: !!ya?.name, valAxisTitle: clean(ya?.name), showCatAxisTitle: !!xa?.name, catAxisTitle: clean(xa?.name), valAxisTitleFontSize: 9, catAxisTitleFontSize: 9 } };
    }
    if (!series.every((se) => se.type === 'bar' || se.type === 'line')) return null;
    const horizontal = ya?.type === 'category' && xa?.type !== 'category';
    const cat = horizontal ? ya : xa;
    if (!cat || cat.type !== 'category') return null;
    const labels = (cat.data || []).map((c) => clean(typeof c === 'object' && c ? c.value : c));
    if (!labels.length) return null;
    const dataOf = (se, i) => ({ name: names[i], labels, values: labels.map((_, k) => val(se.data[k])) });
    const showVal = series.some((se) => se.label?.show);
    const fmt = 'General';
    const common = { ...axisTextOpts, showLegend: legend, legendPos: 'b', legendFontSize: 8, valAxisLabelFormatCode: '#,##0', dataLabelFormatCode: fmt, dataLabelFontSize: 7, showValue: showVal,
      catAxisOrientation: cat.inverse ? 'maxMin' : 'minMax', catAxisLabelFrequency: 1 };
    const bars = series.map((se, i) => [se, i]).filter(([se]) => se.type === 'bar');
    const lines = series.map((se, i) => [se, i]).filter(([se]) => se.type === 'line');
    const stacked = bars.some(([se]) => se.stack);
    const colors = (list) => list.map(([se], j) => colorOf(se) || ['2E6DB4', 'F0AD4E', '5CB85C', 'D9534F', '8E6CC4'][j % 5]);
    if (!lines.length || !bars.length) {
      const list = bars.length ? bars : lines;
      return { types: bars.length ? pptx.ChartType.bar : pptx.ChartType.line, data: list.map(([se, i]) => dataOf(se, i)),
        opts: { ...common, barDir: horizontal ? 'bar' : 'col', barGrouping: stacked ? 'stacked' : 'clustered', barGapWidthPct: 60,
          chartColors: colors(list), lineSize: 2, lineDataSymbolSize: 5 } };
    }
    // bars + lines together: a combined chart, a line on the second axis when the page drew it there
    const second = lines.some(([se]) => se.yAxisIndex === 1);
    const types = [
      { type: pptx.ChartType.bar, data: bars.map(([se, i]) => dataOf(se, i)), options: { barDir: horizontal ? 'bar' : 'col', barGrouping: stacked ? 'stacked' : 'clustered', chartColors: colors(bars), barGapWidthPct: 60 } },
      { type: pptx.ChartType.line, data: lines.map(([se, i]) => dataOf(se, i)), options: { chartColors: colors(lines), lineSize: 2, lineDataSymbolSize: 5, ...(second ? { secondaryValAxis: true, secondaryCatAxis: true } : {}) } },
    ];
    const opts = { ...common };
    if (second) {
      opts.valAxes = [{ showValAxisTitle: false, valAxisLabelFormatCode: '#,##0' }, { showValAxisTitle: false, valAxisLabelFormatCode: 'General', valGridLine: { style: 'none' } }];
      opts.catAxes = [{ catAxisTitle: '' }, { catAxisHidden: true }];
    }
    return { types, data: null, opts };
  }
  function addChart(pptx, s, inst, box, title) {
    let y = box.y, h = box.h;
    if (title) { s.addText(title, { x: box.x, y, w: box.w, h: 0.3, fontSize: 11, bold: true, color: INK, fontFace: FONT }); y += 0.32; h -= 0.32; }
    let spec = null;
    try { spec = chartSpec(pptx, inst); } catch (e) { console.warn('chart not converted', e); }
    if (spec) {
      const place = { x: box.x, y, w: box.w, h, ...spec.opts };
      if (spec.data) s.addChart(spec.types, spec.data, place); else s.addChart(spec.types, place);
      return 'native';
    }
    const url = inst.getDataURL({ pixelRatio: 2, backgroundColor: '#ffffff' });
    const iw = inst.getWidth(), ih = inst.getHeight();
    const k = Math.min(box.w / iw, h / ih);
    s.addImage({ data: url, x: box.x + (box.w - iw * k) / 2, y, w: iw * k, h: ih * k });
    return 'picture';
  }

  // ---- tables ----
  function tableRows(t) {
    const rows = []; let head = 0;
    for (const tr of t.querySelectorAll('tr')) {
      if (!shown(tr)) continue;
      if (tr.parentElement.tagName === 'THEAD') head++;
      const cells = [];
      for (const td of tr.children) {
        if (getComputedStyle(td).display === 'none') continue;
        const cs = getComputedStyle(td);
        const isHead = td.tagName === 'TH' || tr.parentElement.tagName !== 'TBODY';
        const fill = hex(cs.backgroundColor);
        const o = { fontSize: 8, color: hex(cs.color) || INK, bold: isHead || Number(cs.fontWeight) >= 600,
          align: /right|end/.test(cs.textAlign) ? 'right' : (cs.textAlign === 'center' ? 'center' : 'left'), valign: 'middle' };
        if (fill && fill !== 'FFFFFF') o.fill = { color: fill };
        else if (isHead) o.fill = { color: 'EEF2F7' };
        if (td.colSpan > 1) o.colspan = td.colSpan;
        if (td.rowSpan > 1) o.rowspan = td.rowSpan;
        cells.push({ text: clean(td.innerText), options: o });
      }
      if (cells.length) rows.push(cells);
    }
    return { rows, head };
  }
  function addTable(pptx, s, t, y, title, period) {
    const { rows, head } = tableRows(t);
    if (!rows.length) return false;
    const cols = Math.max(...rows.map((r) => r.reduce((n, c) => n + (c.options.colspan || 1), 0)));
    const fs = cols > 12 ? 6.5 : cols > 9 ? 7.5 : 8.5;
    rows.forEach((r) => r.forEach((c) => { c.options.fontSize = fs; }));
    s.addTable(rows, { x: M, y, w: AW, h: BOTTOM - y, fontFace: FONT, border: { type: 'solid', pt: 0.5, color: 'D9DEE5' }, margin: 0.04, rowH: 0.24,
      autoPage: true, autoPageRepeatHeader: head > 0, autoPageHeaderRows: Math.max(1, head), autoPageSlideStartY: 0.8, newSlideStartY: 0.8 });
    // a long table runs on over new slides: give each of them the same heading, marked "continued"
    const all = pptx.slides || pptx._slides || [];
    const first = all.indexOf(s);
    if (first >= 0) {
      const more = all.slice(first + 1);
      more.forEach((c, i) => {
        c.addText(`${title || 'Table'} (continued ${i + 2} / ${more.length + 1})`, { x: M, y: 0.16, w: AW - 3.6, h: 0.45, fontSize: 18, bold: true, color: NAVY, fontFace: FONT, fit: 'shrink' });
        c.addText(period, { x: W - M - 3.5, y: 0.16, w: 3.5, h: 0.45, fontSize: 10, color: GREY, align: 'right', fontFace: FONT });
      });
    }
    return true;
  }

  // ---- one slide frame ----
  function frame(pptx, title, sub, period) {
    const s = pptx.addSlide({ masterName: 'SGH' });
    s.addText(title || ' ', { x: M, y: 0.16, w: AW - 3.6, h: 0.45, fontSize: 18, bold: true, color: NAVY, fontFace: FONT, fit: 'shrink' });
    s.addText(period, { x: W - M - 3.5, y: 0.16, w: 3.5, h: 0.45, fontSize: 10, color: GREY, align: 'right', fontFace: FONT });
    let y = 0.62;
    if (sub) { s.addText(sub, { x: M, y, w: AW, h: 0.32, fontSize: 10, color: GREY, fontFace: FONT, fit: 'shrink' }); y += 0.36; }
    return { s, y: y + 0.06 };
  }

  // ---- one card of the page -> one or more slides ----
  function cardSlides(pptx, el, period, stats) {
    const titleEl = el.querySelector('header h2, .dh-main h2, h2');
    const title = clean(titleEl?.innerText) || (el.id === 'kpis' ? 'Key figures' : '');
    const subEl = el.querySelector('header p, .dh-main p');
    const sub = shown(subEl) ? clean(subEl.innerText) : '';
    const tileSets = [...(el.matches(TILE_SETS) ? [el] : []), ...el.querySelectorAll(TILE_SETS)].filter(shown);
    const tiles = tileSets.flatMap((c) => [...c.children].filter(shown).map(tileOf).filter(Boolean));
    const texts = [];
    el.querySelectorAll('ul.insights > li').forEach((li) => { if (shown(li)) texts.push(clean(li.innerText)); });
    el.querySelectorAll('.align-verdict, .sc-foot').forEach((p) => { if (shown(p) && clean(p.innerText)) texts.push(clean(p.innerText)); });
    const charts = [...el.querySelectorAll('.chart')].filter(shown).map((c) => ({ el: c, inst: window.echarts?.getInstanceByDom(c) })).filter((c) => c.inst);
    const tables = [...el.querySelectorAll('table')].filter((t) => shown(t) && t.querySelector('tr'));
    if (!tiles.length && !texts.length && !charts.length && !tables.length) return;

    let { s, y } = frame(pptx, title, sub, period);
    if (tiles.length) y = drawTiles(pptx, s, tiles, y) + 0.05;
    if (texts.length) {
      const h = Math.min(BOTTOM - y, Math.max(0.6, texts.length * 0.42));
      s.addText(texts.map((t) => ({ text: t, options: { bullet: texts.length > 1, breakLine: true } })),
        { x: M, y, w: AW, h, fontSize: texts.length > 6 ? 11 : 13, color: INK, fontFace: FONT, valign: 'top', fit: 'shrink', paraSpaceAfter: 4 });
      y += h + 0.1;
    }
    if (charts.length) {
      if (BOTTOM - y < 2.2) { ({ s, y } = frame(pptx, title, sub, period)); }
      const per = Math.min(charts.length, 3), gap = 0.3;
      const cw = (AW - gap * (per - 1)) / per;
      const rowsN = Math.ceil(charts.length / per);
      const ch = (BOTTOM - y - 0.15 * (rowsN - 1)) / rowsN;
      charts.forEach((c, i) => {
        const r = Math.floor(i / per), k = i % per;
        const sibTitle = c.el.previousElementSibling?.matches('.bw-title, h3') ? clean(c.el.previousElementSibling.innerText) : '';
        const how = addChart(pptx, s, c.inst, { x: M + k * (cw + gap), y: y + r * (ch + 0.15), w: cw, h: ch }, sibTitle);
        stats[how]++;
      });
    }
    tables.forEach((t, i) => {
      const subH = t.closest('.table-wrap')?.previousElementSibling;
      const tTitle = subH?.matches('h4.sub-h') && shown(subH) ? `${title} · ${clean(subH.innerText)}` : title;
      if (charts.length || texts.length || i > 0 || BOTTOM - y < 1.5) ({ s, y } = frame(pptx, tTitle, i > 0 ? '' : sub, period));
      if (addTable(pptx, s, t, y, tTitle, period)) stats.tables++;
    });
  }

  async function build({ period, stamp, blocks }) {
    const pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = 'Compensation & Incentives Hub';
    pptx.company = 'SGH Egypt';
    const lines = (window.PoweredBy && window.PoweredBy.LINES) || [];
    pptx.defineSlideMaster({ title: 'SGH', background: { color: 'FFFFFF' },
      objects: [
        { rect: { x: 0, y: 0, w: W, h: 0.08, fill: { color: NAVY } } },
        ...(lines.length ? [{ text: { text: lines.join('  ·  '), options: { x: M, y: H - 0.38, w: AW - 1.2, h: 0.28, fontSize: 8, color: GREY, fontFace: FONT } } }] : []),
      ],
      slideNumber: { x: W - M - 0.6, y: H - 0.38, w: 0.6, h: 0.28, fontSize: 8, color: GREY, align: 'right' } });
    const t = pptx.addSlide({ masterName: 'SGH' });
    t.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.18, fill: { color: NAVY }, line: { color: NAVY } });
    try { t.addImage({ path: new URL('logo.png', location.href).href, x: W - 2.3, y: 0.5, w: 1.8, h: 0.9, sizing: { type: 'contain', w: 1.8, h: 0.9 } }); } catch { /* no logo */ }
    t.addText('Compensation & Incentives Hub', { x: M + 0.3, y: 2.3, w: AW - 0.6, h: 0.9, fontSize: 36, bold: true, color: NAVY, fontFace: FONT });
    t.addText('Doctors & Admin Performance', { x: M + 0.3, y: 3.15, w: AW - 0.6, h: 0.5, fontSize: 20, color: '4A4A47', fontFace: FONT });
    t.addText(period, { x: M + 0.3, y: 3.9, w: AW - 0.6, h: 0.5, fontSize: 16, color: INK, fontFace: FONT });
    t.addText('Prepared ' + stamp, { x: M + 0.3, y: 4.45, w: AW - 0.6, h: 0.4, fontSize: 12, color: GREY, fontFace: FONT });
    const stats = { native: 0, picture: 0, tables: 0 };
    for (const el of blocks) cardSlides(pptx, el, period, stats);
    return { pptx, stats };
  }
  return { build, shown };
})();
})();
