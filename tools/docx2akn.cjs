#!/usr/bin/env node
/* Converts a .docx saved from the Bill Drafter add-in to Akoma Ntoso 3.0 XML, with the same code the add-in uses.
     npm install            (once, in this folder's parent: installs @xmldom/xmldom)
     node tools/docx2akn.cjs "My bill.docx" [out.xml]
   The LBD number and session year come from the document's custom properties (LBD, SessionYear) when present.
   Law names in the <ref> links come from the amending clauses; no Bank is needed. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { DOMParser } = require('@xmldom/xmldom');
const lib = path.join(__dirname, '..', 'src', 'lib');
for (const f of ['drafting', 'bank', 'ooxml', 'checks', 'akn']) require(path.join(lib, f + '.js'));
const BD = globalThis.BD;

// A minimal zip reader (central directory, stored or deflated entries).
function unzip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a .docx (zip) file.');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), data = buf.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + size);
    out[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nl + xl + cl;
  }
  return out;
}
function props(xml) {
  const out = {}; if (!xml) return out;
  const re = /<property[^>]*name="([^"]+)"[^>]*>\s*<vt:[a-z0-9]+>([^<]*)<\/vt:/g; let m;
  while ((m = re.exec(xml))) out[m[1]] = m[2];
  return out;
}
const [, , input, output] = process.argv;
if (!input) { console.error('Usage: node tools/docx2akn.cjs bill.docx [out.xml]'); process.exit(2); }
const files = unzip(fs.readFileSync(input));
const docXml = files['word/document.xml']; if (!docXml) throw new Error('No word/document.xml in ' + input);
const model = BD.readBill(docXml.toString('utf8'), DOMParser);
const cp = props(files['docProps/custom.xml'] && files['docProps/custom.xml'].toString('utf8'));
const lawNames = {};
for (const s of model.sections) if (s.law && s.clause && !lawNames[s.law]) {
  const m = /\bof (the [a-z' ,]+?(?:law|act|rules|code)|the constitution)\b/.exec(s.clause) || /^(The [a-z' ,]+?(?:law|act|rules|code)) is amended by adding/.exec(s.clause);
  if (m) lawNames[s.law] = m[1].replace(/^The /, 'the ');
}
const xml = BD.toAkn(model, { lbd: cp.LBD || '', year: cp.SessionYear || '', lawNames });
if (output) fs.writeFileSync(output, xml); else process.stdout.write(xml);
if (!model.sections.length) console.error('Warning: no bill sections (akn:section content controls) were found.');
