/* Bill Drafter for Word (demo) - the words drawn on each page of a PDF, for signed clean copies.
   A clean copy's signed package carries pdftext.txt: the text of each page as drawn, so a PDF whose pages were
   changed in another program is VOID when it is checked, without typesetting the bill again (after the Chrome
   extension's .nysbill files). General PDF text extractors disagree with one another (on hyphens, spaces, word
   order), so this reads the page the same simple way here and in the profile's tools/nysakn.py: every string a
   page shows (Tj, TJ, ', "), in the order the page's content draws it, each code turned into text through its
   font's ToUnicode map, then all white space removed. Needs pdf-lib (vendor/pdf-lib) for the PDF's objects. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const SPACE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]/g;
  const squeeze = s => String(s || '').replace(SPACE, '');
  const dec = new TextDecoder('latin1');

  /* ---------- content stream tokens ---------- */
  const WS = c => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
  const DELIM = c => c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
  function* tokens(u) {
    let i = 0; const n = u.length;
    while (i < n) {
      const c = u[i];
      if (WS(c)) { i++; continue; }
      if (c === 0x25) { while (i < n && u[i] !== 0x0a && u[i] !== 0x0d) i++; continue; } // comment
      if (c === 0x28) { // (literal string)
        const out = []; let depth = 1; i++;
        while (i < n && depth) {
          let b = u[i++];
          if (b === 0x5c) {
            const e = u[i++];
            if (e === 0x6e) out.push(10); else if (e === 0x72) out.push(13); else if (e === 0x74) out.push(9); else if (e === 0x62) out.push(8); else if (e === 0x66) out.push(12);
            else if (e >= 0x30 && e <= 0x37) { let v = e - 48, k = 0; while (k < 2 && u[i] >= 0x30 && u[i] <= 0x37) { v = v * 8 + u[i++] - 48; k++; } out.push(v & 255); }
            else if (e === 0x0d) { if (u[i] === 0x0a) i++; } else if (e === 0x0a) { /* line continuation */ } else out.push(e);
            continue;
          }
          if (b === 0x28) depth++; else if (b === 0x29 && !--depth) break;
          out.push(b);
        }
        yield { s: Uint8Array.from(out) }; continue;
      }
      if (c === 0x3c && u[i + 1] === 0x3c) { yield { op: '<<' }; i += 2; continue; }
      if (c === 0x3e && u[i + 1] === 0x3e) { yield { op: '>>' }; i += 2; continue; }
      if (c === 0x3c) { // <hex string>
        let h = ''; i++; while (i < n && u[i] !== 0x3e) { const ch = String.fromCharCode(u[i++]); if (/[0-9a-f]/i.test(ch)) h += ch; } i++;
        if (h.length % 2) h += '0';
        const out = new Uint8Array(h.length / 2); for (let k = 0; k < out.length; k++) out[k] = parseInt(h.substr(2 * k, 2), 16);
        yield { s: out }; continue;
      }
      if (c === 0x5b) { yield { op: '[' }; i++; continue; }
      if (c === 0x5d) { yield { op: ']' }; i++; continue; }
      if (c === 0x2f) { let j = i + 1; while (j < n && !WS(u[j]) && !DELIM(u[j])) j++; yield { name: dec.decode(u.subarray(i + 1, j)) }; i = j; continue; }
      let j = i; while (j < n && !WS(u[j]) && !DELIM(u[j])) j++;
      if (j === i) { i++; continue; }
      const w = dec.decode(u.subarray(i, j)); i = j;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) yield { num: +w }; else yield { op: w };
      // inline images: skip to EI
      if (w === 'ID') { i++; while (i < n && !(u[i] === 0x45 && u[i + 1] === 0x49 && (i + 2 >= n || WS(u[i + 2])))) i++; i += 2; }
    }
  }

  /* ---------- ToUnicode maps ---------- */
  const hexBytes = u => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
  const utf16 = u => { let s = ''; for (let k = 0; k + 1 < u.length; k += 2) s += String.fromCharCode((u[k] << 8) | u[k + 1]); return s; };
  function parseCMap(u) {
    const map = new Map(), toks = [...tokens(u)];
    let width = 0;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.op === 'begincodespacerange' && toks[k + 1] && toks[k + 1].s) width = toks[k + 1].s.length;
      if (t.op === 'beginbfchar') {
        for (k++; k + 1 < toks.length && toks[k].op !== 'endbfchar'; k += 2) if (toks[k].s && toks[k + 1].s) map.set(hexBytes(toks[k].s), utf16(toks[k + 1].s));
      }
      if (t.op === 'beginbfrange') {
        for (k++; k < toks.length && toks[k].op !== 'endbfrange';) {
          const lo = toks[k], hi = toks[k + 1], dst = toks[k + 2]; if (!lo || !lo.s || !hi || !hi.s) { k++; continue; }
          const w = lo.s.length, a = parseInt(hexBytes(lo.s), 16), b = parseInt(hexBytes(hi.s), 16);
          if (dst && dst.s) {
            const base = dst.s;
            for (let v = a; v <= b && v - a < 65536; v++) {
              const d = base.slice(); let carry = v - a, p = d.length - 1;
              while (carry && p >= 0) { const s0 = d[p] + carry; d[p] = s0 & 255; carry = s0 >> 8; p--; }
              map.set(v.toString(16).padStart(w * 2, '0'), utf16(d));
            }
            k += 3;
          } else if (dst && dst.op === '[') {
            let v = a; k += 3;
            while (k < toks.length && toks[k].op !== ']') { if (toks[k].s) map.set((v++).toString(16).padStart(w * 2, '0'), utf16(toks[k].s)); k++; }
            k++;
          } else k += 3;
        }
      }
    }
    return { map, width };
  }

  /* ---------- pages ---------- */
  function pagesText(pdfDoc) {
    const P = root.PDFLib, N = P.PDFName;
    const streamBytes = s => P.decodePDFRawStream(s).decode();
    const fontInfo = new Map();
    const fontOf = ref => {
      if (fontInfo.has(ref)) return fontInfo.get(ref);
      const f = pdfDoc.context.lookup(ref, P.PDFDict);
      const tu = f.lookupMaybe(N.of('ToUnicode'), P.PDFStream), sub = f.lookupMaybe(N.of('Subtype'), P.PDFName);
      const info = tu ? parseCMap(streamBytes(tu)) : { map: new Map(), width: 0 };
      if (!info.width) info.width = sub && sub.asString() === '/Type0' ? 2 : 1;
      fontInfo.set(ref, info); return info;
    };
    const run = (bytes, resources, out, depth) => {
      if (depth > 8) return;
      const fonts = resources && resources.lookupMaybe(N.of('Font'), P.PDFDict), xobjs = resources && resources.lookupMaybe(N.of('XObject'), P.PDFDict);
      let font = null; const stack = [];
      const show = s => { if (!font) return; const w = font.width; for (let k = 0; k + w <= s.length; k += w) { const key = hexBytes(s.subarray(k, k + w)); out.push(font.map.has(key) ? font.map.get(key) : ''); } };
      for (const t of tokens(bytes)) {
        if (!t.op || t.op === '[' || t.op === '<<') { stack.push(t); continue; }
        if (t.op === ']') { const arr = []; while (stack.length && stack[stack.length - 1].op !== '[') arr.unshift(stack.pop()); stack.pop(); stack.push({ arr }); continue; }
        if (t.op === '>>') { while (stack.length && stack[stack.length - 1].op !== '<<') stack.pop(); stack.pop(); stack.push({ dict: true }); continue; }
        const args = stack.splice(0);
        if (t.op === 'Tf') { const nm = args.find(a => a.name); const ref = nm && fonts && fonts.get(N.of(nm.name)); font = ref ? fontOf(ref) : null; }
        else if (t.op === 'Tj' || t.op === "'") { const s = args.filter(a => a.s).pop(); if (s) show(s.s); }
        else if (t.op === '"') { const s = args.filter(a => a.s).pop(); if (s) show(s.s); }
        else if (t.op === 'TJ') { const a = args.find(x => x.arr); if (a) for (const e of a.arr) if (e.s) show(e.s); }
        else if (t.op === 'Do' && xobjs) {
          const nm = args.find(a => a.name), x = nm && xobjs.lookupMaybe(N.of(nm.name), P.PDFStream);
          if (x && x.dict.lookupMaybe(N.of('Subtype'), P.PDFName) && x.dict.lookupMaybe(N.of('Subtype'), P.PDFName).asString() === '/Form')
            run(streamBytes(x), x.dict.lookupMaybe(N.of('Resources'), P.PDFDict) || resources, out, depth + 1);
        }
      }
    };
    return pdfDoc.getPages().map(page => {
      const node = page.node, out = [];
      const c = node.Contents(), res = node.Resources();
      const parts = !c ? [] : c instanceof P.PDFArray ? c.asArray().map(r => pdfDoc.context.lookup(r, P.PDFStream)) : [c instanceof P.PDFStream ? c : pdfDoc.context.lookup(c, P.PDFStream)];
      const bytes = parts.map(streamBytes), all = new Uint8Array(bytes.reduce((n, b) => n + b.length + 1, 0)); let at = 0;
      for (const b of bytes) { all.set(b, at); at += b.length; all[at++] = 0x0a; }
      run(all, res, out, 0);
      return out.join('');
    });
  }
  // The text of each page of a PDF (bytes), as pdftext.txt holds it: pages separated by form feeds.
  async function pdfPagesText(pdfBytes) {
    const P = root.PDFLib; if (!P) throw new Error('The PDF library (vendor/pdf-lib) did not load.');
    return pagesText(await P.PDFDocument.load(pdfBytes, { updateMetadata: false }));
  }
  // Compare a PDF's pages with the pdftext.txt its package signed: the pages that differ (1-based), or [] if none.
  function comparePages(pages, signedText) {
    const want = String(signedText || '').split('\f'), bad = [];
    if (want.length !== pages.length) return { count: true, pages: pages.length, signed: want.length, differ: [] };
    pages.forEach((p, i) => { if (squeeze(p) !== squeeze(want[i])) bad.push(i + 1); });
    return { count: false, differ: bad };
  }

  BD.pdftext = { pdfPagesText, comparePages, squeeze, parseCMap, tokens };
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
