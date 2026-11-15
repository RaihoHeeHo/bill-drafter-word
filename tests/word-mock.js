/* A small stand-in for Office.js / Word, for testing the task pane in a plain browser.
   It keeps a WordprocessingML document in memory and does what Word does with content controls
   (every w:sdt is one), getOoxml and insertOoxml. It is NOT Word: it checks our logic, not Word's quirks. */
(function () {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const parse = s => new DOMParser().parseFromString(s, 'application/xml');
  const doc = parse('<w:document xmlns:w="' + W + '"><w:body><w:p/></w:body></w:document>');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  window.__mockDoc = doc;
  const ser = n => new XMLSerializer().serializeToString(n);
  const pkgOf = inner => '<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage"><pkg:part pkg:name="/word/document.xml"><pkg:xmlData><w:document xmlns:w="' + W + '"><w:body>' + inner + '</w:body></w:document></pkg:xmlData></pkg:part></pkg:package>';
  // What Word does to inserted OOXML that matters to us:
  //  - a style's id is made again from its name ("Bill Insert (new matter)" -> BillInsertnewmatter);
  //  - the first and last paragraph merge into the paragraph where the content lands, so an empty paragraph
  //    there disappears and a content control holding just one paragraph becomes an inline control in it.
  function bodyKids(pkg) {
    const d = parse(pkg), b = d.getElementsByTagNameNS(W, 'body')[0];
    const ids = {};
    for (const st of d.getElementsByTagNameNS(W, 'style')) { const nm = st.getElementsByTagNameNS(W, 'name')[0]; if (nm) ids[st.getAttribute('w:styleId')] = nm.getAttribute('w:val').replace(/[^A-Za-z0-9]/g, ''); }
    for (const tagName of ['pStyle', 'rStyle']) for (const e of [...b.getElementsByTagNameNS(W, tagName)]) { const v = e.getAttribute('w:val'); if (ids[v]) e.setAttribute('w:val', ids[v]); }
    const out = []; for (let c = b.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(doc.importNode(c, true));
    const edge = i => {
      const k = out[i]; if (!k) return;
      if (k.localName === 'p' && !k.textContent.trim()) { out.splice(i, 1); return; }
      const c = k.localName === 'sdt' && contentOf(k), ps = c ? [...c.childNodes].filter(n => n.nodeType === 1) : [];
      if (ps.length === 1 && ps[0].localName === 'p') {
        const p = ps[0], pPr = [...p.childNodes].find(n => n.localName === 'pPr'), np = doc.createElementNS(W, 'w:p');
        if (pPr) { np.appendChild(pPr); }
        c.removeChild(p); while (p.firstChild) c.appendChild(p.firstChild);
        np.appendChild(k); out[i] = np;
      }
    };
    edge(out.length - 1); edge(0);
    return out;
  }
  const blockOf = n => isInline(n) ? n.parentNode.localName === 'p' ? n.parentNode : blockOf(n.parentNode.parentNode) : n;
  const NULL_CC = { isNullObject: true, tag: '', load() { return this; } };
  const ccFor = n => { const c = CC.cache.get(n) || new CC(n); CC.cache.set(n, c); c.tag = tagOf(n); return c; };
  const parentSdt = n => { for (let a = n.parentNode; a && a.nodeType === 1; a = a.parentNode) if (a.localName === 'sdt') return a; return null; };
  const tagOf = sdt => { const t = sdt.getElementsByTagNameNS(W, 'tag')[0]; return t ? t.getAttributeNS(W, 'val') || t.getAttribute('w:val') : ''; };
  const aliasOf = sdt => { const t = sdt.getElementsByTagNameNS(W, 'alias')[0]; return t ? t.getAttribute('w:val') : ''; };
  const contentOf = sdt => [...sdt.childNodes].find(n => n.localName === 'sdtContent');
  const isInline = sdt => sdt.parentNode && (sdt.parentNode.localName === 'p' || (sdt.parentNode.localName === 'sdtContent' && sdt.parentNode.parentNode && isInline(sdt.parentNode.parentNode)));
  window.__ops = [];

  class Proxy { load() { return this; } }
  class CC extends Proxy {
    constructor(node) { super(); this.node = node; this.tag = tagOf(node); this.title = aliasOf(node); this._title = this.title; }
    get text() { return contentOf(this.node).textContent; }
    get contentControls() { return new CCs(this.node); }
    get paragraphs() { return new Paras(contentOf(this.node)); }
    getRange() { return new Range(this.node); }
    get isNullObject() { return false; }
    get id() { if (!CC.ids.has(this.node)) CC.ids.set(this.node, CC.ids.size + 1); return CC.ids.get(this.node); }
    get parentContentControlOrNullObject() { const a = parentSdt(this.node); return a ? ccFor(a) : NULL_CC; }
    getOoxml() { return { value: pkgOf(isInline(this.node) ? '<w:p xmlns:w="' + W + '">' + ser(this.node) + '</w:p>' : ser(this.node)) }; }
    insertOoxml(x, where) {
      window.__ops.push('cc.insertOoxml ' + where);
      const c = contentOf(this.node), kids = bodyKids(x);
      if (where === 'Replace') { while (c.firstChild) c.removeChild(c.firstChild); kids.forEach(k => c.appendChild(k)); c.appendChild(doc.createElementNS(W, 'w:p')); } // Word adds an empty paragraph
      else if (where === 'End') kids.forEach(k => c.appendChild(k));
      else if (where === 'Start') kids.reverse().forEach(k => c.insertBefore(k, c.firstChild));
    }
    insertText(t, where) {
      const c = contentOf(this.node);
      if (where === 'Replace') {
        const firstR = c.getElementsByTagNameNS(W, 'r')[0], rPr = firstR && [...firstR.childNodes].find(n => n.localName === 'rPr');
        const r = doc.createElementNS(W, 'w:r'); if (rPr) r.appendChild(rPr.cloneNode(true));
        const tt = doc.createElementNS(W, 'w:t'); tt.setAttribute('xml:space', 'preserve'); tt.textContent = t; r.appendChild(tt);
        while (c.firstChild) c.removeChild(c.firstChild); c.appendChild(r);
      }
    }
    delete(keep) { window.__ops.push('cc.delete'); if (!keep) this.node.parentNode.removeChild(this.node); }
    select() { window.__selected = this.tag; window.__selectedNode = this.node; }
  }
  class CCs extends Proxy {
    constructor(root) { super(); this.root = root; }
    get items() {
      const all = [...this.root.getElementsByTagNameNS(W, 'sdt')].filter(n => n !== this.root);
      return all.map(ccFor);
    }
  }
  CC.cache = new WeakMap(); CC.ids = new Map();
  class Range extends Proxy {
    constructor(node) { super(); this.node = node; }
    insertOoxml(x, where) {
      window.__ops.push('range.insertOoxml ' + where);
      const kids = bodyKids(x), n = blockOf(this.node); // inside a paragraph, Word splits it; near enough
      if (where === 'Before') kids.forEach(k => n.parentNode.insertBefore(k, n));
      else if (where === 'After') { let ref = n.nextSibling; kids.forEach(k => n.parentNode.insertBefore(k, ref)); }
    }
  }
  // A paragraph's text as Word gives it: tabs as tab characters.
  const textOf = n => { let s = ''; for (const e of n.getElementsByTagNameNS(W, '*')) { if (e.localName === 't') s += e.textContent; else if (e.localName === 'tab' && e.parentNode.localName === 'r') s += '\t'; } return s; };
  class Paras extends Proxy {
    constructor(root) { super(); this.root = root; }
    get items() { return [...this.root.childNodes].filter(n => n.localName === 'p').map(p => ({ text: textOf(p), delete() { p.parentNode.removeChild(p); } })); }
    // an inline control's first paragraph is the one it sits in, as in Word
    getFirst() { let p = [...this.root.getElementsByTagNameNS(W, 'p')][0]; if (!p) for (let a = this.root.parentNode; a; a = a.parentNode) if (a.localName === 'p') { p = a; break; } return { text: p ? textOf(p) : '', load() { return this; } }; }
  }
  const props = [];
  const document_ = {
    body: {
      getOoxml() { return { value: pkgOf([...body.childNodes].map(ser).join('')) }; },
      get paragraphs() {
        return { load() { return this; }, items: [...body.getElementsByTagNameNS(W, 'p')].map(p => ({
          text: p.textContent, load() { return this; }, delete() { if (p.parentNode) p.parentNode.removeChild(p); },
          get parentContentControlOrNullObject() { const a = parentSdt(p); return a ? ccFor(a) : NULL_CC; } })) };
      },
      // Word's tracked changes (WordApi 1.6): accepting an insertion keeps its words, rejecting it takes them out;
      // accepting a deletion takes the words out, rejecting it puts them back.
      getTrackedChanges() {
        const unwrap = n => { while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n); n.parentNode.removeChild(n); };
        const items = [...body.getElementsByTagNameNS(W, '*')].filter(n => n.localName === 'ins' || n.localName === 'del').map(n => {
          const ins = n.localName === 'ins';
          const text = [...n.getElementsByTagNameNS(W, '*')].filter(e => e.localName === 't' || e.localName === 'delText').map(e => e.textContent).join('');
          return { author: n.getAttribute('w:author'), date: n.getAttribute('w:date'), text, type: ins ? 'Added' : 'Deleted',
            accept() { window.__ops.push('tc.accept'); if (ins) unwrap(n); else n.parentNode.removeChild(n); },
            reject() { window.__ops.push('tc.reject'); if (ins) n.parentNode.removeChild(n); else { for (const e of [...n.getElementsByTagNameNS(W, 'delText')]) { const t = doc.createElementNS(W, 'w:t'); t.textContent = e.textContent; e.parentNode.replaceChild(t, e); } unwrap(n); } } };
        });
        return { items, load() { return this; } };
      },
      insertOoxml(x, where) {
        window.__ops.push('body.insertOoxml ' + where);
        const kids = bodyKids(x);
        if (where === 'Start') kids.reverse().forEach(k => body.insertBefore(k, body.firstChild)); else kids.forEach(k => body.appendChild(k));
      },
    },
    get contentControls() { return new CCs(body); },
    getSelection() { const n = window.__selectedNode; return { parentContentControlOrNullObject: n && n.parentNode ? ccFor(n) : NULL_CC }; },
    changeTrackingMode: 'Off',
    load() {},
    properties: { customProperties: { load() {}, get items() { return props; }, add(key, value) { const p = props.find(x => x.key === key); if (p) p.value = value; else props.push({ key, value }); } } },
  };
  window.Word = { run: fn => fn({ document: document_, sync: async () => {} }) };
  // Custom XML parts (Office's common API, callback style), kept in memory.
  const parts = []; let partN = 0;
  const ok = (cb, value) => cb && setTimeout(() => cb({ status: 'succeeded', value }), 0);
  const customXmlParts = {
    addAsync(xml, cb) { const p = { id: 'part' + (++partN), xml, getXmlAsync(c) { ok(c, this.xml); }, deleteAsync(c) { const i = parts.indexOf(this); if (i >= 0) parts.splice(i, 1); ok(c); } }; parts.push(p); ok(cb, p); },
    getByNamespaceAsync(ns, cb) { ok(cb, parts.filter(p => p.xml.includes('xmlns="' + ns + '"'))); },
  };
  window.__parts = parts;
  window.Office = { HostType: { Word: 'Word' }, AsyncResultStatus: { Succeeded: 'succeeded' }, EventType: { DocumentSelectionChanged: 'documentSelectionChanged' },
    context: { requirements: { isSetSupported: () => true }, document: { customXmlParts, addHandlerAsync(type, fn) { window.__selectionHandler = fn; } } },
    onReady: cb => setTimeout(() => cb({ host: 'Word' }), 0) };
  // Test helper: put the cursor in the content control with this tag, as a click would, and tell the pane.
  window.__selectTag = t => { const n = [...doc.getElementsByTagNameNS(W, 'sdt')].find(s => tagOf(s) === t); if (!n) return false; window.__selectedNode = n; if (window.__selectionHandler) window.__selectionHandler({}); return true; };
  // Test helper: type into the content control with this tag.
  window.__typeInTag = (t, find, replace) => { const n = [...doc.getElementsByTagNameNS(W, 'sdt')].find(s => tagOf(s) === t); if (!n) return false; for (const x of n.getElementsByTagNameNS(W, 't')) if (x.textContent.includes(find)) { x.textContent = x.textContent.replace(find, replace); return true; } return false; };
  // Test helper: type into the first quoted block containing `find`, as a person would.
  window.__typeInLaw = (find, replace) => {
    for (const t of doc.getElementsByTagNameNS(W, 't')) if (t.textContent.includes(find)) { t.textContent = t.textContent.replace(find, replace); return true; }
    return false;
  };
  // Test helper: Word's Track Changes. A tracked insertion by `author` right after the run that holds `after`.
  window.__suggestInLaw = (after, text, author) => {
    for (const t of doc.getElementsByTagNameNS(W, 't')) if (t.textContent.includes(after)) {
      const r = t.parentNode, ins = doc.createElementNS(W, 'w:ins');
      ins.setAttributeNS(W, 'w:id', '901'); ins.setAttributeNS(W, 'w:author', author); ins.setAttributeNS(W, 'w:date', '2026-11-15T15:00:00Z');
      const nr = doc.createElementNS(W, 'w:r'), nt = doc.createElementNS(W, 'w:t'); nt.setAttribute('xml:space', 'preserve'); nt.textContent = text;
      nr.appendChild(nt); ins.appendChild(nr); r.parentNode.insertBefore(ins, r.nextSibling); return true;
    }
    return false;
  };
  // Test helper: accepting every tracked change (Word's Review > Accept All).
  window.__acceptAll = () => { for (const ins of [...doc.getElementsByTagNameNS(W, 'ins')]) { while (ins.firstChild) ins.parentNode.insertBefore(ins.firstChild, ins); ins.remove(); } };
  window.__docXml = () => ser(doc);
})();
