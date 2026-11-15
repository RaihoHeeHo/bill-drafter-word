/* Bill Drafter for Word (demo) - appropriation bills: the checks and comparisons of LBDC's budget tools
   (profile/tools: budget_items.py, budget_report/findings.py, prior_check.py, compare_prints.py, line_vetoes.py),
   done the same way here on the bill's Akoma Ntoso XML so they run in the pane. tests/budget-expected.json holds
   what the Python tools find in the sample; tests/unit.cjs checks these functions find the same.
   Works with the browser's DOM and with xmldom. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const A = 'http://docs.oasis-open.org/legaldocml/ns/akn/3.0';

  /* ---------- the XML ---------- */
  const ln = n => n.localName || String(n.nodeName).replace(/^.*:/, '');
  const kids = n => { const out = []; for (let c = n && n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c); return out; };
  const kid = (n, name) => kids(n).find(c => ln(c) === name) || null;
  // Every element under n, in document order (n itself not included).
  function all(n, pred) {
    const out = [], stack = kids(n).reverse();
    while (stack.length) { const e = stack.pop(); if (!pred || pred(e)) out.push(e); const k = kids(e); for (let i = k.length - 1; i >= 0; i--) stack.push(k[i]); }
    return out;
  }
  const hc = name => e => ln(e) === 'hcontainer' && e.getAttribute('name') === name;
  const isQ = cls => e => ln(e) === 'quantity' && e.getAttribute('class') === cls;
  const ancestors = n => { const out = []; for (let p = n.parentNode; p && p.nodeType === 1; p = p.parentNode) out.push(p); return out; };
  const inDel = n => ancestors(n).some(p => ln(p) === 'del');
  const text = n => n ? n.textContent : '';
  const norm = t => String(t).replace(/\s+/g, ' ').trim();
  const val = q => Math.trunc(parseFloat(q.getAttribute('normalized')));
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
  const cls = e => e.getAttribute('class') || '';
  function parse(xml, DOMParserImpl) {
    const P = DOMParserImpl || root.DOMParser;
    return new P().parseFromString(xml, 'application/xml');
  }
  const docEl = doc => doc.documentElement || doc;
  const byEId = (doc, id) => all(docEl(doc), e => e.getAttribute && e.getAttribute('eId') === id)[0] || null;

  /* ---------- items and their keys (budget_items.py) ----------
     An item's key is its agency, its account number, the program code of the purpose it falls under and its object
     code. The same key in next year's budget is the same money. */
  // The first quantity of a class under el (struck amounts count, as the Python tools read them).
  const q = (el, c) => { const x = all(el, isQ(c))[0]; return x && x.getAttribute('normalized') ? val(x) : null; };
  // The current amount: a struck one ([old]) doesn't count once a new one follows it.
  const qNow = (el, c) => { const x = all(el, isQ(c)).filter(e => !inDel(e))[0]; return x && x.getAttribute('normalized') ? val(x) : null; };
  const qCur = (el, c) => { const v = qNow(el, c); return v != null ? v : q(el, c); };
  const code = (el, name) => { const v = all(el, e => ln(e) === 'inline' && e.getAttribute('name') === name); if (!v.length) return ''; const t = kids(v[v.length - 1]).length ? lastText(v[v.length - 1]) : text(v[v.length - 1]); return t.trim(); };
  function lastText(e) { let t = ''; for (let c = e.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t = c.nodeValue; return t; }
  function nameWords(t, n = 8) {
    const ws = t.toLowerCase().replace(/,/g, '').replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
    return ws.filter(w => !/^\d+$/.test(w) && w !== 're').slice(0, n).join(' ');
  }
  function items(doc) {
    const out = [];
    for (const ag of all(docEl(doc), hc('agency'))) {
      const agency = (ag.getAttribute('refersTo') || '').replace(/^#/, '');
      for (const acct of all(ag, hc('account'))) {
        const ah = kid(acct, 'heading');
        let acode = ah ? code(ah, 'accountCode') : '';
        if (!acode && ah) acode = norm(text(ah));
        let program = '', src = '';
        for (const el of all(acct, e => ln(e) === 'hcontainer')) {
          const name = el.getAttribute('name');
          if (name === 'reappropriationSource') {
            program = '';
            const intro = kid(el, 'intro'), content = kid(el, 'content');
            const refs = [...(intro ? all(intro, e => ln(e) === 'ref') : []), ...(content ? all(content, e => ln(e) === 'mod').flatMap(m => all(m, e => ln(e) === 'ref').slice(0, 1)) : [])];
            el.__src = refs.length ? refs[0].getAttribute('href') : '';
          } else if (name === 'purpose') {
            const pc = code(el, 'programCode'); if (pc) program = pc;
          } else if (name === 'appropriation' || name === 'reappropriation') {
            const own = code(el, 'programCode');
            if (name === 'reappropriation') { const s = ancestors(el).find(hc('reappropriationSource')); src = s ? s.__src || '' : ''; } else src = '';
            const obj = code(el, 'objectCode');
            const words = own || obj ? '' : nameWords(text(el));
            out.push({ kind: name, eId: el.getAttribute('eId'), agency, account: acode, program: own || program, object: obj || words, source: src,
              // the current amounts: one struck in this bill ([old] new) gives way to the new one
              amount: name === 'appropriation' ? qCur(el, 'amount') : qCur(el, 'originalAmount'), reappropriated: qCur(el, 'reappropriatedAmount'),
              words: nameWords(text(el), 30), el });
          }
        }
      }
    }
    return out;
  }
  const key = i => [i.agency, i.account, i.program, i.object];
  const keyStr = i => key(i).join('|');
  function numbered(its) {
    const seen = new Map();
    for (const i of its) { const k = i.kind + '\u0001' + i.source + '\u0001' + keyStr(i); seen.set(k, (seen.get(k) || 0) + 1); i.n = seen.get(k); }
    return its;
  }

  /* ---------- Python's difflib.SequenceMatcher, so similarity scores come out the same ---------- */
  function SequenceMatcher(a, b, autojunk = true) {
    a = typeof a === 'string' ? [...a] : a; b = typeof b === 'string' ? [...b] : b;
    const b2j = new Map();
    b.forEach((x, i) => { if (!b2j.has(x)) b2j.set(x, []); b2j.get(x).push(i); });
    if (autojunk && b.length >= 200) { const ntest = Math.floor(b.length / 100) + 1; for (const [x, idx] of [...b2j]) if (idx.length > ntest) b2j.delete(x); }
    function longest(alo, ahi, blo, bhi) {
      let bi = alo, bj = blo, bs = 0, j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const nj = new Map();
        for (const j of b2j.get(a[i]) || []) { if (j < blo) continue; if (j >= bhi) break; const k = (j2len.get(j - 1) || 0) + 1; nj.set(j, k); if (k > bs) { bi = i - k + 1; bj = j - k + 1; bs = k; } }
        j2len = nj;
      }
      while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) { bi--; bj--; bs++; }
      while (bi + bs < ahi && bj + bs < bhi && a[bi + bs] === b[bj + bs]) bs++;
      return [bi, bj, bs];
    }
    function blocks() {
      const queue = [[0, a.length, 0, b.length]], mb = [];
      while (queue.length) {
        const [alo, ahi, blo, bhi] = queue.pop(), [i, j, k] = longest(alo, ahi, blo, bhi);
        if (k) { mb.push([i, j, k]); if (alo < i && blo < j) queue.push([alo, i, blo, j]); if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]); }
      }
      mb.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
      const out = []; let i1 = 0, j1 = 0, k1 = 0;
      for (const [i2, j2, k2] of mb) { if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2; else { if (k1) out.push([i1, j1, k1]); i1 = i2; j1 = j2; k1 = k2; } }
      if (k1) out.push([i1, j1, k1]);
      out.push([a.length, b.length, 0]);
      return out;
    }
    return {
      ratio() { const m = blocks().reduce((s, x) => s + x[2], 0), t = a.length + b.length; return t ? 2 * m / t : 1; },
      opcodes() {
        let i = 0, j = 0; const out = [];
        for (const [ai, bj, size] of blocks()) {
          const tag = i < ai && j < bj ? 'replace' : i < ai ? 'delete' : j < bj ? 'insert' : '';
          if (tag) out.push([tag, i, ai, j, bj]);
          i = ai + size; j = bj + size;
          if (size) out.push(['equal', ai, i, bj, j]);
        }
        return out;
      },
    };
  }

  /* ---------- the amount checks of the print-error report (budget_report/findings.py) ---------- */
  function agencyOf(e) { const a = ancestors(e).filter(hc('agency')); return a[a.length - 1] || e; }
  const TITLE_SMALL = [' Of ', ' And ', ' For ', ' The ', ' To ', ' With ', ' On ', ' In '];
  function agencyName(a) {
    const h = norm(text(kid(a, 'heading'))), m = kid(a, 'num'), dept = m ? norm(text(m)) : '';
    let name = h.toLowerCase().replace(/(^|[^a-z'])([a-z])/g, (x, p, c) => p + c.toUpperCase()).replace(/'S\b/g, "'s");
    for (const w of TITLE_SMALL) name = name.split(w).join(w.toLowerCase());
    if (cls(a) === 'reappropriations') name += ' (reappropriations)';
    if (dept && !dept.startsWith('MISCELLANEOUS') && dept !== h) { let d = dept.toLowerCase().replace(/(^|[^a-z'])([a-z])/g, (x, p, c) => p + c.toUpperCase()); d = d.split(' Of ').join(' of ').split(' And ').join(' and '); name = d + ': ' + name; }
    return name;
  }
  const sum = (els, c) => els.reduce((s, g) => s + all(g, isQ(c)).filter(x => !inDel(x)).reduce((t, x) => t + val(x), 0), 0);
  const sumIn = (els, holder, c) => els.reduce((s, g) => s + all(g, hc(holder)).reduce((t, h) => t + all(h, isQ(c)).filter(x => !inDel(x)).reduce((u, x) => u + val(x), 0), 0), 0);
  function findings(doc) {
    const R = docEl(doc), F = { headings: [], summaries: [], totals: [], schedules: [], schedule_items: [], reapprop_over: [], no_original: [] };
    // 1. account headings with no account number
    for (const acc of all(R, hc('account'))) {
      const h = kid(acc, 'heading'); if (!h || all(acc, e => ln(e) === 'inline' && e.getAttribute('name') === 'accountCode').length) continue;
      const inl = kids(h).filter(e => ln(e) === 'inline'), parts = inl.length ? inl.map(i => norm(text(i))) : [norm(text(h))];
      if (parts.length === 1 && parts[0] === 'All Funds') continue;
      F.headings.push({ eId: acc.getAttribute('eId'), agency: agencyName(agencyOf(acc)), heading: (parts.length > 2 ? parts.slice(1) : parts).join(' / ') });
    }
    // 2. agency summaries
    const ags = all(R, hc('agency'));
    for (const s of all(R, hc('agencySummary'))) {
      const a = s.parentNode, refs = (s.getAttribute('refersTo') || '').split(/\s+/).filter(Boolean);
      const scope = refs.length > 1 ? ags.filter(g => refs.includes('#' + (g.getAttribute('refersTo') || '').replace(/^#/, ''))) : null;
      const tot = all(s, e => ln(e) === 'tr' && cls(e).includes('totalRow'))[0]; if (!tot) continue;
      const ta = all(tot, isQ('summaryAppropriations')), tr = all(tot, isQ('summaryReappropriations'));
      const own = scope || [a];
      const appr = sumIn(own, 'appropriation', 'amount'), off = sumIn(own, 'adjustment', 'offset');
      const rset = scope || ags.filter(g => g.getAttribute('refersTo') === a.getAttribute('refersTo'));
      const reap = sum(rset, 'reappropriatedAmount');
      for (const [col, printed, comp] of [['appropriations', ta, [appr, appr - off]], ['reappropriations', tr, [reap]]]) {
        if (!printed.length) continue;
        const pv = val(printed[0]);
        if (!comp.includes(pv)) F.summaries.push({ eId: s.getAttribute('eId'), agency: agencyName(a), column: col, printed: pv, items: comp[comp.length - 1], diff: pv - comp[comp.length - 1] });
      }
    }
    // 3. subtotals and program totals
    for (const st of all(R, hc('subtotal'))) {
      const v = val(all(st, isQ('subtotal'))[0]);
      const sibs = kids(st.parentNode);
      const its = sibs.filter(hc('appropriation')).reduce((t, x) => t + all(x, isQ('amount')).filter(y => !inDel(y)).reduce((u, y) => u + val(y), 0), 0);
      const off = sibs.slice(0, sibs.indexOf(st)).filter(hc('adjustment')).reduce((t, x) => t + all(x, isQ('offset')).reduce((u, y) => u + val(y), 0), 0);
      if (v !== its && v !== its - off) F.totals.push({ eId: st.getAttribute('eId'), agency: agencyName(agencyOf(st)), what: 'Program account subtotal', printed: v, items: its, n: sibs.filter(hc('appropriation')).length });
    }
    for (const pg of all(R, hc('program'))) {
      const h = kid(pg, 'heading'), pq = h && kids(h).find(isQ('programTotal')); if (!pq) continue;
      const v = val(pq), its = sumIn([pg], 'appropriation', 'amount'), off = sumIn([pg], 'adjustment', 'offset');
      if (v !== its && v !== its - off) F.totals.push({ eId: pg.getAttribute('eId'), agency: agencyName(agencyOf(pg)), what: 'Program total: ' + norm(lastTextAll(h)), printed: v, items: its, n: all(pg, hc('appropriation')).length });
    }
    // 4. project schedules: their totals, and the item each allocates
    for (const tb of all(R, e => ln(e) === 'table' && cls(e).includes('projectSchedule'))) {
      const rows = kids(tb).filter(e => ln(e) === 'tr'), tot = rows.filter(r => cls(r).includes('totalRow'));
      if (!tot.length) continue;
      const item = ancestors(tb).find(e => hc('appropriation')(e) || hc('reappropriation')(e)); if (!item) continue;
      const ip = kid(kid(item, 'content'), 'p'), words = norm(text(ip)), codes = [...words.matchAll(/\(([0-9A-Z]{5,9})\)/g)].map(m => m[1]);
      const thousands = !!kid(tb, 'caption');
      const cells = kids(tot[0]).filter(c => ln(c) === 'td').slice(1);
      cells.forEach((c, x) => {
        const k = x + 1, tq = all(c, e => ln(e) === 'quantity'); if (!tq.length) return;
        const tv = val(tq[0]);
        const s_ = rows.filter(r => cls(r).includes('summaryRow')).reduce((t, r) => { const cell = kids(r)[k]; return t + (cell ? all(cell, e => ln(e) === 'quantity').reduce((u, y) => u + val(y) * (cls(y) === 'offset' ? -1 : 1), 0) : 0); }, 0);
        if (tv !== s_) F.schedules.push({ eId: tb.getAttribute('eId'), item: item.getAttribute('eId'), agency: agencyName(agencyOf(tb)), code: codes[0] || '', printed: tv, rows: s_, diff: tv - s_, n: rows.filter(r => cls(r).includes('summaryRow')).length, thousands });
        if (k === cells.length) {
          const iq = all(ip, e => isQ('amount')(e) || isQ('originalAmount')(e)).filter(e => !inDel(e));
          if (iq.length && tv * (thousands ? 1000 : 1) !== val(iq[0])) F.schedule_items.push({ eId: tb.getAttribute('eId'), item: item.getAttribute('eId'), agency: agencyName(agencyOf(tb)), code: codes[0] || '', total: tv, thousands, amount: val(iq[0]), reapprop: item.getAttribute('name') === 'reappropriation' });
        }
      });
    }
    // 5. reappropriations larger than the original, and those printing no original amount
    for (const r of all(R, hc('reappropriation'))) {
      const o = qNow(r, 'originalAmount'), re_ = qNow(r, 'reappropriatedAmount');
      const src = ancestors(r).find(hc('reappropriationSource'));
      let lead = src && kid(src, 'intro') ? norm(text(kid(src, 'intro'))) : '';
      if (!lead) { const prev = all(R, hc('reappropriationSource')).filter(s => kid(s, 'intro') && (s.compareDocumentPosition ? s.compareDocumentPosition(r) & 4 : true)); lead = prev.length ? norm(text(kid(prev[prev.length - 1], 'intro'))) + ' (continued)' : ''; }
      const t = norm(text(kid(kid(r, 'content'), 'p')));
      if (o != null && re_ != null && re_ > o && !lead.includes('supplemented')) F.reapprop_over.push({ eId: r.getAttribute('eId'), agency: agencyName(agencyOf(r)), text: t.slice(-90), source: lead, original: o, reappropriated: re_ });
      if (o == null && re_ != null) F.no_original.push({ eId: r.getAttribute('eId'), agency: agencyName(agencyOf(r)), code: ([...t.matchAll(/\(([0-9A-Z]{8})\)/g)].pop() || [])[1] || '', reappropriated: re_, source: lead });
    }
    return F;
  }
  function lastTextAll(h) { if (!h) return ''; let t = ''; for (let c = h.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t += c.nodeValue; else if (ln(c) !== 'quantity') t += c.textContent; return t; }

  /* ---------- reappropriations against last year's chapter (prior_check.py) ---------- */
  const actOf = href => { const m = /^\/akn\/us-ny\/act\/(\d{4})\/(\d+)/.exec(href || ''); return m ? [+m[1], +m[2]] : null; };
  const baseSource = href => String(href || '').replace(/(~(?:part_[A-Z]+__)?sec_[\w-]+).*$/, '$1');
  const TRANSFER = /increased or decreased by (?:interchange or )?transfer|may be increased or decreased|supplemented by|transferred? (?:to|from) this appropriation/i;
  function pick(cands, it, used) {
    const free = cands.filter(c => !used.has(c));
    for (const test of [c => c.n === it.n && c.amount === it.amount, c => c.amount === it.amount, c => c.n === it.n, () => true]) { const hit = free.find(test); if (hit) return hit; }
    return null;
  }
  function context(doc) {
    const out = {};
    for (const src of all(docEl(doc), hc('reappropriationSource'))) {
      let grow = TRANSFER.test(kid(src, 'intro') ? text(kid(src, 'intro')) : '');
      for (const el of all(src, e => ln(e) === 'hcontainer')) {
        if (el.getAttribute('name') === 'purpose' && TRANSFER.test(text(el))) grow = true;
        else if (el.getAttribute('name') === 'reappropriation') {
          const struck = all(el, e => ln(e) === 'del').map(d => d.textContent).filter(t => /^[\d,]+$/.test(t.trim()) && /\d/.test(t)).map(t => +t.replace(/\D/g, ''));
          out[el.getAttribute('eId')] = { transfer: grow, amended: ancestors(el).some(e => ln(e) === 'quotedStructure'), struck: struck.length ? struck[0] : null };
        }
      }
    }
    return out;
  }
  const PRIOR_ORDER = ['continues an item vetoed last year', 'new: as appropriated', 'old: continued', 'amended by this bill (old amount struck)', 'new: found under another program code',
    'new: found by account and amount only (codes or words differ)', 'old: found by account and amount only (codes or words differ)', 'new: not appropriated last year, where transfers may add to it',
    'old: more reappropriated than last year, where transfers may add to it', 'new: original amount is not last year\'s appropriation', 'new: reappropriated more than appropriated',
    'new: not found among last year\'s appropriations', 'old: original amount differs from last year\'s', 'old: more reappropriated than last year', 'old: not among last year\'s reappropriations',
    'another act (not checked)', 'no source'];
  // The categories a person should look at.
  const PRIOR_PROBLEMS = new Set(PRIOR_ORDER.slice(9, 15).concat([PRIOR_ORDER[0]]));
  function priorCheck(doc, prior, chapter, year, vetoed) {
    const cur = numbered(items(doc)), pri = numbered(items(prior)), reap = cur.filter(i => i.kind === 'reappropriation');
    const M = () => new Map(), push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    const pAppr = M(), pReap = M(), byObj = M(), byAcct = M(), rAcct = M();
    for (const i of pri) {
      if (i.kind === 'appropriation') { push(pAppr, keyStr(i), i); push(byObj, [i.agency, i.account, i.object].join('|'), i); push(byAcct, [i.agency, i.account].join('|'), i); }
      else { push(pReap, baseSource(i.source) + '|' + keyStr(i), i); push(rAcct, [baseSource(i.source), i.agency, i.account].join('|'), i); }
    }
    const ctx = context(doc), used = new Set(), res = {}, add = (k, it, p) => (res[k] = res[k] || []).push([it, p]);
    const sim = (x, it) => SequenceMatcher(x.words || '', it.words || '').ratio();
    const maxBy = (arr, f) => { let best = null, bv = -Infinity; for (const x of arr) { const v = f(x); if (v > bv) { bv = v; best = x; } } return best; };
    for (const it of reap) {
      const c = ctx[it.eId] || {}, ac = actOf(it.source);
      if (!ac) { add('no source', it, null); continue; }
      const [y, ch] = ac;
      if (y === year && ch === chapter) {
        const p = pick(pAppr.get(keyStr(it)) || [], it, used);
        if (!p) {
          const alt = (byObj.get([it.agency, it.account, it.object].join('|')) || []).filter(x => x.amount === it.amount && !used.has(x));
          let alt2 = (byAcct.get([it.agency, it.account].join('|')) || []).filter(x => x.amount === it.amount && !used.has(x));
          const best = maxBy(alt2, x => sim(x, it));
          if (alt2.length > 1 && best && sim(best, it) >= 0.8) alt2 = [best];
          if (alt.length) { used.add(alt[0]); add('new: found under another program code', it, alt[0]); }
          else if (alt2.length === 1) { used.add(alt2[0]); add('new: found by account and amount only (codes or words differ)', it, alt2[0]); }
          else if (c.transfer) add('new: not appropriated last year, where transfers may add to it', it, null);
          else add('new: not found among last year\'s appropriations', it, null);
          continue;
        }
        used.add(p);
        if (p.amount !== it.amount && c.amended && c.struck === p.amount) add('amended by this bill (old amount struck)', it, p);
        else if (p.amount !== it.amount) add('new: original amount is not last year\'s appropriation', it, p);
        else if (it.reappropriated != null && it.amount != null && it.reappropriated > it.amount) add('new: reappropriated more than appropriated', it, p);
        else add('new: as appropriated', it, p);
      } else if (y < year) {
        let p = pick(pReap.get(baseSource(it.source) + '|' + keyStr(it)) || [], it, used);
        if (!p) {
          const cands = (rAcct.get([baseSource(it.source), it.agency, it.account].join('|')) || []).filter(x => x.amount === it.amount && !used.has(x));
          const best = maxBy(cands, x => sim(x, it));
          if (best && (cands.length === 1 || sim(best, it) >= 0.8)) { add('old: found by account and amount only (codes or words differ)', it, best); used.add(best); }
          else add('old: not among last year\'s reappropriations', it, null);
          continue;
        }
        used.add(p);
        if (p.amount !== it.amount && c.amended && c.struck === p.amount) add('amended by this bill (old amount struck)', it, p);
        else if (p.amount !== it.amount) add('old: original amount differs from last year\'s', it, p);
        else if (it.reappropriated != null && p.reappropriated != null && it.reappropriated > p.reappropriated) add(c.transfer ? 'old: more reappropriated than last year, where transfers may add to it' : 'old: more reappropriated than last year', it, p);
        else add('old: continued', it, p);
      } else add('another act (not checked)', it, null);
    }
    if (vetoed && vetoed.size) for (const k of Object.keys(res)) { const keep = []; for (const [it, p] of res[k]) (p && vetoed.has(p.eId) ? (res['continues an item vetoed last year'] = res['continues an item vetoed last year'] || []) : keep).push([it, p]); res[k] = keep; }
    const lapsed = new Map();
    for (const i of pri) if (!used.has(i)) {
      const k = i.agency + '|' + (i.kind === 'appropriation' ? 'appropriations' : 'reappropriations'), l = lapsed.get(k) || { agency: i.agency, kind: k.split('|')[1], count: 0, amount: 0 };
      l.count++; l.amount += (i.kind === 'appropriation' ? i.amount : i.reappropriated) || 0; lapsed.set(k, l);
    }
    return { res, lapsed: [...lapsed.values()], reappropriations: reap.length, prior: pri.length };
  }

  /* ---------- one print against another (compare_prints.py, appropriation bills) ---------- */
  function budgetOf(doc) {
    const its = numbered(items(doc));
    for (const i of its) {
      const p = kid(kid(i.el, 'content'), 'p'), t = p ? norm(text(p)) : '';
      i.cmp = t.replace(/\s[\d,]+$/, '').replace(/\s*\.\.\.\s*[\d,]*\s*(\(re\. \$[\d,]+\))?\s*$/, '');
    }
    const summaries = {}, programs = {};
    for (const s of all(docEl(doc), hc('agencySummary'))) {
      const ag = (s.parentNode.getAttribute('refersTo') || '').replace(/^#/, ''), tot = all(s, e => ln(e) === 'tr' && cls(e).includes('totalRow'))[0];
      if (tot) summaries[ag] = [q(tot, 'summaryAppropriations'), q(tot, 'summaryReappropriations')];
    }
    for (const p of all(docEl(doc), hc('program'))) {
      const h = kid(p, 'heading'); if (!h || !kids(h).some(isQ('programTotal'))) continue;
      const ag = (ancestors(p).find(hc('agency')).getAttribute('refersTo') || '').replace(/^#/, '');
      programs[ag + '|' + norm(text(h)).replace(/\s[\d,]+$/, '')] = q(h, 'programTotal');
    }
    return { its, summaries, programs };
  }
  const srcCite = i => { const m = /\/act\/(\d{4})\/(\d+)\/~(?:part_([A-Z]+)__)?sec_([\w-]+)/.exec(i.source || ''); return m ? 'ch. ' + m[2] + ' of ' + m[1] + (m[3] ? ', part ' + m[3] : '') + ', § ' + m[4] : ''; };
  function wordsDiff(a, b) {
    const wa = a.split(/\s+/).filter(Boolean), wb = b.split(/\s+/).filter(Boolean), out = [];
    for (const [op, i1, i2, j1, j2] of SequenceMatcher(wa, wb, false).opcodes()) {
      if (op === 'equal') { const seg = wa.slice(i1, i2); out.push(seg.length <= 24 ? seg.join(' ') : seg.slice(0, 12).join(' ') + ' ... ' + seg.slice(-12).join(' ')); }
      else { if (i2 > i1) out.push('[-' + wa.slice(i1, i2).join(' ') + '-]'); if (j2 > j1) out.push('{+' + wb.slice(j1, j2).join(' ') + '+}'); }
    }
    return out.join(' ');
  }
  function compare(oldDoc, newDoc) {
    const A_ = budgetOf(oldDoc), B_ = budgetOf(newDoc);
    const k = i => [i.kind, i.source, keyStr(i), i.n].join('\u0001');
    const ma = new Map(A_.its.map(i => [k(i), i])), mb = new Map(B_.its.map(i => [k(i), i]));
    const changes = [];
    for (const [kk, i] of ma) {
      const j = mb.get(kk); if (!j) continue;
      const c = { agency: i.agency, kind: i.kind, key: key(i).join(' | '), old: i.eId, new: j.eId, source: srcCite(i) };
      if (i.amount !== j.amount || i.reappropriated !== j.reappropriated) changes.push({ ...c, change: 'amount', was: [i.amount, i.reappropriated], now: [j.amount, j.reappropriated] });
      if (i.cmp !== j.cmp) changes.push({ ...c, change: 'reworded', words: wordsDiff(i.cmp, j.cmp) });
    }
    let gone = [...ma].filter(([kk]) => !mb.has(kk)).map(x => x[1]), fresh = [...mb].filter(([kk]) => !ma.has(kk)).map(x => x[1]);
    const strip = w => w.replace(/\([0-9A-Z]{5,8}\)/g, '').split(/\s+/).filter(Boolean);
    for (const i of gone.slice()) {
      let best = 0, bj = null;
      for (const j of fresh) if (j.agency === i.agency && j.kind === i.kind) { const r = SequenceMatcher(strip(i.cmp), strip(j.cmp), false).ratio(); if (r > best) { best = r; bj = j; } }
      if (bj && best >= 0.85) {
        gone = gone.filter(x => x !== i); fresh = fresh.filter(x => x !== bj);
        changes.push({ agency: i.agency, kind: i.kind, change: 'recoded', old: i.eId, new: bj.eId, key: key(i).join(' | ') + '  →  ' + key(bj).join(' | '), was: [i.amount, i.reappropriated], now: [bj.amount, bj.reappropriated], words: i.cmp !== bj.cmp ? wordsDiff(i.cmp, bj.cmp) : '' });
      }
    }
    for (const i of gone) changes.push({ agency: i.agency, kind: i.kind, change: 'removed', old: i.eId, key: key(i).join(' | '), source: srcCite(i), was: [i.amount, i.reappropriated], text: i.cmp.slice(0, 200) });
    for (const j of fresh) changes.push({ agency: j.agency, kind: j.kind, change: 'added', new: j.eId, key: key(j).join(' | '), source: srcCite(j), now: [j.amount, j.reappropriated], text: j.cmp.slice(0, 200) });
    const totals = [], same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    for (const ag of [...new Set([...Object.keys(A_.summaries), ...Object.keys(B_.summaries)])].sort()) if (!same(A_.summaries[ag], B_.summaries[ag])) totals.push({ agency: ag, what: 'agency summary (appropriations, reappropriations)', was: A_.summaries[ag] || null, now: B_.summaries[ag] || null });
    for (const g of [...new Set([...Object.keys(A_.programs), ...Object.keys(B_.programs)])].sort()) if (A_.programs[g] !== B_.programs[g]) { const [ag, ...p] = g.split('|'); totals.push({ agency: ag, what: 'program total: ' + p.join('|'), was: A_.programs[g] ?? null, now: B_.programs[g] ?? null }); }
    return { changes, totals, items: [A_.its.length, B_.its.length] };
  }

  /* ---------- line vetoes (line_vetoes.py) ----------
     The Division of the Budget's list cites each veto by the bill's page and lines. `lines` says where each element
     of the print is printed ({eId: [[page, line], ...]}); every element printed wholly within the cited lines is
     vetoed, and the veto's words and amounts are compared with the elements'. */
  function elementText(el) {
    const holder = el.getAttribute('name') === 'reappropriationSource' ? kid(el, 'intro') : (kid(el, 'content') || kid(el, 'intro'));
    return holder ? kids(holder).filter(e => ln(e) === 'p').map(p => p.textContent).join(' ') : '';
  }
  const lettersDigits = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const amountsIn = t => (t.match(/\d{1,3}(?:,\d{3})+/g) || []);
  const before = (x, y) => x[0] < y[0] || x[0] === y[0] && x[1] <= y[1];
  function placeVetoes(doc, vetoes, lines) {
    return vetoes.map(v => {
      const lo = [v.page, v.from], hi = [v.page_to || v.page, v.to];
      const inside = ls => ls.length && ls.every(x => before(lo, x) && before(x, hi));
      const els = Object.keys(lines).filter(e => inside(lines[e]));
      const partly = Object.keys(lines).filter(e => !els.includes(e) && lines[e].some(x => before(lo, x) && before(x, hi)));
      const nodes = {}; for (const e of els) nodes[e] = byEId(doc, e);
      const words = els.map(e => nodes[e] ? elementText(nodes[e]) : '').join(' ');
      const sim = v.text ? SequenceMatcher(lettersDigits(words), lettersDigits(v.text)).ratio() : null;
      const have = new Set(amountsIn(words)), amtOk = v.text ? amountsIn(v.text).every(x => have.has(x)) : null;
      const its = els.filter(e => nodes[e] && /^(appropriation|reappropriation)$/.test(nodes[e].getAttribute('name')));
      const problem = !its.length ? 'no item printed wholly on those lines' : partly.length ? 'an element is printed partly on those lines: ' + partly.join(', ') : amtOk === false ? "the veto's amounts are not the item's" : null;
      return { ...v, eIds: els, items: its, similarity: sim == null ? null : Math.round(sim * 1000) / 1000, problem };
    });
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // The line veto memorandum (doc name="lineVetoMemo"), as line_vetoes.py writes it.
  function vetoMemo(v, doc, date) {
    const work = (all(docEl(doc), e => ln(e) === 'FRBRExpression').map(e => kid(e, 'FRBRuri')).filter(Boolean)[0] || { getAttribute: () => '' }).getAttribute('value');
    const [y, mo, d] = date.split('-'), datetext = MONTHS[+mo - 1] + ' ' + (+d) + ', ' + y, session = (+y % 2 ? +y : +y - 1) + '-' + (+y % 2 ? +y + 1 : +y);
    const nb = /^([SA])(\d+)([A-Z]?)$/.exec(v.bill), house = nb[1] === 'S' ? 'Senate' : 'Assembly';
    const place = 'Bill page ' + v.page + ', line ' + v.from + ((v.page_to || v.page) !== v.page ? ' through page ' + v.page_to + ', line ' + v.to : v.to !== v.from ? ' through line ' + v.to : '');
    const refs = v.items.map((e, i) => '<item eId="list_1__item_' + (i + 1) + '"><p>' + place + ': <ref class="vetoedItem" href="' + work + '/~' + e + '">' + esc(norm(elementText(byEId(doc, e)))) + '</ref></p></item>').join('');
    const others = v.eIds.filter(e => !v.items.includes(e));
    const note = others.length ? '<p>With the item, the words printed over it (' + others.map(e => byEId(doc, e).getAttribute('name')).join(', ') + ').</p>' : '';
    const memo = '/akn/us-ny/doc/lineVetoMemo/' + y + '/' + v.number, why = norm(v.reason || '');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Line veto ' + v.number + ' of ' + y + ', from the Division of the Budget\'s list; the items tied to the bill\'s XML by the Bill Drafter add-in. -->\n' +
      '<akomaNtoso xmlns="' + A + '" xmlns:lbdc="urn:x-lbdc:akn:1.0">\n  <doc name="lineVetoMemo">\n    <meta>\n      <identification source="#lbdc">\n' +
      '        <FRBRWork><FRBRthis value="' + memo + '/!main"/><FRBRuri value="' + memo + '"/><FRBRdate date="' + date + '" name="issued"/><FRBRauthor href="#governor"/><FRBRcountry value="us-ny"/><FRBRsubtype value="lineVetoMemo"/><FRBRnumber value="' + v.number + '"/></FRBRWork>\n' +
      '        <FRBRExpression><FRBRthis value="' + memo + '/eng@/!main"/><FRBRuri value="' + memo + '/eng@"/><FRBRdate date="' + date + '" name="issued"/><FRBRauthor href="#governor"/><FRBRlanguage language="eng"/></FRBRExpression>\n' +
      '        <FRBRManifestation><FRBRthis value="' + memo + '/eng@/!main.xml"/><FRBRuri value="' + memo + '/eng@.akn"/><FRBRdate date="' + date + '" name="markup"/><FRBRauthor href="#lbdc"/></FRBRManifestation>\n      </identification>\n' +
      '      <references source="#lbdc">\n        <TLCOrganization eId="lbdc" href="/akn/ontology/organization/us-ny/lbdc" showAs="Legislative Bill Drafting Commission"/>\n        <TLCPerson eId="governor" href="/akn/ontology/person/us-ny/governor" showAs="The Governor"/>\n      </references>\n' +
      '      <proprietary source="#lbdc">\n        <lbdc:documentInfo>\n          <lbdc:profile name="AKN-NY" version="0.3"/>\n          <lbdc:session>' + session + '</lbdc:session>\n        </lbdc:documentInfo>\n      </proprietary>\n    </meta>\n' +
      '    <preface>\n      <p class="number">LINE VETO <docNumber>#' + v.number + '</docNumber></p>\n      <p class="date"><docDate date="' + date + '">' + datetext + '</docDate></p>\n    </preface>\n    <mainBody>\n' +
      '      <p>A statement of items to which the Governor objects and which she does not approve, contained in ' + house + ' Bill Number ' + nb[2] + (nb[3] ? '--' + nb[3] : '') + ', chapter ' + v.chapter + ' of the laws of ' + v.year + '.</p>\n' +
      '      <p>' + esc(v.agency) + '</p>\n      <blockList eId="list_1">' + refs + '</blockList>\n      ' + note + (why ? '\n      <p>This item passed by the Legislature, to which I object and do not approve, ' + esc(why) + '. Accordingly, this item is disapproved.</p>' : '') + '\n    </mainBody>\n  </doc>\n</akomaNtoso>\n';
  }

  /* ---------- the bill at a glance, for the pane ---------- */
  function outline(doc) {
    const R = docEl(doc);
    const fr = all(R, e => ln(e) === 'FRBRExpression')[0], num = all(R, e => ln(e) === 'FRBRnumber')[0], ver = fr && kid(fr, 'FRBRversionNumber');
    return {
      bill: (num ? num.getAttribute('value') : '') + (ver ? '-' + ver.getAttribute('value') : ''),
      agencies: all(R, hc('agency')).map(a => ({
        eId: a.getAttribute('eId'), name: agencyName(a), reapp: cls(a) === 'reappropriations', heading: norm(text(kid(a, 'heading'))), sub: norm(text(kid(a, 'subheading'))),
        programs: kids(a).filter(hc('program')).map(p => ({ eId: p.getAttribute('eId'), heading: norm(lastTextAll(kid(p, 'heading')) || ''), total: kid(p, 'heading') && kids(kid(p, 'heading')).some(isQ('programTotal')) ? val(kids(kid(p, 'heading')).find(isQ('programTotal'))) : null, items: all(p, e => hc('appropriation')(e) || hc('reappropriation')(e)).length })),
        items: all(a, e => hc('appropriation')(e) || hc('reappropriation')(e)).length,
      })),
    };
  }

  BD.budget = { A, parse, items, key, numbered, nameWords, findings, priorCheck, PRIOR_ORDER, PRIOR_PROBLEMS, compare, placeVetoes, vetoMemo, outline, agencyName, SequenceMatcher, fmt,
    _: { all, kids, kid, ln, hc, isQ, ancestors, inDel, text, norm, val, cls, byEId, agencyOf, lastTextAll, elementText, docEl } };
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
