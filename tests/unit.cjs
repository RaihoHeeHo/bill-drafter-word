// Unit tests for the shared libraries (no Word needed): node tests/unit.cjs
const assert = require('assert'); const path = require('path'); const fs = require('fs');
const { DOMParser } = require('@xmldom/xmldom');
for (const f of ['drafting', 'laws', 'bank', 'ooxml', 'checks', 'akn']) require(path.join(__dirname, '..', 'src', 'lib', f + '.js'));
const BD = globalThis.BD; let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('law names', () => {
  assert.strictEqual(BD.lawName({ name: 'General Construction', lawType: 'CONSOLIDATED' }), 'the general construction law');
  assert.strictEqual(BD.lawName({ name: 'Civil Practice Law & Rules', lawType: 'CONSOLIDATED' }), 'the civil practice law and rules');
  assert.strictEqual(BD.lawName({ name: 'Family Court Act', lawType: 'COURT_ACTS' }), 'the family court act');
  assert.strictEqual(BD.lawName({ name: 'Emergency Tenant Protection Act 576/74', lawType: 'UNCONSOLIDATED' }), 'chapter 576 of the laws of 1974, constituting the emergency tenant protection act');
});
t('amending clauses', () => {
  const info = { name: 'Executive', lawType: 'CONSOLIDATED' };
  assert.strictEqual(BD.amendingClause({ act: 'amend', info, loc: '296', unit: '1', history: 'as amended by chapter 1 of the laws of 2020' }), 'Subdivision 1 of section 296 of the executive law, as amended by chapter 1 of the laws of 2020, is amended to read as follows:');
  assert.strictEqual(BD.amendingClause({ act: 'add', info, loc: '296-D' }), 'The executive law is amended by adding a new section 296-d to read as follows:');
  assert.strictEqual(BD.amendingClause({ act: 'repeal', info, loc: '12' }), 'Section 12 of the executive law is REPEALED.');
});
t('section order and numbers', () => {
  assert.strictEqual(BD.insertIndex(['amend', 'severability', 'effective'], 'amend'), 1);
  assert.strictEqual(BD.insertIndex(['amend', 'effective'], 'severability'), 1);
  assert.strictEqual(BD.insertIndex(['amend', 'effective'], 'shortTitle'), 0);
  assert.strictEqual(BD.sectionNum(0), 'Section 1.'); assert.strictEqual(BD.sectionNum(3), '§ 4.');
});
t('long title', () => {
  const x = BD.longTitle([{ act: 'amend', law: 'A', lawName: 'the a law' }, { act: 'add', law: 'B', lawName: 'the b law' }, { act: 'amend', law: 'C', lawName: 'the c law' }, { act: 'repeal', law: 'A', lawName: 'the a law', loc: '5' }], 'things');
  assert.strictEqual(x.text, 'AN ACT to amend the a law, the b law and the c law, in relation to things; and to repeal section 5 of the a law relating thereto');
});
t('mark changes: brackets and underlines, both readings round-trip', () => {
  const law = ['§ 12. Affidavit. When an affidavit is authorized it may be sworn to before any officer, unless a particular officer is specified.', '2. Second paragraph stays.'];
  const now = ['§ 12. Affidavit. When an affidavit is authorized it may be sworn to before any notary public or officer.', '2. Second paragraph stays.', '3. A new paragraph.'];
  const m = BD.markChanges(law, now);
  const flat = m.map(p => p.map(r => r.k === 'ins' ? '_' + r.t + '_' : r.t).join('')).join(' / ');
  assert.ok(flat.includes('before any [officer, unless a particular officer is specified] _notary public or officer_.'), flat);
  assert.ok(flat.endsWith('/ _3. A new paragraph._'), flat);
  const r = BD.readings(m);
  assert.ok(BD.sameText(r.old, law)); assert.ok(BD.sameText(r.now, now));
});
t('mark changes: a replaced word and an added phrase', () => {
  const m = BD.markChanges(['1. The term "person" includes one or more individuals, partnerships, corporations, legal representatives.'], ['1. The term "person" includes one or more natural persons, partnerships, corporations, limited liability companies, legal representatives.']);
  const flat = m.map(p => p.map(r => r.k === 'ins' ? '_' + r.t + '_' : r.t).join('')).join(' / ');
  assert.strictEqual(flat, '1. The term "person" includes one or more [individuals] _natural persons_, partnerships, corporations, _limited liability companies,_ legal representatives.');
});
t('subdivisions split the first paragraph', () => {
  const s = BD.subdivisions(['§ 2-d. Release of information. 1. Definitions. As used here:', 'a. "X" means x.', '2. Officer. Text.']);
  assert.deepStrictEqual(s.map(x => x.unit), ['1', '2']); assert.strictEqual(s[0].paras.length, 2);
});
t('docx round trip and Akoma Ntoso', () => {
  const body = BD.titleXml(BD.longTitle([{ act: 'amend', law: 'GCN', lawName: 'the general construction law' }], 'affidavits')) + BD.enactingXml() +
    BD.sectionXml({ act: 'amend', law: 'GCN', loc: '12', num: 'Section 1.', clause: 'Section 12 of the general construction law is amended to read as follows:', quoted: [[{ t: '§ 12. Affidavit. Old ', k: '' }, { t: '[words]', k: 'del' }, { t: ' ', k: '' }, { t: 'new words', k: 'ins' }]] }) +
    BD.sectionXml({ act: 'effective', num: '§ 2.', content: [{ t: BD.effectiveText('immediately.'), k: '' }] });
  const m = BD.readBill(BD.pkg(body), DOMParser);
  assert.strictEqual(m.title.subject, 'affidavits'); assert.strictEqual(m.sections.length, 2);
  assert.strictEqual(m.sections[0].clause, 'Section 12 of the general construction law is amended to read as follows:');
  const x = BD.toAkn(m, { lbd: '1-01-6', lawNames: { GCN: 'the general construction law' } });
  assert.ok(x.includes('<section eId="sec_1__mod_1__qstr__sec_12"><num>§ 12.</num><heading>Affidavit.</heading><content><p>Old <del>words</del> <ins>new words</ins></p>'), x);
  assert.ok(x.includes('<textualMod eId="amod_1" type="substitution"><source href="#sec_1__mod_1"/><destination href="/akn/us-ny/act/consolidated/gcn/~sec_12"/>'), x);
  assert.ok(x.includes('<mod eId="sec_1__mod_1"><ref href="/akn/us-ny/act/consolidated/gcn/~sec_12">Section 12 of the general construction law</ref> is amended to read as follows:<quotedStructure eId="sec_1__mod_1__qstr">'), x);
});
t('amended text nests by numbering', () => {
  const m = { title: null, enacting: null, sections: [{ act: 'amend', law: 'EXC', loc: '296', num: 'Section 1.', clause: 'Section 296 of the executive law is amended to read as follows:', paras: [], quoted: { paras: [
    [{ t: '\u00a7 296. Unlawful practices. 1. It shall be unlawful:', k: '' }], [{ t: '(a) For an employer;', k: '' }], [{ t: '(1) to refuse;', k: '' }], [{ t: '(b) For an agency.', k: '' }], [{ t: '2. Second.', k: '' }]] } }] };
  const x = BD.toAkn(m, {});
  // New York's names: section, subdivision 1., paragraph (a), subparagraph (1); eIds end in the printed number.
  const q = 'sec_1__mod_1__qstr__sec_296';
  assert.ok(x.includes('<section eId="' + q + '"><num>\u00a7 296.</num><heading>Unlawful practices.</heading><subdivision eId="' + q + '__subdvs_1"><num>1.</num><intro eId="' + q + '__subdvs_1__intro"><p>It shall be unlawful:</p></intro><paragraph eId="' + q + '__subdvs_1__para_a"><num>(a)</num><intro eId="' + q + '__subdvs_1__para_a__intro"><p>For an employer;</p></intro><subparagraph eId="' + q + '__subdvs_1__para_a__subpara_1">'), x);
  assert.ok(x.includes('<subdivision eId="' + q + '__subdvs_2"><num>2.</num><content><p>Second.</p></content></subdivision>'), x);
});
t('example .docx converts', () => {
  const ex = path.join(__dirname, '..', 'examples', 'Example bill.docx');
  if (!fs.existsSync(ex)) return;
  const out = require('child_process').execFileSync('node', [path.join(__dirname, '..', 'tools', 'docx2akn.cjs'), ex]).toString();
  assert.ok(out.includes('refersTo="#effectiveDate"'));
});
t('a document as Word saves it: inline controls and renamed styles', () => {
  // Word keeps a one-paragraph control inside its paragraph and makes style ids from style names.
  const sdt = (tag, inner) => '<w:sdt><w:sdtPr><w:tag w:val="' + tag + '"/></w:sdtPr><w:sdtContent>' + inner + '</w:sdtContent></w:sdt>';
  const r = (t, st) => '<w:r>' + (st ? '<w:rPr><w:rStyle w:val="' + st + '"/></w:rPr>' : '') + '<w:t xml:space="preserve">' + t + '</w:t></w:r>';
  const body = '<w:p><w:pPr><w:pStyle w:val="BillTitle"/></w:pPr>' + sdt('akn:longTitle', r('AN ACT to amend the general construction law, in relation to ') + sdt('akn:subject', r('affidavits'))) + '</w:p>' +
    sdt('akn:enactingFormula', '<w:p>' + r(BD.ENACTING) + '</w:p>') +
    sdt('akn:section;act=amend;law=GCN;loc=12', '<w:p>' + sdt('akn:num', r('Section 1.', 'BillSectionNumber')) + r(' ') + sdt('akn:mod', r('Section 12 of the general construction law is amended to read as follows:')) + '</w:p>' +
      sdt('akn:quoted;law=GCN;loc=12', '<w:p>' + r('§ 12. Affidavit. It may be sworn to before any ') + r('[officer]', 'BillDeletematteromitted') + r(' ') + r('notary', 'BillInsertnewmatter') + r(' here.') + '</w:p>')) +
    '<w:p>' + sdt('akn:section;act=effective', sdt('akn:num', r('§ 2.', 'BillSectionNumber')) + r(' This act shall take effect immediately.')) + '</w:p>';
  const m = BD.readBill('<w:document xmlns:w="' + BD.W_NS + '"><w:body>' + body + '</w:body></w:document>', DOMParser);
  assert.strictEqual(m.title.subject, 'affidavits');
  assert.ok(m.enacting);
  assert.deepStrictEqual(m.sections.map(s => s.act), ['amend', 'effective']);
  assert.strictEqual(m.sections[1].num, '§ 2.'); assert.strictEqual(m.sections[1].text, 'This act shall take effect immediately.');
  assert.deepStrictEqual(m.sections[0].quoted.paras[0].map(x => x.k), ['', 'del', '', 'ins', '']);
  assert.deepStrictEqual(m.loose, []);
});

/* ---------- AKN-NY profile 0.3 ---------- */
const r = (t, k = '') => ({ t, k });
const info = (extra) => ({ lbd: '01234-03-5', house: 'senate', billNumber: '1234', sponsor: 'SMITH', committee: 'Budget and Revenue', date: '2025-01-15', lawNames: { TAX: 'the tax law', GCN: 'the general construction law' }, ...extra });
const taxBill = () => ({ title: { text: 'AN ACT to amend the tax law, in relation to credits', runs: [r('AN ACT to amend the tax law, in relation to credits')] }, enacting: null, sections: [
  { act: 'amend', law: 'TAX', loc: '606', unit: 'c', paras: [], clause: BD.amendingClause({ act: 'amend', info: { lawId: 'TAX', name: 'Tax', lawType: 'CONSOLIDATED' }, loc: '606', unit: 'c', history: 'as amended by chapter 59 of the laws of 2023' }), quoted: { paras: [
    [r('(c) Credit. (1) A taxpayer shall be allowed a credit equal to '), r('[twenty]', 'del'), r(' '), r('forty', 'ins'), r(' percent.')],
    [r('[(2)]', 'del'), r(' '), r('(3)', 'ins'), r(' Renumbered text.')],
    [r('[(4) Struck whole.]', 'del')],
    [r('(2)', 'ins'), r(' '), r('New paragraph two.', 'ins')]] } },
  { act: 'effective', paras: [[r('This act shall take effect immediately.')]] }] });
t('laws are addressed by their Bank ID alone', () => {
  assert.strictEqual(BD.lawBase('TAX'), '/akn/us-ny/act/consolidated/tax');
  assert.strictEqual(BD.lawBase('FCT'), '/akn/us-ny/act/unconsolidated/fct');
  assert.strictEqual(BD.lawBase('CNS'), '/akn/us-ny/act/constitution/cns');
  assert.strictEqual(BD.lawBase('ETP', { lawType: 'UNCONSOLIDATED', name: 'Emergency Tenant Protection Act 576/74' }), '/akn/us-ny/act/1974/576');
  assert.ok(!/\/(19|20)\d\d\//.test(BD.lawBase('GCN')));
});
t('laws of subsections: Tax Law citations and units', () => {
  const m = taxBill();
  assert.strictEqual(m.sections[0].clause, 'Subsection (c) of section 606 of the tax law, as amended by chapter 59 of the laws of 2023, is amended to read as follows:');
  const x = BD.toAkn(m, info());
  assert.ok(x.includes('<ref href="/akn/us-ny/act/consolidated/tax/~sec_606__subsec_c">Subsection (c) of section 606 of the tax law</ref>, as amended by <ref class="amendmentHistory amended" href="/akn/us-ny/act/2023/59">chapter 59 of the laws of 2023</ref>, is amended'), x);
  assert.ok(x.includes('<subsection eId="sec_1__mod_1__qstr__subsec_c"><num>(c)</num><heading>Credit.</heading><paragraph eId="sec_1__mod_1__qstr__subsec_c__para_1">'), x);
  assert.deepStrictEqual(BD.subdivisions(['§ 606. Credits. (a) First.', '(1) one.', '(b) Second.'], true).map(s => s.unit), ['a', 'b']);
});
t('renumbered, struck and inserted units; one bracket pair split across a unit', () => {
  const x = BD.toAkn(taxBill(), info());
  assert.ok(x.includes('<paragraph eId="sec_1__mod_1__qstr__subsec_c__para_3"><num><del>(2)</del> <ins>(3)</ins></num>'), x);
  assert.ok(x.includes('<paragraph eId="sec_1__mod_1__qstr__subsec_c__para_4-old"><num><del class="spanStart">(4)</del></num><content><p><del class="spanEnd">Struck whole.</del></p>'), x);
  assert.ok(x.includes('<paragraph eId="sec_1__mod_1__qstr__subsec_c__para_2"><num><ins>(2)</ins></num>'), x);
});
t('front matter, prints and metadata', () => {
  let x = BD.toAkn(taxBill(), info());
  for (const s of ['<FRBRuri value="/akn/us-ny/bill/2025/s1234"/>', '<FRBRuri value="/akn/us-ny/bill/2025/s1234/eng@"/>', '<lbdc:profile name="AKN-NY" version="0.3"/>', '<lbdc:printNumber>S1234</lbdc:printNumber>', '<lbdc:lbdNumber>LBD01234-03-5</lbdc:lbdNumber>',
    '<p class="number"><docNumber>1234</docNumber></p>', '<p class="stage"><docStage>IN SENATE</docStage></p>', '<docProponent refersTo="#smith">SMITH</docProponent>', '<docCommittee refersTo="#senate-budget-and-revenue">Budget and Revenue</docCommittee>',
    '<section eId="sec_2" class="immediate" refersTo="#effectiveDate">']) assert.ok(x.includes(s), s);
  x = BD.toAkn(taxBill(), info({ billNumber: '1234-A', amended: '2025-03-04', sponsor: 'SMITH, JONES' }));
  for (const s of ['<FRBRuri value="/akn/us-ny/bill/2025/s1234/eng@a"/>', '<FRBRversionNumber value="A"/>', '<lbdc:printNumber>S1234A</lbdc:printNumber>', '<docNumber>1234--A</docNumber>', '<docDate date="2025-01-15">', 'Introduced by Sens. <docProponent'])
    assert.ok(x.includes(s), s);
  x = BD.toAkn(taxBill(), info({ billNumber: '' }));
  assert.ok(x.includes('<FRBRuri value="/akn/us-ny/bill/2025/lbd01234"/>') && !x.includes('printNumber'), 'a draft is addressed by its LBD route number');
});
t('effective-date kinds and a sunset in the title', () => {
  assert.strictEqual(BD.effectiveClass(BD.effectiveText('immediately.', ['sunsetYears'])), 'immediate sunset');
  assert.strictEqual(BD.effectiveClass('This act shall take effect on the first of January next succeeding the date on which it shall have become a law.'), 'nextSucceeding');
  const t2 = BD.longTitle([{ act: 'amend', law: 'GCN', lawName: 'the general construction law' }, { act: 'effective', text: BD.effectiveText('immediately.', ['sunsetYears']) }], 'things').text;
  assert.ok(t2.endsWith('; and providing for the repeal of such provisions upon expiration thereof'), t2);
});
// The add-in's output against the profile itself (the official schema, LBDC's extension and the Schematron rules),
// when Python and lxml are here.
t('output is valid AKN-NY 0.3', () => {
  const cp = require('child_process'), os = require('os');
  try { cp.execFileSync('python3', ['-c', 'import lxml'], { stdio: 'ignore' }); } catch (e) { console.log('   (skipped: needs python3 with lxml)'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akn-')), files = [];
  const write = (name, xml) => { const f = path.join(dir, name); fs.writeFileSync(f, xml); files.push(f); };
  write('tax.xml', BD.toAkn(taxBill(), info()));
  write('tax-a.xml', BD.toAkn(taxBill(), info({ billNumber: '1234-A', amended: '2025-03-04' })));
  const ex = path.join(__dirname, '..', 'examples', 'Example bill.docx');
  if (fs.existsSync(ex)) write('example.xml', cp.execFileSync('node', [path.join(__dirname, '..', 'tools', 'docx2akn.cjs'), ex]).toString());
  const res = cp.spawnSync('python3', [path.join(__dirname, '..', 'profile', 'validate.py'), '--quiet', ...files], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
});
console.log(n + ' passed');
