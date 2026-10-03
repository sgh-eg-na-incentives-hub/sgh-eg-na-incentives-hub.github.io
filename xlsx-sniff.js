/* Minimal in-browser .xlsx reader: finds which month a workbook holds (from its
   ReportDate column) and how many doctor rows it has, so uploads can be filed
   under <year>/<Month>.xlsx automatically. No dependencies. */
(() => {
  'use strict';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');

  function monthIndex(s) {
    const t = String(s ?? '').trim();
    const num = t.match(/^(\d{1,2})(?!\d)/);
    if (num && Number(num[1]) >= 1 && Number(num[1]) <= 12) return Number(num[1]);
    const word = t.match(/[a-z]{3,}/i);
    if (!word) return null;
    const i = MONTHS.findIndex((m) => m.toLowerCase().startsWith(word[0].toLowerCase().slice(0, 3)));
    return i >= 0 ? i + 1 : null;
  }

  function toPeriod(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (typeof v === 'number' || (/^\d+(\.\d+)?$/.test(String(v)) && n > 20000 && n < 90000)) {
      if (n > 20000 && n < 90000) {
        const d = new Date(Math.round((n - 25569) * 86400000));
        return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      }
      return null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${pad2(m[2])}`;
    m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
    if (m) return `${m[2]}-${pad2(m[1])}`;
    m = s.match(/^(\d{1,2})[-/.]\d{1,2}[-/.](\d{4})$/);
    if (m) return `${m[2]}-${pad2(m[1])}`;
    m = s.match(/^([a-z]{3,})[\s\-/.]*(\d{4})$/i);
    if (m && monthIndex(m[1])) return `${m[2]}-${pad2(monthIndex(m[1]))}`;
    return null;
  }

  /** Period guessed from a file name ("August.xlsx", "2026-08.xlsx", "Aug 2026.xlsx"). */
  function periodFromName(name, fallbackYear) {
    const base = String(name).replace(/\.[^.]+$/, '');
    const direct = toPeriod(base);
    if (direct) return direct;
    const month = monthIndex(base);
    const year = (base.match(/(?:19|20)\d{2}/) || [])[0] || fallbackYear;
    return month && year ? `${year}-${pad2(month)}` : null;
  }

  // ---- zip ----
  async function unzip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid .xlsx file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
      entries[name] = { method, size, local };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return async (name) => {
      const e = entries[name];
      if (!e) return null;
      const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
      const data = new Uint8Array(buf, start, e.size);
      if (e.method === 0) return new TextDecoder().decode(data);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    };
  }

  const colOf = (ref) => ref.replace(/\d+/g, '');

  function cellsOf(rowXml, shared) {
    const out = {};
    for (const m of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1];
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      if (!ref) continue;
      const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const body = m[2] || '';
      let v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (type === 's' && v != null) v = shared[Number(v)];
      else if (type === 'inlineStr') v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join('');
      else if (v != null && type !== 'str') v = Number(v);
      else if (v != null) v = decode(v);
      out[colOf(ref)] = v;
    }
    return out;
  }

  const FOOTER = /^(grand\s*)?totals?\b|^sub\s*-?\s*totals?\b|^number\s+of\b|^no\.?\s+of\b/i;
  const ID_NAMES = ['id', 'employeeid', 'empid', 'code', 'doctorid', 'doctorcode', 'staffid', 'empno', 'employeeno', 'employeecode', 'empcode'];
  const NAME_NAMES = ['name', 'doctor', 'doctorname', 'employeename', 'fullname'];
  const PAY_NAMES = ['salary', 'basicsalary', 'salaries', 'totalsalary', 'incentives', 'incentive', 'grossincentives', 'grossicentives', 'finalincentives',
    'finalicentives', 'finalincentive', 'totalincentives', 'revenue', 'income', 'actualsales', 'actualcollection', 'visits', 'allvisitsorcensus', 'admission', 'admissions'];
  const GROUP_NAMES = ['department', 'dept', 'specialty', 'section', 'category', 'month', 'quarter', 'q'];

  /** Inspect a workbook: { period, periods, rows, sheet } or throws. */
  async function inspect(file) {
    // Year for month cells without one ("Jan"): from the file name, else this year.
    const nameYear = (String(file.name || '').match(/(?:19|20)\d{2}/) || [])[0] || String(new Date().getFullYear());
    const read = await unzip(await file.arrayBuffer());
    const sharedXml = (await read('xl/sharedStrings.xml')) || '';
    const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(''));
    const wbXml = (await read('xl/workbook.xml')) || '';
    const relsXml = (await read('xl/_rels/workbook.xml.rels')) || '';
    const rels = Object.fromEntries([...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      (m[0].match(/\bId="([^"]+)"/) || [])[1], (m[0].match(/\bTarget="([^"]+)"/) || [])[1]]));
    const sheets = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
      name: decode((m[0].match(/\bname="([^"]*)"/) || [])[1] || ''),
      target: rels[(m[0].match(/\br:id="([^"]+)"/) || [])[1]],
    }));
    for (const sh of sheets) {
      if (!sh.target) continue;
      const pathIn = sh.target.startsWith('/') ? sh.target.slice(1) : `xl/${sh.target.replace(/^\.\//, '')}`;
      const xml = await read(pathIn);
      if (!xml) continue;
      const rows = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
      // The header is row 1, or a row under a title; a summary sheet has no ID / Name columns.
      const has = (hdr, names) => Object.values(hdr).some((h) => names.includes(norm(h)));
      const top = rows.filter((r) => Number(r[1]) <= 15).map((r) => ({ r, hdr: cellsOf(r[2], shared) }));
      const hit = top.find((t) => has(t.hdr, ID_NAMES) && has(t.hdr, NAME_NAMES))
        || top.find((t) => has(t.hdr, PAY_NAMES) && has(t.hdr, GROUP_NAMES));
      if (!hit) continue;
      const headerRow = hit.r;
      const headerNum = Number(headerRow[1]);
      const header = hit.hdr;
      const colFor = (names) => Object.keys(header).find((c) => names.includes(norm(header[c])));
      const idCol = colFor(ID_NAMES);
      const nameCol = colFor(NAME_NAMES);
      // Targets export: an ID and a target column (or "Jan Target"...), but no salary/incentives.
      const hasPay = colFor(['salary', 'basicsalary', 'incentives', 'incentive']);
      const targetCol = Object.keys(header).find((c) => /target|tgt|goal/i.test(String(header[c] ?? '')));
      // ...or a column per month (Jan, Feb, Mar...): 3+ month headers and no salary columns.
      const monthHeaders = Object.values(header).filter((h) => typeof h === 'number'
        || String(h ?? '').split(/[\s\-_/.,]+/).some((w) => MONTHS.some((m) => m.toLowerCase() === w.toLowerCase() || m.slice(0, 3).toLowerCase() === w.toLowerCase()))).length;
      if (idCol && (targetCol || monthHeaders >= 3) && !hasPay) {
        const ids = new Set();
        for (const r of rows) {
          if (Number(r[1]) <= headerNum) continue;
          const id = cellsOf(r[2], shared)[idCol];
          if (id != null && id !== '') ids.add(String(id));
        }
        return { kind: 'targets', period: null, periods: {}, rows: ids.size, sheet: sh.name };
      }
      const people = idCol && nameCol;
      const dateCol = colFor(['reportdate', 'date', 'period', 'month', 'incentivemonth', 'payrollmonth']);
      const yearCol = colFor(['year']);
      const periods = {};
      let count = 0;
      for (const r of rows) {
        if (Number(r[1]) <= headerNum) continue;
        const cells = cellsOf(r[2], shared);
        const vals = Object.values(cells);
        const labels = people ? [cells[idCol], cells[nameCol]] : vals.slice(0, 2);
        if (labels.some((v) => typeof v === 'string' && FOOTER.test(v.trim()))) continue; // totals / footer lines
        if (people ? (cells[idCol] == null || cells[idCol] === '') && !cells[nameCol] : !vals.some((v) => typeof v === 'number')) continue;
        count++;
        const raw = dateCol ? cells[dateCol] : null;
        const m = raw != null && !toPeriod(raw) ? monthIndex(raw) : null;
        const p = toPeriod(raw) || (m ? `${yearCol && Number(cells[yearCol]) > 1900 ? cells[yearCol] : nameYear}-${pad2(m)}` : null);
        if (p) periods[p] = (periods[p] || 0) + 1;
      }
      const period = Object.entries(periods).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      return { kind: 'month', period, periods, rows: count, sheet: sh.name };
    }
    throw new Error('No sheet with ID and Name columns (or a department / month summary) found');
  }

  const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  /**
   * The first sheet as a grid (rows of cell values, row 0 = Excel row 1) for TemplateCheck:
   * strings, and numbers (dates as their serial number). Accepts a File/Blob or an ArrayBuffer.
   */
  async function grid(src) {
    const read = await unzip(src instanceof ArrayBuffer ? src : await src.arrayBuffer());
    const sharedXml = (await read('xl/sharedStrings.xml')) || '';
    const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(''));
    const wbXml = (await read('xl/workbook.xml')) || '';
    const relsXml = (await read('xl/_rels/workbook.xml.rels')) || '';
    const rels = Object.fromEntries([...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      (m[0].match(/\bId="([^"]+)"/) || [])[1], (m[0].match(/\bTarget="([^"]+)"/) || [])[1]]));
    const first = (wbXml.match(/<sheet\b[^>]*>/) || [])[0];
    const target = first && rels[(first.match(/\br:id="([^"]+)"/) || [])[1]];
    if (!target) throw new Error('The file has no sheet');
    const xml = await read(target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
    const out = [];
    for (const r of (xml || '').matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = cellsOf(r[2], shared);
      const row = [];
      for (const [letters, v] of Object.entries(cells)) if (v != null) row[colIndex(letters)] = v;
      out[Number(r[1]) - 1] = row;
    }
    for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = [];
    return out;
  }

  window.XlsxSniff = { inspect, grid, periodFromName, monthName: (m) => MONTHS[m - 1] };
})();
