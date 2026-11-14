/* Bill Drafter for Word (demo) - drafting rules shared by the task pane, the checks and the converter.
   Plain functions, no Office calls, so they run in Word and in Node tests alike.
   Wording of the boilerplate sections and the effective-date forms is the desktop drafter's
   (Tools > Bill Drafting), which takes it from the Bill Drafting Manual (C.5 boilerplate, D.4/D.5 effective dates). */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};

  const ENACTING = 'The People of the State of New York, represented in Senate and Assembly, do enact as follows:';

  const SHORT_TITLE = name => 'This act shall be known and may be cited as the "' + (name || '____ act') + '".';
  const SEVERABILITY = 'If any clause, sentence, paragraph, subdivision, section or part of this act shall be adjudged by any court of competent jurisdiction to be invalid, such judgment shall not affect, impair, or invalidate the remainder thereof, but shall be confined in its operation to the clause, sentence, paragraph, subdivision, section or part thereof directly involved in the controversy in which such judgment shall have been rendered. It is hereby declared to be the intent of the legislature that this act would have been enacted even if such invalid provisions had not been included herein.';
  const FINDINGS = subject => 'The legislature hereby finds and declares that ' + (subject || '____') + '.';

  // Effective-date forms ("This act shall take effect …") and add-ons, as in the desktop drafter.
  const EFF_FORMS = [
    ['immediately', 'immediately.'],
    ['30th day', 'on the thirtieth day after it shall have become a law.'],
    ['60th day', 'on the sixtieth day after it shall have become a law.'],
    ['90th day', 'on the ninetieth day after it shall have become a law.'],
    ['120th day', 'on the one hundred twentieth day after it shall have become a law.'],
    ['180th day', 'on the one hundred eightieth day after it shall have become a law.'],
    ['1 year', 'one year after it shall have become a law.'],
    ['January 1 next', 'on the first of January next succeeding the date on which it shall have become a law.'],
    ['April 1 next', 'on the first of April next succeeding the date on which it shall have become a law.'],
    ['On a date', 'on ____ 1, 20__.'],
  ];
  const EFF_ADDONS = [
    ['rules', 'Rules and regulations may be made before', ' Effective immediately, the addition, amendment and/or repeal of any rule or regulation necessary for the implementation of this act on its effective date are authorized to be made and completed on or before such effective date.'],
    ['sunsetYears', 'Sunset after a number of years', ' and shall expire and be deemed repealed ____ years after such effective date.'],
    ['sunsetDate', 'Sunset on a date', ' and shall expire and be deemed repealed ____ 1, 20__.'],
    ['retro', 'Retroactive', ' and shall be deemed to have been in full force and effect on and after ____ 1, 20__.'],
    ['applies', 'Applies to', ' and shall apply to ____ on or after such effective date.'],
    ['proviso', 'Proviso', ' ; provided, however, that ____.'],
  ];
  // Builds "This act shall take effect …" from a form and a list of add-on keys.
  function effectiveText(form, addons) {
    let v = String(form || 'immediately.').trim();
    if (!/[.]$/.test(v)) v += '.';
    for (const key of addons || []) {
      const a = EFF_ADDONS.find(x => x[0] === key); if (!a) continue;
      const add = a[2];
      if (add.startsWith(' ;') || add.startsWith(' and')) v = v.replace(/\.$/, '') + add.replace(/^ ;/, ';').replace(/\.$/, '') + '.';
      else v = v + add;
    }
    return 'This act shall take effect ' + v;
  }

  /* ---------- law names and citations ---------- */
  // "General Construction" -> "general construction law"; "Civil Practice Law & Rules" -> "civil practice law and rules".
  function lawName(info) {
    if (!info) return 'the ____ law';
    const type = String(info.lawType || '').toUpperCase();
    let n = String(info.name || info.lawId || '').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
    if (type === 'MISC' && /^constitution$/i.test(n)) return 'the constitution';
    if (type === 'UNCONSOLIDATED') {
      const ch = unconsolidatedChapter(info);
      const bare = n.replace(/\s*(Ch\.\s*)?\d+\/\d+(\s+\d+\/\d+)*\s*$/i, '').replace(/Act\d.*$/, 'Act').trim();
      if (ch) return 'chapter ' + ch.chapter + ' of the laws of ' + ch.year + ', constituting the ' + lowerName(bare);
      return 'the ' + lowerName(bare);
    }
    n = lowerName(n);
    if (type === 'COURT_ACTS') { if (!/\bact$/.test(n)) n += ' act'; }
    else if (type === 'RULES') { /* "senate rules" */ }
    else if (!/\b(law|rules|act|code)$/.test(n)) n += ' law';
    return 'the ' + n;
  }
  // Lower case, except "New York" (and a place name right after "of the city of").
  function lowerName(n) {
    return n.toLowerCase().replace(/\bnew york\b/g, 'New York').replace(/\bnew jersey\b/g, 'New Jersey').replace(/\bnys\b/g, 'New York state').replace(/\bny\b/g, 'New York')
      .replace(/\b(yonkers|troy|albany|suffolk)\b/g, w => w[0].toUpperCase() + w.slice(1));
  }
  // "Emergency Tenant Protection Act 576/74" -> {chapter: '576', year: '1974'}
  function unconsolidatedChapter(info) {
    const m = /(\d+)\/(\d{2,4})\b/.exec(String(info.name || ''));
    if (!m) return null;
    let y = m[2];
    if (y.length === 2) y = '19' + y; // the Bank's unconsolidated laws are all from the 1800s and 1900s
    if (y.length === 2 || +y < 1800) return null;
    return { chapter: m[1], year: y };
  }
  // Section ids are kept as the Bank has them ("37-A"); in text they are lower case ("37-a").
  const secId = loc => String(loc || '').replace(/^§\s*/, '').toLowerCase();

  // The citation of what a bill section acts on: "section 12" / "subdivision 3 of section 12", or for a law whose
  // sections divide into subsections (the Tax Law, the Insurance Law) "subsection (c) of section 606".
  const subName = (unit, sub) => sub ? 'subsection (' + String(unit).replace(/[()]/g, '') + ')' : 'subdivision ' + unit;
  function unitCite(loc, unit, sub) {
    return (unit ? subName(unit, sub) + ' of ' : '') + 'section ' + secId(loc);
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // The amending clause (the sentence before the quoted text).
  //   amend:  Section 12 of the general construction law, as amended by …, is amended to read as follows:
  //   add:    The general construction law is amended by adding a new section 12-a to read as follows:
  //   repeal: Section 12 of the general construction law is REPEALED.
  function amendingClause(o) {
    const law = o.lawName || lawName(o.info);
    const hist = String(o.history || '').trim().replace(/^,\s*/, '').replace(/,\s*$/, '');
    const sub = o.subsections != null ? o.subsections : !!(BD.usesSubsections && o.info && BD.usesSubsections(o.info.lawId));
    if (o.act === 'add') {
      const what = o.unit ? 'a new ' + subName(o.unit, sub) + ' to section ' + secId(o.loc) : 'a new section ' + secId(o.loc);
      return cap(law) + ' is amended by adding ' + what + ' to read as follows:';
    }
    if (o.act === 'repeal') return cap(unitCite(o.loc, o.unit, sub)) + ' of ' + law + (hist ? ', ' + hist + ',' : '') + ' is REPEALED.';
    return cap(unitCite(o.loc, o.unit, sub)) + ' of ' + law + (hist ? ', ' + hist + ',' : '') + ' is amended to read as follows:';
  }

  /* ---------- the bill's sections: numbers and the long title ---------- */
  const ORDINAL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const sectionNum = i => i === 0 ? 'Section 1.' : '§ ' + (i + 1) + '.';

  // Where a new section goes: a short title first, findings after it, the severability clause just
  // before the effective date, the effective date last; anything else before the severability clause.
  function insertIndex(kinds, kind) {
    const n = kinds.length, sev = kinds.indexOf('severability'), eff = kinds.indexOf('effective');
    const tail = [sev, eff].filter(x => x >= 0);
    const beforeTail = tail.length ? Math.min(...tail) : n;
    if (kind === 'shortTitle') return 0;
    if (kind === 'findings') return kinds[0] === 'shortTitle' ? 1 : 0;
    if (kind === 'effective') return n;
    if (kind === 'severability') return eff >= 0 ? eff : n;
    return beforeTail;
  }

  // The long title from what the sections do.
  //   AN ACT to amend the general construction law and the executive law, in relation to …; and to repeal section 5 of the executive law relating thereto
  function longTitle(sections, subject) {
    const amend = [], repeal = [];
    for (const s of sections) {
      if (!s.law || !s.lawName) continue;
      if (s.act === 'amend' || s.act === 'add') { if (!amend.includes(s.lawName)) amend.push(s.lawName); }
      else if (s.act === 'repeal') repeal.push(unitCite(s.loc, s.unit, !!(BD.usesSubsections && BD.usesSubsections(s.law))) + ' of ' + s.lawName);
    }
    // A bill that expires says so in its title (Manual; the profile warns when it doesn't).
    const sunset = sections.some(s => s.act === 'effective' && /expire and be deemed repealed/.test(s.text || ''));
    const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
    const subj = String(subject || '').trim() || '____';
    let t = 'AN ACT ';
    if (amend.length) t += 'to amend ' + list(amend) + ', in relation to ' + subj;
    else if (repeal.length) t += 'to repeal ' + list(repeal) + ', in relation to ' + subj;
    else t += 'in relation to ' + subj;
    if (amend.length && repeal.length) t += '; and to repeal ' + list(repeal) + ' relating thereto';
    if (sunset) t += '; and providing for the repeal of such provisions upon expiration thereof';
    return { text: t, before: t.slice(0, t.indexOf(subj)), subject: subj, after: t.slice(t.indexOf(subj) + subj.length) };
  }

  /* ---------- law text ---------- */
  // The Bank's text: 70-column lines; a line that starts with spaces starts a paragraph.
  function lawParagraphs(text) {
    const t = String(text || '').replace(/\\n/g, '\n').replace(/\r/g, '');
    const out = [];
    for (const line of t.split('\n')) {
      if (!line.trim()) continue;
      if (/^\s{2,}/.test(line) || !out.length) out.push(line.trim());
      else out[out.length - 1] += (/-$/.test(out[out.length - 1]) && /^[a-z]/.test(line) ? '' : ' ') + line.trim();
    }
    return out.map(p => p.replace(/\s+/g, ' '));
  }
  // The subdivisions of a section: "1." starts subdivision 1 (also in the middle of the first paragraph,
  // "§ 2-d. Unauthorized release… 1. Definitions."), lettered paragraphs "a." / "(a)" stay with it.
  // With sub (a law of subsections), "(a)" starts subsection a and "(1)" paragraphs stay with it.
  function subdivisions(paras, sub) {
    const out = [], ps = paras.slice();
    const first = sub ? /^(§\s*[\w-]+\.\s+[^.]+\.)\s+(\(a\)\s.*)$/ : /^(§\s*[\w-]+\.\s+[^.]+\.)\s+(1\.\s.*)$/;
    if (ps.length) {
      const m = first.exec(ps[0]);
      if (m) { ps.splice(0, 1, m[1], m[2]); }
    }
    let cur = null;
    for (const p of ps) {
      const m = sub ? /^\(([a-z]{1,2}(?:-\d+)?)\)\s/.exec(p) : /^(\d+[-a-z]*)\.\s/.exec(p);
      if (m) { cur = { unit: m[1], paras: [p] }; out.push(cur); }
      else if (cur) cur.paras.push(p);
    }
    return out;
  }

  /* ---------- marking changes: law text vs the drafter's text ---------- */
  // Tokens: words with the space after them; '¶' marks a paragraph break.
  function tokens(paras) {
    const out = [];
    paras.forEach((p, i) => {
      if (i) out.push({ w: '¶', s: '' });
      // A word, or one mark of punctuation (so "state," and "state." differ only in the mark).
      const re = /([^\s,.;:!?()"\u201c\u201d]+|[,.;:!?()"\u201c\u201d])(\s*)/g; let m;
      while ((m = re.exec(p))) out.push({ w: m[1], s: m[2] ? ' ' : '' });
    });
    return out;
  }
  const norm = w => w.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, '-');
  // Word diff: fewest words taken out and added (common start and end trimmed first).
  function diffWords(A, B) {
    const a = A.map(t => norm(t.w)), b = B.map(t => norm(t.w));
    let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    // The common end is cut back to a paragraph boundary, so the walk below (which lines words up with their
    // first match) decides about the last changed paragraph, not the end of the text.
    while (q > 0 && a[a.length - q - 1] !== '\u00b6') q--;
    const ops = [];
    for (let i = 0; i < p; i++) ops.push(['=', i, i]);
    const n = a.length - p - q, m = b.length - p - q;
    if (n * m > 16e6) {
      for (let i = 0; i < n; i++) ops.push(['-', p + i, -1]);
      for (let j = 0; j < m; j++) ops.push(['+', -1, p + j]);
    } else {
      const W = m + 1, L = new Uint32Array((n + 1) * W);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
        L[i * W + j] = a[p + i] === b[p + j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
      // Walk the table; on a tie take the addition first, so a kept word lines up with its first
      // appearance in the new text ("any notary public or officer[, unless …]").
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && a[p + i] === b[p + j]) { ops.push(['=', p + i, p + j]); i++; j++; }
        else if (j < m && (i >= n || L[i * W + j + 1] >= L[(i + 1) * W + j])) { ops.push(['+', -1, p + j]); j++; }
        else { ops.push(['-', p + i, -1]); i++; }
      }
    }
    for (let k = 0; k < q; k++) ops.push(['=', a.length - q + k, b.length - q + k]);
    cleanupSemantic(ops, a);
    // Within each run of changes the omitted words come first ("[old] new"), as bills print them.
    const out = [];
    for (let k = 0; k < ops.length;) {
      if (ops[k][0] === '=') { out.push(ops[k++]); continue; }
      const blk = []; while (k < ops.length && ops[k][0] !== '=') blk.push(ops[k++]);
      out.push(...blk.filter(o => o[0] === '-'), ...blk.filter(o => o[0] === '+'));
    }
    return out;
  }
  // A short run of kept words between two bigger changes ("any [officer, unless] a [particular]") reads better as
  // part of one change: a kept run no longer than the changes on both sides of it is turned into a deletion and
  // an addition (the idea of diff-match-patch's semantic cleanup). Paragraph breaks are never absorbed.
  function cleanupSemantic(ops, a) {
    let changed = true;
    while (changed) {
      changed = false;
      const runs = []; // [{eq, from, to, del, ins}]
      for (let k = 0; k < ops.length;) {
        const eq = ops[k][0] === '='; let e = k, del = 0, ins = 0;
        while (e < ops.length && (ops[e][0] === '=') === eq) { if (ops[e][0] === '-') del++; if (ops[e][0] === '+') ins++; e++; }
        runs.push({ eq, from: k, to: e, len: e - k, del, ins }); k = e;
      }
      for (let r = 1; r < runs.length - 1; r++) {
        const R = runs[r]; if (!R.eq) continue;
        const before = Math.max(runs[r - 1].del, runs[r - 1].ins), after = Math.max(runs[r + 1].del, runs[r + 1].ins);
        if (R.len > Math.min(before, after) || R.len > 4) continue;
        if (ops.slice(R.from, R.to).some(o => a[o[1]] === '\u00b6')) continue;
        const eqOps = ops.slice(R.from, R.to);
        ops.splice(R.from, R.len, ...eqOps.map(o => ['-', o[1], -1]), ...eqOps.map(o => ['+', -1, o[2]]));
        changed = true; break;
      }
    }
  }
  // Paragraphs of runs [{t, k: ''|'ins'|'del'}] showing the change from `law` to `now` (both arrays of paragraphs).
  // Deleted matter is put in brackets; a paragraph that is all new or all old stays its own paragraph.
  function markChanges(law, now) {
    const A = tokens(law), B = tokens(now), ops = diffWords(A, B);
    // Paragraphs of [{tok, k}]; a paragraph break that was taken out keeps the old layout.
    const paras = [[]];
    for (const [op, i, j] of ops) {
      const tok = op === '-' ? A[i] : B[j]; // kept words take the new text's spacing
      if (tok.w === '\u00b6') { if (op !== '-') paras.push([]); continue; }
      paras[paras.length - 1].push({ tok, k: op === '-' ? 'del' : op === '+' ? 'ins' : '' });
    }
    const punct = w => /^[,.;:!?)]/.test(w);
    return paras.filter(p => p.length).map(items => {
      const runs = [];
      for (const it of items) { const l = runs[runs.length - 1]; if (l && l.k === it.k) l.toks.push(it.tok); else runs.push({ k: it.k, toks: [it.tok] }); }
      const out = [];
      runs.forEach((r, x) => {
        let t = r.toks.map((tk, y) => tk.w + (y < r.toks.length - 1 ? tk.s : '')).join('');
        if (r.k === 'del') t = '[' + t + ']';
        out.push({ t, k: r.k });
        const next = runs[x + 1];
        if (next) {
          const last = r.toks[r.toks.length - 1], first = next.toks[0];
          const sep = last.s || (!punct(first.w) && (r.k || next.k) ? ' ' : '');
          if (sep) out.push({ t: sep, k: '' });
        }
      });
      // merge plain neighbours
      const m = [];
      for (const r of out) { const l = m[m.length - 1]; if (l && l.k === r.k && !r.k) l.t += r.t; else m.push(r); }
      return m;
    });
  }
  // The two readings of marked runs: the law as it stands (old) and as the bill would leave it (new).
  function readings(paras) {
    const strip = t => t.replace(/^\[/, '').replace(/\]$/, '');
    const old = [], now = [];
    for (const p of paras) {
      let o = '', n = '';
      for (const r of p) {
        if (r.k === 'del') o += r.t.replace(/[\[\]]/g, '');
        else if (r.k === 'ins') n += r.t;
        else { o += r.t; n += r.t; }
        void strip;
      }
      o = o.replace(/\s+/g, ' ').trim(); n = n.replace(/\s+/g, ' ').trim();
      if (o) old.push(o); if (n) now.push(n);
    }
    return { old, now };
  }
  const sameText = (a, b) => tokens(a).map(t => norm(t.w)).join(' ') === tokens(b).map(t => norm(t.w)).join(' ');

  Object.assign(BD, {
    ENACTING, SHORT_TITLE, SEVERABILITY, FINDINGS, EFF_FORMS, EFF_ADDONS, effectiveText,
    lawName, unconsolidatedChapter, secId, unitCite, amendingClause, sectionNum, ORDINAL, insertIndex, longTitle,
    lawParagraphs, subdivisions, tokens, diffWords, markChanges, readings, sameText,
  });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
