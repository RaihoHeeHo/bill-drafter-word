/* Bill Drafter for Word (demo) - clean copy PDF inside the pane: the Akoma Ntoso XML is typeset with LBDC's
   clean-copy template (clean-copy/bill.typ, AKN-NY profile 0.3; it matches the public PDFs line for line, with word
   divisions from clean-copy/hyphenation.json) by the Typst compiler built for the browser (vendor/typst, Typst 0.15.1,
   the same version as the desktop app, so the pane's PDF is the desktop app's PDF).
   Everything loads from this site and runs on this computer; the bill is never sent anywhere.
   The compiler (about 30 MB) is fetched the first time it is used and then cached by the browser. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  let ready = null;
  const TEMPLATE_FILES = ['hyphenation.json', 'hyphenation-approp.json', 'hyphenation-flow.json'];
  const base = () => new URL('.', document.baseURI).href;
  async function bytes(path) { const r = await fetch(base() + path); if (!r.ok) throw new Error('Could not load ' + path + ' (' + r.status + ').'); return new Uint8Array(await r.arrayBuffer()); }
  async function text(path) { const r = await fetch(base() + path); if (!r.ok) throw new Error('Could not load ' + path + ' (' + r.status + ').'); return r.text(); }

  function load(progress) {
    if (ready) return ready;
    ready = (async () => {
      progress && progress('Loading the typesetter (first time only)…');
      const mod = await import(base() + 'vendor/typst/typst_ts_web_compiler.mjs');
      await mod.default({ module_or_path: base() + 'vendor/typst/typst_ts_web_compiler_bg.wasm' });
      const b = new mod.TypstCompilerBuilder();
      b.set_dummy_access_model();
      for (const f of ['FreeMono.ttf', 'FreeMonoBold.ttf']) await b.add_raw_font(await bytes('clean-copy/fonts/' + f));
      const compiler = await b.build();
      compiler.add_source('/bill.typ', await text('clean-copy/bill.typ'));
      // Every file the template reads with json() must be mapped here; one left out stops the build with Typst's
      // "failed to load file (access denied)". Where real prints divide words at a line end (the template divides
      // only there), where budget prints divide them, and the divisions learned from running text of long bills.
      for (const f of TEMPLATE_FILES) compiler.map_shadow('/' + f, await bytes('clean-copy/' + f));
      return compiler;
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }

  // Typst's diagnostics come back as Rust debug text; keep just the messages.
  function readable(e) {
    const t = String(e && e.message || e);
    const m = [...t.matchAll(/message: "((?:[^"\\]|\\.)*)"/g)].map(x => x[1]);
    return m.length ? [...new Set(m)].join('; ') : t;
  }

  // The typesetter runs in a worker of its own where the browser allows (src/cleancopy-worker.js), so the pane
  // stays responsive while a long bill is laid out; otherwise (tests in Node) here.
  // engine.compile(xml, extraInputs, query) -> { pdf, query }
  let engine = null;
  function workerEngine(progress) {
    const w = new Worker(base() + 'src/cleancopy-worker.js', { type: 'module' });
    let n = 0; const waiting = new Map();
    w.onmessage = e => { const f = waiting.get(e.data.id); if (!f) return; waiting.delete(e.data.id); e.data.error ? f.rej(new Error(e.data.error)) : f.res(e.data); };
    w.onerror = e => { for (const f of waiting.values()) f.rej(new Error('The typesetter stopped: ' + (e.message || 'out of memory?'))); waiting.clear(); engine = null; };
    const ask = (msg, transfer) => new Promise((res, rej) => { const id = ++n; waiting.set(id, { res, rej }); w.postMessage({ ...msg, id }, transfer || []); });
    progress && progress('Loading the typesetter (first time only)…');
    const started = ask({ type: 'init', base: base() });
    return started.then(() => ({ compile: (xml, extra, query) => ask({ type: 'compile', xml, inputs: [['xml', '/bill.akn.xml'], ['font', 'FreeMono']].concat(extra || []), query }) }));
  }
  function inlineEngine(progress) {
    return load(progress).then(c => ({
      compile: async (xml, extra, query) => {
        c.map_shadow('/bill.akn.xml', new TextEncoder().encode(xml));
        const inputs = [['xml', '/bill.akn.xml'], ['font', 'FreeMono']].concat(extra || []);
        let out;
        try { out = c.compile('/bill.typ', inputs, 'pdf', 1); } catch (e) { throw new Error('The clean copy could not be made: ' + readable(e)); }
        const pdf = out && (out.result || out);
        if (!(pdf instanceof Uint8Array) || !pdf.length) throw new Error('The clean copy could not be made: ' + (out && out.diagnostics ? out.diagnostics.map(x => x.message || readable(x)).join('; ') : 'no output'));
        let q = null;
        if (query) { try { q = c.query('/bill.typ', inputs, query, 'value'); } catch (e) { throw new Error('The clean copy could not be made: ' + readable(e)); } }
        try { c.evict_cache(0); } catch (e) { /* older compilers */ }
        return { pdf, query: q };
      },
    }));
  }
  function getEngine(progress) {
    if (engine) return engine;
    engine = (typeof Worker !== 'undefined' ? workerEngine(progress).catch(() => inlineEngine(progress)) : inlineEngine(progress));
    engine.catch(() => { engine = null; });
    return engine;
  }

  // A long budget bill is too much for the browser's typesetter in one go (all of S.3003-D, 1,518 pages, runs it
  // out of memory; a part of about 460 pages takes some 25 seconds). It is printed in parts, split between agencies
  // (each agency begins a page of its own, so the parts paginate as the whole bill does), each part beginning on
  // the page after the last one, and the parts are joined into one PDF. The template takes the part's first page,
  // prints the front matter only in the first part and the table of contents only in the last, and reports where
  // each agency begins, which the last part's table of contents needs.
  const PART_LIMIT = 1600000; // characters of XML in a part: about 280 pages, well inside the browser's memory
  const AKN = 'http://docs.oasis-open.org/legaldocml/ns/akn/3.0';
  // The parts, made from one copy of the bill: each part's agencies are put in, the part written out, and taken
  // out again (a copy of the whole bill for every part would need several times the memory).
  function parts(xml) {
    const P = root.DOMParser, S = root.XMLSerializer;
    const doc = new P().parseFromString(xml, 'application/xml');
    const agencies = [...doc.getElementsByTagNameNS(AKN, 'hcontainer')].filter(e => e.getAttribute('name') === 'agency' && e.parentNode.localName === 'section');
    if (!agencies.length) return null;
    const groups = []; let cur = [], n = 0;
    for (const a of agencies) { const sz = new S().serializeToString(a).length; if (cur.length && n + sz > PART_LIMIT) { groups.push(cur); cur = []; n = 0; } cur.push(a); n += sz; }
    groups.push(cur);
    if (groups.length < 2) return null;
    // take every agency out, keeping where each goes back
    const home = agencies.map(a => ({ a, parent: a.parentNode, next: a.nextSibling }));
    for (const a of agencies) a.parentNode.removeChild(a);
    // section 1's opening paragraphs belong to the first part; the table of contents to the last
    const opening = [...doc.getElementsByTagNameNS(AKN, 'section')].flatMap(s => [...s.childNodes].filter(c => c.nodeType === 1 && /^(intro|num|heading)$/.test(c.localName)).map(c => ({ c, parent: s, next: c.nextSibling })));
    const toc = [...doc.getElementsByTagNameNS(AKN, 'conclusions')].map(c => ({ c, parent: c.parentNode, next: c.nextSibling }));
    const out = groups.map((g, i) => {
      if (i === 1) for (const o of opening) o.parent.removeChild(o.c);
      if (i === 0) for (const t of toc) t.parent.removeChild(t.c);
      if (i === groups.length - 1) for (const t of toc) t.parent.insertBefore(t.c, t.next && t.next.parentNode === t.parent ? t.next : null);
      const placed = home.filter(h => g.includes(h.a));
      for (const h of placed) h.parent.appendChild(h.a); // agencies keep their order: they are appended in it
      const x = new S().serializeToString(doc);
      for (const h of placed) h.parent.removeChild(h.a);
      return { xml: x, agencies: g.length };
    });
    return out;
  }
  // extra: more of the template's inputs, e.g. [['fingerprint', 'XXXX-XXXX-XXXX'], ['void', 'yes']] (signed packages).
  async function cleanCopyPdf(xml, progress, extra) {
    extra = extra || [];
    const c = await getEngine(progress);
    const ps = xml.length > PART_LIMIT * 1.15 ? parts(xml) : null;
    if (!ps) { progress && progress('Laying out the clean copy…'); return (await c.compile(xml, extra)).pdf; }
    if (!root.PDFLib) throw new Error('The PDF joiner (vendor/pdf-lib) did not load.');
    const done = [], pages = {}; let offset = 0;
    for (let i = 0; i < ps.length; i++) {
      progress && progress('Laying out the clean copy, part ' + (i + 1) + ' of ' + ps.length + (offset ? ' (from page ' + (offset + 1) + ')' : '') + '…');
      await new Promise(r => setTimeout(r, 0)); // let the pane show it
      const r = await c.compile(ps[i].xml, [['page-offset', String(offset)], ['front', i === 0 ? 'yes' : 'no'], ['toc', i === ps.length - 1 ? 'yes' : 'no'], ['agency-pages', JSON.stringify(pages)]].concat(extra), '<agency-page>');
      try { for (const x of JSON.parse(r.query)) pages[x.eid] = x.page; }
      catch (e) { throw new Error('The clean copy could not be made: where the agencies begin could not be read (' + readable(e) + ').'); }
      const part = await root.PDFLib.PDFDocument.load(r.pdf);
      done.push(part); offset += part.getPageCount();
    }
    progress && progress('Joining the ' + ps.length + ' parts (' + offset.toLocaleString() + ' pages)…');
    const out = await root.PDFLib.PDFDocument.create();
    for (const part of done) for (const pg of await out.copyPages(part, part.getPageIndices())) out.addPage(pg);
    return out.save();
  }

  Object.assign(BD, { cleanCopyPdf, cleanCopyParts: parts });
})(typeof globalThis !== 'undefined' ? globalThis : this);
