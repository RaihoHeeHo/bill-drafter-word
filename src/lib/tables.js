/* Bill Drafter for Word (demo) - tables in the law's text.

   A table is one item among a text's paragraphs:
     {table: true, caption?: 'TABLE ONE.', rows: [{kind: 'head'|'group'|'note'|'', cells: [cell, …]}, …]}
   where a cell is a string in the law's own text (readings, the Bank), or an array of runs [{t, k}] in a marked
   text (k '' | 'ins' | 'del'). A line break inside a cell is "\n" (the profile's <eol/>, kept as a layout hint).
   Row kinds follow the AKN-NY profile's named tables: a heading row (the column headings), a group row
   ("Group A:", spanning the table) and a note row ("{3} If licensed …", spanning the table, under it).

   In Word a table is a real Word table inside the quoted text, so the drafter edits it with Word's own table
   tools or with the pane's table editor. Mark changes compares it row by row and cell by cell with the Bank:
   rows that are new are underlined, rows taken out stay in brackets, and changed cells are marked word by word. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const isTable = p => !!p && !Array.isArray(p) && typeof p === 'object' && p.table === true;
  const cellText = c => Array.isArray(c) ? c.map(r => r.t).join('') : String(c == null ? '' : c);
  const GROUP = /^Group [A-Z]+:?$/, NOTE = /^\{\d+\}/, CAPTION = /^TABLE [A-Z]+\.?$/;
  // A table as text, row by row (for comparing and for the style checks).
  const tableText = t => t.rows.map(r => r.cells.map(cellText).join(' ')).join('\n');
  const rowKind = cells => {
    const filled = cells.map(cellText).filter(x => x.trim());
    if (filled.length === 1 && GROUP.test(filled[0].trim())) return 'group';
    if (filled.length === 1 && NOTE.test(filled[0].trim())) return 'note';
    return '';
  };

  /* ---------- tables in the Bank's text ----------
     The Bank keeps tables as fixed-width text: columns separated by runs of spaces. A block of two or more lines
     with a gap of three or more spaces inside them is a table. Its columns are the stretches of characters that
     some row uses, separated by spaces every row leaves blank. A line with words only in the first column
     continues the row above (a wrapped cell); the lines before the first row with an amount are the headings. */
  const GAP = /\S {3,}\S/;
  const isGapLine = l => GAP.test(l.trim());
  const isGroupLine = l => GROUP.test(l.trim());
  // A line that starts a unit of the law ("(b) The …", "2. Any …", "§ 12. …"), as opposed to a cell that happens
  // to begin with a letter in parentheses ("(a) of § 1113:").
  const startsUnit = l => /^\s*(§\s*\d+[\w-]*\.\s|\(?[0-9a-zA-Z]{1,4}[.)]\s+["\u201cA-Z])/.test(l) && !isGapLine(l);
  function columns(lines) {
    const w = Math.max(...lines.map(l => l.length)), used = new Array(w).fill(false);
    for (const l of lines) for (let i = 0; i < l.length; i++) if (l[i] !== ' ') used[i] = true;
    const cols = [];
    for (let i = 0; i < w; i++) {
      if (!used[i]) continue;
      const l = cols[cols.length - 1];
      // Columns closer than three spaces are one column (words inside a cell are one or two spaces apart).
      if (l && i - l[1] < 3) l[1] = i + 1; else cols.push([i, i + 1]);
    }
    return cols;
  }
  function blockToTable(lines) {
    const rowsLines = lines.filter(l => !isGroupLine(l) && !NOTE.test(l.trim()));
    const cols = columns(rowsLines.filter(isGapLine).map(l => l.replace(/\s+$/, '')));
    // Re-cut each line at the gaps nearest the column starts, so a cell that starts early still lands in its column.
    const cut = l => {
      const cells = new Array(cols.length).fill('');
      const re = /\S+(?: \S+| {2}(?=\S)\S*)*/g; let m;
      while ((m = re.exec(l))) {
        const mid = m.index, end = m.index + m[0].length;
        let k = cols.findIndex(([a, b]) => end > a && mid < b + 2);
        if (k < 0) k = cols.reduce((best, c, i) => Math.abs(c[0] - mid) < Math.abs(cols[best][0] - mid) ? i : best, 0);
        cells[k] = cells[k] ? cells[k] + ' ' + m[0].trim() : m[0].trim();
      }
      return cells;
    };
    const rows = []; let pending = [], caption = null;
    for (const l of lines) {
      if (!l.trim()) continue;
      if (CAPTION.test(l.trim())) { caption = l.trim(); continue; }
      // Words waiting for a row end where a group or note begins: they finish the row above.
      if ((isGroupLine(l) || NOTE.test(l.trim())) && pending.length && rows.length) { rows[rows.length - 1].cells[0] += '\n' + pending.join('\n'); pending = []; }
      if (isGroupLine(l)) { rows.push({ kind: 'group', cells: [l.trim()].concat(new Array(cols.length - 1).fill('')) }); continue; }
      if (NOTE.test(l.trim()) && rows.length) { rows.push({ kind: 'note', cells: [l.trim()].concat(new Array(cols.length - 1).fill('')) }); continue; }
      const last = rows[rows.length - 1];
      if (last && last.kind === 'note') { last.cells[0] += ' ' + l.trim(); continue; }
      const cells = cut(l);
      // A line with words only in the first column is the start of a wrapped cell: in print a row's amounts sit on
      // its last line, so the words go with the row below.
      if (!isGapLine(l) && cells.slice(1).every(c => !c)) { pending.push(cells[0]); continue; }
      if (pending.length) { cells[0] = pending.concat(cells[0] ? [cells[0]] : []).join('\n'); pending = []; }
      rows.push({ kind: '', cells });
    }
    if (pending.length) { const last = rows[rows.length - 1]; if (last) last.cells[0] += '\n' + pending.join('\n'); }
    // Headings: the rows before the first one with an amount or a number in a later column, merged into one row.
    const firstData = rows.findIndex(r => r.kind !== '' || r.cells.slice(1).some(c => /[\d$%]/.test(c)));
    if (firstData > 0 && rows.slice(0, firstData).every(r => r.kind === '')) {
      const head = { kind: 'head', cells: cols.map((_, k) => rows.slice(0, firstData).map(r => r.cells[k]).filter(Boolean).join('\n')) };
      rows.splice(0, firstData, head);
    }
    return caption ? { table: true, caption, rows } : { table: true, rows };
  }
  // The Bank's lines -> [{start, end, table}] (end exclusive).
  function findTables(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!isGapLine(lines[i]) || startsUnit(lines[i])) continue;
      // Headings and the caption sit just above the first row with a gap.
      let start = i;
      while (start > 0 && lines[start - 1].trim() && !startsUnit(lines[start - 1]) && (CAPTION.test(lines[start - 1].trim()) || !/[.;:]$/.test(lines[start - 1].trim()))) start--;
      let j = i, gaps = 0, lastGap = i;
      while (j < lines.length) {
        const l = lines[j];
        if (!l.trim()) { j++; continue; }
        if (isGapLine(l)) { gaps++; lastGap = j; j++; continue; }
        if (isGroupLine(l) || NOTE.test(l.trim())) { j++; continue; }
        // a continuation line: a gap line follows soon, and it doesn't start a new unit
        const nextGap = lines.slice(j + 1, j + 4).findIndex(isGapLine);
        if (nextGap >= 0 && !startsUnit(l)) { j++; continue; }
        break;
      }
      // Notes right under the table belong to it: "{3} …" and the lines that run on from it (no indent).
      let end = lastGap + 1;
      while (end < lines.length && NOTE.test(lines[end].trim())) {
        end++;
        while (end < lines.length && lines[end].trim() && !/^\s/.test(lines[end]) && !NOTE.test(lines[end].trim())) end++;
      }
      if (gaps >= 2) {
        out.push({ start, end, table: blockToTable(lines.slice(start, end)) });
        i = end - 1;
      }
    }
    return out;
  }

  /* ---------- a table typed or pasted as text (the pane's "From text") ---------- */
  // Tabs, or runs of two or more spaces, separate the cells; a blank line ends nothing.
  function tableFromText(text, head) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (!lines.length) return null;
    const split = l => l.includes('\t') ? l.split('\t').map(s => s.trim()) : l.trim().split(/ {2,}/);
    const cells = lines.map(split), n = Math.max(...cells.map(c => c.length));
    const rows = cells.map(c => { const r = c.concat(new Array(n - c.length).fill('')); return { kind: rowKind(r), cells: r }; });
    if (head && rows.length) rows[0].kind = 'head';
    return { table: true, rows };
  }

  /* ---------- readings and marking ---------- */
  const stripBr = t => t.replace(/[[\]]/g, '');
  // A marked table (runs) -> the law as it stands (old) and as the bill would leave it (now), as text tables.
  function tableReadings(t) {
    const old = [], now = [];
    for (const r of t.rows) {
      const o = r.cells.map(c => (Array.isArray(c) ? c : [{ t: String(c), k: '' }]).filter(x => x.k !== 'ins').map(x => x.k === 'del' ? stripBr(x.t) : x.t).join('').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim());
      const n = r.cells.map(c => (Array.isArray(c) ? c : [{ t: String(c), k: '' }]).filter(x => x.k !== 'del').map(x => x.t).join('').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim());
      const allNew = r.cells.every(c => (Array.isArray(c) ? c : []).every(x => x.k === 'ins' || !x.t.trim())) && r.cells.some(c => cellText(c).trim());
      const allOld = r.cells.every(c => (Array.isArray(c) ? c : []).every(x => x.k === 'del' || !x.t.trim())) && r.cells.some(c => cellText(c).trim());
      if (!allNew && o.some(Boolean)) old.push({ kind: r.kind, cells: o });
      if (!allOld && n.some(Boolean)) now.push({ kind: r.kind, cells: n });
    }
    return { old: { table: true, caption: t.caption, rows: old }, now: { table: true, caption: t.caption, rows: now } };
  }
  const words = s => s.toLowerCase().split(/\s+/).filter(Boolean);
  function similar(a, b) {
    const A = words(a.cells.join(' ')), B = words(b.cells.join(' '));
    if (!A.length && !B.length) return 1;
    const set = new Set(A); let same = 0; for (const w of B) if (set.has(w)) same++;
    return 2 * same / (A.length + B.length);
  }
  // Rows lined up by similarity, keeping their order: [[oldIndex|-1, newIndex|-1], …]
  function alignRows(O, N) {
    const n = O.length, m = N.length, S = [];
    for (let i = 0; i <= n; i++) S.push(new Float64Array(m + 1));
    const sim = (i, j) => { const s = similar(O[i], N[j]); return s >= 0.5 ? s : -1; };
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      const s = sim(i, j);
      S[i][j] = Math.max(S[i + 1][j], S[i][j + 1], s > 0 ? S[i + 1][j + 1] + s : -Infinity);
    }
    const out = []; let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m) { const s = sim(i, j); if (s > 0 && S[i][j] === S[i + 1][j + 1] + s) { out.push([i, j]); i++; j++; continue; } }
      if (i < n && (j >= m || S[i][j] === S[i + 1][j])) { out.push([i, -1]); i++; }
      else { out.push([-1, j]); j++; }
    }
    return out;
  }
  const lines = s => String(s).split('\n');
  const joinLines = paras => { const out = []; paras.forEach((p, i) => { if (i) out.push({ t: '\n', k: '' }); out.push(...p); }); return out; };
  // One cell's change, word by word; its line breaks are kept.
  function markCell(o, n) {
    if (o === n) return o ? [{ t: o, k: '' }] : [];
    if (!o.trim()) return n ? [{ t: n, k: 'ins' }] : [];
    if (!n.trim()) return [{ t: '[' + o + ']', k: 'del' }];
    return joinLines(BD.markChanges(lines(o), lines(n)));
  }
  // A row taken out stays in the table in one pair of brackets: "[" before its first words, "]" after its last.
  function struckRow(r) {
    const filled = r.cells.map((c, k) => c.trim() ? k : -1).filter(k => k >= 0), first = filled[0], last = filled[filled.length - 1];
    return { kind: r.kind, cells: r.cells.map((c, k) => c.trim() ? [{ t: (k === first ? '[' : '') + c + (k === last ? ']' : ''), k: 'del' }] : []) };
  }
  const newRow = r => ({ kind: r.kind, cells: r.cells.map(c => c ? [{ t: c, k: 'ins' }] : []) });
  // The change from one text table to another, as a marked table.
  function markTable(oldT, nowT) {
    const O = oldT.rows, N = nowT.rows, rows = [];
    for (const [i, j] of alignRows(O, N)) {
      if (i < 0) { rows.push(newRow(N[j])); continue; }
      if (j < 0) { rows.push(struckRow(O[i])); continue; }
      const n = Math.max(O[i].cells.length, N[j].cells.length);
      const cells = [];
      for (let k = 0; k < n; k++) cells.push(markCell(O[i].cells[k] || '', N[j].cells[k] || ''));
      rows.push({ kind: N[j].kind, cells });
    }
    // Every row spans the same number of columns.
    const w = Math.max(0, ...rows.map(r => r.cells.length));
    for (const r of rows) while (r.cells.length < w) r.cells.push([]);
    return { table: true, caption: nowT.caption || oldT.caption, rows };
  }
  const insTable = t => ({ table: true, caption: t.caption, rows: t.rows.map(newRow) });
  const delTable = t => ({ table: true, caption: t.caption, rows: t.rows.map(struckRow) });

  /* Marking a text that holds tables: each table stands in the word diff as one marker paragraph. Tables are first
     paired old to new (in order, by similarity); a pair shares a marker, so the diff keeps it in place, and the
     marker is then replaced by the pair's marked table. An unpaired new table is underlined, an unpaired old one
     stays in brackets. */
  function markWithTables(law, now, markText) {
    const LT = law.filter(isTable), NT = now.filter(isTable);
    const pairs = alignRows(LT.map(t => ({ cells: [tableText(t)] })), NT.map(t => ({ cells: [tableText(t)] })));
    // An unpaired table still pairs with one at the same place when the counts agree (a table rewritten whole).
    const tag = k => '⟦T' + k + '⟧', lawTag = new Map(), nowTag = new Map(), byTag = {};
    pairs.forEach(([i, j], k) => {
      if (i >= 0) lawTag.set(LT[i], tag(k));
      if (j >= 0) nowTag.set(NT[j], tag(k));
      byTag[tag(k)] = i >= 0 && j >= 0 ? markTable(LT[i], NT[j]) : i >= 0 ? delTable(LT[i]) : insTable(NT[j]);
    });
    const marked = markText(law.map(p => isTable(p) ? lawTag.get(p) : p), now.map(p => isTable(p) ? nowTag.get(p) : p));
    const placed = new Set(), out = [];
    for (const p of marked) {
      const t = p.map(r => r.t).join('').replace(/[[\]\s]/g, '');
      if (/^⟦T\d+⟧$/.test(t)) {
        if (placed.has(t)) continue;
        // A kept marker the diff split into "[marker] marker" is one table.
        const twin = marked.some(q => q !== p && q.map(r => r.t).join('').replace(/[[\]\s]/g, '') === t);
        if (twin && p.every(r => r.k === 'del')) continue;
        placed.add(t); out.push(byTag[t]); continue;
      }
      out.push(p);
    }
    return out;
  }

  /* ---------- tables in a unit's text, for the AKN writer ---------- */
  const cols = t => Math.max(1, ...t.rows.map(r => r.cells.length));
  const empty = (rows, n) => ({ table: true, rows: Array.from({ length: rows }, (_, i) => ({ kind: i === 0 ? 'head' : '', cells: new Array(n).fill('') })) });

  Object.assign(BD, { isTable, cellText, tableText, findTables, blockToTable, tableFromText, tableReadings, markTable, markWithTables, alignRows, tableCols: cols, emptyTable: empty, TABLE_CAPTION: CAPTION, rowKind });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
