/* Bill Drafter for Word (demo) - signed bill packages (.nysakn), after the Chrome extension's .nysbill files.
   A package is a zip:
     mimetype         application/vnd.lbdc.akn-ny+zip (stored, first)
     manifest.json    what the package is, who signed it, and the size and SHA-256 of every other file
     signature.json   Ed25519 over the exact bytes of manifest.json
     bill.akn.xml     the bill in the AKN-NY profile: a working copy, or the XML a clean copy is printed from
     preview.html     the bill to read in any browser, with who signed it (not a check of anything)
     README.txt
   and, as the package has them (version 2):
     activity.json    each person's signed, hash-chained log of what they did to the draft
     lawcheck.json    the checks against the Bank when the package was signed
     versions/N.akn.xml   earlier versions of the bill
     attachments/<sha256>/<name>   files that go with the bill, each signed by the person who added it
     pdftext.txt      in a clean copy PDF's own package: the text of each page as drawn
   Encrypted, the package is wrapped in a second zip: mimetype, encrypted.json (AES-256-GCM, the content key wrapped
   for a password with PBKDF2 and/or for people with X25519 + HKDF) and payload.bin.
   Each person has a key pair (Ed25519 to sign, X25519 to receive) and a card: name, role, the two public keys, a key id
   and a self-signature. The same format is written and checked by the profile's tools/package_make.py and
   tools/package_check.py. A package that fails a check is VOID. See profile/PACKAGE.md.
   Works in the browser and in Node (WebCrypto with Ed25519 and X25519). */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const subtle = root.crypto && root.crypto.subtle;
  const MIME = 'application/vnd.lbdc.akn-ny+zip', KIND = 'AKN-NY bill package', FORMAT = 'akn-ny-package', VERSION = 2;
  const PBKDF2_ITER = 310000, LIMITS = { maxFiles: 200, maxOne: 64 << 20, maxAll: 256 << 20 };
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: false });
  const bytes = x => x instanceof Uint8Array ? x : typeof x === 'string' ? enc.encode(x) : new Uint8Array(x);
  const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
  const b64 = u => { let s = ''; u = bytes(u); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  const unb64 = s => { try { return Uint8Array.from(atob(String(s || '')), c => c.charCodeAt(0)); } catch (e) { return null; } };
  const b64url = u => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = s => unb64(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  const rand = n => root.crypto.getRandomValues(new Uint8Array(n));
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async data => hex(await subtle.digest('SHA-256', bytes(data)));
  const err = m => Object.assign(new Error(m), { readable: true });

  /* ---------- zip: stored or deflated entries, no zip64 ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const canDeflate = typeof root.CompressionStream !== 'undefined' && typeof root.DecompressionStream !== 'undefined';
  const through = async (u, s) => new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(s)).arrayBuffer());
  async function writeZip(parts) {
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [], central = []; let off = 0;
    for (const p of parts) {
      const name = enc.encode(p.path), raw = bytes(p.data), crc = crc32(raw), deflate = !p.store && canDeflate && raw.length > 256;
      const body = deflate ? await through(raw, new root.CompressionStream('deflate-raw')) : raw, method = deflate ? 8 : 0;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
      h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(h.buffer), name, body);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
      c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + body.length;
    }
    const size = central.reduce((n, c) => n + c.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, parts.length, true); e.setUint16(10, parts.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return concat(...chunks, ...central, new Uint8Array(e.buffer));
  }
  async function readZip(buf) {
    const u = bytes(buf), v = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let e = -1; for (let i = u.length - 22; i >= Math.max(0, u.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw err('This is not a bill package (it is not a readable zip).');
    const count = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true), total = 0;
    if (count > LIMITS.maxFiles) throw err('This package has too many parts.');
    const files = new Map(), order = [];
    for (let k = 0; k < count; k++) {
      if (p + 46 > u.length || v.getUint32(p, true) !== 0x02014b50) throw err('This package is damaged (its table of contents).');
      const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
      const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(u.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (name.endsWith('/')) continue;
      if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(s => s === '' || s === '.' || s === '..')) throw err('This package has a part with an unsafe name, so it was not opened.');
      if (files.has(name)) throw err('This package has two parts called ' + name + ', so it was not opened.');
      if (usize > LIMITS.maxOne || (total += usize) > LIMITS.maxAll) throw err('This package is too large to open.');
      if (v.getUint32(lo, true) !== 0x04034b50) throw err('This package is damaged.');
      const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), body = u.subarray(start, start + csize);
      let data;
      if (method === 0) data = body.slice();
      else if (method === 8 && canDeflate) { try { data = await through(body, new root.DecompressionStream('deflate-raw')); } catch (x) { throw err('This package is damaged.'); } }
      else throw err('This package uses a kind of compression this computer cannot read.');
      if (data.length !== usize || crc32(data) !== crc) throw err('This package is damaged or was changed: ' + name + ' no longer matches its own checksum.');
      files.set(name, data); order.push(name);
    }
    return { files, order };
  }

  /* ---------- people's keys and cards ---------- */
  // The card's fields, sorted, as compact JSON (Python: json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)).
  const CARD_FIELDS = ['box', 'created', 'device', 'keyId', 'name', 'role', 'sign', 'v'];
  const cardOf = c => { const o = {}; for (const k of CARD_FIELDS) o[k] = c[k]; if (c.self) o.self = c.self; return o; };
  const cardMessage = c => { const o = {}; for (const k of CARD_FIELDS) o[k] = c[k]; return concat(enc.encode('AKN-NY-CARD-v1\0'), enc.encode(JSON.stringify(o))); };
  const purposeMessage = (purpose, msg) => concat(enc.encode('AKN-NY-PKG-v1\0' + purpose + '\0'), bytes(msg));
  const keyIdOf = async (sign, box) => (await sha256(concat(sign, box))).slice(0, 20);
  const fingerprint = id => String(id || '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
  const cardText = c => c ? c.name + (c.role ? ' (' + c.role + ')' : '') + (c.device ? ' on ' + c.device : '') : 'someone';
  async function makeKeys(person) {
    const s = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']), b = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    const sj = await subtle.exportKey('jwk', s.privateKey), bj = await subtle.exportKey('jwk', b.privateKey);
    const sp = unb64url(sj.x), bp = unb64url(bj.x);
    const card = { v: 1, keyId: await keyIdOf(sp, bp), name: String(person.name || ''), role: String(person.role || ''), device: String(person.device || 'Word'), sign: b64(sp), box: b64(bp), created: new Date().toISOString() };
    card.self = b64(await subtle.sign({ name: 'Ed25519' }, s.privateKey, cardMessage(card)));
    return { card, secret: b64(concat(unb64url(sj.d), unb64url(bj.d))) };
  }
  // stored: { card, secret } (secret: the Ed25519 seed then the X25519 private key, 64 bytes, base64)
  async function loadKeys(stored) {
    const raw = unb64(stored && stored.secret), card = stored && stored.card;
    if (!raw || raw.length !== 64 || !card) throw err('The key kept on this computer is damaged.');
    const sign = await subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', d: b64url(raw.subarray(0, 32)), x: b64url(unb64(card.sign)) }, { name: 'Ed25519' }, false, ['sign']);
    const box = await subtle.importKey('jwk', { kty: 'OKP', crv: 'X25519', d: b64url(raw.subarray(32)), x: b64url(unb64(card.box)) }, { name: 'X25519' }, false, ['deriveBits']);
    return { card, sign, box };
  }
  const pubSign = raw => subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
  async function cardValid(c) {
    try {
      const sp = unb64(c.sign), bp = unb64(c.box), sig = unb64(c.self);
      return !!(sp && bp && sig && sp.length === 32 && bp.length === 32 && c.v === 1 && c.keyId === await keyIdOf(sp, bp) &&
        await subtle.verify({ name: 'Ed25519' }, await pubSign(sp), sig, cardMessage(c)));
    } catch (e) { return false; }
  }
  const signFor = async (keys, purpose, msg) => b64(await subtle.sign({ name: 'Ed25519' }, keys.sign, purposeMessage(purpose, msg)));
  async function verifyFor(card, purpose, msg, sig) {
    try { const s = unb64(sig), p = unb64(card.sign); return !!(s && p && p.length === 32 && await subtle.verify({ name: 'Ed25519' }, await pubSign(p), s, purposeMessage(purpose, msg))); }
    catch (e) { return false; }
  }

  /* ---------- the bill's fingerprint, printed at the foot of every page of its clean copy ---------- */
  const fingerprintCode = sha => sha.slice(0, 12).toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
  const xmlFingerprint = async xml => fingerprintCode(await sha256(xml));

  /* ---------- canonical JSON (sorted keys, compact; Python: json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)) ---------- */
  const sortDeep = v => Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortDeep(v[k]), o), {}) : v;
  const canon = v => JSON.stringify(sortDeep(v));

  /* ---------- the activity log: per person, hash-chained, signed (as the extension's) ----------
     An entry: { at, by, role, e (what happened), d (detail), k (key id), seq (1, 2, … per key), prev (the hash of the
     same key's previous entry, '' for the first), h (SHA-256 of the canonical entry without h and sig), sig (Ed25519
     over h, purpose "activity") }. A missing entry leaves a gap in seq; a changed one breaks h, sig or the chain. */
  const ENTRY_FIELDS = ['at', 'by', 'role', 'e', 'd', 'k', 'seq', 'prev'];
  async function addEntry(keys, log, ev) {
    const mine = (log || []).filter(x => x.k === keys.card.keyId), last = mine[mine.length - 1];
    const e = { at: ev.at || new Date().toISOString(), by: keys.card.name, role: keys.card.role, e: String(ev.e), d: String(ev.d || ''), k: keys.card.keyId, seq: last ? last.seq + 1 : 1, prev: last ? last.h : '' };
    e.h = await sha256(canon(e)); e.sig = await signFor(keys, 'activity', enc.encode(e.h));
    return (log || []).concat([e]);
  }
  // { entries: [{…, status: 'valid'|'bad'|'unknown-key'}], signers: {keyId: {card, count, gaps, broken}}, problems }
  async function checkLog(log, people) {
    const out = { entries: [], signers: {}, problems: [] }, chains = new Map();
    for (const x of log || []) {
      const it = { ...x, status: 'bad' }, c = people[x.k];
      const body = {}; for (const f of ENTRY_FIELDS) body[f] = x[f];
      if (!c) it.status = 'unknown-key';
      else if (await sha256(canon(body)) === x.h && await verifyFor(c, 'activity', enc.encode(String(x.h)), x.sig)) it.status = 'valid';
      out.entries.push(it);
      if (it.status === 'valid') { if (!chains.has(x.k)) chains.set(x.k, []); chains.get(x.k).push(x); }
    }
    const bad = out.entries.filter(x => x.status === 'bad').length, unknown = out.entries.filter(x => x.status === 'unknown-key').length;
    if (bad) out.problems.push(bad + ' entr' + (bad === 1 ? 'y' : 'ies') + ' of its activity log ' + (bad === 1 ? 'was' : 'were') + ' changed after being signed');
    if (unknown) out.problems.push(unknown + ' entr' + (unknown === 1 ? 'y' : 'ies') + ' of its activity log ' + (unknown === 1 ? 'is' : 'are') + ' signed by a key it does not name');
    for (const [k, ls] of chains) {
      ls.sort((a, b) => a.seq - b.seq);
      const s = out.signers[k] = { card: people[k], count: ls.length, last: ls[ls.length - 1].seq, head: ls[ls.length - 1].h, gaps: [], broken: 0 };
      const bySeq = new Map(ls.map(x => [x.seq, x]));
      for (let n = 1; n <= s.last; n++) {
        const x = bySeq.get(n); if (!x) { s.gaps.push(n); continue; }
        if (n === 1) { if (x.prev !== '') s.broken++; } else { const p = bySeq.get(n - 1); if (p && x.prev !== p.h) s.broken++; }
      }
      if (s.gaps.length) out.problems.push(cardText(people[k]) + '’s activity ' + (s.gaps.length === 1 ? 'entry ' + s.gaps[0] + ' is' : 'entries ' + s.gaps.slice(0, 8).join(', ') + (s.gaps.length > 8 ? ', …' : '') + ' are') + ' missing');
      if (s.broken) out.problems.push(cardText(people[k]) + '’s chain of activity entries is broken in ' + s.broken + ' place' + (s.broken === 1 ? '' : 's'));
    }
    return out;
  }
  const chainHeads = log => { const h = {}; for (const x of log || []) if (!h[x.k] || x.seq > h[x.k].seq) h[x.k] = { seq: x.seq, h: x.h }; return h; };

  /* ---------- attachments: each signed by the person who added it ---------- */
  const attachMsg = a => enc.encode(canon({ name: a.name, size: a.size, sha256: a.sha256, at: a.at, by: a.by || '', k: a.k || '' }));
  const safeName = n => { n = String(n || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim(); if (!n || n.startsWith('.')) n = 'attachment' + n; return n.slice(0, 120); };
  async function attachment(keys, name, type, data) {
    const b = bytes(data), a = { name: safeName(name), ...(type ? { type } : {}), size: b.length, sha256: await sha256(b), at: new Date().toISOString(), by: keys.card.name, k: keys.card.keyId };
    a.sig = b64(await subtle.sign({ name: 'Ed25519' }, keys.sign, purposeMessage('attachment', attachMsg(a))));
    return a;
  }

  /* ---------- preview.html: the bill to read without the app (not a check of anything) ---------- */
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' })[c]);
  function billText(xml) {
    // the printed text: struck matter in [brackets], new matter underlined; one paragraph per block
    let t = String(xml).replace(/<meta>[\s\S]*?<\/meta>/, '').replace(/<lbdc:working[\s\S]*?<\/lbdc:working>/, '');
    t = t.replace(/<ins\b[^>]*>/g, '\u0001').replace(/<\/ins>/g, '\u0002').replace(/<del\b[^>]*>/g, '[').replace(/<\/del>/g, ']');
    t = t.replace(/<\/(p|heading|longTitle|formula|docTitle|docNumber|docProponent|docStage|docDate|tr)>/g, '\n').replace(/<(num)\b[^>]*>/g, '\n').replace(/<[^>]+>/g, '');
    t = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
  function previewHtml(m, xml) {
    const b = m.bill || {}, title = b.lbd ? 'LBD ' + b.lbd : 'Bill';
    const lines = billText(xml).map(l => '<p>' + esc(l).replace(/\u0001/g, '<u>').replace(/\u0002/g, '</u>') + '</p>').join('\n');
    const pk = m.packet ? '<div class="packet"><b>Review packet for the ' + esc(String(m.packet.to || '').toLowerCase()) + '</b>' + (m.packet.due ? ' · due ' + esc(m.packet.due) : '') + (m.packet.note ? '<br>' + esc(m.packet.note) : '') + '</div>' : '';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>:root{color-scheme:light dark}body{margin:0;font:14px system-ui,sans-serif;background:#f4f4ef;color:#1f2a24}' +
      'header{padding:20px 28px;background:#fff;border-bottom:1px solid #d6dfd9}h1{font:600 22px Georgia,serif;margin:0 0 6px}.meta{color:#53616a;margin:2px 0}.packet{margin-top:10px;padding:10px 12px;border-left:4px solid #b45309;background:#fff7ed}' +
      'main{max-width:46em;margin:20px auto;padding:24px 32px;background:#fff;font:13.5px/1.55 "Courier New",monospace}main p{margin:0 0 .5em}footer{color:#53616a;font-size:12px;padding:0 28px 28px;max-width:46em;margin:auto}</style></head><body>' +
      '<header><h1>' + esc(title) + '</h1><p class="meta">' + (m.copy === 'clean' ? 'Clean copy' : 'Working copy') + (b.status ? ' · ' + esc(b.status) : '') + ' · signed by ' + esc(cardText(m.signer)) + ' · ' + esc(String(m.created || '').slice(0, 10)) + '</p>' +
      '<p class="meta">Bill fingerprint ' + esc(m.fingerprint) + ' · key ' + esc(fingerprint(m.signer && m.signer.keyId)) + '</p>' + pk + '</header><main>' + lines + '</main>' +
      '<footer>Preview only: it shows what the package holds but checks nothing. The signed bill is bill.akn.xml; check the package in the Bill Drafter for Word or with the AKN-NY profile\'s tools/nysakn.py check.</footer></body></html>';
  }

  /* ---------- a package ---------- */
  const README = `This is a signed bill package (.nysakn), version 2, from LBDC's Bill Drafter.

bill.akn.xml is the bill in LBDC's AKN-NY profile; preview.html shows it in any browser (it checks nothing).
activity.json is each person's signed log of what they did to the draft, lawcheck.json the checks against the
Bank when it was signed, versions/ earlier versions, attachments/ the files that go with it, each signed by the
person who added it.

manifest.json lists every file with its size and SHA-256,
and signature.json holds the signer's Ed25519 signature over the exact bytes of manifest.json. The signer's
public key is in the manifest, on their card; compare its fingerprint with them before you trust it.

Check it in the Bill Drafter for Word (Clean copy > Signed package > Check a package or PDF), or with the
AKN-NY profile's tools/nysakn.py check. A package that fails a check is VOID: do not rely on it.
`;
  function billInfo(xml) {
    const pick = re => { const m = re.exec(xml); return m ? m[1] : ''; };
    return {
      expression: pick(/<FRBRExpression>[\s\S]*?<FRBRthis value="([^"]*)"/),
      lbd: pick(/<lbdc:lbdNumber[^>]*>([^<]*)</) || pick(/name="lbdNumber" value="([^"]*)"/),
      working: pick(/<lbdc:working\b[^>]*status="([^"]*)"/) || null,
    };
  }
  /* inp: { xml, keys (loadKeys), copy: 'working'|'clean', note?, app?,
       packet?: {to: 'Drafter'|'Examiner'|'Proofreader', due?: 'YYYY-MM-DD', note?},
       versions?: [{xml, label?, at?, by?}], attachments?: [{meta (from attachment()), data}],
       activity?: [entries (addEntry)], people?: {keyId: card} (the cards that sign the activity and attachments),
       lawcheck?: object, pdftext?: string } -> zip bytes */
  async function build(inp) {
    if (!inp.keys) throw err('Choose who you are (Review tab) to sign the package.');
    const xml = bytes(inp.xml), info = billInfo(dec.decode(xml)), parts = [{ path: 'bill.akn.xml', data: xml }];
    const created = new Date().toISOString(), c = inp.keys.card;
    const m = { kind: KIND, format: FORMAT, version: VERSION, created, app: inp.app || 'Bill Drafter for Word', copy: inp.copy === 'clean' ? 'clean' : 'working',
      signer: cardOf(c), bill: { ...(info.lbd ? { lbd: info.lbd } : {}), ...(info.expression ? { expression: info.expression } : {}), ...(info.working ? { status: info.working } : {}) },
      fingerprint: await xmlFingerprint(xml), ...(inp.note ? { note: String(inp.note) } : {}) };
    if (inp.packet && inp.packet.to) m.packet = { to: String(inp.packet.to), ...(inp.packet.due ? { due: String(inp.packet.due) } : {}), ...(inp.packet.note ? { note: String(inp.packet.note) } : {}) };
    const people = {}; const want = k => { if (k && !people[k] && inp.people && inp.people[k]) people[k] = cardOf(inp.people[k]); };
    people[c.keyId] = cardOf(c);
    if (inp.activity && inp.activity.length) {
      inp.activity.forEach(x => want(x.k));
      parts.push({ path: 'activity.json', data: JSON.stringify({ entries: inp.activity }, null, 1) });
      m.chainHeads = chainHeads(inp.activity);
    }
    if (inp.lawcheck) parts.push({ path: 'lawcheck.json', data: JSON.stringify(inp.lawcheck, null, 1) });
    if (inp.versions && inp.versions.length) {
      m.versions = [];
      for (const [i, v] of inp.versions.entries()) {
        const vx = bytes(v.xml), vi = billInfo(dec.decode(vx)), path = 'versions/' + (i + 1) + '.akn.xml';
        parts.push({ path, data: vx });
        m.versions.push({ path, ...(v.label ? { label: String(v.label) } : {}), ...(v.at ? { at: v.at } : {}), ...(v.by ? { by: v.by } : {}), ...(vi.lbd ? { lbd: vi.lbd } : {}), fingerprint: await xmlFingerprint(vx) });
      }
    }
    if (inp.attachments && inp.attachments.length) {
      m.attachments = [];
      for (const a of inp.attachments) {
        const path = 'attachments/' + a.meta.sha256 + '/' + a.meta.name; want(a.meta.k);
        parts.push({ path, data: a.data }); m.attachments.push({ path, ...a.meta });
      }
    }
    if (inp.pdftext != null) parts.push({ path: 'pdftext.txt', data: String(inp.pdftext) });
    m.people = people;
    parts.push({ path: 'preview.html', data: previewHtml(m, dec.decode(xml)) }, { path: 'README.txt', data: README });
    m.files = [];
    for (const p of parts) m.files.push({ path: p.path, size: bytes(p.data).length, sha256: await sha256(p.data) });
    const mraw = enc.encode(JSON.stringify(m, null, 1));
    const sig = { alg: 'Ed25519', keyId: c.keyId, at: created, sig: await signFor(inp.keys, 'manifest', mraw) };
    return writeZip([{ path: 'mimetype', data: MIME, store: true }, { path: 'manifest.json', data: mraw }, { path: 'signature.json', data: JSON.stringify(sig, null, 1) }, ...parts]);
  }

  /* ---------- encryption: a password, or the people it is for ---------- */
  const pbkdf2 = async (password, salt, iter) => new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']), 256));
  const hkdf = async (secret, salt, info) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']), 256));
  const x25519 = async (priv, pubRaw) => new Uint8Array(await subtle.deriveBits({ name: 'X25519', public: await subtle.importKey('raw', pubRaw, { name: 'X25519' }, false, []) }, priv, 256));
  async function seal(key, plain, aad) { const nonce = rand(12), k = await subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']); return { nonce, ct: new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(aad) }, k, bytes(plain))) }; }
  async function unseal(key, nonce, ct, aad) { const k = await subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']); return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(aad) }, k, ct)); }
  const AAD_PAYLOAD = 'akn-ny-package-v1 payload', AAD_KEY = 'akn-ny-package-v1 key', HKDF_INFO = 'akn-ny-package-v1 wrap';
  // lock: { password?, to?: [cards] }, from: the signer's card
  async function encrypt(inner, lock, from) {
    const to = (lock && lock.to) || [], password = lock && lock.password;
    if (!password && !to.length) return inner;
    if (password && password.length < 8) throw err('Use a password of at least 8 characters.');
    const ck = rand(32), { nonce, ct } = await seal(ck, inner, AAD_PAYLOAD);
    const h = { kind: KIND, format: FORMAT, version: VERSION, encrypted: true, cipher: 'AES-256-GCM', created: new Date().toISOString(), from: cardOf(from), nonce: b64(nonce), recipients: [] };
    if (password) { const salt = rand(16), w = await seal(await pbkdf2(password, salt, PBKDF2_ITER), ck, AAD_KEY); h.recipients.push({ type: 'password', salt: b64(salt), iter: PBKDF2_ITER, nonce: b64(w.nonce), wrapped: b64(w.ct) }); }
    for (const c of to) {
      if (!await cardValid(c)) throw err('The card for ' + cardText(c) + ' is not genuine, so the package was not sent to them.');
      const pub = unb64(c.box), ep = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']), epPub = new Uint8Array(await subtle.exportKey('raw', ep.publicKey));
      const w = await seal(await hkdf(await x25519(ep.privateKey, pub), concat(epPub, pub), HKDF_INFO), ck, AAD_KEY);
      h.recipients.push({ type: 'x25519', keyId: c.keyId, label: cardText(c), epk: b64(epPub), nonce: b64(w.nonce), wrapped: b64(w.ct) });
    }
    const note = '<!doctype html><meta charset="utf-8"><title>Encrypted bill package</title><body style="font:16px system-ui;padding:40px;color:#1f2a24"><h1 style="font:600 24px Georgia,serif">Encrypted bill package</h1><p>This signed bill package is encrypted. Check a package in the Bill Drafter for Word' + (password ? ' with its password' : '') + (to.length ? (password ? ', or' : '') + ' as one of the people it was sent to' : '') + '.</p></body>';
    return writeZip([{ path: 'mimetype', data: MIME, store: true }, { path: 'encrypted.json', data: JSON.stringify(h, null, 1) }, { path: 'preview.html', data: note, store: true }, { path: 'payload.bin', data: ct, store: true }]);
  }
  async function decrypt(h, payload, password, keys) {
    const nonce = unb64(h.nonce), open = async ck => { try { return await unseal(ck, nonce, payload, AAD_PAYLOAD); } catch (e) { return null; } };
    for (const r of h.recipients || []) {
      const n = unb64(r.nonce), w = unb64(r.wrapped);
      try {
        if (r.type === 'x25519' && keys && keys.card.keyId === r.keyId) {
          const epk = unb64(r.epk), ck = await unseal(await hkdf(await x25519(keys.box, epk), concat(epk, unb64(keys.card.box)), HKDF_INFO), n, w, AAD_KEY);
          const out = await open(ck); if (out) return out;
        }
        if (r.type === 'password' && password && r.iter >= 100000 && r.iter <= 5000000) { const out = await open(await unseal(await pbkdf2(password, unb64(r.salt), r.iter), n, w, AAD_KEY)); if (out) return out; }
      } catch (e) { /* not this one */ }
    }
    return null;
  }

  /* ---------- opening and checking ---------- */
  // opts: { password?, keys? (to open a package sent to you), trusted?: Set of key ids }
  // -> { encrypted, needPassword, needKey, manifest, signature: {status, signer, fingerprint, trust, at}, problems (VOID), warnings, xml, void }
  async function open(data, opts) {
    opts = opts || {};
    const o = { problems: [], warnings: [], signature: { status: 'unsigned' } };
    let { files, order } = await readZip(data);
    if (dec.decode(files.get('mimetype') || new Uint8Array()).trim() !== MIME) throw err('This is not a bill package.');
    if (files.has('encrypted.json')) {
      let h; try { h = JSON.parse(dec.decode(files.get('encrypted.json'))); } catch (e) { /* below */ }
      if (!h || !h.encrypted) throw err('This package is damaged (its encryption header).');
      o.encrypted = true; o.from = h.from; o.recipients = (h.recipients || []).map(r => r.type === 'password' ? 'a password' : r.label);
      const inner = await decrypt(h, files.get('payload.bin') || new Uint8Array(), opts.password, opts.keys);
      if (!inner) {
        o.needPassword = (h.recipients || []).some(r => r.type === 'password'); o.needKey = !o.needPassword;
        if (opts.password) o.warnings.push('That password does not open this package.');
        return o;
      }
      ({ files, order } = await readZip(inner));
      if (dec.decode(files.get('mimetype') || new Uint8Array()).trim() !== MIME) throw err('This package is damaged (inside the encryption).');
    }
    const mraw = files.get('manifest.json'); let m = null;
    try { m = JSON.parse(dec.decode(mraw)); } catch (e) { /* below */ }
    if (!m || m.kind !== KIND || m.format !== FORMAT) throw err('This package is damaged (it has no manifest).');
    o.manifest = m;
    if (m.version > VERSION) o.warnings.push('This package was written by a newer version; some of it may not show.');
    let sig = {}; try { sig = JSON.parse(dec.decode(files.get('signature.json'))); } catch (e) { /* unsigned */ }
    const card = m.signer;
    if (!card || !sig.sig) { o.problems.push('it is not signed'); }
    else {
      o.signature = { status: 'bad', signer: cardOf(card), fingerprint: fingerprint(card.keyId), at: sig.at || '' };
      o.signature.trust = opts.trusted && opts.trusted.has(card.keyId) ? 'trusted' : 'unknown';
      if (!await cardValid(card)) o.problems.push('the signer’s card is not genuine (it was changed after it was made)');
      else if (sig.alg !== 'Ed25519' || sig.keyId !== card.keyId || !await verifyFor(card, 'manifest', mraw, sig.sig)) o.problems.push('its signature does not match its manifest');
      else o.signature.status = 'valid';
    }
    const listed = new Set(['mimetype', 'manifest.json', 'signature.json']);
    for (const f of m.files || []) {
      listed.add(f.path); const b = files.get(f.path);
      if (!b) o.problems.push(f.path + ' is missing');
      else if (b.length !== f.size || await sha256(b) !== f.sha256) o.problems.push(f.path + ' was changed after the package was signed');
    }
    for (const n of order) if (!listed.has(n)) o.warnings.push('Left out ' + n + ': it was added after the package was signed.');
    const xml = listed.has('bill.akn.xml') ? files.get('bill.akn.xml') : null;
    if (!xml) o.problems.push('it holds no bill (bill.akn.xml)');
    else {
      o.xml = dec.decode(xml); o.fingerprint = await xmlFingerprint(xml);
      if (m.fingerprint && m.fingerprint !== o.fingerprint) o.problems.push('the fingerprint in its manifest is not the bill’s');
    }
    await openParts(o, m, files, listed, opts);
    if (o.signature.status === 'valid' && o.signature.trust !== 'trusted') o.warnings.push('Signed by ' + cardText(card) + ', whose key this computer does not yet trust. Compare the fingerprint ' + o.signature.fingerprint + ' with them (in person or by phone) before you rely on it.');
    o.void = o.problems.length ? { reasons: [...new Set(o.problems)] } : null;
    return o;
  }

  // Version 2's parts: the people who sign inside it, the activity log, attachments, versions, the review packet, the
  // law check, and (for a PDF's own package) the text of its pages.
  async function openParts(o, m, files, listed, opts) {
    const got = p => listed.has(p) ? files.get(p) : null, json = p => { try { const b = got(p); return b ? JSON.parse(dec.decode(b)) : null; } catch (e) { return undefined; } };
    const people = {};
    for (const [k, c] of Object.entries(m.people || {})) {
      if (c && c.keyId === k && await cardValid(c)) people[k] = c; else o.problems.push('the card it carries for ' + cardText(c) + ' is not genuine');
    }
    if (m.signer && !people[m.signer.keyId] && await cardValid(m.signer)) people[m.signer.keyId] = m.signer;
    o.people = people;
    o.packet = m.packet || null;
    // activity
    const act = json('activity.json');
    if (act === undefined) o.problems.push('its activity log (activity.json) is damaged');
    else if (act || m.chainHeads) {
      const r = await checkLog((act && act.entries) || [], people); o.activity = r; o.problems.push(...r.problems);
      for (const [k, want] of Object.entries(m.chainHeads || {})) {
        const s = r.signers[k];
        if (!s || s.last < want.seq || (s.last === want.seq && s.head !== want.h)) { o.problems.push('activity entries were taken out after the package was signed'); break; }
      }
    }
    // attachments
    o.attachments = [];
    for (const a of m.attachments || []) {
      const b = got(a.path), it = { ...a, status: 'bad' };
      if (!b || b.length !== a.size || await sha256(b) !== a.sha256 || a.path !== 'attachments/' + a.sha256 + '/' + a.name) { o.problems.push('the attachment ' + a.name + ' is missing or changed'); o.attachments.push(it); continue; }
      const c = people[a.k];
      if (!c) { it.status = 'unknown-key'; o.problems.push('the attachment ' + a.name + ' is signed by a key the package does not name'); }
      else if (!await verifyFor(c, 'attachment', attachMsg(a), a.sig)) o.problems.push('the attachment ' + a.name + '’s signature does not match it');
      else { it.status = 'valid'; it.signer = c; }
      it.data = b; o.attachments.push(it);
    }
    // versions
    o.versions = [];
    for (const v of m.versions || []) {
      const b = got(v.path);
      if (!b) { o.problems.push('the earlier version ' + (v.label || v.path) + ' is missing'); continue; }
      const fp = await xmlFingerprint(b);
      if (v.fingerprint && v.fingerprint !== fp) o.problems.push('the earlier version ' + (v.label || v.path) + ' is not the one its manifest names');
      o.versions.push({ ...v, xml: dec.decode(b) });
    }
    const lc = json('lawcheck.json'); if (lc === undefined) o.warnings.push('Its law check (lawcheck.json) could not be read.'); else o.lawcheck = lc;
    const pt = got('pdftext.txt'); o.pdftext = pt ? dec.decode(pt) : null;
    if (opts.pdf && o.pdftext != null && BD.pdftext) {
      const cmp = BD.pdftext.comparePages(await BD.pdftext.pdfPagesText(opts.pdf), o.pdftext);
      if (cmp.count) o.problems.push('the PDF has ' + cmp.pages + ' pages, but its signed package says ' + cmp.signed);
      else for (const n of cmp.differ) o.problems.push('the words on page ' + n + ' of the PDF are not the words it was signed with');
      o.pagesChecked = !cmp.count && !cmp.differ.length ? (o.pdftext.split('\f').length) : 0;
    }
  }

  /* ---------- a clean copy PDF that carries its signed package ---------- */
  // The package goes into the PDF as an embedded file (bill.nysakn), the bill's XML beside it (bill.akn.xml).
  async function embedInPdf(pdfBytes, pkg, xml) {
    const P = root.PDFLib; if (!P) throw err('The PDF library (vendor/pdf-lib) did not load.');
    const doc = await P.PDFDocument.load(pdfBytes);
    await doc.attach(bytes(pkg), 'bill.nysakn', { mimeType: MIME, description: 'The signed bill package this clean copy was printed from', afRelationship: P.AFRelationship.Source });
    if (xml) await doc.attach(bytes(xml), 'bill.akn.xml', { mimeType: 'application/xml', description: 'The bill in the AKN-NY profile (also inside bill.nysakn)', afRelationship: P.AFRelationship.Source });
    return doc.save();
  }
  // The files embedded in a PDF: Map(name -> bytes).
  async function pdfAttachments(pdfBytes) {
    const P = root.PDFLib; if (!P) throw err('The PDF library (vendor/pdf-lib) did not load.');
    const doc = await P.PDFDocument.load(pdfBytes, { updateMetadata: false }), out = new Map();
    const names = doc.catalog.lookupMaybe(P.PDFName.of('Names'), P.PDFDict), ef = names && names.lookupMaybe(P.PDFName.of('EmbeddedFiles'), P.PDFDict);
    const walk = node => {
      if (!node) return;
      const arr = node.lookupMaybe(P.PDFName.of('Names'), P.PDFArray);
      if (arr) for (let i = 0; i + 1 < arr.size(); i += 2) {
        const nm = arr.lookup(i), spec = arr.lookup(i + 1, P.PDFDict);
        const efd = spec.lookupMaybe(P.PDFName.of('EF'), P.PDFDict), stream = efd && (efd.lookupMaybe(P.PDFName.of('F'), P.PDFStream) || efd.lookupMaybe(P.PDFName.of('UF'), P.PDFStream));
        if (stream) out.set(nm.decodeText ? nm.decodeText() : String(nm), P.decodePDFRawStream(stream).decode());
      }
      const kids = node.lookupMaybe(P.PDFName.of('Kids'), P.PDFArray);
      if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i, P.PDFDict));
    };
    walk(ef);
    return out;
  }
  const isPdf = u => { u = bytes(u); return u.length > 4 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46; };

  BD.nysakn = { MIME, KIND, VERSION, canon, addEntry, checkLog, attachment, billText, previewHtml, makeKeys, loadKeys, cardOf, cardValid, cardText, fingerprint, xmlFingerprint, build, encrypt, open, embedInPdf, pdfAttachments, isPdf, readZip, writeZip, sha256 };
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
