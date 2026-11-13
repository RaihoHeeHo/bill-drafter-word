/* Bill Drafter for Word (demo) - the bill's structure in the .docx (see FORMAT.md):
   content controls tagged "akn:…" say what each part is, styles say how it looks.
   This file writes that structure as OOXML (for Word's insertOoxml) and reads it back from
   WordprocessingML (Word's getOoxml, or word/document.xml in a saved .docx) into a plain model,
   which the checks and the Akoma Ntoso converter use. Works with the browser's DOMParser and with xmldom. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  /* ---------- styles ---------- */
  // Paragraph styles carry the look only; nothing depends on them but the reader's eye.
  // Character styles Bill Insert / Bill Delete DO carry meaning (new matter / matter to be omitted).
  const STYLES = [
    ['paragraph', 'BillTitle', 'Bill Title', '<w:pPr><w:spacing w:after="240"/><w:ind w:left="720" w:hanging="720"/></w:pPr><w:rPr><w:b/></w:rPr>'],
    ['paragraph', 'BillEnacting', 'Bill Enacting Clause', '<w:pPr><w:spacing w:after="240"/><w:ind w:firstLine="720"/></w:pPr><w:rPr><w:i/></w:rPr>'],
    ['paragraph', 'BillSection', 'Bill Section', '<w:pPr><w:spacing w:before="120" w:after="120"/><w:ind w:firstLine="360"/></w:pPr>'],
    ['paragraph', 'BillQuoted', 'Bill Amended Text', '<w:pPr><w:spacing w:after="80"/><w:ind w:left="360" w:firstLine="360"/></w:pPr>'],
    ['character', 'BillNum', 'Bill Section Number', '<w:rPr><w:b/></w:rPr>'],
    ['character', 'BillHeading', 'Bill Section Heading', ''],
    ['character', 'BillInsert', 'Bill Insert (new matter)', '<w:rPr><w:u w:val="single"/></w:rPr>'],
    ['character', 'BillDelete', 'Bill Delete (matter omitted)', '<w:rPr><w:color w:val="9B1C1C"/></w:rPr>'],
  ];
  const STYLE_KIND = { BillInsert: 'ins', BillDelete: 'del', BillNum: 'num', BillHeading: 'heading' };
  const stylesXml = () => '<w:styles xmlns:w="' + W + '">' + STYLES.map(([type, id, name, body]) =>
    '<w:style w:type="' + type + '" w:customStyle="1" w:styleId="' + id + '"><w:name w:val="' + name + '"/>' +
    (type === 'paragraph' ? '<w:basedOn w:val="Normal"/><w:qFormat/>' : '<w:qFormat/>') + body + '</w:style>').join('') + '</w:styles>';

  /* ---------- writing ---------- */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const RSTYLE = { ins: 'BillInsert', del: 'BillDelete', num: 'BillNum', heading: 'BillHeading' };
  function run(t, k) {
    if (!t) return '';
    const st = RSTYLE[k] ? '<w:rPr><w:rStyle w:val="' + RSTYLE[k] + '"/></w:rPr>' : '';
    return '<w:r>' + st + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
  }
  const runs = rs => rs.map(r => run(r.t, r.k)).join('');
  const para = (style, inner) => '<w:p><w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' + inner + '</w:p>';
  let nextId = Math.floor(Math.random() * 1e6) + 1000;
  const sdtPr = (tag, alias) => '<w:sdtPr><w:alias w:val="' + esc(alias || tag.split(';')[0]) + '"/><w:tag w:val="' + esc(tag) + '"/><w:id w:val="' + (nextId++) + '"/></w:sdtPr>';
  const sdt = (tag, alias, inner) => '<w:sdt>' + sdtPr(tag, alias) + '<w:sdtContent>' + inner + '</w:sdtContent></w:sdt>';

  // Tags: "akn:section;act=amend;law=GCN;loc=12;unit=3". Word allows 64 characters.
  function tagOf(name, props) {
    let t = name;
    for (const k of Object.keys(props || {})) if (props[k] != null && props[k] !== '') t += ';' + k + '=' + String(props[k]).replace(/[;=]/g, '');
    return t.slice(0, 64);
  }
  function parseTag(tag) {
    const parts = String(tag || '').split(';'), out = { name: parts[0] };
    for (const p of parts.slice(1)) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i)] = p.slice(i + 1); }
    return out;
  }

  const ACT_LABEL = { amend: 'Amend', add: 'Add', repeal: 'Repeal', new: 'New matter', shortTitle: 'Short title', findings: 'Findings', severability: 'Severability', effective: 'Effective date' };
  // A bill section. s = {act, law, loc, unit, num, heading, clause, content: [runs] (first paragraph's text),
  //                      more: [[runs]…] (more paragraphs), quoted: [[runs]…]}
  function sectionXml(s) {
    const props = { act: s.act, law: s.law, loc: s.loc, unit: s.unit };
    const alias = (s.num || '') + ' ' + (ACT_LABEL[s.act] || 'Section') + (s.law ? ' ' + s.law + ' ' + BD.secId(s.loc) + (s.unit ? '(' + s.unit + ')' : '') : '');
    let first = sdt('akn:num', 'Number', run(s.num || '§ __.', 'num')) + run(' ', '');
    if (s.heading) first += sdt('akn:heading', 'Heading', run(s.heading, 'heading')) + run(' ', '');
    if (s.clause != null) first += sdt('akn:mod', 'Amending clause', run(s.clause, ''));
    first += runs(s.content || []);
    let inner = para('BillSection', first);
    for (const p of s.more || []) inner += para('BillSection', runs(p));
    if (s.quoted) inner += sdt(tagOf('akn:quoted', { law: s.law, loc: s.loc, unit: s.unit }), 'Text of the law', s.quoted.map(p => para('BillQuoted', runs(p))).join('') || para('BillQuoted', ''));
    return sdt(tagOf('akn:section', props), alias.trim(), inner);
  }
  const quotedInner = paras => paras.map(p => para('BillQuoted', runs(p))).join('');
  function titleXml(t) {
    return sdt('akn:longTitle', 'Title', para('BillTitle', run(t.before, '') + sdt('akn:subject', 'Subject (in relation to …)', run(t.subject, '')) + run(t.after, '')));
  }
  const enactingXml = () => sdt('akn:enactingFormula', 'Enacting clause', para('BillEnacting', run(BD.ENACTING, '')));

  // A flat OPC package for insertOoxml: the body plus our styles.
  function pkg(bodyInner) {
    return '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">' +
      '<pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData></pkg:part>' +
      '<pkg:part pkg:name="/word/_rels/document.xml.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships></pkg:xmlData></pkg:part>' +
      '<pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"><pkg:xmlData><w:document xmlns:w="' + W + '"><w:body>' + bodyInner + '</w:body></w:document></pkg:xmlData></pkg:part>' +
      '<pkg:part pkg:name="/word/styles.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"><pkg:xmlData>' + stylesXml() + '</pkg:xmlData></pkg:part>' +
      '</pkg:package>';
  }

  /* ---------- reading ---------- */
  const kids = n => { const out = []; for (let c = n && n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c); return out; };
  const ln = n => n.localName || String(n.nodeName).replace(/^.*:/, '');
  const attr = (n, name) => n.getAttributeNS ? (n.getAttributeNS(W, name) || n.getAttribute('w:' + name)) : n.getAttribute('w:' + name);
  const child = (n, name) => kids(n).find(c => ln(c) === name);

  // The w:body of document XML, a flat OPC package, or a w:document.
  function bodyOf(doc) {
    const all = doc.getElementsByTagNameNS ? doc.getElementsByTagNameNS(W, 'body') : doc.getElementsByTagName('w:body');
    return all && all[0];
  }
  function sdtInfo(n) {
    const pr = child(n, 'sdtPr'), tag = pr && child(pr, 'tag'), alias = pr && child(pr, 'alias');
    return { tag: tag ? attr(tag, 'val') : '', alias: alias ? attr(alias, 'val') : '', content: child(n, 'sdtContent') };
  }
  // A run's text and kind ('' plain, ins, del, num, heading); Word's own tracked changes count too.
  function runOf(r, ctx) {
    const pr = child(r, 'rPr');
    let k = '';
    if (pr) {
      const st = child(pr, 'rStyle'), u = child(pr, 'u'), strike = child(pr, 'strike');
      if (st && STYLE_KIND[attr(st, 'val')]) k = STYLE_KIND[attr(st, 'val')];
      else if (u && attr(u, 'val') !== 'none') k = 'ins';
      else if (strike && attr(strike, 'val') !== '0' && attr(strike, 'val') !== 'false') k = 'del';
    }
    if (ctx.rev) k = ctx.rev;
    let t = '';
    for (const c of kids(r)) {
      const n = ln(c);
      if (n === 't' || n === 'delText') t += c.textContent;
      else if (n === 'tab') t += '\t';
      else if (n === 'br' || n === 'cr') t += '\n';
      else if (n === 'noBreakHyphen') t += '-';
    }
    return { t, k, cc: ctx.cc || '', rev: !!ctx.rev };
  }
  // Runs of a paragraph (or of an inline content control), with the inline control they sit in.
  function runsIn(n, ctx, out) {
    for (const c of kids(n)) {
      const name = ln(c);
      if (name === 'r') { const r = runOf(c, ctx); if (r.t) out.push(r); }
      else if (name === 'sdt') { const s = sdtInfo(c); if (s.content) runsIn(s.content, { ...ctx, cc: BD.parseTag(s.tag).name || ctx.cc }, out); }
      else if (name === 'ins' || name === 'moveTo') runsIn(c, { ...ctx, rev: 'ins' }, out);
      else if (name === 'del' || name === 'moveFrom') runsIn(c, { ...ctx, rev: 'del' }, out);
      else if (name === 'hyperlink' || name === 'smartTag' || name === 'fldSimple' || name === 'customXml') runsIn(c, ctx, out);
    }
    // Merge neighbours of the same kind.
    const m = [];
    for (const r of out) { const l = m[m.length - 1]; if (l && l.k === r.k && l.cc === r.cc && l.rev === r.rev) l.t += r.t; else m.push({ ...r }); }
    out.length = 0; out.push(...m); return out;
  }
  // Paragraphs inside a block: [{runs, style, el}], and nested block controls in order.
  function blocksIn(n) {
    const out = [];
    for (const c of kids(n)) {
      const name = ln(c);
      if (name === 'p') {
        const pPr = child(c, 'pPr'), ps = pPr && child(pPr, 'pStyle');
        out.push({ type: 'p', style: ps ? attr(ps, 'val') : '', runs: runsIn(c, {}, []) });
      } else if (name === 'sdt') {
        const s = sdtInfo(c);
        if (!s.content) continue;
        // An inline control at block level can't happen; a block one holds paragraphs.
        out.push({ type: 'cc', tag: BD.parseTag(s.tag), alias: s.alias, blocks: blocksIn(s.content) });
      } else if (name === 'tbl') {
        out.push({ type: 'p', style: 'table', runs: [{ t: c.textContent, k: '', cc: '' }] });
      }
    }
    return out;
  }
  const textOf = rs => rs.map(r => r.t).join('');

  // The bill model from WordprocessingML (a string or a parsed Document).
  //   {title: {text, subject} | null, enacting: {text} | null, sections: [...], loose: [paragraph texts outside any control]}
  function readBill(xml, DOMParserImpl) {
    const doc = typeof xml === 'string' ? new (DOMParserImpl || root.DOMParser)().parseFromString(xml, 'application/xml') : xml;
    const body = bodyOf(doc);
    if (!body) throw new Error('No document body found.');
    const model = { title: null, enacting: null, sections: [], loose: [] };
    const visit = blocks => {
      for (const b of blocks) {
        if (b.type === 'p') { const t = textOf(b.runs).trim(); if (t) model.loose.push(t); continue; }
        const name = b.tag.name;
        if (name === 'akn:longTitle') {
          const rs = b.blocks.filter(x => x.type === 'p').flatMap(x => x.runs);
          model.title = { text: textOf(rs).trim(), subject: textOf(rs.filter(r => r.cc === 'akn:subject')).trim(), runs: rs };
        } else if (name === 'akn:enactingFormula') {
          model.enacting = { text: b.blocks.filter(x => x.type === 'p').map(x => textOf(x.runs)).join(' ').trim() };
        } else if (name === 'akn:section') model.sections.push(sectionOf(b));
        else visit(b.blocks);
      }
    };
    visit(blocksIn(body));
    model.sections.forEach((s, i) => { s.index = i; });
    return model;
  }
  function sectionOf(b) {
    const s = { act: b.tag.act || 'new', law: b.tag.law || '', loc: b.tag.loc || '', unit: b.tag.unit || '', alias: b.alias, num: '', heading: '', clause: null, paras: [], quoted: null };
    let first = true;
    for (const x of b.blocks) {
      if (x.type === 'cc' && x.tag.name === 'akn:quoted') {
        s.quoted = { law: x.tag.law || s.law, loc: x.tag.loc || s.loc, unit: x.tag.unit || s.unit, paras: x.blocks.filter(y => y.type === 'p').map(y => y.runs).filter(rs => textOf(rs).trim()) };
        continue;
      }
      const ps = x.type === 'p' ? [x] : x.blocks.filter(y => y.type === 'p');
      for (const p of ps) {
        if (first) {
          first = false;
          s.num = textOf(p.runs.filter(r => r.cc === 'akn:num')).trim();
          s.heading = textOf(p.runs.filter(r => r.cc === 'akn:heading')).trim();
          const mod = p.runs.filter(r => r.cc === 'akn:mod');
          if (mod.length) s.clause = textOf(mod).trim();
          const rest = p.runs.filter(r => !r.cc);
          if (!s.num) { // a section typed without a number control: take "§ 3." from the start
            const t = textOf(rest), m = /^\s*((Section|§)\s*\d+\.)\s*/.exec(t);
            if (m) { s.num = m[1]; trimStart(rest, m[0].length); }
          }
          const r2 = rest.map(r => ({ ...r })); trimEnds(r2);
          if (r2.length) s.paras.push(r2);
        } else if (textOf(p.runs).trim()) s.paras.push(p.runs);
      }
    }
    s.text = s.paras.map(textOf).join('\n');
    return s;
  }
  function trimStart(rs, n) { while (n > 0 && rs.length) { const r = rs[0]; if (r.t.length <= n) { n -= r.t.length; rs.shift(); } else { r.t = r.t.slice(n); n = 0; } } }
  function trimEnds(rs) {
    while (rs.length && !rs[0].t.trim()) rs.shift();
    while (rs.length && !rs[rs.length - 1].t.trim()) rs.pop();
    if (rs.length) { rs[0].t = rs[0].t.replace(/^\s+/, ''); rs[rs.length - 1].t = rs[rs.length - 1].t.replace(/\s+$/, ''); }
  }

  // Every paragraph's runs in a piece of OOXML (e.g. one content control's getOoxml), controls flattened.
  function parasOf(xml, DOMParserImpl) {
    const doc = typeof xml === 'string' ? new (DOMParserImpl || root.DOMParser)().parseFromString(xml, 'application/xml') : xml;
    const body = bodyOf(doc); if (!body) return [];
    const out = [];
    const visit = bs => { for (const b of bs) { if (b.type === 'p') { if (BD.textOf(b.runs).trim()) out.push(b.runs); } else visit(b.blocks); } };
    visit(blocksIn(body));
    return out;
  }
  Object.assign(BD, { parasOf, W_NS: W, STYLES, stylesXml, run, runs, para, sdt, tagOf, parseTag, sectionXml, quotedInner, titleXml, enactingXml, pkg, readBill, textOf, esc });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
