// Unit tests for the shared libraries (no Word needed): node tests/unit.cjs
const assert = require('assert'); const path = require('path'); const fs = require('fs');
const { DOMParser } = require('@xmldom/xmldom');
for (const f of ['drafting', 'laws', 'tables', 'bank', 'ooxml', 'checks', 'akn', 'budget', 'budgetword']) require(path.join(__dirname, '..', 'src', 'lib', f + '.js'));
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
  for (const s of ['<FRBRuri value="/akn/us-ny/bill/2025/lbd01234"/>', '<FRBRuri value="/akn/us-ny/bill/2025/lbd01234/eng@03"/>', '<FRBRversionNumber value="03"/>', '<p class="number"><docNumber></docNumber></p>'])
    assert.ok(x.includes(s), 'draft: ' + s);
  assert.ok(!x.includes('printNumber') && !x.includes('docDate'), 'a draft has no print number or introduction date');
});
t('effective-date kinds and a sunset in the title', () => {
  assert.strictEqual(BD.effectiveClass(BD.effectiveText('immediately.', ['sunsetYears'])), 'immediate sunset');
  assert.strictEqual(BD.effectiveClass('This act shall take effect on the first of January next succeeding the date on which it shall have become a law.'), 'nextSucceeding');
  const t2 = BD.longTitle([{ act: 'amend', law: 'GCN', lawName: 'the general construction law' }, { act: 'effective', text: BD.effectiveText('immediately.', ['sunsetYears']) }], 'things').text;
  assert.ok(t2.endsWith('; and providing for the repeal of such provisions upon expiration thereof'), t2);
});
/* ---------- tables ---------- */
const ISC_TEXT = JSON.parse(fs.readFileSync(path.join(__dirname, 'bank-fixture', 'ISC.json'), 'utf8')).result.documents.documents.items[0].documents.items[0].text;
t('tables in the Bank: columns, headings, wrapped cells, group, note, caption', () => {
  const ps = BD.lawParagraphs(ISC_TEXT), tb = ps.find(BD.isTable);
  assert.ok(tb, 'a table was found');
  assert.strictEqual(tb.caption, 'TABLE ONE.');
  assert.deepStrictEqual(tb.rows.map(r => r.kind), ['head', 'group', '', '', '', '', 'note']);
  assert.deepStrictEqual(tb.rows[0].cells, ['Kind of insurance specified\nin the following numbered\nparagraphs of subsection\n(a) of § 1113:', 'Paid-in\nCapital', 'Paid-in\nSurplus']);
  assert.deepStrictEqual(tb.rows[3].cells, ['8, 9, 10, 11, or 14 - for\neach such kind', '$100,000', '$50,000']);
  assert.strictEqual(tb.rows[6].cells[0], '{3} If licensed to write paragraph 4, no additional paid-in capital and surplus is required.');
  assert.deepStrictEqual(BD.subdivisions(ps, true).map(x => x.unit), ['a', 'b']);
  const rate = BD.lawParagraphs('  (a) Rates:\n  If the taxable income is:      The tax is:\n  Not over $8,500                4% of the taxable income\n  Over $8,500                    $340 plus 4.5% of excess over $8,500\n  (b) Next.').find(BD.isTable);
  assert.deepStrictEqual(rate.rows.map(r => r.kind + ':' + r.cells.join('|')), ['head:If the taxable income is:|The tax is:', ':Not over $8,500|4% of the taxable income', ':Over $8,500|$340 plus 4.5% of excess over $8,500']);
});
t('tables marked against the Bank: changed amount, struck row, new row; both readings round-trip', () => {
  const law = BD.lawParagraphs(ISC_TEXT), now = JSON.parse(JSON.stringify(law)), tb = now.find(BD.isTable);
  tb.rows[3].cells[1] = '$400,000'; tb.rows.splice(5, 1, { kind: '', cells: ['23', '$750,000', '$375,000'] });
  const m = BD.markChanges(law, now), mt = m.find(BD.isTable), flat = c => c.map(r => r.k ? r.k + ':' + r.t : r.t).join('');
  assert.strictEqual(flat(mt.rows[3].cells[1]), 'del:[$100,000] ins:$400,000');
  assert.deepStrictEqual(mt.rows[5].cells.map(flat), ['del:[22', 'del:$2,000,000', 'del:$1,000,000]']);
  assert.deepStrictEqual(mt.rows[6].cells.map(flat), ['ins:23', 'ins:$750,000', 'ins:$375,000']);
  const r = BD.readings(m);
  assert.ok(BD.sameText(r.old, law) && BD.sameText(r.now, now));
  // a new table among the paragraphs is all new matter
  const added = BD.markChanges(['Text.'], ['Text.', BD.tableFromText('A  B\n1  2', true)]);
  assert.ok(added[1].rows.every(r => r.cells.every(c => c.every(x => x.k === 'ins'))));
  assert.deepStrictEqual(BD.tokens(['$1,250,000 and 4.5%.']).map(x => x.w), ['$1,250,000', 'and', '4.5%', '.']);
  // two rows taken out together: one pair of brackets, top left to bottom right
  const two = JSON.parse(JSON.stringify(law)), t2 = two.find(BD.isTable); t2.rows.splice(4, 2);
  const m2 = BD.markChanges(law, two).find(BD.isTable), s2 = m2.rows.map(r => r.cells.map(flat).join('|')).join('\n');
  assert.strictEqual((s2.match(/\[/g) || []).length, 1, s2); assert.strictEqual((s2.match(/\]/g) || []).length, 1, s2);
  const r2 = BD.readings(BD.markChanges(law, two)); assert.ok(BD.sameText(r2.old, law) && BD.sameText(r2.now, two));
});
t('tables in Word: written as Word tables and read back the same', () => {
  const law = BD.lawParagraphs(ISC_TEXT), sub = BD.subdivisions(law, true)[0];
  const body = BD.sectionXml({ act: 'amend', law: 'ISC', loc: '4103', unit: 'a', num: 'Section 1.', clause: 'Subsection (a) of section 4103 of the insurance law is amended to read as follows:', quoted: BD.markChanges(sub.paras, sub.paras) });
  assert.ok(body.includes('<w:tbl>') && body.includes('<w:tblHeader/>') && body.includes('<w:gridSpan w:val="3"/>'));
  const q = BD.readBill(BD.pkg(body), DOMParser).sections[0].quoted.paras, tb = q.find(BD.isTable);
  assert.strictEqual(tb.caption, 'TABLE ONE.');
  assert.ok(BD.sameText(BD.readings(q).now, sub.paras));
  const x = BD.toAkn({ title: null, enacting: null, sections: [{ act: 'amend', law: 'ISC', loc: '4103', unit: 'a', num: 'Section 1.', clause: 'Subsection (a) of section 4103 of the insurance law is amended to read as follows:', paras: [], quoted: { paras: q } }] }, info({ lawNames: { ISC: 'the insurance law' } }));
  for (const want of ['<hcontainer name="table" eId="sec_1__mod_1__qstr__subsec_a__para_1__table_1"><heading>TABLE ONE.</heading>', '__tableGroup_A"><heading>Group A:</heading>', '__tableNote_3"><num>{3}</num>', '<th><p>Paid-in<eol/>Capital</p></th>'])
    assert.ok(x.includes(want), want);
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
  write('draft.xml', BD.toAkn(taxBill(), info({ billNumber: '' })));
  { // a bill amending a table
    const law = BD.lawParagraphs(ISC_TEXT), sub = BD.subdivisions(law, true)[0], now = JSON.parse(JSON.stringify(sub.paras)), tb = now.find(BD.isTable);
    tb.rows[3].cells[1] = '$400,000'; tb.rows.splice(5, 1, { kind: '', cells: ['23', '$750,000', '$375,000'] });
    const m = { title: { text: 'AN ACT to amend the insurance law, in relation to capital', runs: [r('AN ACT to amend the insurance law, in relation to capital')] }, enacting: null, sections: [
      { act: 'amend', law: 'ISC', loc: '4103', unit: 'a', num: 'Section 1.', clause: 'Subsection (a) of section 4103 of the insurance law, as amended by chapter 10 of the laws of 2020, is amended to read as follows:', paras: [], quoted: { paras: BD.markChanges(sub.paras, now) } },
      { act: 'effective', paras: [[r('This act shall take effect immediately.')]] }] };
    write('table.xml', BD.toAkn(m, info({ lawNames: { ISC: 'the insurance law' } })));
  }
  const ex = path.join(__dirname, '..', 'examples', 'Example bill.docx');
  if (fs.existsSync(ex)) write('example.xml', cp.execFileSync('node', [path.join(__dirname, '..', 'tools', 'docx2akn.cjs'), ex]).toString());
  const res = cp.spawnSync('python3', [path.join(__dirname, '..', 'profile', 'validate.py'), '--quiet', ...files], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stdout + res.stderr);
});
t('the pane loads every file the clean-copy template reads', () => {
  // A file the template reads but the pane doesn't map stops the build with "failed to load file (access denied)".
  const dir = path.join(__dirname, '..'), js = fs.readFileSync(path.join(dir, 'src', 'cleancopy.js'), 'utf8');
  const listed = JSON.parse(js.match(/TEMPLATE_FILES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const read = [...fs.readFileSync(path.join(dir, 'clean-copy', 'bill.typ'), 'utf8').matchAll(/(?:json|read|image|csv|yaml|toml)\("([^"]+)"/g)].map(m => m[1]);
  for (const f of read) assert.ok(listed.includes(f), f + ' is read by bill.typ but not loaded by src/cleancopy.js');
  for (const f of listed) assert.ok(fs.existsSync(path.join(dir, 'clean-copy', f)), 'clean-copy/' + f + ' is missing');
});
t('budget: the add-in finds what the Python budget tools find', () => {
  const B = BD.budget, dir = path.join(__dirname, '..', 'samples', 'budget');
  const S = f => B.parse(fs.readFileSync(path.join(dir, f), 'utf8'), DOMParser);
  const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'budget-expected.json'), 'utf8'));
  const d = S('S3003D.akn.xml'), p = S('S8303D.akn.xml');
  // items and their keys (budget_items.py)
  const its = B.numbered(B.items(d));
  assert.strictEqual(its.length, exp.items.length);
  its.forEach((i, k) => assert.deepStrictEqual([i.eId, i.kind, B.key(i), i.n, i.source, i.amount, i.reappropriated], [exp.items[k].eId, exp.items[k].kind, exp.items[k].key, exp.items[k].n, exp.items[k].source, exp.items[k].amount, exp.items[k].reappropriated]));
  // the print-error report's amount checks (budget_report/findings.py)
  const F = B.findings(d);
  for (const k of Object.keys(exp.findings)) assert.strictEqual(F[k].length, exp.findings[k].length, k);
  const n = s => +String(s).replace(/,/g, '');
  assert.deepStrictEqual(F.summaries.map(x => [x.printed, x.items]), exp.findings.summaries.map(x => [n(x.printed), n(x.items)]));
  assert.deepStrictEqual(F.schedules.map(x => [x.printed, x.rows]), exp.findings.schedules.map(x => [n(x.printed), n(x.rows)]));
  assert.deepStrictEqual(F.schedule_items.map(x => [x.total, x.amount]), exp.findings.schedule_items.map(x => [n(x.total), n(x.item)]));
  // reappropriations against last year's chapter (prior_check.py)
  const P = B.priorCheck(d, p, 53, 2024);
  const got = {}; for (const [k, v] of Object.entries(P.res)) if (v.length) got[k] = v.map(([a, b]) => [a.eId, b ? b.eId : null]).sort();
  assert.deepStrictEqual(got, exp.prior);
  assert.deepStrictEqual(P.lapsed.map(l => [l.agency, l.kind, l.count, l.amount]).sort(), exp.prior_not_continued);
  // one print against another (compare_prints.py)
  const C = B.compare(S('S3000C.akn.xml'), S('S3000D.akn.xml'));
  const sig = c => [c.change, c.agency, JSON.stringify(c.was || null), JSON.stringify(c.now || null)].join('|');
  assert.deepStrictEqual(C.changes.map(sig).sort(), exp.compare.changes.map(sig).sort());
  assert.deepStrictEqual(C.totals, exp.compare.totals); assert.deepStrictEqual(C.items, exp.compare.items);
  // line vetoes placed on their items (line_vetoes.py)
  const V = B.placeVetoes(d, JSON.parse(fs.readFileSync(path.join(dir, 'vetoes-2025.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(dir, 'S3003D.lines.json'), 'utf8')));
  for (const v of V) { assert.deepStrictEqual(v.items, exp.vetoes[v.number], 'veto ' + v.number); assert.strictEqual(v.problem, null); }
  // the memorandum is valid XML naming the item
  const memo = B.vetoMemo(V[0], d, '2025-05-20');
  const md = B.parse(memo, DOMParser); assert.ok(md.getElementsByTagName('doc')[0].getAttribute('name') === 'lineVetoMemo');
  assert.ok(memo.includes('~' + V[0].items[0] + '"'), memo);
});
t('budget in Word: laid out, read back, edits marked as the prints mark them, totals updated', () => {
  const B = BD.budget, BW = BD.budgetWord, { XMLSerializer } = require('@xmldom/xmldom');
  const d = B.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', 'budget', 'S3003D.akn.xml'), 'utf8'), DOMParser);
  const W = new DOMParser().parseFromString(BD.pkg(BW.renderBill(d).join('')), 'application/xml');
  const sdts = [...W.getElementsByTagName('w:sdt')];
  // every part that can change is tagged, and the tag leads back to its element
  for (const s of sdts) { const tg = s.getElementsByTagName('w:tag')[0].getAttribute('w:val'); assert.ok(tg.length <= 64, tg); const p = BW.parseTag(tg); assert.ok(p && B._.byEId(d, p.eId), tg); }
  assert.strictEqual(sdts.filter(s => /k=(appropriation|reappropriation)$/.test(s.getElementsByTagName('w:tag')[0].getAttribute('w:val'))).length, B.items(d).length);
  // each item reads back as it was written, and applying it unchanged changes nothing
  for (const s of sdts) {
    const p = BW.parseTag(s.getElementsByTagName('w:tag')[0].getAttribute('w:val')); if (!/appropriation|purpose/.test(p.kind)) continue;
    const el = B._.byEId(d, p.eId), rs = BW.wordRuns(BD.pkg(new XMLSerializer().serializeToString(s)), DOMParser);
    assert.strictEqual(rs.map(r => r.t).join(''), BW.shownText(el), p.eId);
    assert.strictEqual(BW.applyEdit(el, rs, DOMParser), 'same', p.eId);
  }
  const its = B.items(d), ap = its.find(i => i.kind === 'appropriation' && i.amount === 15000000), re = its.find(i => i.kind === 'reappropriation' && i.amount === 15000000 && i.reappropriated === 15000000);
  // an appropriation is new money: it takes the new amount, unmarked
  assert.strictEqual(BW.applyEdit(ap.el, BW.shownRuns(ap.el).map(r => ({ ...r, t: r.t.replace('15,000,000', '16,250,000') })), DOMParser), 'replaced');
  assert.ok(!BW.shownText(ap.el).includes('['));
  // a reappropriation is law: its code and original amount are marked; "(re. $...)" is reprinted
  assert.strictEqual(BW.applyEdit(re.el, BW.shownRuns(re.el).map(r => ({ ...r, t: r.t.replace('(34218) ... 15,000,000 (re. $15,000,000)', '(34219) ... 14,000,000 (re. $12,500,000)') })), DOMParser), 'marked');
  assert.ok(BW.shownText(re.el).endsWith('[(34218)] (34219) ... [15,000,000] 14,000,000 (re. $12,500,000)'), BW.shownText(re.el));
  const x = new XMLSerializer().serializeToString(re.el);
  assert.ok(x.includes('<del>15,000,000</del> <ins><quantity class="originalAmount" normalized="14000000"'), x);
  assert.ok(x.includes('(re. $<quantity class="reappropriatedAmount" normalized="12500000"'), x);
  const now = B.items(d).find(i => i.eId === re.eId); assert.deepStrictEqual([now.amount, now.reappropriated], [14000000, 12500000]);
  // the program total and the agency summary follow once updated; the print's own summary errors go too
  assert.ok(BW.totals(d, false).some(t => /Program total/.test(t.what) && t.now === 16250000));
  BW.totals(d, true);
  assert.deepStrictEqual(BW.totals(d, false), []);
  assert.strictEqual(B.findings(d).summaries.length, 0);
  // the edited bill is still valid in the profile (the print's schedule errors aside)
  const out = path.join(require('os').tmpdir(), 'budget-edited.akn.xml'); fs.writeFileSync(out, new XMLSerializer().serializeToString(d));
  const v = require('child_process').spawnSync('python3', [path.join(__dirname, '..', 'profile', 'validate.py'), out], { encoding: 'utf8' }).stdout;
  const errs = v.split('\n').filter(l => /\[(profile|schema|lbdc) error\]/.test(l) && !/project schedule|summary total/i.test(l));
  assert.deepStrictEqual(errs, []);
});
t('budget: the whole of S.3003-D, as the Python tools find it', () => {
  const B = BD.budget, dir = path.join(__dirname, '..', 'samples', 'budget', 'full');
  const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'budget-expected.json'), 'utf8')).full;
  const S = f => B.parse(fs.readFileSync(path.join(dir, f), 'utf8'), DOMParser);
  const d = S('S3003D.akn.xml');
  assert.strictEqual(B.items(d).length, exp.items);
  const F = B.findings(d); for (const k of Object.keys(exp.findings)) assert.strictEqual(F[k].length, exp.findings[k], k);
  const P = B.priorCheck(d, S('S8303D.akn.xml'), 53, 2024), got = {};
  for (const [k, v] of Object.entries(P.res)) if (v.length) got[k] = v.length;
  assert.deepStrictEqual(got, exp.prior);
  const V = B.placeVetoes(d, JSON.parse(fs.readFileSync(path.join(dir, 'vetoes-2025.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(dir, 'S3003D.lines.json'), 'utf8')));
  for (const v of V) assert.deepStrictEqual(v.items, exp.vetoes[v.number], 'veto ' + v.number);
});
console.log(n + ' passed');
