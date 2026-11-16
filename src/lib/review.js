/* Bill Drafter for Word (demo) - the review inside the Commission (AKN-NY 0.4 working copies).
   The draft goes drafter -> examiner -> proofreader -> examiner -> drafter. Each hand-off is sent by the role whose
   turn it is; examiners sign off sections, proofreaders mark them proofread; suggested changes (Word's tracked
   changes) are accepted or rejected by whoever the rules allow. What was done is kept as steps, in the document
   (a custom XML part) and in the working copy's XML (<workflow source="#lbdc-review">).
   A sign-off records the SHA-256 of its section's exclusive canonical XML (comment anchors left out), the same hash
   the profile's validate.py works out, so a sign-off can be seen to go stale when the section changes.
   Works in the browser and in Node. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const AKN = 'http://docs.oasis-open.org/legaldocml/ns/akn/3.0', LBDC = 'urn:x-lbdc:akn:1.0', XMLNS = 'http://www.w3.org/2000/xmlns/';

  const ROLES = ['drafter', 'examiner', 'proofreader'];
  const ROLE_NAME = { drafter: 'Drafter', examiner: 'Examiner', proofreader: 'Proofreader' };
  const STATUS = { drafting: 'with the drafter', examination: 'in examination', proofreading: 'in proofreading', returned: 'back with the examiner' };
  // Whose turn it is in each stage, and where they send the draft.
  const FLOW = {
    drafting: { role: 'drafter', event: 'sentToExamination', label: 'Send to examination' },
    examination: { role: 'examiner', event: 'sentToProofreading', label: 'Send to proofreading' },
    proofreading: { role: 'proofreader', event: 'returnedToExaminer', label: 'Send back to the examiner' },
    returned: { role: 'examiner', event: 'returnedToDrafter', label: 'Send back to the drafter' },
  };
  const HAND = { sentToExamination: 'examination', sentToProofreading: 'proofreading', returnedToExaminer: 'returned', returnedToDrafter: 'drafting' };
  const EVENTS = {
    sentToExamination: 'Sent to examination', sentToProofreading: 'Sent to proofreading', returnedToExaminer: 'Returned to the examiner',
    returnedToDrafter: 'Returned to the drafter', signedOff: 'Signed off', signoffWithdrawn: 'Sign-off withdrawn', proofread: 'Proofread',
    accepted: 'Suggested change accepted', rejected: 'Suggested change rejected',
  };

  // Who has the draft: the stage the last hand-off put it in.
  function statusOf(steps) { let s = 'drafting'; for (const st of steps || []) if (HAND[st.event]) s = HAND[st.event]; return s; }
  // May `me` ({name, role}) send the draft on? {ok, why, event, label}
  function handOff(steps, me) {
    const f = FLOW[statusOf(steps)];
    if (!me || !me.role) return { ok: false, why: 'Say who you are first.' };
    if (me.role !== f.role) return { ok: false, why: 'The draft is ' + STATUS[statusOf(steps)] + ': only ' + (f.role === 'examiner' ? 'an examiner' : 'the ' + f.role) + ' sends it on.', ...f };
    return { ok: true, ...f };
  }
  // May `me` accept or reject a suggestion made by someone in `authorRole`? Proofreaders never; an examiner not a drafter's.
  function mayDecide(me, authorRole) {
    if (!me || !me.role) return { ok: false, why: 'Say who you are first.' };
    if (me.role === 'proofreader') return { ok: false, why: 'Proofreaders do not accept or reject suggested changes.' };
    if (me.role === 'examiner' && authorRole === 'drafter') return { ok: false, why: 'An examiner does not accept or reject a drafter\'s suggested change.' };
    return { ok: true };
  }
  const maySignOff = me => !!me && me.role === 'examiner';
  const mayProofread = me => !!me && me.role === 'proofreader';
  // The sign-offs still standing, by section eId: the last signedOff not followed by a signoffWithdrawn.
  function signoffs(steps) {
    const out = new Map();
    for (const st of steps || []) if (st.section) { if (st.event === 'signedOff') out.set(st.section, st); else if (st.event === 'signoffWithdrawn') out.delete(st.section); }
    return out;
  }
  const proofread = steps => new Map((steps || []).filter(s => s.event === 'proofread' && s.section).map(s => [s.section, s]));
  // Everyone the steps name (who took them, and whose suggestion was decided).
  const stepPeople = steps => [...new Set((steps || []).flatMap(s => [s.by, s.suggestionBy]).filter(Boolean))];

  /* ---------- the sign-off hash ---------- */
  // Exclusive XML canonicalization (W3C exc-c14n, without comments) of an element, as lxml writes it.
  const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
  const escAttr = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
  function c14n(node, rendered) {
    if (node.nodeType === 3 || node.nodeType === 4) return escText(node.data);
    if (node.nodeType !== 1) return '';
    rendered = rendered || {};
    const attrs = [], need = new Map([[node.prefix || '', node.namespaceURI || '']]);
    for (const a of Array.from(node.attributes)) {
      if (a.namespaceURI === XMLNS || a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue;
      attrs.push(a);
      if (a.prefix && a.prefix !== 'xml') need.set(a.prefix, a.namespaceURI);
    }
    const mine = { ...rendered }, decls = [];
    for (const [p, u] of need) {
      if (p === '' && u === '' && !mine['']) continue;
      if (mine[p] !== u) { decls.push([p, u]); mine[p] = u; }
    }
    decls.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    attrs.sort((a, b) => { const na = a.namespaceURI || '', nb = b.namespaceURI || ''; if (na !== nb) return na < nb ? -1 : 1; const la = a.localName || a.name, lb = b.localName || b.name; return la < lb ? -1 : la > lb ? 1 : 0; });
    let out = '<' + node.nodeName + decls.map(([p, u]) => (p ? ' xmlns:' + p : ' xmlns') + '="' + escAttr(u) + '"').join('') + attrs.map(a => ' ' + a.name + '="' + escAttr(a.value) + '"').join('') + '>';
    for (let c = node.firstChild; c; c = c.nextSibling) out += c14n(c, mine);
    return out + '</' + node.nodeName + '>';
  }
  // The section as a sign-off records it: comment anchors taken out (a comment does not change what was signed off).
  function withoutComments(section) {
    const el = section.cloneNode(true);
    for (const span of Array.from(el.getElementsByTagNameNS(AKN, 'span'))) {
      if (!span.hasAttributeNS(LBDC, 'comment')) continue;
      span.removeAttributeNS(LBDC, 'comment');
      const left = Array.from(span.attributes).filter(a => !(a.namespaceURI === XMLNS || a.name === 'xmlns' || a.name.startsWith('xmlns:')));
      if (left.length) continue;
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.parentNode.removeChild(span);
    }
    return el;
  }
  async function sha256hex(s) {
    const subtle = root.crypto && root.crypto.subtle;
    if (subtle) { const d = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(s))); return Array.from(d, b => b.toString(16).padStart(2, '0')).join(''); }
    return require('crypto').createHash('sha256').update(s, 'utf8').digest('hex');
  }
  // The hash of bill section `eid` in an AKN-NY document (a string of XML).
  async function sectionHash(xml, eid, DOMParserImpl) {
    const doc = new (DOMParserImpl || root.DOMParser)().parseFromString(xml, 'application/xml');
    const body = doc.getElementsByTagNameNS(AKN, 'body')[0]; if (!body) return '';
    const sec = Array.from(body.getElementsByTagNameNS(AKN, 'section')).find(s => s.getAttribute('eId') === eid);
    return sec ? sha256hex(c14n(withoutComments(sec))) : '';
  }

  // The sign-offs standing in a working copy's XML, each with whether its section has changed since (as validate.py's
  // stale_signoffs): [{ section, by, date, stale }].
  async function signoffsInXml(xml, DOMParserImpl) {
    const doc = new (DOMParserImpl || root.DOMParser)().parseFromString(xml, 'application/xml'), out = [];
    const wf = Array.from(doc.getElementsByTagNameNS(AKN, 'workflow')).find(w => w.getAttribute('source') === '#lbdc-review');
    if (!wf) return out;
    const names = {}; for (const p of Array.from(doc.getElementsByTagNameNS(AKN, 'TLCPerson'))) names[p.getAttribute('eId')] = p.getAttribute('showAs');
    const standing = new Map();
    for (const st of Array.from(wf.getElementsByTagNameNS(AKN, 'step'))) {
      const sec = st.getAttributeNS(LBDC, 'section'), ev = st.getAttribute('refersTo');
      if (!sec) continue;
      if (ev === '#signedOff') standing.set(sec, st); else if (ev === '#signoffWithdrawn') standing.delete(sec);
    }
    const body = doc.getElementsByTagNameNS(AKN, 'body')[0];
    for (const [sec, st] of standing) {
      const el = body && Array.from(body.getElementsByTagNameNS(AKN, 'section')).find(s => s.getAttribute('eId') === sec);
      const want = st.getAttributeNS(LBDC, 'hash'), who = (st.getAttribute('by') || '').replace(/^#/, '');
      out.push({ section: sec, by: names[who] || who, date: st.getAttribute('date'), hash: want, stale: !!(el && want && await sha256hex(c14n(withoutComments(el))) !== want) });
    }
    return out;
  }

  /* ---------- in the working copy's XML ---------- */
  // <workflow source="#lbdc-review"> with a step per event; personId(name) gives the TLCPerson's eId.
  function workflowXml(steps, personId) {
    if (!steps || !steps.length) return '';
    const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    return '<workflow source="#lbdc-review">' + steps.map(s => '<step date="' + String(s.at).slice(0, 10) + '" by="#' + personId(s.by) + '" as="#' + s.role + '" refersTo="#' + s.event + '"' +
      (s.section ? ' lbdc:section="' + x(s.section) + '"' : '') + (s.hash && s.event === 'signedOff' ? ' lbdc:hash="' + s.hash + '"' : '') +
      (s.suggestionBy ? ' lbdc:suggestionBy="#' + personId(s.suggestionBy) + '"' : '') + '/>').join('') + '</workflow>';
  }
  function workflowRefs(steps) {
    if (!steps || !steps.length) return '';
    const used = [...new Set(steps.map(s => s.event))];
    return '<TLCOrganization eId="lbdc-review" href="/akn/ontology/organization/us-ny/lbdc.review" showAs="Review inside the Commission"/>' +
      used.map(e => '<TLCEvent eId="' + e + '" href="/akn/ontology/event/us-ny/lbdc.' + e + '" showAs="' + EVENTS[e] + '"/>').join('');
  }

  BD.review = { ROLES, ROLE_NAME, STATUS, FLOW, EVENTS, statusOf, handOff, mayDecide, maySignOff, mayProofread, signoffs, proofread, stepPeople, c14n, withoutComments, sha256hex, sectionHash, signoffsInXml, workflowXml, workflowRefs };
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
