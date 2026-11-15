/* Bill Drafter for Word (demo) - an appropriation bill in Word.
   The bill's Akoma Ntoso XML is the record (kept in the document as a custom XML part by the pane); Word shows it
   laid out as the print reads, each part that can change in a content control tagged with its eId:
     akn:b;e=<short eId>;k=<kind>   kinds: agency, summary, program, purpose, appropriation, reappropriation, subtotal
   An item edited in Word is read back and written into the XML:
     - a reappropriation (and a purpose under a reappropriation source) is existing law: what changed in its words
       and its original amount is put in [brackets] and underlined against the law as it stands, as the bill's
       opening section says; the amount reappropriated ("(re. $...)") is this year's figure and is just reprinted,
       as the prints do ("[1,312,000] 1,433,000 ... (re. $1,433,000)");
     - an appropriation is new money in this bill: it simply takes the new words and amount.
   Codes and amounts are tagged again (programCode, objectCode, amount, originalAmount, reappropriatedAmount), so
   every check and total keeps working on the edited bill. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const B = BD.budget, { all, kids, kid, ln, hc, isQ, ancestors, inDel, text, norm, val, cls } = B._;
  const A = B.A;

  /* ---------- short eIds for Word's 64-character tags ---------- */
  const ABBR = { agency: 'a', program: 'p', account: 'c', reappropriationSource: 's', reappropriation: 'r', appropriation: 'i', purpose: 'u', subtotal: 't', agencySummary: 'm', adjustment: 'j', table: 'b', text: 'x', intro: 'n', mod: 'o', qstr: 'q', allocation: 'l' };
  const FULL = Object.fromEntries(Object.entries(ABBR).map(([k, v]) => [v, k]));
  const shortId = eId => String(eId).split('__').map((p, i) => { const m = /^([A-Za-z]+)_(.+)$/.exec(p); if (!m) return p; if (i === 0 && m[1] === 'sec') return m[2]; return ABBR[m[1]] ? ABBR[m[1]] + m[2] : p; }).join('.');
  const longId = s => String(s).split('.').map((p, i) => { if (i === 0) return 'sec_' + p; const m = /^([a-z])(\d[\w-]*)$/.exec(p); return m && FULL[m[1]] ? FULL[m[1]] + '_' + m[2] : p; }).join('__');
  const tag = (eId, kind) => 'akn:b;e=' + shortId(eId) + ';k=' + kind;
  function parseTag(t) { const m = /^akn:b;e=([^;]+);k=(\w+)/.exec(t || ''); return m ? { eId: longId(m[1]), kind: m[2] } : null; }

  /* ---------- writing OOXML ---------- */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const RIGHT = 9360; // the right margin of a letter page with one-inch margins, in twips
  function run(t, k, bold) {
    if (!t) return '';
    const st = (k === 'ins' ? '<w:rStyle w:val="BillInsert"/><w:u w:val="single"/>' : k === 'del' ? '<w:rStyle w:val="BillDelete"/>' : '') + (bold ? '<w:b/>' : '');
    return t.split('\t').map((x, i) => (i ? '<w:r>' + (st ? '<w:rPr>' + st + '</w:rPr>' : '') + '<w:tab/></w:r>' : '') + (x ? '<w:r>' + (st ? '<w:rPr>' + st + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(x) + '</w:t></w:r>' : '')).join('');
  }
  const pPr = o => '<w:pPr>' + (o.keep ? '<w:keepNext/>' : '') + (o.tab ? '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="' + RIGHT + '"/></w:tabs>' : '') +
    '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 60 : o.after) + '"/>' + (o.ind ? '<w:ind ' + o.ind + '/>' : '') + (o.jc ? '<w:jc w:val="' + o.jc + '"/>' : '') + '</w:pPr>';
  const para = (o, runs) => '<w:p>' + pPr(o) + runs.map(r => run(r.t, r.k, o.bold)).join('') + '</w:p>';
  let nextId = Math.floor(Math.random() * 1e6) + 5000;
  const sdt = (t, alias, inner) => '<w:sdt><w:sdtPr><w:alias w:val="' + esc(alias) + '"/><w:tag w:val="' + esc(t) + '"/><w:id w:val="' + (nextId++) + '"/></w:sdtPr><w:sdtContent>' + inner + '</w:sdtContent></w:sdt>';
  const BORDER = '<w:tblBorders>' + ['top', 'bottom', 'insideH'].map(b => '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="C8CCD0"/>').join('') + '</w:tblBorders>';

  // The runs of an element's words: [{t, k}] with old matter in [brackets] (k 'del') and new matter (k 'ins').
  function runsOf(el, k = '', out = []) {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) push(out, c.nodeValue, k);
      else if (c.nodeType === 1) {
        const n = ln(c);
        if (n === 'del') { push(out, '[', 'del'); runsOf(c, 'del', out); push(out, ']', 'del'); }
        else if (n === 'ins') runsOf(c, 'ins', out);
        else if (n === 'table' || n === 'authorialNote' || n === 'quotedStructure') continue;
        else runsOf(c, k, out);
      }
    }
    return out;
  }
  function push(out, t, k) { if (!t) return; const l = out[out.length - 1]; if (l && l.k === k) l.t += t; else out.push({ t, k }); }
  // An amount at the end of a line goes to the right margin, after a row of leader dots, as in the print.
  function amountToMargin(rs) {
    const l = rs[rs.length - 1]; if (!l) return rs;
    const m = /\s+(\$?[\d,]+)$/.exec(l.t); if (!m) return rs;
    l.t = l.t.slice(0, m.index) + '\t' + m[1];
    return rs;
  }
  const textRuns = t => [{ t, k: '' }];
  // What Word shows for an item's first paragraph (what the reader compares to see whether it was edited).
  function shownRuns(el) {
    const name = el.getAttribute('name'), p = firstP(el);
    if (!p) return [];
    const rs = runsOf(p).map(r => ({ ...r }));
    rs.forEach(r => { r.t = r.t.replace(/\s+/g, ' '); });
    if (rs.length) { rs[0].t = rs[0].t.replace(/^\s+/, ''); rs[rs.length - 1].t = rs[rs.length - 1].t.replace(/\s+$/, ''); }
    return name === 'appropriation' ? amountToMargin(rs) : rs;
  }
  const firstP = el => { const c = kid(el, 'content') || kid(el, 'intro'); return c ? kid(c, 'p') : null; };
  const shownText = el => shownRuns(el).map(r => r.t).join('');

  function tableXml(tb) {
    const rows = kids(tb).filter(e => ln(e) === 'tr'); if (!rows.length) return '';
    const ncol = Math.max(...rows.map(r => kids(r).length));
    const w = Math.floor(RIGHT / ncol), first = RIGHT - w * (ncol - 1);
    const cell = (c, i, head, total) => {
      const t = norm(text(c)), num = /^\(?-?\$?[\d,]+\)?$/.test(t);
      return '<w:tc><w:tcPr><w:tcW w:w="' + (i ? w : first) + '" w:type="dxa"/></w:tcPr>' + para({ after: 0, jc: i && (num || head) ? 'right' : null, bold: head || total }, textRuns(t)) + '</w:tc>';
    };
    const cap = kid(tb, 'caption');
    return (cap ? para({ jc: 'center', after: 0 }, textRuns(norm(text(cap)))) : '') +
      '<w:tbl><w:tblPr><w:tblW w:w="' + RIGHT + '" w:type="dxa"/>' + BORDER + '</w:tblPr><w:tblGrid>' + Array.from({ length: ncol }, (_, i) => '<w:gridCol w:w="' + (i ? w : first) + '"/>').join('') + '</w:tblGrid>' +
      rows.map(r => { const c = kids(r), head = cls(r).includes('headerRow'), tot = cls(r).includes('totalRow'); while (c.length < ncol) c.push(null); return '<w:tr>' + c.map((x, i) => x ? cell(x, i, head, tot) : '<w:tc><w:tcPr><w:tcW w:w="' + (i ? w : first) + '" w:type="dxa"/></w:tcPr><w:p/></w:tc>').join('') + '</w:tr>'; }).join('') + '</w:tbl>' + para({ after: 0 }, []);
  }
  const ALIAS = { agency: 'Agency', summary: 'Agency summary', program: 'Program', purpose: 'Purpose', appropriation: 'Appropriation', reappropriation: 'Reappropriation', subtotal: 'Subtotal' };
  // Just the element's own content control (an agency's or a program's heading, without what is under it).
  function renderOwn(el) {
    const name = el.getAttribute('name'), id = el.getAttribute('eId');
    if (name === 'agency') return sdt(tag(id, 'agency'), ALIAS.agency, para({ jc: 'center', before: 360, after: 0, bold: true, keep: true }, textRuns(norm(text(kid(el, 'heading'))))) +
      (kid(el, 'subheading') ? para({ jc: 'center', after: 120, keep: true }, textRuns(norm(text(kid(el, 'subheading'))))) : ''));
    if (name === 'program') {
      const h = kid(el, 'heading'), q = h && kids(h).find(isQ('programTotal'));
      return sdt(tag(id, 'program'), ALIAS.program, para({ tab: !!q, before: 240, bold: true, keep: true }, textRuns(norm(B._.lastTextAll(h)) + (q ? '\t' + norm(text(q)) : ''))));
    }
    return render(el);
  }
  // One element of the bill (and what it holds) as OOXML.
  function render(el) {
    const name = el.getAttribute('name'), id = el.getAttribute('eId');
    if (ln(el) === 'section') {
      const intro = kid(el, 'intro');
      return (intro ? kids(intro).filter(e => ln(e) === 'p').map((p, i) => para({ ind: 'w:firstLine="360"', after: 80 }, (i === 0 ? [{ t: norm(text(kid(el, 'num'))) + ' ', k: '' }] : []).concat(runsOf(p)))).join('') : '') +
        kids(el).filter(e => ln(e) === 'hcontainer').map(render).join('');
    }
    switch (name) {
      case 'agency': return renderOwn(el) + kids(el).filter(e => ln(e) === 'hcontainer').map(render).join('');
      case 'agencySummary': {
        const intro = kid(el, 'intro');
        const inner = (intro ? kids(intro).filter(e => ln(e) === 'p').map(p => para({ ind: 'w:firstLine="360"' }, runsOf(p))).join('') : '') +
          all(el, e => ln(e) === 'table').map(tableXml).join('');
        return sdt(tag(id, 'summary'), ALIAS.summary, inner || para({}, []));
      }
      case 'program': return renderOwn(el) + kids(el).filter(e => ln(e) === 'hcontainer').map(render).join('');
      case 'account': {
        const h = kid(el, 'heading');
        return (h ? para({ before: 160, keep: true }, [{ t: norm(text(h)), k: '' }]) : '') + kids(el).filter(e => ln(e) === 'hcontainer').map(render).join('');
      }
      case 'reappropriationSource': {
        const intro = kid(el, 'intro');
        return (intro ? kids(intro).filter(e => ln(e) === 'p').map(p => para({ before: 80, keep: true }, runsOf(p))).join('') : '') + kids(el).filter(e => ln(e) === 'hcontainer').map(render).join('');
      }
      case 'purpose': case 'appropriation': case 'reappropriation': {
        const kind = name === 'purpose' ? 'purpose' : name;
        const ps = kids(kid(el, 'content') || el).filter(e => ln(e) === 'p');
        const first = para({ ind: 'w:firstLine="360"', tab: name === 'appropriation' }, shownRuns(el));
        const more = ps.slice(1).map(p => para({ ind: 'w:firstLine="360"' }, runsOf(p))).join('');
        const tables = all(el, e => ln(e) === 'table' && !ancestors(e).some(a => ln(a) === 'quotedStructure')).map(tableXml).join('');
        return sdt(tag(id, kind), ALIAS[kind], first + more + tables) + kids(el).filter(e => ln(e) === 'hcontainer').map(render).join('');
      }
      case 'subtotal': {
        const p = firstP(el); const rs = p ? amountToMargin(runsOf(p).map(r => ({ ...r, t: r.t.replace(/\s+/g, ' ').trim() }))) : [];
        return sdt(tag(id, 'subtotal'), ALIAS.subtotal, para({ tab: true, before: 60 }, rs));
      }
      default: {
        const h = kid(el, 'heading'), c = kid(el, 'content') || kid(el, 'intro');
        return (h ? para({ before: 120, bold: true }, textRuns(norm(text(h)))) : '') +
          (c ? kids(c).map(x => ln(x) === 'p' ? para({}, amountToMargin(runsOf(x))) : ln(x) === 'table' ? tableXml(x) : '').join('') : '') +
          kids(el).filter(e => ln(e) === 'hcontainer').map(render).join('');
      }
    }
  }
  // The bill's body, in pieces Word can take one at a time: a title block, section 1's opening, then each agency.
  function renderBill(doc) {
    const R = B._.docEl(doc), body = all(R, e => ln(e) === 'body')[0], sec = kid(body, 'section'), o = B.outline(doc);
    const head = para({ jc: 'center', after: 0, bold: true }, textRuns(o.bill.replace(/^S(\d+)/, 'S. $1').replace(/^A(\d+)/, 'A. $1').replace(/-/, '--'))) +
      para({ jc: 'center', after: 240 }, textRuns('Appropriation bill · ' + o.agencies.length + ' agency schedules · laid out from its XML by the Bill Drafter'));
    const pieces = [head];
    if (sec) {
      const intro = kid(sec, 'intro');
      pieces.push(intro ? kids(intro).filter(e => ln(e) === 'p').map((p, i) => para({ ind: 'w:firstLine="360"', after: 80 }, (i === 0 ? [{ t: norm(text(kid(sec, 'num'))) + ' ', k: '' }] : []).concat(runsOf(p)))).join('') : '');
      for (const ag of kids(sec).filter(hc('agency'))) pieces.push(render(ag));
    }
    return pieces.filter(Boolean);
  }

  /* ---------- reading an item back from Word ---------- */
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // The runs of the first paragraph in a content control's OOXML (from Word's getOoxml), with their kinds.
  function wordRuns(ooxml, DOMParserImpl) {
    const d = B.parse(ooxml, DOMParserImpl), R = d.documentElement;
    const body = all(R, e => ln(e) === 'body')[0] || R;
    const p = all(body, e => ln(e) === 'p')[0]; if (!p) return [];
    const out = [];
    for (const r of all(p, e => ln(e) === 'r')) {
      if (ancestors(r).some(a => ln(a) === 'del' && a.namespaceURI === W)) { /* Word's own tracked deletion */ }
      const pr = kid(r, 'rPr'); let k = '';
      if (pr) {
        const st = kid(pr, 'rStyle'), u = kid(pr, 'u'), s = kid(pr, 'strike'), v = n => n && (n.getAttributeNS ? n.getAttributeNS(W, 'val') || n.getAttribute('w:val') : n.getAttribute('w:val'));
        const sv = v(st) || '';
        if (/^BillInsert/i.test(sv)) k = 'ins'; else if (/^BillDelete/i.test(sv)) k = 'del';
        else if (u && v(u) !== 'none') k = 'ins'; else if (s && v(s) !== '0' && v(s) !== 'false') k = 'del';
      }
      const rev = ancestors(r).find(a => a.namespaceURI === W && (ln(a) === 'ins' || ln(a) === 'del'));
      if (rev) k = ln(rev) === 'ins' ? 'ins' : 'del';
      let t = '';
      for (const c of kids(r)) { const n = ln(c); if (n === 't' || n === 'delText') t += c.textContent; else if (n === 'tab') t += '\t'; }
      push(out, t, k);
    }
    return bracketize(out);
  }
  // Brackets typed in plain text open and close old matter, as in the bill side.
  function bracketize(rs) {
    const out = []; let open = false;
    for (const r of rs) {
      if (r.k) { if (r.k === 'del') open = !/\]\s*$/.test(r.t) && (open || /\[/.test(r.t)); push(out, r.t, r.k); continue; }
      for (const ch of r.t) {
        if (ch === '[' && !open) { open = true; push(out, ch, 'del'); }
        else if (ch === ']' && open) { push(out, ch, 'del'); open = false; }
        else push(out, ch, open ? 'del' : '');
      }
    }
    return out;
  }
  const flat = t => t.replace(/\s+/g, ' ').trim();
  // The two readings of marked runs: the law as it stands (old matter kept) and as the bill would leave it.
  function readingsOf(rs) {
    let o = '', n = '';
    for (const r of rs) { if (r.k === 'del') o += r.t.replace(/[\[\]]/g, ''); else if (r.k === 'ins') n += r.t; else { o += r.t; n += r.t; } }
    return { old: flat(o), now: flat(n) };
  }
  // Is this element existing law (a reappropriation, or a purpose under a reappropriation source)?
  const isLaw = el => el.getAttribute('name') === 'reappropriation' || el.getAttribute('name') === 'purpose' && ancestors(el).some(hc('reappropriationSource'));

  /* ---------- writing an edit into the XML ---------- */
  const NUM = /\d{1,3}(?:,\d{3})+|\d+/g;
  function qty(c, t) { const v = t.replace(/\D/g, ''); return '<quantity class="' + c + '" normalized="' + (+v) + '" refersTo="#usd">' + esc(t) + '</quantity>'; }
  // Marked runs -> the inline XML of the item's paragraph, with its codes and amounts tagged.
  function inlineXml(el, rs) {
    const name = el.getAttribute('name');
    const oldCodes = {}; for (const i of all(firstP(el) || el, e => ln(e) === 'inline')) { const nm = i.getAttribute('name'); if (/Code$/.test(nm)) oldCodes[norm(text(i))] = nm; }
    const D = rs.map(r => r.t).join('');
    // Where each run starts in D.
    const starts = []; let pos = 0; for (const r of rs) { starts.push(pos); pos += r.t.length; }
    const marks = []; // [from, to, open, close]
    // amounts
    const nums = []; let m; NUM.lastIndex = 0;
    while ((m = NUM.exec(D))) { if (!/,/.test(m[0]) && +m[0] < 100) continue; nums.push([m.index, m.index + m[0].length]); }
    const codeSpans = []; const CODE = /\((\d{5})\)/g; while ((m = CODE.exec(D))) codeSpans.push([m.index + 1, m.index + 6, m[1]]);
    const inCode = s => codeSpans.some(c => s[0] >= c[0] && s[1] <= c[1]);
    const amts = nums.filter(s => !inCode(s) && !/^\d{5}$/.test(D.slice(s[0], s[1])) || /,/.test(D.slice(s[0], s[1])));
    if (name === 'appropriation' || name === 'subtotal') {
      const last = amts[amts.length - 1]; if (last && /^[\s\]\)\.]*$/.test(D.slice(last[1]))) marks.push([last[0], last[1], name === 'subtotal' ? 'subtotal' : 'amount']);
    } else if (name === 'reappropriation') {
      const re = D.lastIndexOf('(re. $');
      if (re >= 0) {
        const close = D.indexOf(')', re);
        for (const s of amts) if (s[0] > re && (close < 0 || s[1] <= close)) marks.push([s[0], s[1], 'reappropriatedAmount']);
        // the original amount: the number(s) just before "(re.", back to the leader dots or words
        let k = re; while (k > 0 && /[\d,\s\[\]]/.test(D[k - 1])) k--;
        for (const s of amts) if (s[0] >= k && s[1] <= re) marks.push([s[0], s[1], 'originalAmount']);
      } else { const last = amts[amts.length - 1]; if (last) marks.push([last[0], last[1], 'originalAmount']); }
    }
    // codes: those the item had, by their name; a new code where the program code was, as the program code
    const known = new Set(Object.keys(oldCodes));
    let unknown = codeSpans.filter(c => !known.has(c[2]));
    const hadProgram = Object.values(oldCodes).includes('programCode') && !codeSpans.some(c => oldCodes[c[2]] === 'programCode');
    for (const c of codeSpans) {
      if (known.has(c[2])) marks.push([c[0], c[1], 'code:' + oldCodes[c[2]]]);
      else if (hadProgram && c === unknown[unknown.length - 1]) marks.push([c[0], c[1], 'code:programCode']);
    }
    marks.sort((a, b) => a[0] - b[0]);
    // emit run by run; a mark never crosses a run (an amount or a code is one word to the diff)
    let xml = '';
    rs.forEach((r, i) => {
      let t = r.t, base = starts[i], from = 0, to = t.length;
      if (r.k === 'del') { if (t.startsWith('[')) from = 1; if (t.endsWith(']')) to = t.length - 1; }
      let inner = '', at = from;
      // struck matter stays plain words in <del>, as the converter reads the prints: only current amounts and
      // codes are tagged
      for (const [s, e, what] of r.k === 'del' ? [] : marks) {
        if (s < base + from || e > base + to) continue;
        inner += esc(t.slice(at, s - base));
        const seg = t.slice(s - base, e - base);
        inner += what.startsWith('code:') ? '<inline name="' + what.slice(5) + '">' + esc(seg) + '</inline>' : qty(what, seg);
        at = e - base;
      }
      inner += esc(t.slice(at, to));
      if (!inner) return;
      xml += r.k === 'del' ? '<del>' + inner + '</del>' : r.k === 'ins' ? '<ins>' + inner + '</ins>' : inner;
    });
    return xml;
  }
  // The runs Word read for an item -> the item in the XML. Returns what happened: 'marked', 'replaced', 'same'.
  function applyEdit(el, wordRs, P) {
    const law = readingsOf(runsOf(firstP(el))).old, now = readingsOf(wordRs).now;
    const before = readingsOf(runsOf(firstP(el))).now;
    if (flat(now) === flat(before) && !wordRs.some(r => r.k)) return 'same';
    let rs, how;
    if (isLaw(el)) {
      // the law: the words and the original amount, up to "(re. $"; the amount reappropriated is reprinted
      const cut = t => { const i = t.lastIndexOf('(re. '); return i < 0 ? [t, ''] : [t.slice(0, i).trim(), t.slice(i)]; };
      // a code in parentheses is one word to the diff, so a changed code reads "[(15126)] (60501)" as printed
      const hide = t => t.replace(/\((\d{5})\)/g, '\u27e6$1\u27e7'), show = t => t.replace(/\u27e6(\d{5})\u27e7/g, '($1)');
      const [lawHead] = cut(law), [nowHead, nowTail] = cut(now);
      rs = BD.sameText([lawHead], [nowHead]) ? [{ t: nowHead, k: '' }] : BD.markChanges([hide(lawHead)], [hide(nowHead)])[0].map(r => ({ ...r, t: show(r.t) }));
      if (nowTail) rs = rs.concat([{ t: ' ' + nowTail, k: '' }]);
      how = 'marked';
    } else { rs = [{ t: now, k: '' }]; how = 'replaced'; }
    const p = firstP(el);
    const D = P || (typeof root.DOMParser !== 'undefined' ? root.DOMParser : null);
    const d = new D().parseFromString('<p xmlns="' + A + '">' + inlineXml(el, rs) + '</p>', 'application/xml');
    while (p.firstChild) p.removeChild(p.firstChild);
    for (let c = d.documentElement.firstChild; c; c = c.nextSibling) p.appendChild(p.ownerDocument.importNode(c, true));
    return how;
  }

  /* ---------- totals ---------- */
  // Program totals, program account subtotals and agency summaries computed from the items, and set where they
  // differ from what is printed. A total is reprinted, not marked: it isn't law being amended.
  const fundOf = acc => { const h = kid(acc, 'heading'); if (!h) return ''; const ft = kids(h).find(e => ln(e) === 'inline' && e.getAttribute('name') === 'fundType'), f = kids(h).find(e => ln(e) === 'inline' && e.getAttribute('name') === 'fund'); return norm(text(ft || f || { textContent: '' })); };
  const amountsIn = (els, holder, c) => els.reduce((s, g) => s + all(g, hc(holder)).reduce((t, h) => t + all(h, isQ(c)).filter(x => !inDel(x)).reduce((u, x) => u + val(x), 0), 0), 0);
  function setQ(q, v) { q.setAttribute('normalized', String(v)); while (q.firstChild) q.removeChild(q.firstChild); q.appendChild(q.ownerDocument.createTextNode(B.fmt(v))); }
  function totals(doc, apply) {
    const R = B._.docEl(doc), out = [];
    for (const st of all(R, hc('subtotal'))) {
      const q = all(st, isQ('subtotal'))[0]; if (!q) continue;
      const sibs = kids(st.parentNode), v = sibs.filter(hc('appropriation')).reduce((t, x) => t + all(x, isQ('amount')).filter(y => !inDel(y)).reduce((u, y) => u + val(y), 0), 0);
      const off = sibs.slice(0, sibs.indexOf(st)).filter(hc('adjustment')).reduce((t, x) => t + all(x, isQ('offset')).reduce((u, y) => u + val(y), 0), 0);
      if (val(q) !== v && val(q) !== v - off) { out.push({ eId: st.getAttribute('eId'), what: 'Program account subtotal', was: val(q), now: v, kind: 'subtotal' }); if (apply) setQ(q, v); }
    }
    for (const pg of all(R, hc('program'))) {
      const h = kid(pg, 'heading'), q = h && kids(h).find(isQ('programTotal')); if (!q) continue;
      const v = amountsIn([pg], 'appropriation', 'amount'), off = amountsIn([pg], 'adjustment', 'offset');
      if (val(q) !== v && val(q) !== v - off) { out.push({ eId: pg.getAttribute('eId'), what: 'Program total: ' + norm(B._.lastTextAll(h)), was: val(q), now: v, kind: 'program' }); if (apply) setQ(q, v); }
    }
    const ags = all(R, hc('agency'));
    for (const s of all(R, hc('agencySummary'))) {
      const a = s.parentNode, refs = (s.getAttribute('refersTo') || '').split(/\s+/).filter(Boolean);
      if (refs.length > 1) continue; // a summary over several agencies: checked, not rewritten
      const rset = ags.filter(g => g.getAttribute('refersTo') === a.getAttribute('refersTo'));
      const perFund = (els, holder, c) => { const m = {}; for (const g of els) for (const acc of all(g, hc('account'))) { const f = fundOf(acc); m[f] = (m[f] || 0) + all(acc, hc(holder)).reduce((t, h) => t + all(h, isQ(c)).filter(x => !inDel(x)).reduce((u, x) => u + val(x), 0), 0); } return m; };
      const ap = perFund([a], 'appropriation', 'amount'), rp = perFund(rset, 'reappropriation', 'reappropriatedAmount');
      const apTot = amountsIn([a], 'appropriation', 'amount'), off = amountsIn([a], 'adjustment', 'offset'), rpTot = rset.reduce((t, g) => t + all(g, isQ('reappropriatedAmount')).filter(x => !inDel(x)).reduce((u, x) => u + val(x), 0), 0);
      for (const tr of all(s, e => ln(e) === 'tr')) {
        const label = norm(text(kids(tr)[0])), total = cls(tr).includes('totalRow');
        for (const [c, m, t] of [['summaryAppropriations', ap, [apTot, apTot - off]], ['summaryReappropriations', rp, [rpTot]]]) {
          const q = all(tr, isQ(c))[0]; if (!q) continue;
          const want = total ? t : m[label] != null ? [m[label]] : null;
          if (!want || want.includes(val(q))) continue;
          out.push({ eId: s.getAttribute('eId'), what: 'Agency summary, ' + label + ', ' + (c === 'summaryAppropriations' ? 'appropriations' : 'reappropriations'), was: val(q), now: want[0], kind: 'summary' });
          if (apply) setQ(q, want[0]);
        }
      }
    }
    return out;
  }

  /* ---------- adding and removing items ---------- */
  // A new appropriation after `afterEl` (an appropriation or a purpose) in the same account: new money, so plain.
  function addItem(doc, afterEl, words, amount, P) {
    const acct = afterEl.parentNode;
    const nums = kids(acct).filter(hc('appropriation')).map(e => +(/appropriation_(\d+)$/.exec(e.getAttribute('eId')) || [0, 0])[1]);
    const eId = acct.getAttribute('eId') + '__appropriation_' + (Math.max(0, ...nums) + 1);
    const amt = B.fmt(+String(amount).replace(/\D/g, ''));
    const code = /\((\d{5})\)\s*$/.exec(words);
    const body = code ? esc(words.slice(0, code.index)) + '(<inline name="programCode">' + code[1] + '</inline>)' : esc(words);
    const xml = '<hcontainer xmlns="' + A + '" name="appropriation" eId="' + eId + '"><content><p>' + body + ' ' + qty('amount', amt) + '</p></content></hcontainer>';
    const D = P || root.DOMParser, n = acct.ownerDocument.importNode(new D().parseFromString(xml, 'application/xml').documentElement, true);
    acct.insertBefore(n, afterEl.nextSibling);
    return n;
  }
  function removeItem(el) { el.parentNode.removeChild(el); }

  BD.budgetWord = { shortId, longId, tag, parseTag, render, renderOwn, renderBill, shownRuns, shownText, wordRuns, readingsOf, isLaw, applyEdit, inlineXml, totals, addItem, removeItem, runsOf };
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
