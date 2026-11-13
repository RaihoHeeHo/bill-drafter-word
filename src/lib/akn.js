/* Bill Drafter for Word (demo) - the bill model (ooxml.js readBill) as Akoma Ntoso 3.0 XML.
   The mapping is in FORMAT.md. Every part of the .docx that means something is a tagged content control or a
   Bill Insert / Bill Delete run, so the conversion needs no guessing from the layout. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const AKN = 'http://docs.oasis-open.org/legaldocml/ns/akn/3.0';
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const REFERS = { shortTitle: 'shortTitle', findings: 'legislativeFindings', severability: 'severability', effective: 'effectiveDate', amend: 'amendment', add: 'amendment', repeal: 'repeal', new: 'newMatter' };
  const lawSlug = id => String(id || '').toLowerCase();
  // The law's work URI: consolidated laws by their three-letter id, e.g. /akn/us-ny/act/consolidated/gcn/!main
  const lawUri = (id, loc, unit) => '/akn/us-ny/act/consolidated/' + lawSlug(id) + '/!main' + (loc ? '#sec_' + BD.secId(loc).replace(/[^a-z0-9-]/g, '') + (unit ? '__subsec_' + String(unit).toLowerCase() : '') : '');

  // Inline runs: Bill Insert -> <ins>, Bill Delete -> <del> (its brackets are the print form, so they are left out).
  function inline(rs) {
    let out = '';
    for (const r of rs) {
      if (!r.t) continue;
      if (r.k === 'ins') out += '<ins>' + x(r.t) + '</ins>';
      else if (r.k === 'del') { const t = r.t.replace(/^(\s*)\[/, '$1').replace(/\](\s*)$/, '$1'); if (t.trim()) out += '<del>' + x(t) + '</del>'; else out += x(t); }
      else out += x(r.t);
    }
    return out.replace(/^\s+|\s+$/g, '');
  }
  /* ---------- the amended text as nested units ----------
     Numbered paragraphs become section / subsection / paragraph / subparagraph / clause …, nested by the order
     in which the kinds of number first appear: § 296.  1.  (a)  (1)  (i)  (A)  a.  - (i) right after (h) is a
     letter, otherwise roman. Same rules as LBDC's clean-copy demo converter (docx2akn.py), so both produce the
     same shapes. A short sentence after the number is the unit's heading. */
  const NUM = /^(?:(§\s*\d+[\w-]*\.)|(\((?:[0-9]+(?:-[a-z])?|[a-z]{1,4}|[A-Z]{1,2})\))|((?:[0-9]+(?:-[a-z])?|[a-z])\.))(?=\s|$)/;
  const LEVEL_TAGS = ['section', 'subsection', 'paragraph', 'subparagraph', 'clause', 'subclause', 'item', 'subitem'];
  const EID_PREFIX = { section: 'sec', subsection: 'subsec', paragraph: 'para', subparagraph: 'subpara', clause: 'clause', subclause: 'subclause', item: 'item', subitem: 'subitem' };
  const HEADING = /^([A-Z][^.:;]{0,150}?\.)(?=\s|$)/;
  const VERB = /\b(shall|may|must|is|are|was|were|will|be|has|have)\b/i;
  function numKind(token, prevLetter) {
    if (token.startsWith('§')) return 'sect';
    if (token.startsWith('(')) {
      const inner = token.slice(1, -1);
      if (/^\d+(-[a-z])?$/.test(inner)) return 'paren-digit';
      if (inner === inner.toUpperCase()) return 'paren-upper';
      if (/^[ivxlc]+$/.test(inner)) return inner.length === 1 && prevLetter && inner.charCodeAt(0) === prevLetter.charCodeAt(0) + 1 ? 'paren-letter' : 'paren-roman';
      return 'paren-letter';
    }
    return /^\d/.test(token) ? 'dot-digit' : 'dot-letter';
  }
  const slug = t => t.replace(/§/g, '').replace(/[^0-9A-Za-z-]/g, '').toLowerCase() || 'x';
  function splitRuns(rs, n) {
    const L = [], R = [];
    for (const r of rs) {
      if (n <= 0) { R.push({ ...r }); continue; }
      if (r.t.length <= n) { L.push({ ...r }); n -= r.t.length; }
      else { L.push({ ...r, t: r.t.slice(0, n) }); R.push({ ...r, t: r.t.slice(n) }); n = 0; }
    }
    while (R.length && !R[0].t.trim()) R.shift();
    if (R.length) R[0].t = R[0].t.replace(/^\s+/, '');
    return [L, R];
  }
  // The number at the start of a paragraph (a deleted number keeps its opening bracket outside the match).
  function numAt(rs) {
    const t = BD.textOf(rs), off = /^\[/.test(t) && rs[0].k === 'del' ? 1 : 0, m = NUM.exec(t.slice(off));
    return m ? { token: m[0], len: off + m[0].length } : null;
  }
  // "§ 296. Unlawful discriminatory practices. 1. It shall be …" is two units on one line: split it.
  function splitInline(paras) {
    const out = [];
    for (const rs of paras) {
      let cur = rs;
      for (let guard = 0; guard < 3; guard++) {
        const n = numAt(cur); if (!n) break;
        const [, rest] = splitRuns(cur, n.len), rt = BD.textOf(rest), h = HEADING.exec(rt);
        if (!h || VERB.test(h[1])) break;
        const after = rt.slice(h[0].length).replace(/^\s+/, '');
        if (!NUM.test(after) || numKind(NUM.exec(after)[0], null) === numKind(n.token, null)) break;
        const cut = BD.textOf(cur).length - after.length;
        const [a, b] = splitRuns(cur, cut); out.push(a); cur = b;
      }
      out.push(cur);
    }
    return out;
  }
  function units(paras, rootEid) {
    const top = [], stack = [];
    let first = null;
    const ps = splitInline(paras);
    ps.forEach((rs, i) => {
      const n = numAt(rs);
      if (!n) {
        if (stack.length) stack[stack.length - 1].node.content.push(rs);
        else top.push({ tag: 'hcontainer', content: [rs], kids: [] });
        return;
      }
      const prevLetter = (stack.slice().reverse().find(l => l.kind === 'paren-letter') || {}).last || null;
      const kind = numKind(n.token, prevLetter);
      const kinds = stack.map(l => l.kind);
      if (kinds.includes(kind)) stack.splice(kinds.indexOf(kind));
      if (first == null || !stack.length && !top.some(u => u.tag !== 'hcontainer')) first = first || kind;
      const tags = first === 'sect' ? LEVEL_TAGS : LEVEL_TAGS.slice(1);
      const tag = tags[Math.min(stack.length, tags.length - 1)];
      const parentEid = stack.length ? stack[stack.length - 1].node.eId : rootEid;
      const node = { tag, eId: parentEid + '__' + EID_PREFIX[tag] + '_' + slug(n.token), num: null, heading: null, content: [], kids: [] };
      const [numRuns, rest] = splitRuns(rs, n.len); node.num = numRuns;
      // A heading: on a section, a short verbless sentence before the text; on other units, a short sentence
      // standing alone with a deeper unit after it.
      const rt = BD.textOf(rest), h = HEADING.exec(rt);
      const nxt = ps[i + 1] && numAt(ps[i + 1]);
      const childNext = nxt && !stack.map(l => l.kind).concat([kind]).includes(numKind(nxt.token, kind === 'paren-letter' ? n.token.replace(/[().]/g, '') : prevLetter));
      if (h && !VERB.test(h[1]) && (kind === 'sect' ? true : childNext && h[0].length === rt.trim().length)) {
        const [hd, more] = splitRuns(rest, h[1].length); node.heading = hd; if (more.length) node.content.push(more);
      } else if (rest.length) node.content.push(rest);
      (stack.length ? stack[stack.length - 1].node.kids : top).push(node);
      stack.push({ kind, node, last: n.token.replace(/[().§\s]/g, '').toLowerCase() });
    });
    return top;
  }
  function unitXml(u) {
    if (u.tag === 'hcontainer') return '<hcontainer name="text"><content>' + u.content.map(p => '<p>' + inline(p) + '</p>').join('') + '</content></hcontainer>';
    let out = '<' + u.tag + ' eId="' + u.eId + '"><num>' + inline(u.num) + '</num>' + (u.heading ? '<heading>' + inline(u.heading) + '</heading>' : '');
    if (u.kids.length) {
      // Text before the first child unit is the intro; text after the children would be a wrap-up.
      if (u.content.length) out += '<intro>' + u.content.map(p => '<p>' + inline(p) + '</p>').join('') + '</intro>';
      out += u.kids.map(unitXml).join('');
    } else out += '<content>' + (u.content.map(p => '<p>' + inline(p) + '</p>').join('') || '<p/>') + '</content>';
    return out + '</' + u.tag + '>';
  }
  function quoted(q, eid) {
    const us = units(q.paras, eid);
    return '<quotedStructure eId="' + eid + '__qstr_1">' + (us.map(unitXml).join('') || '<hcontainer name="text"><content><p/></content></hcontainer>') + '</quotedStructure>';
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const longDate = d => { const [y, m, day] = d.split('-').map(Number); return MONTHS[m - 1] + ' ' + day + ', ' + y; };

  // info: {lbd, year, house: 'senate'|'assembly', billNumber, sponsor, committee, date, lawNames: {GCN: 'the general construction law'}}
  // The preface and the <proprietary> block follow LBDC's clean-copy demo (bill.typ reads them for the clean copy).
  function toAkn(model, info) {
    info = info || {};
    const date = info.date || new Date().toISOString().slice(0, 10);
    const year = +(info.year || date.slice(0, 4));
    const house = /^a/i.test(info.house || '') ? 'assembly' : 'senate';
    const billNo = String(info.billNumber || '').replace(/[^0-9A-Za-z-]/g, '');
    const lbd = String(info.lbd || '').trim();
    const work = '/akn/us-ny/bill/' + year + '/' + (billNo ? (house === 'assembly' ? 'A' : 'S') + billNo : 'lbd-' + (lbd.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'draft'));
    const expr = work + '/eng@' + date;
    const mods = [], used = new Set();
    let body = '';
    model.sections.forEach((s, i) => {
      const eid = 'sec_' + (i + 1), refers = REFERS[s.act] || 'newMatter'; used.add(refers);
      let content = '';
      if (s.act === 'amend' || s.act === 'add' || s.act === 'repeal') {
        const modId = eid + '__mod_1';
        const name = (info.lawNames && info.lawNames[s.law]) || '';
        let clause = x(s.clause || '');
        // The law's name in the clause links to the law being amended.
        if (name && s.law) { const bare = x(name.replace(/^the /, '')); const k = clause.indexOf(bare); if (k >= 0) clause = clause.slice(0, k) + '<ref eId="' + eid + '__ref_1" href="' + lawUri(s.law, s.loc, s.unit) + '">' + bare + '</ref>' + clause.slice(k + bare.length); }
        // The lead-in stays in the paragraph; <mod> holds the amended text (as in LBDC's demo XML).
        if (s.act === 'repeal' || !s.quoted) content = '<p>' + clause + '</p>';
        else content = '<p>' + clause + ' <mod eId="' + modId + '">' + quoted(s.quoted, modId) + '</mod></p>';
        mods.push({ type: s.act === 'repeal' ? 'repeal' : s.act === 'add' ? 'insertion' : 'substitution', source: s.act === 'repeal' || !s.quoted ? eid : modId, dest: lawUri(s.law, s.loc, s.unit) });
        for (const p of s.paras) content += '<p>' + inline(p) + '</p>';
      } else {
        content = s.paras.map(p => '<p>' + inline(p) + '</p>').join('') || '<p/>';
      }
      body += '<section eId="' + eid + '" refersTo="#' + refers + '"><num>' + x(s.num || BD.sectionNum(i)) + '</num>' +
        (s.heading ? '<heading>' + x(s.heading) + '</heading>' : '') + '<content>' + content + '</content></section>';
    });
    const title = model.title ? (() => {
      const rs = model.title.runs || [{ t: model.title.text, k: '' }];
      let t = ''; for (const r of rs) t += r.cc === 'akn:subject' ? '<span refersTo="#subject">' + x(r.t) + '</span>' : x(r.t);
      return '<longTitle><p>' + t.trim() + '</p></longTitle>';
    })() : '<longTitle><p/></longTitle>';
    const start = year % 2 ? year : year - 1;
    const intro = info.sponsor ? '<p class="introduction">' + (house === 'assembly'
      ? 'Introduced by M. of A. <docProponent>' + x(info.sponsor) + '</docProponent> -- read once and referred to the Committee on <docCommittee>' + x(info.committee || '____') + '</docCommittee>'
      : 'Introduced by Sen. <docProponent>' + x(info.sponsor) + '</docProponent> -- read twice and ordered printed, and when printed to be committed to the Committee on <docCommittee>' + x(info.committee || '____') + '</docCommittee>') + '</p>' : '';
    const concept = (id, show) => '<TLCConcept eId="' + id + '" href="/ontology/concept/us-ny/' + id + '" showAs="' + show + '"/>';
    const CONCEPTS = { shortTitle: 'Short title', legislativeFindings: 'Legislative findings', severability: 'Severability clause', effectiveDate: 'Effective date', amendment: 'Amendment', repeal: 'Repeal', newMatter: 'New matter' };
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<akomaNtoso xmlns="' + AKN + '" xmlns:lbdc="urn:x-lbdc:clean-copy"><bill name="bill">' +
      '<meta><identification source="#drafter">' +
      '<FRBRWork><FRBRthis value="' + work + '/!main"/><FRBRuri value="' + work + '"/><FRBRdate date="' + date + '" name="draft"/><FRBRauthor href="#' + house + '"/><FRBRcountry value="us-ny"/>' + (billNo ? '<FRBRnumber value="' + x(billNo) + '"/>' : '') + '</FRBRWork>' +
      '<FRBRExpression><FRBRthis value="' + expr + '/!main"/><FRBRuri value="' + expr + '"/><FRBRdate date="' + date + '" name="draft"/><FRBRauthor href="#drafter"/><FRBRlanguage language="eng"/></FRBRExpression>' +
      '<FRBRManifestation><FRBRthis value="' + expr + '/!main.xml"/><FRBRuri value="' + expr + '/.akn"/><FRBRdate date="' + date + '" name="generated"/><FRBRauthor href="#drafter"/></FRBRManifestation>' +
      '</identification>' +
      (mods.length ? '<analysis source="#drafter"><activeModifications>' + mods.map((m, k) =>
        '<textualMod eId="amod_' + (k + 1) + '" type="' + m.type + '"><source href="#' + m.source + '"/><destination href="' + m.dest + '"/></textualMod>').join('') + '</activeModifications></analysis>' : '') +
      '<references source="#drafter"><TLCOrganization eId="lbdc" href="/ontology/organization/us-ny/lbdc" showAs="Legislative Bill Drafting Commission"/>' +
      '<TLCOrganization eId="senate" href="/ontology/organization/us-ny/senate" showAs="Senate"/><TLCOrganization eId="assembly" href="/ontology/organization/us-ny/assembly" showAs="Assembly"/>' +
      '<TLCPerson eId="drafter" href="/ontology/person/bill-drafter" showAs="Bill Drafter (demo)"/>' +
      [...used].map(k => concept(k, CONCEPTS[k])).join('') + concept('subject', 'Subject') + '</references>' +
      '<proprietary source="#drafter"><lbdc:house>' + house + '</lbdc:house>' + (lbd ? '<lbdc:lbdNumber>' + x(/^LBD/i.test(lbd) ? lbd : 'LBD' + lbd) + '</lbdc:lbdNumber>' : '') + '</proprietary></meta>' +
      '<preface><p><docAuthority>STATE OF NEW YORK</docAuthority></p>' +
      '<p><docNumber>' + x(billNo) + '</docNumber></p>' +
      '<p><session>' + start + '-' + (start + 1) + ' Regular Sessions</session></p>' +
      '<p><docStage>IN ' + house.toUpperCase() + '</docStage></p>' +
      '<p><docDate date="' + date + '">' + longDate(date) + '</docDate></p>' + intro + title + '</preface>' +
      '<preamble><formula name="enactingFormula"><p>' + x(model.enacting ? model.enacting.text : BD.ENACTING) + '</p></formula></preamble>' +
      '<body>' + (body || '<section eId="sec_1"><num>Section 1.</num><content><p/></content></section>') + '</body>' +
      '</bill></akomaNtoso>\n';
  }

  Object.assign(BD, { toAkn, AKN_NS: AKN, lawUri });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
