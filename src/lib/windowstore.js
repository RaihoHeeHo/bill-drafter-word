/* Bill Drafter for Word (demo) - what the pane hands the bill window: the whole bill's XML and its status, in this
   computer's browser storage (IndexedDB, the same site's, which the pane and its window share). Nothing leaves the
   computer. */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  let db = null;
  const open = () => db || (db = new Promise((res, rej) => {
    const r = indexedDB.open('bill-drafter-window', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  async function tx(mode, fn) {
    const d = await open();
    return new Promise((res, rej) => { const t = d.transaction('kv', mode), r = fn(t.objectStore('kv')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
  }
  BD.windowStore = { get: k => tx('readonly', s => s.get(k)), put: (k, v) => tx('readwrite', s => s.put(v, k)) };
})(typeof globalThis !== 'undefined' ? globalThis : this);
