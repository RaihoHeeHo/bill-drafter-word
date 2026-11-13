// Unit tests for the shared libraries (no Word needed): node tests/unit.cjs
const assert = require('assert'); const path = require('path'); const fs = require('fs');
const { DOMParser } = require('@xmldom/xmldom');
for (const f of ['drafting', 'bank', 'ooxml', 'checks', 'akn']) require(path.join(__dirname, '..', 'src', 'lib', f + '.js'));
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
  assert.ok(x.includes('<num>§ 12.</num><heading>Affidavit.</heading><content><p>Old <del>words</del> <ins>new words</ins></p>'), x);
  assert.ok(x.includes('<textualMod eId="amod_1" type="substitution">'));
});
t('amended text nests by numbering', () => {
  const m = { title: null, enacting: null, sections: [{ act: 'amend', law: 'EXC', loc: '296', num: 'Section 1.', clause: 'Section 296 of the executive law is amended to read as follows:', paras: [], quoted: { paras: [
    [{ t: '\u00a7 296. Unlawful practices. 1. It shall be unlawful:', k: '' }], [{ t: '(a) For an employer;', k: '' }], [{ t: '(1) to refuse;', k: '' }], [{ t: '(b) For an agency.', k: '' }], [{ t: '2. Second.', k: '' }]] } }] };
  const x = BD.toAkn(m, {});
  assert.ok(x.includes('<section eId="sec_1__mod_1__sec_296"><num>\u00a7 296.</num><heading>Unlawful practices.</heading><subsection eId="sec_1__mod_1__sec_296__subsec_1"><num>1.</num><intro><p>It shall be unlawful:</p></intro><paragraph eId="sec_1__mod_1__sec_296__subsec_1__para_a"><num>(a)</num><intro><p>For an employer;</p></intro><subparagraph'), x);
  assert.ok(x.includes('<subsection eId="sec_1__mod_1__sec_296__subsec_2"><num>2.</num><content><p>Second.</p></content></subsection>'), x);
});
t('example .docx converts', () => {
  const ex = path.join(__dirname, '..', 'examples', 'Example bill.docx');
  if (!fs.existsSync(ex)) return;
  const out = require('child_process').execFileSync('node', [path.join(__dirname, '..', 'tools', 'docx2akn.cjs'), ex]).toString();
  assert.ok(out.includes('refersTo="#effectiveDate"'));
});
console.log(n + ' passed');
