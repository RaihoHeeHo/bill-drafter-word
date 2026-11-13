/* Bill Drafter for Word (demo) - the Bank: the computer's own copy of the laws (NY-Law-Exporter JSON,
   one file per law, as the desktop app downloads them). Nothing is fetched from the internet: the drafter
   picks the files once, and they are kept in this computer's browser storage for Word (IndexedDB). */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};

  // One law file -> {info, activeDate, sections: [{loc, title, text, path}]}. `path` is the article/title chain.
  function parseLaw(raw) {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const r = d && d.result;
    if (!r || !r.info || !r.documents) return null;
    const info = { lawId: String(r.info.lawId || '').toUpperCase(), name: r.info.name || '', lawType: r.info.lawType || '', chapter: r.info.chapter || '' };
    const sections = [];
    const walk = (n, path) => {
      for (const c of (n.documents && n.documents.items) || []) {
        const here = c.docType === 'SECTION' ? path : path.concat([(c.docType || '') + ' ' + (c.docLevelId || '') + (c.title ? ': ' + c.title : '')]);
        if (c.docType === 'SECTION') sections.push({ loc: String(c.locationId), title: String(c.title || ''), text: fixText(c.text), path: path.join(' > '), repealed: !!c.repealed, activeDate: c.activeDate || '' });
        walk(c, here);
      }
    };
    walk(r.documents, []);
    return { info, activeDate: (r.lawVersion && r.lawVersion.activeDate) || '', sections };
  }
  const fixText = t => String(t || '').replace(/\\n/g, '\n');

  // "12", "§ 12", "37-a" -> the Bank's locationId form ("37-A").
  const locKey = s => String(s || '').replace(/^\s*(§+|sec(tion)?\.?)\s*/i, '').trim().toUpperCase();

  function findSection(law, loc) {
    if (!law) return null;
    const k = locKey(loc);
    return law.sections.find(s => s.loc.toUpperCase() === k) || null;
  }
  // Sections whose number starts with the query, or whose title has every word of it.
  function searchSections(law, q, limit) {
    q = String(q || '').trim(); if (!law || !q) return [];
    const k = locKey(q), words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const exact = [], prefix = [], title = [];
    for (const s of law.sections) {
      const L = s.loc.toUpperCase();
      if (L === k) exact.push(s);
      else if (/^[\dA-Z-]+$/.test(k) && /\d/.test(k) && L.startsWith(k)) prefix.push(s);
      else if (words.every(w => s.title.toLowerCase().includes(w))) title.push(s);
    }
    return exact.concat(prefix, title).slice(0, limit || 50);
  }
  // The next free section number after `loc` ("12" -> "12-a", "12-a" -> "12-b").
  function nextFreeSection(law, loc) {
    const base = locKey(loc).replace(/-[A-Z]+$/, '');
    for (let i = 0; i < 26; i++) {
      const id = base + '-' + String.fromCharCode(65 + i);
      if (!findSection(law, id)) return id.toLowerCase();
    }
    return base.toLowerCase() + '-__';
  }

  /* ---------- storage (browser only) ---------- */
  const DB = 'bill-drafter-word-bank', VER = 1;
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((ok, no) => {
      const q = indexedDB.open(DB, VER);
      q.onupgradeneeded = () => { const d = q.result; if (!d.objectStoreNames.contains('laws')) d.createObjectStore('laws'); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta'); };
      q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error);
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(d => new Promise((ok, no) => {
      const t = d.transaction(store, mode), s = t.objectStore(store); let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => ok(out); t.onerror = () => no(t.error); t.onabort = () => no(t.error);
    }));
  }
  const req = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const cache = new Map();
  const store = {
    async put(law) {
      cache.set(law.info.lawId, law);
      await tx('laws', 'readwrite', s => s.put(law, law.info.lawId));
      const idx = await store.index();
      idx[law.info.lawId] = { ...law.info, activeDate: law.activeDate, count: law.sections.length, loaded: new Date().toISOString() };
      await tx('meta', 'readwrite', s => s.put(idx, 'index'));
    },
    async get(id) {
      id = String(id || '').toUpperCase(); if (cache.has(id)) return cache.get(id);
      const law = await tx('laws', 'readonly', s => req(s.get(id)));
      if (law) { cache.set(id, law); if (cache.size > 12) cache.delete(cache.keys().next().value); }
      return law || null;
    },
    async index() { return (await tx('meta', 'readonly', s => req(s.get('index')))) || {}; },
    async clear() { cache.clear(); await tx('laws', 'readwrite', s => s.clear()); await tx('meta', 'readwrite', s => s.clear()); },
  };

  Object.assign(BD, { parseLaw, findSection, searchSections, nextFreeSection, locKey, bank: store });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
