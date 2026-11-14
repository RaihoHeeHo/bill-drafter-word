// node tests/bank-sweep.cjs <Bank dir>: run every table in a folder of Bank law files through the table tools.
// Every section of the staged Bank laws that holds a table: detect it, then strike two rows, change a cell, add a row,
// and check the marked text reads back to the law and to the change, with one bracket pair per struck run.
const fs = require('fs'), path = require('path');
for (const f of ['drafting', 'laws', 'tables', 'bank', 'ooxml', 'checks', 'akn']) require(path.join(__dirname, '..', 'src', 'lib', f + '.js'));
const BD = globalThis.BD, dir = process.argv[2] || 'Bank';
const fix = t => String(t || '').replace(/\\n/g, '\n');
let secs = 0, withT = 0, tables = 0, ok = 0, fails = [], shapes = {};
for (const f of fs.readdirSync(dir)) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), law = f.split(' - ')[0];
  const walk = x => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk);
    if (x.docType === 'SECTION' && x.text) one(law, x.locationId, fix(x.text)); for (const v of Object.values(x)) if (typeof v === 'object') walk(v); };
  walk(d.result.documents);
}
function one(law, loc, text) {
  secs++;
  let ps; try { ps = BD.lawParagraphs(text); } catch (e) { fails.push([law, loc, 'parse: ' + e.message]); return; }
  const ts = ps.filter(BD.isTable); if (!ts.length) return; withT++;
  ts.forEach((t, ti) => {
    tables++; const key = t.rows.length + 'x' + Math.max(...t.rows.map(r => r.cells.length)); shapes[key] = (shapes[key] || 0) + 1;
    try {
      const now = JSON.parse(JSON.stringify(ps)), nt = now.filter(BD.isTable)[ti];
      const body = nt.rows.map((r, i) => i).filter(i => nt.rows[i].kind === '' && nt.rows[i].cells.filter(c => String(c).trim()).length > 1);
      if (body.length >= 4) nt.rows.splice(body[1], 2);
      const c = nt.rows.find(r => r.kind === '' && r.cells.length > 1); if (c) c.cells[c.cells.length - 1] = '$123,456';
      nt.rows.push({ kind: '', cells: nt.rows[nt.rows.length - 1].cells.map((_, k) => k ? '9%' : 'New row') });
      const m = BD.markChanges(ps, now), r = BD.readings(m);
      if (!BD.sameText(r.old, ps)) throw new Error('old reading differs');
      if (!BD.sameText(r.now, now)) throw new Error('new reading differs');
      const mt = m.filter(BD.isTable)[ti]; if (!mt) throw new Error('table lost in marking');
      if (body.length >= 4) { const s = mt.rows.map(r => r.cells.map(c => c.map(x => x.k === 'del' ? x.t : '').join('')).join('|')).join('\n');
        const o = (s.match(/\[/g) || []).length, cl = (s.match(/\]/g) || []).length; if (o !== cl) throw new Error('brackets unbalanced'); }
      ok++;
    } catch (e) { fails.push([law, loc, e.message]); }
  });
}
console.log(`${secs} sections; ${withT} with tables; ${tables} tables; ${ok} round-trip; ${fails.length} problems`);
const by = {}; for (const [l, s, m] of fails) (by[m] = by[m] || []).push(l + ' ' + s);
for (const [m, v] of Object.entries(by)) console.log(' ', v.length, m, '|', v.slice(0, 6).join(', '));
console.log('largest shapes', Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 8));
