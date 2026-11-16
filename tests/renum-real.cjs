// Renumberings found by the add-in's reader (akn.js) in real bills, compared with those the profile's converter
// recorded in the hand-checked XML (profile real/*.xml). Run: node tests/renum-real.cjs <bill.xml> ...
const fs = require('fs'), { DOMParser } = require('@xmldom/xmldom');
for (const f of ['laws', 'ooxml', 'tables', 'drafting', 'akn']) require('../src/lib/' + f + '.js');
const BD = globalThis.BD;
const A = 'http://docs.oasis-open.org/legaldocml/ns/akn/3.0';
const UNIT = new Set(['section', 'subsection', 'subdivision', 'paragraph', 'subparagraph', 'clause', 'subclause', 'point']);
function runsOf(el, out, k) {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out.push({ t: n.nodeValue.replace(/\s+/g, ' '), k });
    else if (n.nodeType === 1) {
      if (n.localName === 'del') { out.push({ t: '[', k: 'del' }); runsOf(n, out, 'del'); out.push({ t: ']', k: 'del' }); }
      else if (n.localName === 'ins') runsOf(n, out, 'ins');
      else if (n.localName !== 'quotedStructure') runsOf(n, out, k);
    }
  }
  return out;
}
function paras(q) {
  const out = [];
  const unit = u => {
    let line = [];
    for (const c of Array.from(u.childNodes).filter(n => n.nodeType === 1)) {
      if (c.localName === 'num' || c.localName === 'heading') { if (line.length) line.push({ t: ' ', k: '' }); runsOf(c, line, ''); }
      else if (UNIT.has(c.localName)) { if (line.length) { out.push(line); line = []; } unit(c); }
      else if (['content', 'intro', 'wrapUp'].includes(c.localName)) {
        for (const p of Array.from(c.getElementsByTagNameNS(A, 'p'))) { const r = runsOf(p, [], ''); if (line.length) { line.push({ t: ' ', k: '' }); line.push(...r); out.push(line); line = []; } else out.push(r); }
        if (line.length) { out.push(line); line = []; }
      } else if (c.localName === 'hcontainer') { for (const p of Array.from(c.getElementsByTagNameNS(A, 'p'))) out.push(runsOf(p, [], '')); }
    }
    if (line.length) out.push(line);
  };
  for (const c of Array.from(q.childNodes).filter(n => n.nodeType === 1)) if (UNIT.has(c.localName)) unit(c); else for (const p of Array.from(c.getElementsByTagNameNS(A, 'p'))) out.push(runsOf(p, [], ''));
  return out.map(rs => { const m = []; for (const r of rs) { const l = m[m.length - 1]; if (l && l.k === r.k) l.t += r.t; else m.push({ ...r }); } m.forEach(r => r.t = r.t.replace(/ {2,}/g, ' ')); if (m[0]) m[0].t = m[0].t.replace(/^\s+/, ''); return m; });
}
let bad = 0;
for (const f of process.argv.slice(2)) {
  const doc = new DOMParser().parseFromString(fs.readFileSync(f, 'utf8'), 'application/xml');
  const want = Array.from(doc.getElementsByTagNameNS(A, 'textualMod')).filter(t => t.getAttribute('type') === 'renumbering')
    .map(t => ({ src: t.getElementsByTagNameNS(A, 'source')[0].getAttribute('href').slice(1), old: t.getElementsByTagNameNS(A, 'destination')[0].getAttribute('href'), now: (t.getElementsByTagNameNS(A, 'new')[0] || { getAttribute: () => '' }).getAttribute('href') }));
  const got = [];
  for (const mod of Array.from(doc.getElementsByTagNameNS(A, 'mod'))) {
    const q = mod.getElementsByTagNameNS(A, 'quotedStructure')[0]; if (!q) continue;
    const ref = mod.getElementsByTagNameNS(A, 'ref')[0], href = ref ? ref.getAttribute('href') : '';
    const m = /^(.*?)\/~(.*)$/.exec(href); if (!m) continue;
    const target = m[2].split('__').map(s => { const i = s.indexOf('_'); return [s.slice(0, i), s.slice(i + 1)]; });
    const sub = /__subsec_|\/(tax|isc)\//.test(href);
    for (const r of BD.renumberedIn(paras(q), sub, target)) got.push({ src: mod.getAttribute('eId'), old: m[1] + '/~' + r.old.map(a => a.join('_')).join('__'), now: m[1] + '/~' + r.now.map(a => a.join('_')).join('__') });
  }
  // only the moves made inside quoted text (the converter also records lead-in renumberings, which have no quoted pair)
  const key = r => r.old + ' -> ' + r.now, G = new Set(got.map(key)), W = new Set(want.map(key));
  const missing = want.filter(r => !G.has(key(r))), extra = got.filter(r => !W.has(key(r)));
  console.log(f.split('/').pop() + ': recorded ' + want.length + ', found ' + got.length + ', missing ' + missing.length + ', extra ' + extra.length);
  for (const r of missing) console.log('  missing ' + key(r) + '  (' + r.src + ')');
  for (const r of extra) console.log('  extra   ' + key(r) + '  (' + r.src + ')');
  bad += extra.length;
}
process.exit(bad ? 1 : 0);
