// Makes clean copies with the pane's own code:  node tests/cleancopy.mjs [bill.akn.xml ...]  (default: the example bill)
// Runs the pane's src/cleancopy.js unchanged: fetch() and document.baseURI point at the add-in folder on disk.
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const files = process.argv.length > 2 ? process.argv.slice(2) : [path.join(root, 'examples', 'Example bill.akn.xml')];
let failed = 0;
globalThis.document = { baseURI: pathToFileURL(root + '/taskpane.html').href };
globalThis.fetch = async (u) => { const p = new URL(u).pathname; try { const b = fs.readFileSync(decodeURIComponent(p)); return new Response(b, { status: 200, headers: { "Content-Type": p.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" } }); } catch { return new Response(null, { status: 404 }); } };
(0, eval)(fs.readFileSync(root + '/src/cleancopy.js', 'utf8'));
for (const f of files) {
  const t0 = Date.now();
  try { const pdf = await globalThis.BD.cleanCopyPdf(fs.readFileSync(f, 'utf8'), () => {});
        if (process.argv.length > 2) fs.writeFileSync(f.replace(/\.xml$/, '') + '.pane.pdf', pdf);
        console.log('OK  ', path.basename(f), pdf.length, 'bytes', ((Date.now() - t0) / 1000).toFixed(1) + 's'); }
  catch (e) { failed++; console.log('FAIL', path.basename(f), String(e && e.message || e).slice(0, 300)); }
}
process.exit(failed ? 1 : 0);
