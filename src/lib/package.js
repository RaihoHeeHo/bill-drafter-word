/* Bill Drafter for Word (demo) - signed bill packages (.nysakn), after the Chrome extension's .nysbill files.
   A package is a zip:
     mimetype         application/vnd.lbdc.akn-ny+zip (stored, first)
     manifest.json    what the package is, who signed it, and the size and SHA-256 of every other file
     signature.json   Ed25519 over the exact bytes of manifest.json
     bill.akn.xml     the bill in the AKN-NY profile: a working copy, or the XML a clean copy is printed from
     README.txt
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
  const MIME = 'application/vnd.lbdc.akn-ny+zip', KIND = 'AKN-NY bill package', FORMAT = 'akn-ny-package', VERSION = 1;
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

  /* ---------- a package ---------- */
  const README = `This is a signed bill package (.nysakn), version 1, from LBDC's Bill Drafter.

bill.akn.xml is the bill in LBDC's AKN-NY profile. manifest.json lists every file with its size and SHA-256,
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
  // inp: { xml, keys (loadKeys), copy: 'working'|'clean', note?, app? } -> zip bytes
  async function build(inp) {
    if (!inp.keys) throw err('Choose who you are (Review tab) to sign the package.');
    const xml = bytes(inp.xml), info = billInfo(dec.decode(xml)), parts = [{ path: 'bill.akn.xml', data: xml }, { path: 'README.txt', data: README }];
    const created = new Date().toISOString(), c = inp.keys.card;
    const m = { kind: KIND, format: FORMAT, version: VERSION, created, app: inp.app || 'Bill Drafter for Word', copy: inp.copy === 'clean' ? 'clean' : 'working',
      signer: cardOf(c), bill: { ...(info.lbd ? { lbd: info.lbd } : {}), ...(info.expression ? { expression: info.expression } : {}), ...(info.working ? { status: info.working } : {}) },
      fingerprint: await xmlFingerprint(xml), ...(inp.note ? { note: String(inp.note) } : {}), files: [] };
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
    return writeZip([{ path: 'mimetype', data: MIME, store: true }, { path: 'encrypted.json', data: JSON.stringify(h, null, 1) }, { path: 'payload.bin', data: ct, store: true }]);
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
    if (o.signature.status === 'valid' && o.signature.trust !== 'trusted') o.warnings.push('Signed by ' + cardText(card) + ', whose key this computer does not yet trust. Compare the fingerprint ' + o.signature.fingerprint + ' with them (in person or by phone) before you rely on it.');
    o.void = o.problems.length ? { reasons: [...new Set(o.problems)] } : null;
    return o;
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

  BD.nysakn = { MIME, KIND, VERSION, makeKeys, loadKeys, cardOf, cardValid, cardText, fingerprint, xmlFingerprint, build, encrypt, open, embedInPdf, pdfAttachments, isPdf, readZip, writeZip, sha256 };
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
