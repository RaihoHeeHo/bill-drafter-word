/* Bill Drafter for Word (demo) - the bill model (ooxml.js readBill) as Akoma Ntoso 3.0 XML in the shape of LBDC's
   AKN-NY profile, version 0.3. The mapping is in FORMAT.md. Every part of the .docx that means something is a tagged
   content control or a Bill Insert / Bill Delete run, so the conversion needs no guessing from the layout.

   What the profile fixes, and this file follows:
   * Work /akn/us-ny/bill/2025/s1234, Expression eng@ (original print) or eng@a (A print); lbdc:documentInfo.
   * Front matter as classed paragraphs (authority, number, session, stage, date, introduction) and the long title.
   * Laws addressed by their Bank ID alone: /akn/us-ny/act/consolidated/gcn, a provision as …/gcn/~sec_12__subdvs_1.
   * The whole lead-in inside <mod>: the citation as a <ref> to the provision, the history as
     <ref class="amendmentHistory amended">, then <quotedStructure eId="…__qstr">.
   * Units named as New York names them: section, subdivision 1., paragraph (a), subparagraph (1) …; for the laws
     whose sections divide into subsections (Tax, Insurance): subsection (a), paragraph (1), subparagraph (A).
   * eIds end in the printed number; a renumbered unit takes its new number, a unit struck out whole ends "-old",
     a second unit with the same number gets the Bank's marker (34*2). */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const AKN = 'http://docs.oasis-open.org/legaldocml/ns/akn/3.0';
  const LBDC = 'urn:x-lbdc:akn:1.0';
  const PROFILE_VERSION = '0.3';
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const REFERS = { shortTitle: 'shortTitle', findings: 'legislativeFindings', severability: 'severability', effective: 'effectiveDate' };
  const CONCEPTS = {
    shortTitle: ['short-title', 'Short title'], legislativeFindings: ['legislative-findings', 'Legislative findings and intent'],
    severability: ['severability', 'Severability clause'], effectiveDate: ['effective-date', 'Effective date provision'], subject: ['subject', 'Subject of the bill'],
  };

  /* ---------- addresses ---------- */
  const SCHEME = ['sec', 'subdvs', 'para', 'subpara', 'cl', 'subcl', 'point'];
  const SCHEME_SUBSEC = ['sec', 'subsec', 'para', 'subpara', 'cl', 'subcl', 'point'];
  const TAG = { sec: 'section', subsec: 'subsection', subdvs: 'subdivision', para: 'paragraph', subpara: 'subparagraph', cl: 'clause', subcl: 'subclause', point: 'point' };
  // A printed number as it appears in an eId: "§ 12-a." -> 12-a, "(A)" -> A, "263.10" -> 263-10.
  const numId = t => String(t).replace(/^\s*(Section|§)\s*/, '').replace(/[()[\]\s]/g, '').replace(/[.:;,]+$/, '').replace(/\./g, '-');
  const lawBase = (id, info) => BD.lawBase(id, info);
  // A provision of a law: /akn/us-ny/act/consolidated/gcn/~sec_12__subdvs_1
  function provision(base, loc, unit, sub) {
    if (!loc) return base;
    return base + '/~sec_' + numId(BD.secId(loc)) + (unit ? '__' + (sub ? 'subsec' : 'subdvs') + '_' + numId(unit) : '');
  }
  // Kept for callers of the earlier version.
  const lawUri = (id, loc, unit) => provision(lawBase(id), loc, unit, BD.usesSubsections(id));

  /* ---------- inline text ---------- */
  // Bill Insert -> <ins>, Bill Delete -> <del> (its brackets are the print form, so they are left out).
  function inline(rs) {
    let out = '';
    for (const r of rs) {
      if (!r.t) continue;
      if (r.k === 'ins') {
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.t);
        out += m[2] ? m[1] + '<ins>' + x(m[2]) + '</ins>' + m[3] : x(r.t);
      } else if (r.k === 'del') {
        const t = r.t.replace(/^(\s*)\[/, '$1').replace(/\](\s*)$/, '$1');
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t);
        out += m[2] ? m[1] + '<del' + (r.g ? ' data-g="' + r.g + '"' : '') + '>' + x(m[2]) + '</del>' + m[3] : x(t);
      } else out += x(r.t);
    }
    return out.replace(/^\s+|\s+$/g, '').replace(/ {2,}/g, ' ');
  }
  const plain = rs => rs.map(r => r.t).join('');

  /* ---------- the amended text as nested units ----------
     Numbered paragraphs nest by the order in which the kinds of number first appear: § 296.  1.  (a)  (1)  (i)  (A)
     - (i) right after (h) is a letter, otherwise roman. The kinds take New York's names in that order. A short
     verbless sentence after a section's number is its heading. */
  const NUM = /^(?:(§\s*\d+[\w.-]*\.)|(\((?:[0-9]+(?:-[a-z])?|[a-z]{1,4}(?:-\d+)?|[A-Z]{1,2})\))|((?:[0-9]+(?:-[a-z])?|[a-z])\.))(?=\s|$)/;
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
  /* The number at the start of a paragraph. A struck number keeps its bracket ("[3.]"); a renumbered one is the old
     number struck and the new one underlined ("[3.] 4."): both are the unit's number. */
  function numAt(rs) {
    const t = plain(rs);
    let m = /^\[([^\]]{1,12})\]\s+/.exec(t);
    if (m && rs[0].k === 'del' && NUM.test(m[1] + ' ')) {
      const rest = t.slice(m[0].length), m2 = NUM.exec(rest);
      const nextIns = rs.find((r, i) => i > 0 && r.t.trim());
      if (m2 && nextIns && nextIns.k === 'ins' && nextIns.t.trim().startsWith(m2[0])) return { token: m2[0], len: m[0].length + m2[0].length, old: NUM.exec(m[1] + ' ')[0] };
      return { token: NUM.exec(m[1] + ' ')[0], len: m[0].length - (m[0].length - m[0].trimEnd().length), struckOnly: true };
    }
    m = /^\[/.test(t) && rs[0].k === 'del' ? NUM.exec(t.slice(1)) : null;
    if (m) return { token: m[0], len: 1 + m[0].length };
    m = NUM.exec(t);
    return m ? { token: m[0], len: m[0].length } : null;
  }
  // "§ 296. Unlawful discriminatory practices. 1. It shall be …" is two units on one line: split it.
  function splitInline(paras) {
    const out = [];
    for (const rs of paras) {
      let cur = rs;
      for (let guard = 0; guard < 3; guard++) {
        const n = numAt(cur); if (!n) break;
        const [, rest] = splitRuns(cur, n.len), rt = plain(rest), h = HEADING.exec(rt);
        if (!h || VERB.test(h[1])) break;
        const after = rt.slice(h[0].length).replace(/^\s+/, '');
        const na = numAt(splitRuns(rest, rt.length - after.length)[1]);
        if (!na || numKind(na.token, null) === numKind(n.token, null)) break;
        const cut = plain(cur).length - after.length;
        const [a, b] = splitRuns(cur, cut); out.push(a); cur = b;
      }
      out.push(cur);
    }
    return out;
  }
  // Is every word of this unit's paragraph struck out?
  const allStruck = rs => rs.every(r => !r.t.trim() || r.k === 'del');
  function units(paras, rootEid, scheme) {
    const top = [], stack = [], used = new Set();
    let first = null;
    const ps = splitInline(paras);
    const unique = id => { if (!used.has(id)) { used.add(id); return id; } let k = 2; while (used.has(id + '*' + k)) k++; used.add(id + '*' + k); return id + '*' + k; };
    let loose = 0;
    ps.forEach((rs, i) => {
      const n = numAt(rs);
      if (!n) {
        if (stack.length) stack[stack.length - 1].node.content.push(rs);
        else top.push({ tag: 'hcontainer', eId: rootEid + '__text_' + (++loose), content: [rs], kids: [] });
        return;
      }
      const prevLetter = (stack.slice().reverse().find(l => l.kind === 'paren-letter') || {}).last || null;
      const kind = numKind(n.token, prevLetter);
      const kinds = stack.map(l => l.kind);
      if (kinds.includes(kind)) stack.splice(kinds.indexOf(kind));
      if (first == null) first = kind;
      const names = first === 'sect' ? scheme : scheme.slice(1);
      const abbr = names[Math.min(stack.length, names.length - 1)];
      const parentEid = stack.length ? stack[stack.length - 1].node.eId : rootEid;
      const struck = !n.old && rs[0].k === 'del' && allStruck(rs);
      const node = { tag: TAG[abbr], abbr, eId: unique(parentEid + '__' + abbr + '_' + numId(n.token) + (struck ? '-old' : '')), num: null, heading: null, content: [], kids: [] };
      const [numRuns, rest] = splitRuns(rs, n.len); node.num = numRuns;
      // A heading: on a section, a short verbless sentence before the text; on other units, a short sentence
      // standing alone with a deeper unit after it.
      const rt = plain(rest), h = HEADING.exec(rt);
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
  const ps = content => content.map(p => '<p>' + inline(p) + '</p>').join('');
  function unitXml(u) {
    if (u.tag === 'hcontainer') return '<hcontainer name="text" eId="' + u.eId + '"><content>' + ps(u.content) + '</content></hcontainer>';
    let out = '<' + u.tag + ' eId="' + x(u.eId) + '"><num>' + inline(u.num) + '</num>' + (u.heading ? '<heading>' + inline(u.heading) + '</heading>' : '');
    if (u.kids.length) {
      // Text before the first child unit is the intro.
      if (u.content.length) out += '<intro eId="' + x(u.eId) + '__intro">' + ps(u.content) + '</intro>';
      out += u.kids.map(unitXml).join('');
    } else out += '<content>' + (ps(u.content) || '<p/>') + '</content>';
    return out + '</' + u.tag + '>';
  }
  /* One printed pair of brackets can run on from a unit's number into its text, or from one unit into the next.
     Each continuous stretch of old matter is one pair: typed brackets open and close it; a tracked deletion (no
     brackets) runs until the next words that are not struck. A pair that ends up in more than one element is split
     into pieces marked spanStart, spanMiddle and spanEnd, so the template prints one "[" and one "]". */
  function groupDeletions(paras) {
    let g = 0, open = false;
    return paras.map(rs => rs.map(r0 => {
      const r = { ...r0 };
      if (r.k === 'del' && r.t.trim()) {
        const opens = /^\s*\[/.test(r.t), closes = /\]\s*$/.test(r.t);
        if (!open || opens) g++;
        r.g = g; open = opens || /[[\]]/.test(r.t) ? !closes : true;
      } else if (r.t.trim()) open = false;
      return r;
    }));
  }
  function spans(xml) {
    const count = {}, seen = {};
    xml.replace(/<del data-g="(\d+)">/g, (m, g) => { count[g] = (count[g] || 0) + 1; return m; });
    return xml.replace(/<del data-g="(\d+)">/g, (m, g) => {
      seen[g] = (seen[g] || 0) + 1;
      if (count[g] === 1) return '<del>';
      return '<del class="' + (seen[g] === 1 ? 'spanStart' : seen[g] === count[g] ? 'spanEnd' : 'spanMiddle') + '">';
    });
  }
  function quoted(q, modEid, sub) {
    const eid = modEid + '__qstr', us = units(groupDeletions(q.paras), eid, sub ? SCHEME_SUBSEC : SCHEME);
    return '<quotedStructure eId="' + eid + '">' + (spans(us.map(unitXml).join('')) || '<hcontainer name="text" eId="' + eid + '__text_1"><content><p/></content></hcontainer>') + '</quotedStructure>';
  }

  /* ---------- the lead-in ---------- */
  // "as added by chapter 3 of the laws of 1990 and amended by chapter 5 of the laws of 2001": each act cited, linked
  // with what it did. (In deployment the history comes from LBDC's own records, not the Bank.)
  function history(t) {
    let out = '', pos = 0, kind = 'amended';
    const re = /\b(added|amended|renumbered|relettered|redesignated) by\b|\bchapter (\d+) of the laws of (\d{4})\b/g;
    let m;
    while ((m = re.exec(t))) {
      if (m[1]) { kind = /^re(lettered|designated)|^renumbered/.test(m[1]) ? 'renumbered' : m[1]; continue; }
      out += x(t.slice(pos, m.index)) + '<ref class="amendmentHistory ' + kind + '" href="/akn/us-ny/act/' + m[3] + '/' + m[2] + '">' + x(m[0]) + '</ref>';
      pos = m.index + m[0].length;
    }
    return out + x(t.slice(pos));
  }
  // The clause's citation ends with the law's name: "Subdivision 1 of section 296 of the executive law".
  function leadIn(clause, name, href) {
    const bare = String(name || '').replace(/^the /, '');
    let end = -1;
    if (bare) { const k = clause.toLowerCase().indexOf(bare.toLowerCase()); if (k >= 0) end = k + bare.length; }
    if (end < 0) { const m = /,? (?:as (?:added|amended|renumbered)|is |are )/.exec(clause); end = m ? m.index : clause.length; }
    const action = clause.slice(end), v = /\b(is|are) (amended|REPEALED)\b/.exec(action);
    const hist = v ? action.slice(0, v.index) : '', rest = v ? action.slice(v.index) : action;
    return '<ref href="' + href + '">' + x(clause.slice(0, end)) + '</ref>' + history(hist) + x(rest);
  }

  /* ---------- effective dates ---------- */
  function effectiveClass(t) {
    const c = [];
    if (/take effect immediately/.test(t)) c.push('immediate');
    if (/day after it shall have become a law|years? after it shall have become a law/.test(t)) c.push('daysAfter');
    if (/next succeeding the date/.test(t)) c.push('nextSucceeding');
    if (/take effect on (January|February|March|April|May|June|July|August|September|October|November|December|____) /.test(t)) c.push('dateCertain');
    if (/deemed to have been in full force and effect/.test(t)) c.push('retroactive');
    if (/expire and be deemed repealed/.test(t)) c.push('sunset');
    if (/rule or regulation necessary for the implementation/.test(t)) c.push('regulations');
    if (/shall apply to/.test(t)) c.push('applicability');
    return c.join(' ');
  }

  /* ---------- the document ---------- */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const longDate = d => { const [y, m, day] = d.split('-').map(Number); return MONTHS[m - 1] + ' ' + day + ', ' + y; };
  const slugName = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /* info: {lbd, year, house: 'senate'|'assembly', billNumber ('1234', '1234-A' or '1234A' for the A print), sponsor
     ('SMITH' or 'SMITH, JONES'), committee, date (of introduction), amended (date of this print), lawNames: {GCN: 'the
     general construction law'}, laws: {GCN: Bank law info}}.
     Without a bill number the document is a draft (profile 0.3's draft form): the bill is addressed by its LBD route
     number (/akn/us-ny/bill/2025/lbd12345), each LBD version is an Expression (eng@01), and the bill number and
     introduction date are left blank until a house introduces it. */
  function toAkn(model, info) {
    info = info || {};
    const date = info.date || new Date().toISOString().slice(0, 10);
    const year = +(info.year || date.slice(0, 4));
    const start = year % 2 ? year : year - 1, session = start + '-' + (start + 1);
    const house = /^a/i.test(info.house || '') ? 'assembly' : 'senate', H = house === 'assembly' ? 'A' : 'S';
    const bn = /^\s*[SA]?\.?\s*(\d+)\s*(?:-{1,2}\s*)?([A-Z])?\s*$/i.exec(String(info.billNumber || ''));
    const digits = bn ? String(+bn[1]) : '', letter = bn && bn[2] ? bn[2].toUpperCase() : '';
    const lbd = String(info.lbd || '').trim().replace(/^LBD/i, '');
    const route = (/^(\d{5})-/.exec(lbd) || [])[1] || slugName(lbd) || 'draft';
    const work = '/akn/us-ny/bill/' + start + '/' + (digits ? H.toLowerCase() + digits : 'lbd' + route);
    const lbdVer = (/^\d{5}-(\d{2})-\d$/.exec(lbd) || [])[1] || '01';
    const expr = work + '/eng@' + (digits ? letter.toLowerCase() : lbdVer);
    const exprDate = letter ? (info.amended || new Date().toISOString().slice(0, 10)) : date;
    const mods = [], used = new Set(), names = info.lawNames || {}, laws = info.laws || {};
    let body = '';
    model.sections.forEach((s, i) => {
      const eid = 'sec_' + (i + 1), refers = REFERS[s.act];
      if (refers) used.add(refers);
      let content = '', cls = '';
      if ((s.act === 'amend' || s.act === 'add' || s.act === 'repeal') && s.law) {
        const modId = eid + '__mod_1', sub = BD.usesSubsections(s.law), base = lawBase(s.law, laws[s.law]);
        const dest = provision(base, s.loc, s.unit, sub);
        // An addition cites the law (or the section a subdivision is added to); an amendment or repeal the provision.
        const cite = s.act === 'add' ? (s.unit && /^(Section|Subsection|Subdivision)/.test(s.clause || '') ? provision(base, s.loc, null, sub) : base) : dest;
        const lead = leadIn(s.clause || '', names[s.law], cite);
        if (s.act === 'repeal' || !s.quoted) content = '<p><mod eId="' + modId + '">' + lead + '</mod></p>';
        else content = '<p><mod eId="' + modId + '">' + lead + quoted(s.quoted, modId, sub) + '</mod></p>';
        mods.push({ type: s.act === 'repeal' ? 'repeal' : s.act === 'add' ? 'insertion' : 'substitution', source: modId, dest });
        for (const p of s.paras) content += '<p>' + inline(p.map(r => ({ t: r.t, k: '' }))) + '</p>';
      } else {
        // Outside quoted text there is no new or old matter: the bill's own words are plain.
        content = s.paras.map(p => '<p>' + inline(p.map(r => ({ t: r.t, k: '' }))) + '</p>').join('') || '<p/>';
        if (s.act === 'effective') cls = effectiveClass(s.paras.map(plain).join(' '));
      }
      body += '<section eId="' + eid + '"' + (cls ? ' class="' + cls + '"' : '') + (refers ? ' refersTo="#' + refers + '"' : '') + '><num>' + x(BD.sectionNum(i)) + '</num>' +
        (s.heading ? '<heading>' + x(s.heading) + '</heading>' : '') + '<content>' + content + '</content></section>';
    });
    let hasSubject = false;
    const title = model.title ? (() => {
      const rs = model.title.runs || [{ t: model.title.text, k: '' }];
      let t = ''; for (const r of rs) if (r.cc === 'akn:subject') { hasSubject = true; t += '<span refersTo="#subject">' + x(r.t) + '</span>'; } else t += x(r.t);
      return '<longTitle><p>' + t.trim() + '</p></longTitle>';
    })() : '<longTitle><p>AN ACT</p></longTitle>';
    if (hasSubject) used.add('subject');
    // Sponsors and committee
    const sponsors = String(info.sponsor || '').split(/\s*,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean);
    const people = sponsors.map(n => ({ id: slugName(n) || 'sponsor', name: n }));
    const committee = String(info.committee || '').trim();
    const cid = committee ? house + '-' + slugName(committee) : '';
    const proponents = people.map(p => '<docProponent refersTo="#' + p.id + '">' + x(p.name.toUpperCase()) + '</docProponent>').join(', ');
    const comm = committee ? '<docCommittee refersTo="#' + cid + '">' + x(committee) + '</docCommittee>' : '____';
    const intro = people.length ? '<p class="introduction">' + (house === 'assembly'
      ? 'Introduced by M. of A. ' + proponents + ' -- read once and referred to the Committee on ' + comm
      : 'Introduced by Sen' + (people.length > 1 ? 's' : '') + '. ' + proponents + ' -- read twice and ordered printed, and when printed to be committed to the Committee on ' + comm) + '</p>' : '';
    const ont = (kind, id, path, show) => '<TLC' + kind + ' eId="' + x(id) + '" href="/akn/ontology/' + path + '" showAs="' + x(show) + '"/>';
    const refs = [
      ont('Organization', 'lbdc', 'organization/us-ny/lbdc', 'Legislative Bill Drafting Commission'),
      ont('Organization', house, 'organization/us-ny/' + house, house === 'senate' ? 'Senate' : 'Assembly'),
      ...people.map(p => ont('Person', p.id, 'person/us-ny/' + house + '.member.' + p.id, p.name)),
      ...(cid ? [ont('Organization', cid, 'organization/us-ny/' + house + '.committee.' + slugName(committee), (house === 'senate' ? 'Senate' : 'Assembly') + ' Committee on ' + committee)] : []),
      ...[...used].map(k => ont('Concept', k, 'concept/us-ny/' + CONCEPTS[k][0], CONCEPTS[k][1])),
    ];
    const printNo = digits ? H + digits + letter : '';
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<akomaNtoso xmlns="' + AKN + '" xmlns:lbdc="' + LBDC + '"><bill name="bill">' +
      '<meta><identification source="#lbdc">' +
      '<FRBRWork><FRBRthis value="' + work + '/!main"/><FRBRuri value="' + work + '"/><FRBRdate date="' + date + '" name="' + (digits ? 'introduced' : 'drafted') + '"/><FRBRauthor href="#' + house + '"/><FRBRcountry value="us-ny"/>' + (digits ? '<FRBRnumber value="' + H + digits + '"/>' : '') + '</FRBRWork>' +
      '<FRBRExpression><FRBRthis value="' + expr + '/!main"/><FRBRuri value="' + expr + '"/><FRBRdate date="' + exprDate + '" name="' + (letter ? 'amended' : digits ? 'introduced' : 'drafted') + '"/><FRBRauthor href="#' + (digits ? house : 'lbdc') + '"/>' + (letter ? '<FRBRversionNumber value="' + letter + '"/>' : digits ? '' : '<FRBRversionNumber value="' + lbdVer + '"/>') + '<FRBRlanguage language="eng"/></FRBRExpression>' +
      '<FRBRManifestation><FRBRthis value="' + expr + '/!main.xml"/><FRBRuri value="' + expr + '.akn"/><FRBRdate date="' + new Date().toISOString().slice(0, 10) + '" name="markup"/><FRBRauthor href="#lbdc"/></FRBRManifestation>' +
      '</identification>' +
      (mods.length ? '<analysis source="#lbdc"><activeModifications>' + mods.map((m, k) =>
        '<textualMod eId="amod_' + (k + 1) + '" type="' + m.type + '"><source href="#' + m.source + '"/><destination href="' + m.dest + '"/></textualMod>').join('') + '</activeModifications></analysis>' : '') +
      '<references source="#lbdc">' + refs.join('') + '</references>' +
      '<proprietary source="#lbdc"><lbdc:documentInfo><lbdc:profile name="AKN-NY" version="' + PROFILE_VERSION + '"/><lbdc:house>' + house + '</lbdc:house><lbdc:session>' + session + '</lbdc:session>' +
      (printNo ? '<lbdc:printNumber>' + printNo + '</lbdc:printNumber>' : '') + (lbd ? '<lbdc:lbdNumber>LBD' + x(lbd) + '</lbdc:lbdNumber>' : '') + '</lbdc:documentInfo></proprietary></meta>' +
      '<preface><p class="authority"><docAuthority>STATE OF NEW YORK</docAuthority></p>' +
      '<p class="number"><docNumber>' + (digits ? digits + (letter ? '--' + letter : '') : '') + '</docNumber></p>' +
      '<p class="session"><session value="' + session + '">' + session + ' Regular Sessions</session></p>' +
      '<p class="stage"><docStage>IN ' + house.toUpperCase() + '</docStage></p>' +
      (digits ? '<p class="date"><docDate date="' + date + '">' + longDate(date) + '</docDate></p>' : '') + intro + title + '</preface>' +
      '<preamble><formula name="enactingFormula"><p>' + x(model.enacting ? model.enacting.text : BD.ENACTING) + '</p></formula></preamble>' +
      '<body>' + (body || '<section eId="sec_1"><num>Section 1.</num><content><p/></content></section>') + '</body>' +
      '</bill></akomaNtoso>\n';
  }

  Object.assign(BD, { toAkn, AKN_NS: AKN, LBDC_NS: LBDC, PROFILE_VERSION, lawUri, provision, effectiveClass });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
