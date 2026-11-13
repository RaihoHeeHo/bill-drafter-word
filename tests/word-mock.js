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
  function bodyKids(pkg) {
    const d = parse(pkg), b = d.getElementsByTagNameNS(W, 'body')[0];
    const out = []; for (let c = b.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(doc.importNode(c, true));
    // like Word, give every content control a fresh id
    return out;
  }
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
    getOoxml() { return { value: pkgOf(ser(this.node)) }; }
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
    select() { window.__selected = this.tag; }
  }
  class CCs extends Proxy {
    constructor(root) { super(); this.root = root; }
    get items() {
      const all = [...this.root.getElementsByTagNameNS(W, 'sdt')].filter(n => n !== this.root);
      return all.map(n => { const c = CC.cache.get(n) || new CC(n); CC.cache.set(n, c); c.tag = tagOf(n); return c; });
    }
  }
  CC.cache = new WeakMap();
  class Range extends Proxy {
    constructor(node) { super(); this.node = node; }
    insertOoxml(x, where) {
      window.__ops.push('range.insertOoxml ' + where);
      const kids = bodyKids(x), n = this.node;
      if (where === 'Before') kids.forEach(k => n.parentNode.insertBefore(k, n));
      else if (where === 'After') { let ref = n.nextSibling; kids.forEach(k => n.parentNode.insertBefore(k, ref)); }
    }
  }
  class Paras extends Proxy {
    constructor(root) { super(); this.root = root; }
    get items() { return [...this.root.childNodes].filter(n => n.localName === 'p').map(p => ({ text: p.textContent, delete() { p.parentNode.removeChild(p); } })); }
  }
  const props = [];
  const document_ = {
    body: {
      getOoxml() { return { value: pkgOf([...body.childNodes].map(ser).join('')) }; },
      insertOoxml(x, where) {
        window.__ops.push('body.insertOoxml ' + where);
        const kids = bodyKids(x);
        if (where === 'Start') kids.reverse().forEach(k => body.insertBefore(k, body.firstChild)); else kids.forEach(k => body.appendChild(k));
      },
    },
    get contentControls() { return new CCs(body); },
    changeTrackingMode: 'Off',
    load() {},
    properties: { customProperties: { load() {}, get items() { return props; }, add(key, value) { const p = props.find(x => x.key === key); if (p) p.value = value; else props.push({ key, value }); } } },
  };
  window.Word = { run: fn => fn({ document: document_, sync: async () => {} }) };
  window.Office = { HostType: { Word: 'Word' }, context: { requirements: { isSetSupported: () => true } }, onReady: cb => setTimeout(() => cb({ host: 'Word' }), 0) };
  // Test helper: type into the first quoted block containing `find`, as a person would.
  window.__typeInLaw = (find, replace) => {
    for (const t of doc.getElementsByTagNameNS(W, 't')) if (t.textContent.includes(find)) { t.textContent = t.textContent.replace(find, replace); return true; }
    return false;
  };
  window.__docXml = () => ser(doc);
})();
