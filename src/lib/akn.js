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
  // The amended provision inside <quotedStructure>: "§ 12. Affidavit. When …" -> section/num/heading/content.
  function quoted(q, eid, act) {
    const ps = q.paras.slice();
    const kind = q.unit ? 'subsection' : 'section';
    let num = '', heading = '';
    if (ps.length) {
      const first = ps[0].map(r => ({ ...r }));
      const t = BD.textOf(first);
      const m = q.unit ? /^\s*(\d+[-a-z]*\.)\s+/.exec(t) : /^\s*(§\s*[\w-]+\.)\s+(?:([^.]{1,120}\.)\s+)?/.exec(t);
      // Only when number (and heading) are not marked as changed, or the whole provision is new.
      if (m && (act === 'add' || !first[0].k) && first[0].t.length >= m[0].length) {
        num = m[1]; heading = m[2] || ''; first[0].t = first[0].t.slice(m[0].length); ps[0] = first;
      }
    }
    return '<quotedStructure eId="' + eid + '__qstr_1" startQuote="" endQuote="">' +
      '<' + kind + '>' +
      (num ? '<num>' + x(num) + '</num>' : '') + (heading ? '<heading>' + x(heading) + '</heading>' : '') +
      '<content>' + (ps.map(p => '<p>' + inline(p) + '</p>').join('') || '<p/>') + '</content></' + kind + '></quotedStructure>';
  }

  // info: {lbd, year, house, date, lawNames: {GCN: 'the general construction law'}}
  function toAkn(model, info) {
    info = info || {};
    const date = info.date || new Date().toISOString().slice(0, 10);
    const year = info.year || date.slice(0, 4);
    const num = String(info.lbd || 'draft').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const work = '/akn/us-ny/bill/' + year + '/' + num;
    const expr = work + '/eng@' + date;
    const mods = [];
    const used = new Set();
    let body = '';
    model.sections.forEach((s, i) => {
      const eid = 'sec_' + (i + 1), refers = REFERS[s.act] || 'newMatter'; used.add(refers);
      let content = '';
      if (s.act === 'amend' || s.act === 'add' || s.act === 'repeal') {
        const modId = eid + '__mod_1';
        const name = (info.lawNames && info.lawNames[s.law]) || '';
        let clause = x(s.clause || '');
        // Link the law's name in the clause to the law being amended.
        if (name && s.law) { const bare = x(name.replace(/^the /, '')); const k = clause.indexOf(bare); if (k >= 0) clause = clause.slice(0, k) + '<ref eId="' + modId + '__ref_1" href="' + lawUri(s.law) + '">' + bare + '</ref>' + clause.slice(k + bare.length); }
        content = '<p><mod eId="' + modId + '">' + clause + (s.quoted && s.act !== 'repeal' ? quoted(s.quoted, modId, s.act) : '') + '</mod></p>';
        mods.push({ type: s.act === 'repeal' ? 'repeal' : s.act === 'add' ? 'insertion' : 'substitution', source: modId, dest: lawUri(s.law, s.loc, s.unit) });
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
    const concept = (id, show) => '<TLCConcept eId="' + id + '" href="/ontology/concept/us-ny/' + id + '" showAs="' + show + '"/>';
    const CONCEPTS = { shortTitle: 'Short title', legislativeFindings: 'Legislative findings', severability: 'Severability clause', effectiveDate: 'Effective date', amendment: 'Amendment', repeal: 'Repeal', newMatter: 'New matter' };
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<akomaNtoso xmlns="' + AKN + '"><bill name="bill">' +
      '<meta><identification source="#drafter">' +
      '<FRBRWork><FRBRthis value="' + work + '/!main"/><FRBRuri value="' + work + '"/><FRBRdate date="' + date + '" name="draft"/><FRBRauthor href="#legislature"/><FRBRcountry value="us-ny"/>' + (info.lbd ? '<FRBRnumber value="' + x(info.lbd) + '"/>' : '') + '</FRBRWork>' +
      '<FRBRExpression><FRBRthis value="' + expr + '/!main"/><FRBRuri value="' + expr + '"/><FRBRdate date="' + date + '" name="draft"/><FRBRauthor href="#drafter"/><FRBRlanguage language="eng"/></FRBRExpression>' +
      '<FRBRManifestation><FRBRthis value="' + expr + '/!main.xml"/><FRBRuri value="' + expr + '/.akn"/><FRBRdate date="' + date + '" name="generated"/><FRBRauthor href="#drafter"/></FRBRManifestation>' +
      '</identification>' +
      (mods.length ? '<analysis source="#drafter"><activeModifications>' + mods.map((m, k) =>
        '<textualMod eId="amod_' + (k + 1) + '" type="' + m.type + '"><source href="#' + m.source + '"/><destination href="' + m.dest + '"/></textualMod>').join('') + '</activeModifications></analysis>' : '') +
      '<references source="#drafter"><TLCOrganization eId="legislature" href="/ontology/organization/us-ny/legislature" showAs="New York State Legislature"/>' +
      '<TLCPerson eId="drafter" href="/ontology/person/bill-drafter" showAs="Bill Drafter (demo)"/>' +
      [...used].map(k => concept(k, CONCEPTS[k])).join('') + concept('subject', 'Subject') + '</references></meta>' +
      '<preface>' + (info.lbd ? '<p class="lbd">LBD <docNumber>' + x(info.lbd) + '</docNumber></p>' : '') + title + '</preface>' +
      '<preamble><formula name="enactingFormula"><p>' + x(model.enacting ? model.enacting.text : BD.ENACTING) + '</p></formula></preamble>' +
      '<body>' + (body || '<section eId="sec_1"><num>Section 1.</num><content><p/></content></section>') + '</body>' +
      '</bill></akomaNtoso>\n';
  }

  Object.assign(BD, { toAkn, AKN_NS: AKN, lawUri });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
