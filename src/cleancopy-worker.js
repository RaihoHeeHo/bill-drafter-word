/* Bill Drafter for Word (demo) - the clean-copy typesetter in a worker of its own, so the pane stays responsive while
   a long bill is laid out (a part of a whole budget bill takes some 20 seconds). src/cleancopy.js sends it the XML
   and the template's inputs; it sends back the PDF, and where each agency begins when asked. */
let ready = null, base = '';
const TEMPLATE_FILES = ['hyphenation.json', 'hyphenation-approp.json', 'hyphenation-flow.json'];
async function bytes(path) { const r = await fetch(base + path); if (!r.ok) throw new Error('Could not load ' + path + ' (' + r.status + ').'); return new Uint8Array(await r.arrayBuffer()); }
async function text(path) { const r = await fetch(base + path); if (!r.ok) throw new Error('Could not load ' + path + ' (' + r.status + ').'); return r.text(); }
function load() {
  if (ready) return ready;
  ready = (async () => {
    const mod = await import(base + 'vendor/typst/typst_ts_web_compiler.mjs');
    await mod.default({ module_or_path: base + 'vendor/typst/typst_ts_web_compiler_bg.wasm' });
    const b = new mod.TypstCompilerBuilder();
    b.set_dummy_access_model();
    for (const f of ['FreeMono.ttf', 'FreeMonoBold.ttf']) await b.add_raw_font(await bytes('clean-copy/fonts/' + f));
    const c = await b.build();
    c.add_source('/bill.typ', await text('clean-copy/bill.typ'));
    for (const f of TEMPLATE_FILES) c.map_shadow('/' + f, await bytes('clean-copy/' + f));
    return c;
  })();
  ready.catch(() => { ready = null; });
  return ready;
}
function readable(e) {
  const t = String(e && e.message || e);
  const m = [...t.matchAll(/message: "((?:[^"\\]|\\.)*)"/g)].map(x => x[1]);
  return m.length ? [...new Set(m)].join('; ') : t;
}
self.onmessage = async ev => {
  const { id, type } = ev.data;
  try {
    if (type === 'init') { base = ev.data.base; await load(); self.postMessage({ id, ok: true }); return; }
    const c = await load();
    if (type === 'compile') {
      c.map_shadow('/bill.akn.xml', new TextEncoder().encode(ev.data.xml));
      let out;
      try { out = c.compile('/bill.typ', ev.data.inputs, 'pdf', 1); } catch (e) { throw new Error('The clean copy could not be made: ' + readable(e)); }
      const pdf = out && (out.result || out);
      if (!(pdf instanceof Uint8Array) || !pdf.length) throw new Error('The clean copy could not be made: ' + (out && out.diagnostics ? out.diagnostics.map(x => x.message || readable(x)).join('; ') : 'no output'));
      let query = null;
      if (ev.data.query) { try { query = c.query('/bill.typ', ev.data.inputs, ev.data.query, 'value'); } catch (e) { throw new Error('The clean copy could not be made: ' + readable(e)); } }
      try { c.evict_cache(0); } catch (e) { /* older compilers */ }
      const copy = pdf.slice(); // its own buffer, so it can be handed over without touching the compiler's memory
      self.postMessage({ id, pdf: copy, query }, [copy.buffer]);
    }
  } catch (e) { self.postMessage({ id, error: String(e && e.message || e) }); }
};
