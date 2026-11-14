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
      // Where real prints divide words at a line end; the template divides only there.
      compiler.map_shadow('/hyphenation.json', await bytes('clean-copy/hyphenation.json'));
      return compiler;
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }

  // XML text -> PDF bytes. Throws with Typst's messages when the template can't lay it out.
  async function cleanCopyPdf(xml, progress) {
    const c = await load(progress);
    progress && progress('Laying out the clean copy…');
    c.map_shadow('/bill.akn.xml', new TextEncoder().encode(xml));
    const out = c.compile('/bill.typ', [['xml', '/bill.akn.xml'], ['font', 'FreeMono']], 'pdf', 1);
    const pdf = out && (out.result || out);
    if (!(pdf instanceof Uint8Array) || !pdf.length) {
      const d = out && out.diagnostics ? out.diagnostics.map(x => x.message || JSON.stringify(x)).join('; ') : 'no output';
      throw new Error('The clean copy could not be made: ' + d);
    }
    return pdf;
  }

  Object.assign(BD, { cleanCopyPdf });
})(typeof globalThis !== 'undefined' ? globalThis : this);
