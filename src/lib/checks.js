/* Bill Drafter for Word (demo) - drafting checks over the bill model (ooxml.js readBill).
   Structure and amendment checks follow the Bill Drafting Manual's forms as the desktop drafter applies them
   (C.5 boilerplate order, D.4/D.5 effective dates, amending clauses, bracket/underscore marking);
   the style checks are the desktop drafter's suggestions. Each finding: {level, rule, text, sec, fix}. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};

  const GENDERED = [
    [/\b(he or she|she or he)\b/gi, 'they'], [/\b(him or her|her or him)\b/gi, 'them'], [/\b(his or her|her or his)\b/gi, 'their'],
    [/\b(himself or herself|herself or himself)\b/gi, 'themselves'],
    [/\bhe\b/gi, 'they'], [/\bshe\b/gi, 'they'], [/\bhim\b/gi, 'them'], [/\bhis\b/gi, 'their'], [/\bhers\b/gi, 'theirs'], [/\bhimself\b/gi, 'themselves'], [/\bherself\b/gi, 'themselves'],
    [/\bchairman\b/gi, 'chair or chairperson'], [/\bchairwoman\b/gi, 'chair or chairperson'], [/\bpoliceman\b/gi, 'police officer'], [/\bfireman\b/gi, 'firefighter'],
    [/\bworkmen'?s\b/gi, "workers'"], [/\bmanpower\b/gi, 'workforce'],
  ];
  // Words and forms the drafter suggests changing in new matter.
  const STYLE = [
    [/\bsaid (?=[a-z])/g, 'Style', '"said" as an adjective: use "such" or "the".'],
    [/\bmust\b/g, 'Style', '"must": for a duty, use "shall".'],
    [/\b(Chapter|chapter) (\d+), [Ll]aws of (\d{4})\b/g, 'Citation', 'Cite a session law as "chapter N of the laws of YYYY".'],
    [/\bL\. ?(\d{4}), (c|ch)\. ?\d+/g, 'Citation', 'Cite a session law as "chapter N of the laws of YYYY".'],
    [/(^|[^(])\$\s?\d[\d,]*(\.\d+)?(?!\))/g, 'Numbers', 'A sum of money: write it in words with the figures after ("five hundred dollars ($500)").'],
    [/§/g, 'Citation', 'In the text of a law, refer to "section …", not "§".'],
    [/ {2,}/g, 'Spacing', 'Two spaces in a row.'],
    [/\[|\]/g, 'Brackets', 'A bracket typed in new matter reads as old law to be omitted. Use the Bill Delete style (Mark changes does this).'],
  ];

  function styleFindings(text, sec, where) {
    const out = [];
    for (const [re, rule, msg] of STYLE) { re.lastIndex = 0; const m = re.exec(text); if (m) out.push({ level: rule === 'Brackets' ? 'error' : 'info', rule, text: msg + ' (' + where + ': "' + snippet(text, m.index) + '")', sec }); }
    for (const [re, sug] of GENDERED) { re.lastIndex = 0; const m = re.exec(text); if (m) { out.push({ level: 'info', rule: 'Gender', text: 'Gendered: "' + m[0] + '"; use "' + sug + '" where possible (' + where + ').', sec }); break; } }
    return out;
  }
  // A quoted text's paragraphs as runs, a table's cells counted as paragraphs (for the style and marking checks).
  const runsOf = paras => paras.flatMap(p => BD.isTable(p) ? p.rows.flatMap(r => r.cells.map(c => Array.isArray(c) ? c : [{ t: String(c || ''), k: '' }])) : [p]);
  const snippet = (t, i) => t.slice(Math.max(0, i - 20), i + 30).replace(/\s+/g, ' ').trim();

  // The law text a quoted block should start from (paragraphs), or null when not in the Bank.
  function lawTextFor(law, q) {
    const s = BD.findSection(law, q.loc); if (!s) return null;
    const paras = BD.lawParagraphs(s.text);
    if (!q.unit) return paras;
    const sub = BD.subdivisions(paras, BD.usesSubsections(law.info && law.info.lawId)).find(x => x.unit.toLowerCase() === String(q.unit).toLowerCase());
    return sub ? sub.paras : null;
  }

  async function check(model, getLaw) {
    const F = [], S = model.sections;
    const add = (level, rule, text, sec, fix) => F.push({ level, rule, text, sec: sec == null ? null : sec, fix });

    /* ----- suggestions waiting (Word's tracked changes) ----- */
    const sg = model.suggestions;
    if (sg) {
      sg.bySection.forEach((n, i) => { if (n) add('warning', 'Suggestions', n + ' suggested change' + (n === 1 ? '' : 's') + ' in this section ' + (n === 1 ? 'waits' : 'wait') + ' to be accepted or rejected. Mark changes leaves the section alone until then, and no clean copy is made.', i); });
      if (sg.outside) add('warning', 'Suggestions', sg.outside + ' suggested change' + (sg.outside === 1 ? '' : 's') + ' in the title ' + (sg.outside === 1 ? 'waits' : 'wait') + ' to be accepted or rejected.', null);
    }

    /* ----- title and enacting clause ----- */
    if (!model.title) add('error', 'Title', 'The bill has no title ("AN ACT to …"). Use New bill or Update title.', null, 'title');
    else {
      if (!/^AN ACT\b/.test(model.title.text)) add('error', 'Title', 'The title should begin "AN ACT".', null, 'title');
      if (!model.title.subject || /_{2,}/.test(model.title.subject)) add('error', 'Title', 'Fill in what the bill is "in relation to".', null, 'subject');
      const lawsIn = await Promise.all(S.filter(s => s.law && s.act !== 'new').map(async s => ({ s, name: await nameOf(s.law, getLaw) })));
      const want = BD.longTitle(lawsIn.map(x => ({ ...x.s, lawName: x.name })).concat(S.filter(s => s.act === 'effective')), model.title.subject).text;
      if (lawsIn.length && want.replace(/\s+/g, ' ') !== model.title.text.replace(/\s+/g, ' ')) add('warning', 'Title', 'The title does not match what the sections do. It would read: "' + want + '".', null, 'title');
    }
    if (!model.enacting) add('error', 'Enacting clause', 'The enacting clause is missing.', null, 'enacting');
    else if (model.enacting.text.replace(/\s+/g, ' ') !== BD.ENACTING) add('error', 'Enacting clause', 'The enacting clause should read exactly: "' + BD.ENACTING + '"', null, 'enacting');

    /* ----- sections: numbers and order ----- */
    if (!S.length) add('error', 'Structure', 'The bill has no sections.', null);
    S.forEach((s, i) => { if (s.num !== BD.sectionNum(i)) add('warning', 'Numbering', 'Section ' + (i + 1) + ' is numbered "' + (s.num || 'nothing') + '"; it should be "' + BD.sectionNum(i) + '".', i, 'renumber'); });
    const kinds = S.map(s => s.act);
    const eff = kinds.lastIndexOf('effective'), sev = kinds.indexOf('severability'), st = kinds.indexOf('shortTitle');
    if (eff < 0) add('warning', 'Effective date', 'No effective-date section. Without one the act takes effect on the twentieth day after it becomes a law (Legislative Law § 43).', null, 'effective');
    else {
      if (eff !== S.length - 1) add('error', 'Effective date', 'The effective-date section should be the last section.', eff);
      if (!/^This act shall take effect\b/.test(S[eff].text)) add('error', 'Effective date', 'The effective-date section should begin "This act shall take effect".', eff);
      if (kinds.filter(k => k === 'effective').length > 1) add('error', 'Effective date', 'There is more than one effective-date section.', eff);
    }
    if (sev >= 0 && eff >= 0 && sev !== eff - 1) add('warning', 'Severability', 'The severability clause goes just before the effective-date section.', sev);
    if (st > 0) add('error', 'Short title', 'The short title section should be section 1.', st);
    if (st >= 0) {
      const m = /"([^"]+)"/.exec(S[st].text.replace(/[“”]/g, '"'));
      if (!m || /_{2,}/.test(m[1])) add('error', 'Short title', 'Fill in the short title (in quotation marks).', st);
      else if (!/\b(act|law)$/i.test(m[1].trim())) add('info', 'Short title', 'A short title usually ends in "act" or "law": "' + m[1] + '".', st);
    }

    /* ----- each section ----- */
    const seen = new Map();
    for (const s of S) {
      const i = s.index, all = [s.heading, s.clause, s.text, ...(s.quoted ? runsOf(s.quoted.paras).map(BD.textOf) : [])].join(' ');
      if (/_{3,}/.test(all)) add('error', 'Blanks', 'There is a blank (____) to fill in.', i);
      if (s.act === 'new' && !s.text.trim()) add('error', 'Blanks', 'This section is empty: type its text, or remove it and renumber.', i);
      if (s.act === 'amend' || s.act === 'add' || s.act === 'repeal') await checkAmendment(s, getLaw, add);
      if (s.law && s.loc && s.act !== 'add') {
        const key = s.law + ' ' + BD.locKey(s.loc) + (s.unit ? '/' + s.unit : '');
        if (seen.has(key)) add('warning', 'Amendments', 'This provision is also acted on in section ' + (seen.get(key) + 1) + '. Combine them.', i);
        else seen.set(key, i);
      }
      // New matter for the style checks.
      let fresh = '';
      if (s.act === 'new' || s.act === 'findings' || s.act === 'shortTitle') fresh = s.text;
      if (s.quoted) fresh += ' ' + runsOf(s.quoted.paras).flatMap(p => p.filter(r => r.k === 'ins').map(r => r.t)).join(' ');
      if (s.act === 'add' && s.quoted) fresh = runsOf(s.quoted.paras).map(p => BD.textOf(p).replace(/^\s*(§\s*[\w-]+|\d+[-a-z]*)\.\s*/, '')).join(' ');
      if (fresh.trim()) for (const f of styleFindings(fresh, i, 'new matter')) F.push(f);
    }
    // Sections amending one law go in the order of its section numbers.
    const byLaw = {};
    for (const s of S) if ((s.act === 'amend' || s.act === 'add' || s.act === 'repeal') && s.law) (byLaw[s.law] = byLaw[s.law] || []).push(s);
    for (const list of Object.values(byLaw)) for (let k = 1; k < list.length; k++)
      if (cmpLoc(list[k - 1].loc, list[k].loc) > 0) { add('info', 'Order', 'Sections amending the same law usually follow its section order (section ' + BD.secId(list[k].loc) + ' comes before section ' + BD.secId(list[k - 1].loc) + ').', list[k].index); break; }

    const rank = { error: 0, warning: 1, info: 2 };
    return F.sort((a, b) => rank[a.level] - rank[b.level] || (a.sec == null ? -1 : a.sec) - (b.sec == null ? -1 : b.sec));
  }

  async function nameOf(id, getLaw) { const law = await getLaw(id); return law ? BD.lawName(law.info) : 'the ' + id + ' law'; }
  function cmpLoc(a, b) {
    const pa = String(a).toUpperCase().split('-'), pb = String(b).toUpperCase().split('-');
    const na = parseFloat(pa[0]), nb = parseFloat(pb[0]);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b));
  }

  async function checkAmendment(s, getLaw, add) {
    const i = s.index, law = await getLaw(s.law);
    const clause = s.clause || '';
    if (!clause) add('error', 'Amending clause', 'This section has no amending clause.', i, 'clause');
    if (/[A-Z][a-z]+ [A-Z][a-z]+ Law\b/.test(clause)) add('warning', 'Amending clause', 'In an amending clause the law\'s name is lower case ("the general construction law").', i);
    if (!law) { add('info', 'Bank', 'The ' + s.law + ' law is not in this computer\'s Bank, so this section could not be checked against the law. Load the Bank.', i); return; }
    if (law.info.lawType === 'UNCONSOLIDATED') add('info', 'Citation', 'An unconsolidated law: check the chapter citation in the amending clause.', i);
    const sec = BD.findSection(law, s.loc);
    if (s.act === 'add') {
      if (s.unit ? !sec : false) add('error', 'Citation', 'Section ' + BD.secId(s.loc) + ' is not in the ' + BD.lawName(law.info) + ', so a subdivision cannot be added to it.', i);
      if (!s.unit && sec) add('error', 'Already in law', 'Section ' + BD.secId(s.loc) + ' is already in ' + BD.lawName(law.info) + '. The next free number is ' + BD.nextFreeSection(law, s.loc) + '.', i);
      if (!/is amended by adding/.test(clause)) add('warning', 'Amending clause', 'Adding a provision reads "… is amended by adding a new section … to read as follows:".', i, 'clause');
      if (s.quoted) {
        const plain = runsOf(s.quoted.paras).flatMap(p => p.filter(r => r.k !== 'ins' && r.t.trim())).length;
        if (plain) add('error', 'Marking', 'All of an added provision is new matter: underline it (Mark changes).', i, 'mark');
        if (runsOf(s.quoted.paras).some(p => p.some(r => r.k === 'del'))) add('error', 'Marking', 'An added provision has nothing to omit, so nothing should be bracketed.', i);
      }
      return;
    }
    if (!sec) { add('error', 'Citation', 'Section ' + BD.secId(s.loc) + ' is not in ' + BD.lawName(law.info) + ' (Bank as of ' + (law.activeDate || '?') + ').', i); return; }
    if (sec.repealed) add('warning', 'Citation', 'The Bank shows section ' + BD.secId(s.loc) + ' as repealed.', i);
    if (!/\bas (amended|added|renumbered)\b/.test(clause) && law.info.lawType !== 'MISC')
      add('warning', 'History', 'The amending clause should cite the provision\'s last amendment ("as amended by chapter … of the laws of …"). The Bank does not hold the history, so type it in.', i, 'history');
    if (s.act === 'repeal') {
      if (!/is REPEALED\.$/.test(clause)) add('warning', 'Amending clause', 'A repeal reads "… is REPEALED."', i, 'clause');
      return;
    }
    if (!/is amended to read as follows:$/.test(clause)) add('warning', 'Amending clause', 'An amendment ends "… is amended to read as follows:".', i, 'clause');
    if (!s.quoted) { add('error', 'Structure', 'The text of the law being amended is missing.', i); return; }
    const want = lawTextFor(law, s.quoted);
    if (!want) { add('error', 'Citation', 'Subdivision ' + s.quoted.unit + ' was not found in section ' + BD.secId(s.loc) + '.', i); return; }
    const r = BD.readings(s.quoted.paras);
    if (!BD.sameText(r.old, want)) add('error', 'Marking', 'The unmarked and bracketed words are not the law as it stands: something was changed without marking it, or the law changed. Use Mark changes.', i, 'mark');
    else if (BD.sameText(r.now, want)) add('warning', 'Amendments', 'This section amends nothing yet: the text reads the same as the law.', i);
  }

  Object.assign(BD, { check, lawTextFor, styleFindings, GENDERED });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
