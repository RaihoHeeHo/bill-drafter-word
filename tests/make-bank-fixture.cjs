// Builds tests/bank-fixture/: three small Bank files (NY-Law-Exporter law-tree JSON) for tests/flow.cjs, from the
// law text in examples/Example bill.docx (its unmarked and bracketed words are the law). Test data only: each law
// holds just the sections the flow touches, and EDN 2-d is abbreviated.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { DOMParser } = require('@xmldom/xmldom');
for (const f of ['drafting', 'laws', 'tables', 'bank', 'ooxml', 'checks', 'akn']) require(path.join(__dirname, '..', 'src', 'lib', f + '.js'));
const BD = globalThis.BD;
const zip = fs.readFileSync(path.join(__dirname, '..', 'examples', 'Example bill.docx'));
// minimal zip reader for word/document.xml
function entry(buf, name) {
  let i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); const n = buf.readUInt16LE(i + 10); let p = buf.readUInt32LE(i + 16);
  for (let k = 0; k < n; k++) {
    const m = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20), fl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nm = buf.toString('utf8', p + 46, p + 46 + fl);
    if (nm === name) { const lf = buf.readUInt16LE(off + 26), le = buf.readUInt16LE(off + 28); const d = buf.slice(off + 30 + lf + le, off + 30 + lf + le + cs); return (m ? zlib.inflateRawSync(d) : d).toString('utf8'); }
    p += 46 + fl + el + cl;
  }
}
const model = BD.readBill(entry(zip, 'word/document.xml'), DOMParser);
const old = s => BD.readings(s.quoted.paras).old;
const text = paras => paras.map(p => '  ' + p).join('\n');
const gcn12 = model.sections.find(s => s.law === 'GCN' && s.act === 'amend');
const exc296 = model.sections.find(s => s.law === 'EXC');
const law = (id, name, secs) => ({ result: { info: { lawId: id, name, lawType: 'CONSOLIDATED', chapter: '' }, lawVersion: { activeDate: '2026-11-01' },
  documents: { docType: 'CHAPTER', documents: { items: [{ docType: 'ARTICLE', docLevelId: '1', title: 'Test excerpt', documents: { items: secs.map(([loc, title, t]) => ({ docType: 'SECTION', locationId: loc, title, text: t, documents: { items: [] } })) } }] } } } });
const out = path.join(__dirname, 'bank-fixture'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'GCN.json'), JSON.stringify(law('GCN', 'General Construction', [['11', 'Test section', '  § 11. Test section. Text for tests.'], ['12', 'Affidavit', text(old(gcn12))], ['13', 'Test section', '  § 13. Test section. Text for tests.']])));
fs.writeFileSync(path.join(out, 'EXC.json'), JSON.stringify(law('EXC', 'Executive', [['296', 'Unlawful discriminatory practices', '  § 296. Unlawful discriminatory practices.\n' + text(old(exc296)) + '\n  2. Text for tests.']])));
fs.writeFileSync(path.join(out, 'EDN.json'), JSON.stringify(law('EDN', 'Education', [['2-D', 'Unauthorized release of personally identifiable information', '  § 2-d. Unauthorized release of personally identifiable information. 1. Definitions. Text abbreviated for tests.']])));
// Insurance Law § 4103(a): a named table in the Bank's fixed-width layout (abbreviated, in the shape of the real one).
const isc = ['  § 4103. Financial requirements. (a) Capital and surplus.',
  '  (1) The minimum capital and surplus required are set forth in the following table:',
  '                               TABLE ONE.',
  '  Kind of insurance specified',
  '  in the following numbered          Paid-in        Paid-in',
  '  paragraphs of subsection           Capital        Surplus',
  '  (a) of § 1113:',
  '                               Group A:',
  '  7                                  $300,000       $150,000',
  '  8, 9, 10, 11, or 14 - for',
  '  each such kind                     $100,000        $50,000',
  '  13 or 15 -',
  '  for each such kind                 $500,000       $250,000',
  '  22                               $2,000,000     $1,000,000',
  '{3} If licensed to write paragraph 4, no additional paid-in capital',
  'and surplus is required.',
  '  (2) Text for tests.',
  '  (b) Text for tests.'].join('\n');
fs.writeFileSync(path.join(out, 'ISC.json'), JSON.stringify(law('ISC', 'Insurance', [['4103', 'Financial requirements', isc]])));
console.log('wrote', fs.readdirSync(out).join(', '));
