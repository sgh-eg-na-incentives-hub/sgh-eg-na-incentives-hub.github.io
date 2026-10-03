/*
 * Upload templates: which template belongs to which page, and the strict check an upload must pass
 * before it is accepted. Shared by the page (instant errors in the upload window) and the upload
 * worker (checked again before anything is filed), so both apply exactly the same rules.
 *
 * The rules come from the template itself: its table's columns (the header row, the one starting
 * with "Branch") and the department figures typed above it (label in column A, value next to it).
 * A file passes when it has every column of its template, every figure above the table filled with
 * a number, and every row complete: a real branch (the one being uploaded for), month and year, one
 * month for the whole file, and numbers in the number columns.
 *
 * Grids are arrays of rows, each an array of cell values (row 0 = Excel row 1): strings, numbers
 * (Excel dates as their serial number) or Date objects.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TemplateCheck = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // page -> template file (public/templates/). "category" for the whole page (and its specialty
  // pages); "category:unit" for one department / section.
  const TEMPLATES = {
    opd: 'OPD Med 01.xlsx',
    residents: 'Residents Med 02.xlsx',
    'allied:Anesthesia': 'Anesthesia.xlsx',
    'allied:Emergency Room': 'Emergency Room.xlsx',
    'allied:Home care': 'Home care.xlsx',
    'allied:Intensive Care Unit': 'Intensive Care Unit.xlsx',
    'allied:Laboratory': 'Laboratory.xlsx',
    'allied:Medical Imaging': 'Medical Imaging.xlsx',
    'allied:Pharmacy': 'Pharmacy.xlsx',
    'allied:Physiotherapy': 'Physiotherapy.xlsx',
    'allied:Radiation Oncology': 'Radiation Oncology.xlsx',
    'bd:Corporate Sales': 'BD Corporate Sales.xlsx',
    'bd:External Doctors': 'BD External Doctors.xlsx',
    'bd:IVP Visiting Professors': 'BD IVP Visiting Professors.xlsx',
    admission: 'Admission & Discharge.xlsx',
    patientrel: 'Patient Relation.xlsx',
    legal: 'Legal Affairs (0500).xlsx',
    collection: 'CAM Collection.xlsx',
    quarterly: 'Quarterly Incentive.xlsx',
    other: 'Other Incentives.xlsx',
  };
  /** The template key of a page: its department's own, else its category's (null = none yet). */
  const templateKey = (category, unit) => (unit && TEMPLATES[`${category}:${unit}`] ? `${category}:${unit}`
    : TEMPLATES[category] ? category : null);

  const BRANCHES = ['SGH-Cairo', 'SGH-Alex'];
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const text = (v) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v).trim());
  const empty = (v) => text(v) === '';
  const col = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  // columns that hold words; every other template column must hold a number
  const TEXT_COLS = new Set(['branch', 'month', 'quarter', 'year', 'paidto', 'incentivereason', 'reason', 'id', 'employeeid', 'name', 'doctor', 'position', 'designation', 'department', 'section', 'specialty']);
  const MAY_BE_NEGATIVE = new Set(['netprofit', 'profit', 'net']);
  const UNIT_COLS = new Set(['department', 'section', 'specialty']);
  // Paid To (Other Incentives): a person, a department or a group of employees. A person needs
  // these columns; a department / group row may leave them empty.
  const PAID_TO = { person: 'Person', individual: 'Person', employee: 'Person', department: 'Department', dept: 'Department', group: 'Group', team: 'Group' };
  const PERSON_ONLY = new Set(['id', 'employeeid', 'position', 'designation', 'totalsalary', 'salary']);
  const COUNT_COLS = new Set(['noofemployees', 'numberofemployees', 'employees', 'headcount']);

  function toNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = text(v).replace(/[,\s]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }
  /** Month number 1-12 from "July", "Jul", "Sept", 7, "07" or an Excel date; null if it isn't one. */
  function monthOf(v) {
    if (v instanceof Date) return v.getUTCMonth() + 1;
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 1 && v <= 12) return v;
      if (v > 20000 && v < 90000) return new Date(Math.round((v - 25569) * 86400000)).getUTCMonth() + 1;
      return null;
    }
    const s = text(v).toLowerCase();
    if (/^\d{1,2}$/.test(s)) { const n = Number(s); return n >= 1 && n <= 12 ? n : null; }
    if (s === 'sept') return 9;
    const i = MONTHS.findIndex((m) => m === s || m.slice(0, 3) === s);
    return i >= 0 ? i + 1 : null;
  }
  /** Quarter 1-4 from "Q3", "q 3", 3; null if it isn't one. */
  function quarterOf(v) {
    const s = text(v).toLowerCase().replace(/s+/g, '');
    const m = s.match(/^q?([1-4])$/);
    return m ? Number(m[1]) : null;
  }
  function yearOf(v) {
    if (v instanceof Date) return v.getUTCFullYear();
    const n = toNumber(v);
    return n != null && Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : null;
  }
  function branchOf(v) {
    const s = norm(v);
    if (s === 'sghcairo' || s === 'cairo') return 'SGH-Cairo';
    if (s === 'sghalex' || s === 'alex' || s === 'alexandria' || s === 'sghalexandria') return 'SGH-Alex';
    return null;
  }

  /** A template's shape: its header row, the columns (same-name columns are alternatives), the figures above. */
  function shapeOf(grid) {
    const headerRow = grid.findIndex((row, i) => i < 20 && norm(row && row[0]) === 'branch');
    if (headerRow < 0) return null;
    const groups = new Map();
    (grid[headerRow] || []).forEach((h, i) => {
      // "Quarter ( Q1 , Q2 , Q3 , Q4 )" is the Quarter column
      const k = /^quarter/.test(norm(h)) ? 'quarter' : norm(h);
      if (!k) return;
      if (!groups.has(k)) groups.set(k, { key: k, label: text(h), cols: [] });
      groups.get(k).cols.push(i);
    });
    const figures = [];
    for (let r = 0; r < headerRow; r++) {
      const label = text(grid[r] && grid[r][0]);
      if (label) figures.push({ label, key: norm(label) });
    }
    return { headerRow, columns: [...groups.values()], figures };
  }

  /**
   * Check an upload against its template. ctx: { branch, unit, name } (name = the page, for messages).
   * -> { ok, errors: [..], rows, month: 'July 2026' (or 'Q2 2026' for a quarterly template) }
   */
  function validate(grid, templateGrid, ctx = {}) {
    const errors = [];
    const tpl = shapeOf(templateGrid);
    if (!tpl) return { ok: false, errors: ['The template for this page could not be read.'], rows: 0 };
    const up = shapeOf(grid);
    if (!up) return { ok: false, errors: [`This is not the ${ctx.name || ''} template: no table starting with a "Branch" column. Download the template from this page and fill it in.`], rows: 0 };
    // every column of the template
    const where = new Map(up.columns.map((c) => [c.key, c]));
    const missing = tpl.columns.filter((c) => !where.has(c.key)).map((c) => c.label);
    if (missing.length) {
      return { ok: false, errors: [`This is not the ${ctx.name || ''} template: missing column${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${m}"`).join(', ')}. Download the template from this page and fill it in.`], rows: 0 };
    }
    // every figure above the table, filled with a number
    for (const f of tpl.figures) {
      let found = false;
      for (let r = 0; r < up.headerRow; r++) {
        const row = grid[r] || [];
        if (norm(row[0]) !== f.key) continue;
        found = true;
        const value = row.slice(1).find((v) => !empty(v));
        if (value === undefined) errors.push(`"${f.label}" (row ${r + 1}) is empty — type its number in column B.`);
        else if (toNumber(value) == null || toNumber(value) < 0) errors.push(`"${f.label}" (row ${r + 1}) must be a number, not "${text(value)}".`);
      }
      if (!found) errors.push(`"${f.label}" is missing above the table — use the template from this page.`);
    }
    // the rows
    const value = (row, c) => { for (const i of c.cols) if (!empty(row[i])) return row[i]; return null; };
    const cell = (r, c) => `${col(c.cols[0])}${r + 1}`;
    const months = new Set();
    let rows = 0;
    for (let r = up.headerRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (!up.columns.some((c) => !empty(value(row, c)))) continue; // an empty row
      // a template may come with a column filled in (e.g. BD's "Section") - that row alone is not data
      if (tpl.columns.every((c) => { const v = value(row, where.get(c.key)); return empty(v) || ['department', 'section'].includes(c.key); })) continue;
      rows++;
      let m = null; let q = null; let y = null;
      const paidCol = where.get('paidto');
      const paid = paidCol && PAID_TO[norm(value(row, paidCol))];
      for (const tc of tpl.columns) {
        const c = where.get(tc.key);
        const v = value(row, c);
        if (empty(v) && paid && paid !== 'Person' && PERSON_ONLY.has(tc.key)) continue; // not needed for a department / group
        if (empty(v)) { errors.push(`Row ${r + 1}: "${tc.label}" is empty (${cell(r, c)})${paid === 'Person' && PERSON_ONLY.has(tc.key) ? ' — needed when it is paid to a person' : ''}.`); continue; }
        if (tc.key === 'branch') {
          const b = branchOf(v);
          if (!b) errors.push(`Row ${r + 1}: Branch "${text(v)}" — write SGH-Cairo or SGH-Alex.`);
          else if (ctx.branch && b !== ctx.branch) errors.push(`Row ${r + 1}: Branch is ${b}, but this upload is for ${ctx.branch}.`);
        } else if (tc.key === 'month') {
          m = monthOf(v);
          if (!m) errors.push(`Row ${r + 1}: Month "${text(v)}" is not a month — write e.g. July.`);
        } else if (tc.key === 'paidto') {
          if (!paid) errors.push(`Row ${r + 1}: Paid To "${text(v)}" — write Person, Department or Group.`);
        } else if (COUNT_COLS.has(tc.key)) {
          const n = toNumber(v);
          if (n == null || !Number.isInteger(n) || n < 1) errors.push(`Row ${r + 1}: "${tc.label}" must be a whole number of employees (1 or more), not "${text(v)}" (${cell(r, c)}).`);
          else if (paid === 'Person' && n !== 1) errors.push(`Row ${r + 1}: paid to a person, so "${tc.label}" is 1 (${cell(r, c)}).`);
        } else if (tc.key === 'quarter') {
          q = quarterOf(v);
          if (!q) errors.push(`Row ${r + 1}: Quarter "${text(v)}" — write Q1, Q2, Q3 or Q4.`);
        } else if (tc.key === 'year') {
          y = yearOf(v);
          if (!y) errors.push(`Row ${r + 1}: Year "${text(v)}" is not a year — write e.g. 2026.`);
        } else if (UNIT_COLS.has(tc.key) && ctx.unit && norm(v) !== norm(ctx.unit)) {
          errors.push(`Row ${r + 1}: ${tc.label} is "${text(v)}", but this is the ${ctx.unit} template.`);
        } else if (!TEXT_COLS.has(tc.key)) {
          const n = toNumber(v);
          if (n == null) errors.push(`Row ${r + 1}: "${tc.label}" must be a number, not "${text(v)}" (${cell(r, c)}).`);
          else if (n < 0 && !MAY_BE_NEGATIVE.has(tc.key)) errors.push(`Row ${r + 1}: "${tc.label}" cannot be negative (${cell(r, c)}).`);
        }
      }
      if (m && y) months.add(`${MONTH_LABELS[m - 1]} ${y}`);
      else if (q && y) months.add(`Q${q} ${y}`);
    }
    if (!rows) errors.unshift('The table is empty — fill in at least one row.');
    if (months.size > 1) errors.unshift(`The file mixes ${q0(months) ? 'quarters' : 'months'} (${[...months].join(', ')}) — one file is one ${q0(months) ? 'quarter' : 'month'}.`);
    return { ok: !errors.length, errors, rows, month: months.size === 1 ? [...months][0] : null };
  }

  const q0 = (set) => /^Q/.test([...set][0] || '');

  /** Errors as a short text (the first few, and how many more). */
  const summary = (errors, max = 8) => (errors.length <= max ? errors.join('\n') : `${errors.slice(0, max).join('\n')}\n… and ${errors.length - max} more.`);

  return { TEMPLATES, templateKey, validate, summary, shapeOf, BRANCHES };
}));
