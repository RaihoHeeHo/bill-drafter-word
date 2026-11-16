#!/usr/bin/env python3
"""Signed bill packages (.nysakn): make keys, make packages, and check packages and the clean-copy PDFs that carry them.

The format is in PACKAGE.md; the Bill Drafter for Word writes and reads the same files (src/lib/package.js).

  nysakn.py key  --name "Ann Drafter" --role drafter -o ann.key.json     a new key pair; the card is inside
  nysakn.py card ann.key.json -o ann.card.json                           the public card, to give to others
  nysakn.py make bill.akn.xml --key ann.key.json -o bill.nysakn          sign a package (--copy clean, --note "…")
            [--password-env VAR] [--to ed.card.json ...]                 encrypted, for a password and/or people
  nysakn.py check bill.nysakn|clean-copy.pdf                             check it: exit 0 sound, 1 VOID, 3 not opened
            [--password-env VAR] [--key ann.key.json] [--trust ann.card.json|KEYID ...]
            [--no-profile] [--rerender] [--json]

A package is VOID when its signature or its signer's card does not check, a file it lists is missing or changed,
or the fingerprint in its manifest is not its bill's. A PDF is VOID when the package inside it is, when a page does
not carry the package's fingerprint, or (with --rerender, which needs Typst and the clean-copy template) when the
words on its pages are not the words the package's XML prints. An untrusted signer, files added after signing,
stale sign-offs and the profile's own findings are warnings.

Keys kept in a file are for trying the format out; in production signatures would rest on the state's own
sign-ins or certificates.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MIME = "application/vnd.lbdc.akn-ny+zip"
KIND, FORMAT, VERSION = "AKN-NY bill package", "akn-ny-package", 2
PBKDF2_ITER = 310000
AAD_PAYLOAD, AAD_KEY, HKDF_INFO = b"akn-ny-package-v1 payload", b"akn-ny-package-v1 key", b"akn-ny-package-v1 wrap"
CARD_FIELDS = ("box", "created", "device", "keyId", "name", "role", "sign", "v")
MAX_FILES, MAX_ONE, MAX_ALL = 200, 64 << 20, 256 << 20
README = """This is a signed bill package (.nysakn), version 2, from LBDC's Bill Drafter.

bill.akn.xml is the bill in LBDC's AKN-NY profile; preview.html shows it in any browser (it checks nothing).
activity.json is each person's signed log of what they did to the draft, lawcheck.json the checks against the
Bank when it was signed, versions/ earlier versions, attachments/ the files that go with it, each signed by the
person who added it.

 manifest.json lists every file with its size and SHA-256,
and signature.json holds the signer's Ed25519 signature over the exact bytes of manifest.json. The signer's
public key is in the manifest, on their card; compare its fingerprint with them before you trust it.

Check it in the Bill Drafter for Word (Clean copy > Signed package > Check a package or PDF), or with the
AKN-NY profile's tools/nysakn.py check. A package that fails a check is VOID: do not rely on it.
"""

PROFILE = Path(__file__).resolve().parent.parent


class Unreadable(Exception):
    """The file could not be opened at all (not a package, damaged, or encrypted without the means to open it)."""


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def unb64(s) -> bytes:
    try:
        return base64.b64decode(str(s or ""), validate=True)
    except (ValueError, TypeError):
        return b""


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def fingerprint_code(sha: str) -> str:
    return "-".join(sha[i:i + 4] for i in (0, 4, 8)).upper()


def key_fingerprint(key_id: str) -> str:
    k = str(key_id or "").upper()
    return " ".join(k[i:i + 4] for i in range(0, len(k), 4))


def card_text(c: dict | None) -> str:
    if not c:
        return "someone"
    return c.get("name", "") + (f" ({c['role']})" if c.get("role") else "") + (f" on {c['device']}" if c.get("device") else "")


# ---------- cards and keys ----------

def card_message(c: dict) -> bytes:
    body = json.dumps({k: c.get(k) for k in CARD_FIELDS}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return b"AKN-NY-CARD-v1\0" + body.encode()


def purpose_message(purpose: str, msg: bytes) -> bytes:
    return b"AKN-NY-PKG-v1\0" + purpose.encode() + b"\0" + msg


def raw_public(k) -> bytes:
    return k.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def raw_private(k) -> bytes:
    return k.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())


def make_keys(name: str, role: str, device: str = "the command line") -> dict:
    s, x = Ed25519PrivateKey.generate(), X25519PrivateKey.generate()
    sp, xp = raw_public(s.public_key()), raw_public(x.public_key())
    card = {"v": 1, "keyId": sha256(sp + xp)[:20], "name": name, "role": role, "device": device,
            "sign": b64(sp), "box": b64(xp), "created": now()}
    card["self"] = b64(s.sign(card_message(card)))
    return {"card": card, "secret": b64(raw_private(s) + raw_private(x))}


def load_keys(stored: dict):
    raw = unb64(stored.get("secret"))
    if len(raw) != 64:
        raise SystemExit("The key file is damaged.")
    return stored["card"], Ed25519PrivateKey.from_private_bytes(raw[:32]), X25519PrivateKey.from_private_bytes(raw[32:])


def card_valid(c) -> bool:
    try:
        sp, xp, sig = unb64(c.get("sign")), unb64(c.get("box")), unb64(c.get("self"))
        if len(sp) != 32 or len(xp) != 32 or c.get("v") != 1 or c.get("keyId") != sha256(sp + xp)[:20]:
            return False
        Ed25519PublicKey.from_public_bytes(sp).verify(sig, card_message(c))
        return True
    except (InvalidSignature, ValueError, AttributeError, TypeError):
        return False


def verify_for(card: dict, purpose: str, msg: bytes, sig: str) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(unb64(card.get("sign"))).verify(unb64(sig), purpose_message(purpose, msg))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


# ---------- zips ----------

def write_zip(parts: list[tuple[str, bytes, bool]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for path, data, store in parts:
            info = zipfile.ZipInfo(path, date_time=datetime.now().timetuple()[:6])
            info.compress_type = zipfile.ZIP_STORED if store or len(data) <= 256 else zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    return buf.getvalue()


def read_zip(data: bytes) -> tuple[dict, list]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise Unreadable("This is not a bill package (it is not a readable zip).")
    infos = [i for i in z.infolist() if not i.filename.endswith("/")]
    if len(infos) > MAX_FILES:
        raise Unreadable("This package has too many parts.")
    files, order, total = {}, [], 0
    for i in infos:
        n = i.filename
        if not n or n.startswith("/") or "\\" in n or any(s in ("", ".", "..") for s in n.split("/")):
            raise Unreadable("This package has a part with an unsafe name, so it was not opened.")
        if n in files:
            raise Unreadable(f"This package has two parts called {n}, so it was not opened.")
        total += i.file_size
        if i.file_size > MAX_ONE or total > MAX_ALL:
            raise Unreadable("This package is too large to open.")
        try:
            files[n] = z.read(i)
        except (zipfile.BadZipFile, OSError) as e:
            raise Unreadable(f"This package is damaged or was changed: {n} no longer matches its own checksum ({e}).")
        order.append(n)
    return files, order


# ---------- making a package ----------

def bill_info(xml: str) -> dict:
    def pick(pattern):
        m = re.search(pattern, xml)
        return m.group(1) if m else ""
    out = {}
    lbd = pick(r"<lbdc:lbdNumber[^>]*>([^<]*)<")
    expr = pick(r"<FRBRExpression>[\s\S]*?<FRBRthis value=\"([^\"]*)\"")
    status = pick(r"<lbdc:working\b[^>]*status=\"([^\"]*)\"")
    if lbd:
        out["lbd"] = lbd
    if expr:
        out["expression"] = expr
    if status:
        out["status"] = status
    return out


# ---------- version 2's parts: canonical JSON, the activity log, attachments, the preview ----------

def canon(v) -> bytes:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


ENTRY_FIELDS = ("at", "by", "role", "e", "d", "k", "seq", "prev")


def add_entry(stored_key: dict, log: list, e: str, d: str = "") -> list:
    """An activity entry signed with this key, chained to its previous entry (as the Word add-in's addEntry)."""
    card, sk, _ = load_keys(stored_key)
    mine = [x for x in log if x.get("k") == card["keyId"]]
    last = mine[-1] if mine else None
    x = {"at": now(), "by": card["name"], "role": card["role"], "e": e, "d": d, "k": card["keyId"],
         "seq": last["seq"] + 1 if last else 1, "prev": last["h"] if last else ""}
    x["h"] = sha256(canon(x))
    x["sig"] = b64(sk.sign(purpose_message("activity", x["h"].encode())))
    return log + [x]


def check_log(log: list, people: dict) -> dict:
    out = {"entries": [], "signers": {}, "problems": []}
    chains: dict[str, list] = {}
    for x in log:
        it = dict(x, status="bad")
        c = people.get(x.get("k"))
        if not c:
            it["status"] = "unknown-key"
        elif sha256(canon({f: x.get(f) for f in ENTRY_FIELDS})) == x.get("h") and verify_for(c, "activity", str(x.get("h")).encode(), x.get("sig", "")):
            it["status"] = "valid"
            chains.setdefault(x["k"], []).append(x)
        out["entries"].append(it)
    bad = sum(1 for e in out["entries"] if e["status"] == "bad")
    unknown = sum(1 for e in out["entries"] if e["status"] == "unknown-key")
    if bad:
        out["problems"].append(f"{bad} entr{'y' if bad == 1 else 'ies'} of its activity log {'was' if bad == 1 else 'were'} changed after being signed")
    if unknown:
        out["problems"].append(f"{unknown} entr{'y' if unknown == 1 else 'ies'} of its activity log {'is' if unknown == 1 else 'are'} signed by a key it does not name")
    for k, ls in chains.items():
        ls.sort(key=lambda x: x["seq"])
        by_seq = {x["seq"]: x for x in ls}
        s = out["signers"][k] = {"card": people[k], "count": len(ls), "last": ls[-1]["seq"], "head": ls[-1]["h"], "gaps": [], "broken": 0}
        for n in range(1, s["last"] + 1):
            x = by_seq.get(n)
            if not x:
                s["gaps"].append(n)
            elif n == 1:
                s["broken"] += x.get("prev") != ""
            elif n - 1 in by_seq and x.get("prev") != by_seq[n - 1]["h"]:
                s["broken"] += 1
        who = card_text(people[k])
        if s["gaps"]:
            g = s["gaps"]
            out["problems"].append(f"{who}’s activity " + (f"entry {g[0]} is" if len(g) == 1 else "entries " + ", ".join(map(str, g[:8])) + (", …" if len(g) > 8 else "") + " are") + " missing")
        if s["broken"]:
            out["problems"].append(f"{who}’s chain of activity entries is broken in {s['broken']} place" + ("" if s["broken"] == 1 else "s"))
    return out


def chain_heads(log: list) -> dict:
    h = {}
    for x in log:
        if x["k"] not in h or x["seq"] > h[x["k"]]["seq"]:
            h[x["k"]] = {"seq": x["seq"], "h": x["h"]}
    return h


def attach_msg(a: dict) -> bytes:
    return canon({"name": a["name"], "size": a["size"], "sha256": a["sha256"], "at": a["at"], "by": a.get("by", ""), "k": a.get("k", "")})


def safe_name(n: str) -> str:
    n = re.split(r"[\\/]", str(n or ""))[-1]
    n = re.sub(r'[\x00-\x1f<>:"|?*]', "_", n).strip()
    if not n or n.startswith("."):
        n = "attachment" + n
    return n[:120]


def attachment(stored_key: dict, name: str, data: bytes, mime: str = "") -> dict:
    card, sk, _ = load_keys(stored_key)
    a = {"name": safe_name(name), **({"type": mime} if mime else {}), "size": len(data), "sha256": sha256(data), "at": now(), "by": card["name"], "k": card["keyId"]}
    a["sig"] = b64(sk.sign(purpose_message("attachment", attach_msg(a))))
    return a


def bill_text(xml: str) -> list[str]:
    t = re.sub(r"<meta>[\s\S]*?</meta>", "", xml, count=1)
    t = re.sub(r"<ins\b[^>]*>", "\x01", t).replace("</ins>", "\x02")
    t = re.sub(r"<del\b[^>]*>", "[", t).replace("</del>", "]")
    t = re.sub(r"</(p|heading|longTitle|formula|docTitle|docNumber|docProponent|docStage|docDate|tr)>", "\n", t)
    t = re.sub(r"<num\b[^>]*>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    for a, b in (("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"), ("&amp;", "&")):
        t = t.replace(a, b)
    return [l for l in (re.sub(r"\s+", " ", x).strip() for x in t.split("\n")) if l]


def preview_html(m: dict, xml: str) -> str:
    import html
    b = m.get("bill", {})
    title = "LBD " + b["lbd"] if b.get("lbd") else "Bill"
    lines = "\n".join("<p>" + html.escape(l).replace("\x01", "<u>").replace("\x02", "</u>") + "</p>" for l in bill_text(xml))
    pk = m.get("packet")
    pkt = (f'<div class="packet"><b>Review packet for the {html.escape(pk.get("to", "").lower())}</b>' + (f' · due {html.escape(pk["due"])}' if pk.get("due") else "")
           + (f'<br>{html.escape(pk["note"])}' if pk.get("note") else "") + "</div>") if pk else ""
    return ('<!doctype html><html><head><meta charset="utf-8"><title>' + html.escape(title) + '</title><style>body{margin:0;font:14px system-ui,sans-serif;background:#f4f4ef;color:#1f2a24}'
            'header{padding:20px 28px;background:#fff;border-bottom:1px solid #d6dfd9}h1{font:600 22px Georgia,serif;margin:0 0 6px}.meta{color:#53616a;margin:2px 0}.packet{margin-top:10px;padding:10px 12px;border-left:4px solid #b45309;background:#fff7ed}'
            'main{max-width:46em;margin:20px auto;padding:24px 32px;background:#fff;font:13.5px/1.55 "Courier New",monospace}main p{margin:0 0 .5em}footer{color:#53616a;font-size:12px;padding:0 28px 28px;max-width:46em;margin:auto}</style></head><body>'
            f'<header><h1>{html.escape(title)}</h1><p class="meta">{"Clean copy" if m.get("copy") == "clean" else "Working copy"}' + (f' · {html.escape(b["status"])}' if b.get("status") else "")
            + f' · signed by {html.escape(card_text(m.get("signer")))} · {html.escape(str(m.get("created", ""))[:10])}</p>'
            f'<p class="meta">Bill fingerprint {html.escape(m.get("fingerprint", ""))} · key {html.escape(key_fingerprint(m.get("signer", {}).get("keyId")))}</p>{pkt}</header><main>{lines}</main>'
            "<footer>Preview only: it shows what the package holds but checks nothing. The signed bill is bill.akn.xml; check the package in the Bill Drafter for Word or with the AKN-NY profile's tools/nysakn.py check.</footer></body></html>")


def build(xml: bytes, stored_key: dict, copy: str = "working", note: str = "", app: str = "AKN-NY profile tools/nysakn.py",
          packet: dict | None = None, versions: list | None = None, attachments: list | None = None,
          activity: list | None = None, people: dict | None = None, lawcheck: dict | None = None, pdftext: str | None = None) -> bytes:
    """versions: [{"xml": bytes, "label", "at", "by"}]; attachments: [(meta from attachment(), data)];
    activity: entries (add_entry); people: {keyId: card} for the keys that sign the activity and attachments."""
    card, sk, _ = load_keys(stored_key)
    parts = [("bill.akn.xml", xml)]
    created = now()
    m = {"kind": KIND, "format": FORMAT, "version": VERSION, "created": created, "app": app,
         "copy": "clean" if copy == "clean" else "working",
         "signer": {k: card[k] for k in (*CARD_FIELDS, "self")}, "bill": bill_info(xml.decode("utf-8", "replace")),
         "fingerprint": fingerprint_code(sha256(xml))}
    if note:
        m["note"] = note
    if packet and packet.get("to"):
        m["packet"] = {k: v for k, v in packet.items() if k in ("to", "due", "note") and v}
    ppl = {card["keyId"]: {k: card[k] for k in (*CARD_FIELDS, "self")}}
    def want(k):
        if k and k not in ppl and people and k in people:
            ppl[k] = people[k]
    if activity:
        for x in activity:
            want(x.get("k"))
        parts.append(("activity.json", json.dumps({"entries": activity}, indent=1, ensure_ascii=False).encode()))
        m["chainHeads"] = chain_heads(activity)
    if lawcheck:
        parts.append(("lawcheck.json", json.dumps(lawcheck, indent=1, ensure_ascii=False).encode()))
    if versions:
        m["versions"] = []
        for i, v in enumerate(versions, 1):
            path = f"versions/{i}.akn.xml"
            parts.append((path, v["xml"]))
            vi = bill_info(v["xml"].decode("utf-8", "replace"))
            m["versions"].append({"path": path, **{k: v[k] for k in ("label", "at", "by") if v.get(k)}, **({"lbd": vi["lbd"]} if vi.get("lbd") else {}), "fingerprint": fingerprint_code(sha256(v["xml"]))})
    if attachments:
        m["attachments"] = []
        for meta, data in attachments:
            path = f"attachments/{meta['sha256']}/{meta['name']}"
            want(meta.get("k"))
            parts.append((path, data))
            m["attachments"].append({"path": path, **meta})
    if pdftext is not None:
        parts.append(("pdftext.txt", pdftext.encode()))
    m["people"] = ppl
    parts += [("preview.html", preview_html(m, xml.decode("utf-8", "replace")).encode()), ("README.txt", README.encode())]
    m["files"] = [{"path": p, "size": len(d), "sha256": sha256(d)} for p, d in parts]
    mraw = json.dumps(m, indent=1, ensure_ascii=False).encode()
    sig = {"alg": "Ed25519", "keyId": card["keyId"], "at": created, "sig": b64(sk.sign(purpose_message("manifest", mraw)))}
    return write_zip([("mimetype", MIME.encode(), True), ("manifest.json", mraw, False),
                      ("signature.json", json.dumps(sig, indent=1).encode(), False)] + [(p, d, False) for p, d in parts])


def hkdf(secret: bytes, salt: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=HKDF_INFO).derive(secret)


def pbkdf2(password: str, salt: bytes, iterations: int) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(password.encode())


def seal(key: bytes, plain: bytes, aad: bytes) -> tuple[bytes, bytes]:
    nonce = os.urandom(12)
    return nonce, AESGCM(key).encrypt(nonce, plain, aad)


def encrypt(inner: bytes, from_card: dict, password: str = "", to: list | None = None) -> bytes:
    to = to or []
    if not password and not to:
        return inner
    if password and len(password) < 8:
        raise SystemExit("Use a password of at least 8 characters.")
    ck = os.urandom(32)
    nonce, ct = seal(ck, inner, AAD_PAYLOAD)
    h = {"kind": KIND, "format": FORMAT, "version": VERSION, "encrypted": True, "cipher": "AES-256-GCM", "created": now(),
         "from": {k: from_card[k] for k in (*CARD_FIELDS, "self")}, "nonce": b64(nonce), "recipients": []}
    if password:
        salt = os.urandom(16)
        n, w = seal(pbkdf2(password, salt, PBKDF2_ITER), ck, AAD_KEY)
        h["recipients"].append({"type": "password", "salt": b64(salt), "iter": PBKDF2_ITER, "nonce": b64(n), "wrapped": b64(w)})
    for c in to:
        if not card_valid(c):
            raise SystemExit(f"The card for {card_text(c)} is not genuine.")
        pub = unb64(c["box"])
        ep = X25519PrivateKey.generate()
        epk = raw_public(ep.public_key())
        n, w = seal(hkdf(ep.exchange(X25519PublicKey.from_public_bytes(pub)), epk + pub), ck, AAD_KEY)
        h["recipients"].append({"type": "x25519", "keyId": c["keyId"], "label": card_text(c), "epk": b64(epk), "nonce": b64(n), "wrapped": b64(w)})
    note = ('<!doctype html><meta charset="utf-8"><title>Encrypted bill package</title><body style="font:16px system-ui;padding:40px">'
            '<h1>Encrypted bill package</h1><p>This signed bill package is encrypted. Check it in the Bill Drafter for Word or with tools/nysakn.py check.</p></body>')
    return write_zip([("mimetype", MIME.encode(), True), ("encrypted.json", json.dumps(h, indent=1).encode(), False),
                      ("preview.html", note.encode(), True), ("payload.bin", ct, True)])


def decrypt(h: dict, payload: bytes, password: str = "", stored_key: dict | None = None) -> bytes | None:
    nonce = unb64(h.get("nonce"))

    def open_with(ck):
        try:
            return AESGCM(ck).decrypt(nonce, payload, AAD_PAYLOAD)
        except (InvalidTag, ValueError):
            return None

    mine = load_keys(stored_key) if stored_key else None
    for r in h.get("recipients") or []:
        n, w = unb64(r.get("nonce")), unb64(r.get("wrapped"))
        try:
            if r.get("type") == "x25519" and mine and mine[0]["keyId"] == r.get("keyId"):
                epk = unb64(r["epk"])
                ck = AESGCM(hkdf(mine[2].exchange(X25519PublicKey.from_public_bytes(epk)), epk + unb64(mine[0]["box"]))).decrypt(n, w, AAD_KEY)
                out = open_with(ck)
                if out is not None:
                    return out
            if r.get("type") == "password" and password and 100000 <= int(r.get("iter", 0)) <= 5000000:
                out = open_with(AESGCM(pbkdf2(password, unb64(r["salt"]), int(r["iter"]))).decrypt(n, w, AAD_KEY))
                if out is not None:
                    return out
        except (InvalidTag, ValueError, KeyError):
            continue
    return None


# ---------- the words drawn on a PDF's pages (pdftext.txt) ----------
# The same simple reading as the Word add-in's src/lib/pdftext.js: every string a page shows (Tj, TJ, ', "), in the
# order its content draws it, each code turned into text through its font's ToUnicode map; compared with all white
# space removed. General extractors disagree with one another, so both sides use this one.

SPACE = re.compile("[\t\n\v\f\r \u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]")


def squeeze_text(s: str) -> str:
    return SPACE.sub("", s or "")


def _ws(c):
    return c in (0x20, 0x0A, 0x0D, 0x09, 0x0C, 0x00)


def _delim(c):
    return c in (0x28, 0x29, 0x3C, 0x3E, 0x5B, 0x5D, 0x7B, 0x7D, 0x2F, 0x25)


NUMBER = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)$")


def pdf_tokens(u: bytes):
    i, n = 0, len(u)
    while i < n:
        c = u[i]
        if _ws(c):
            i += 1
            continue
        if c == 0x25:
            while i < n and u[i] not in (0x0A, 0x0D):
                i += 1
            continue
        if c == 0x28:
            out, depth = bytearray(), 1
            i += 1
            while i < n and depth:
                b = u[i]
                i += 1
                if b == 0x5C:
                    e = u[i] if i < n else 0
                    i += 1
                    if e == 0x6E: out.append(10)
                    elif e == 0x72: out.append(13)
                    elif e == 0x74: out.append(9)
                    elif e == 0x62: out.append(8)
                    elif e == 0x66: out.append(12)
                    elif 0x30 <= e <= 0x37:
                        v, k = e - 48, 0
                        while k < 2 and i < n and 0x30 <= u[i] <= 0x37:
                            v = v * 8 + u[i] - 48
                            i += 1
                            k += 1
                        out.append(v & 255)
                    elif e == 0x0D:
                        if i < n and u[i] == 0x0A:
                            i += 1
                    elif e == 0x0A:
                        pass
                    else:
                        out.append(e)
                    continue
                if b == 0x28:
                    depth += 1
                elif b == 0x29:
                    depth -= 1
                    if not depth:
                        break
                out.append(b)
            yield ("s", bytes(out))
            continue
        if c == 0x3C and i + 1 < n and u[i + 1] == 0x3C:
            yield ("op", "<<"); i += 2; continue
        if c == 0x3E and i + 1 < n and u[i + 1] == 0x3E:
            yield ("op", ">>"); i += 2; continue
        if c == 0x3C:
            h = ""
            i += 1
            while i < n and u[i] != 0x3E:
                ch = chr(u[i]); i += 1
                if ch in "0123456789abcdefABCDEF":
                    h += ch
            i += 1
            if len(h) % 2:
                h += "0"
            yield ("s", bytes.fromhex(h))
            continue
        if c == 0x5B:
            yield ("op", "["); i += 1; continue
        if c == 0x5D:
            yield ("op", "]"); i += 1; continue
        if c == 0x2F:
            j = i + 1
            while j < n and not _ws(u[j]) and not _delim(u[j]):
                j += 1
            yield ("name", u[i + 1:j].decode("latin1"))
            i = j
            continue
        j = i
        while j < n and not _ws(u[j]) and not _delim(u[j]):
            j += 1
        if j == i:
            i += 1
            continue
        w = u[i:j].decode("latin1")
        i = j
        yield ("num", float(w)) if NUMBER.match(w) else ("op", w)
        if w == "ID":
            i += 1
            while i < n and not (u[i] == 0x45 and i + 1 < n and u[i + 1] == 0x49 and (i + 2 >= n or _ws(u[i + 2]))):
                i += 1
            i += 2


def _utf16(b: bytes) -> str:
    return "".join(chr((b[k] << 8) | b[k + 1]) for k in range(0, len(b) - 1, 2))


def parse_cmap(u: bytes):
    toks = list(pdf_tokens(u))
    m, width, k = {}, 0, 0
    while k < len(toks):
        kind, v = toks[k]
        if kind == "op" and v == "begincodespacerange" and k + 1 < len(toks) and toks[k + 1][0] == "s":
            width = len(toks[k + 1][1])
        if kind == "op" and v == "beginbfchar":
            k += 1
            while k + 1 < len(toks) and toks[k] != ("op", "endbfchar"):
                if toks[k][0] == "s" and toks[k + 1][0] == "s":
                    m[toks[k][1].hex()] = _utf16(toks[k + 1][1])
                k += 2
        if kind == "op" and v == "beginbfrange":
            k += 1
            while k < len(toks) and toks[k] != ("op", "endbfrange"):
                lo, hi = toks[k], toks[k + 1] if k + 1 < len(toks) else ("", None)
                dst = toks[k + 2] if k + 2 < len(toks) else ("", None)
                if lo[0] != "s" or hi[0] != "s":
                    k += 1
                    continue
                w, a, b = len(lo[1]), int(lo[1].hex(), 16), int(hi[1].hex(), 16)
                if dst[0] == "s":
                    for val in range(a, min(b, a + 65535) + 1):
                        d = bytearray(dst[1]); carry, p = val - a, len(d) - 1
                        while carry and p >= 0:
                            s0 = d[p] + carry; d[p] = s0 & 255; carry = s0 >> 8; p -= 1
                        m[format(val, "0%dx" % (w * 2))] = _utf16(bytes(d))
                    k += 3
                elif dst == ("op", "["):
                    val = a
                    k += 3
                    while k < len(toks) and toks[k] != ("op", "]"):
                        if toks[k][0] == "s":
                            m[format(val, "0%dx" % (w * 2))] = _utf16(toks[k][1]); val += 1
                        k += 1
                    k += 1
                else:
                    k += 3
        k += 1
    return m, width


def pdf_pages_text(pdf: bytes) -> list[str]:
    from pypdf import PdfReader
    from pypdf.generic import ArrayObject, IndirectObject
    reader = PdfReader(io.BytesIO(pdf))
    cache = {}

    def font_info(ref):
        key = (ref.idnum, ref.generation) if isinstance(ref, IndirectObject) else id(ref)
        if key in cache:
            return cache[key]
        f = ref.get_object()
        tu = f.get("/ToUnicode")
        m, width = parse_cmap(tu.get_object().get_data()) if tu is not None else ({}, 0)
        if not width:
            width = 2 if f.get("/Subtype") == "/Type0" else 1
        cache[key] = (m, width)
        return cache[key]

    def run(data: bytes, resources, out: list, depth: int):
        if depth > 8:
            return
        resources = resources.get_object() if resources is not None else {}
        fonts = resources.get("/Font")
        fonts = fonts.get_object() if fonts is not None else {}
        xobjs = resources.get("/XObject")
        xobjs = xobjs.get_object() if xobjs is not None else {}
        font, stack = None, []

        def show(s: bytes):
            if not font:
                return
            m, w = font
            for k in range(0, len(s) - w + 1, w):
                out.append(m.get(s[k:k + w].hex(), ""))

        for kind, v in pdf_tokens(data):
            if kind != "op" or v in ("[", "<<"):
                stack.append((kind, v))
                continue
            if v == "]":
                arr = []
                while stack and stack[-1] != ("op", "["):
                    arr.insert(0, stack.pop())
                if stack:
                    stack.pop()
                stack.append(("arr", arr))
                continue
            if v == ">>":
                while stack and stack[-1] != ("op", "<<"):
                    stack.pop()
                if stack:
                    stack.pop()
                stack.append(("dict", None))
                continue
            args, stack = stack, []
            if v == "Tf":
                nm = next((a[1] for a in args if a[0] == "name"), None)
                ref = fonts.get("/" + nm) if nm else None
                font = font_info(ref) if ref is not None else None
            elif v in ("Tj", "'", '"'):
                ss = [a[1] for a in args if a[0] == "s"]
                if ss:
                    show(ss[-1])
            elif v == "TJ":
                arr = next((a[1] for a in args if a[0] == "arr"), None)
                for e in arr or []:
                    if e[0] == "s":
                        show(e[1])
            elif v == "Do":
                nm = next((a[1] for a in args if a[0] == "name"), None)
                x = xobjs.get("/" + nm) if nm else None
                if x is not None:
                    x = x.get_object()
                    if x.get("/Subtype") == "/Form":
                        run(x.get_data(), x.get("/Resources", resources), out, depth + 1)

    pages = []
    for page in reader.pages:
        c = page.get("/Contents")
        datas = []
        if c is not None:
            c = c.get_object()
            if isinstance(c, ArrayObject):
                datas = [x.get_object().get_data() for x in c]
            else:
                datas = [c.get_data()]
        out = []
        run(b"".join(d + b"\n" for d in datas), page.get("/Resources"), out, 0)
        pages.append("".join(out))
    return pages


# ---------- checking ----------

def open_package(data: bytes, password: str = "", stored_key: dict | None = None, trusted: set | None = None) -> dict:
    o = {"problems": [], "warnings": [], "signature": {"status": "unsigned"}}
    files, order = read_zip(data)
    if files.get("mimetype", b"").decode("utf-8", "replace").strip() != MIME:
        raise Unreadable("This is not a bill package.")
    if "encrypted.json" in files:
        try:
            h = json.loads(files["encrypted.json"])
        except ValueError:
            h = None
        if not isinstance(h, dict) or not h.get("encrypted"):
            raise Unreadable("This package is damaged (its encryption header).")
        o["encrypted"] = True
        o["recipients"] = ["a password" if r.get("type") == "password" else r.get("label", "?") for r in h.get("recipients") or []]
        inner = decrypt(h, files.get("payload.bin", b""), password, stored_key)
        if inner is None:
            asks = " or ".join(o["recipients"]) or "no one"
            raise Unreadable(f"This package is encrypted; it opens with {asks}."
                             + (" That password does not open it." if password else ""))
        files, order = read_zip(inner)
        if files.get("mimetype", b"").decode("utf-8", "replace").strip() != MIME:
            raise Unreadable("This package is damaged (inside the encryption).")
    mraw = files.get("manifest.json", b"")
    try:
        m = json.loads(mraw)
    except ValueError:
        m = None
    if not isinstance(m, dict) or m.get("kind") != KIND or m.get("format") != FORMAT:
        raise Unreadable("This package is damaged (it has no manifest).")
    o["manifest"] = m
    if int(m.get("version", 0)) > VERSION:
        o["warnings"].append("This package was written by a newer version; some of it may not show.")
    try:
        sig = json.loads(files.get("signature.json", b"{}"))
    except ValueError:
        sig = {}
    card = m.get("signer")
    if not isinstance(card, dict) or not sig.get("sig"):
        o["problems"].append("it is not signed")
    else:
        s = o["signature"] = {"status": "bad", "signer": card, "fingerprint": key_fingerprint(card.get("keyId")), "at": sig.get("at", ""),
                              "trust": "trusted" if trusted and card.get("keyId") in trusted else "unknown"}
        if not card_valid(card):
            o["problems"].append("the signer’s card is not genuine (it was changed after it was made)")
        elif sig.get("alg") != "Ed25519" or sig.get("keyId") != card.get("keyId") or not verify_for(card, "manifest", mraw, sig["sig"]):
            o["problems"].append("its signature does not match its manifest")
        else:
            s["status"] = "valid"
    listed = {"mimetype", "manifest.json", "signature.json"}
    for f in m.get("files") or []:
        listed.add(f.get("path"))
        b = files.get(f.get("path"))
        if b is None:
            o["problems"].append(f"{f.get('path')} is missing")
        elif len(b) != f.get("size") or sha256(b) != f.get("sha256"):
            o["problems"].append(f"{f.get('path')} was changed after the package was signed")
    for n in order:
        if n not in listed:
            o["warnings"].append(f"Left out {n}: it was added after the package was signed.")
    xml = files.get("bill.akn.xml") if "bill.akn.xml" in listed else None
    if xml is None:
        o["problems"].append("it holds no bill (bill.akn.xml)")
    else:
        o["xml"] = xml
        o["fingerprint"] = fingerprint_code(sha256(xml))
        if m.get("fingerprint") and m["fingerprint"] != o["fingerprint"]:
            o["problems"].append("the fingerprint in its manifest is not the bill’s")
    open_parts(o, m, files, listed)
    s = o["signature"]
    if s.get("status") == "valid" and s.get("trust") != "trusted":
        o["warnings"].append(f"Signed by {card_text(card)}, whose key is not on the trusted list. Compare the fingerprint "
                             f"{s['fingerprint']} with them (in person or by phone) before you rely on it.")
    return o


def open_parts(o: dict, m: dict, files: dict, listed: set) -> None:
    """Version 2's parts, checked as the Word add-in checks them (package.js openParts)."""
    def got(p):
        return files.get(p) if p in listed else None

    def load(p):
        b = got(p)
        if b is None:
            return None
        try:
            return json.loads(b)
        except ValueError:
            return ValueError
    people = {}
    for k, c in (m.get("people") or {}).items():
        if isinstance(c, dict) and c.get("keyId") == k and card_valid(c):
            people[k] = c
        else:
            o["problems"].append(f"the card it carries for {card_text(c if isinstance(c, dict) else None)} is not genuine")
    sg = m.get("signer")
    if isinstance(sg, dict) and sg.get("keyId") not in people and card_valid(sg):
        people[sg["keyId"]] = sg
    o["people"] = people
    o["packet"] = m.get("packet")
    act = load("activity.json")
    if act is ValueError:
        o["problems"].append("its activity log (activity.json) is damaged")
    elif act is not None or m.get("chainHeads"):
        r = check_log((act or {}).get("entries") or [], people)
        o["activity"] = r
        o["problems"].extend(r["problems"])
        for k, w in (m.get("chainHeads") or {}).items():
            s = r["signers"].get(k)
            if not s or s["last"] < w["seq"] or (s["last"] == w["seq"] and s["head"] != w["h"]):
                o["problems"].append("activity entries were taken out after the package was signed")
                break
    o["attachments"] = []
    for a in m.get("attachments") or []:
        b, it = got(a.get("path")), dict(a, status="bad")
        if b is None or len(b) != a.get("size") or sha256(b) != a.get("sha256") or a.get("path") != f"attachments/{a.get('sha256')}/{a.get('name')}":
            o["problems"].append(f"the attachment {a.get('name')} is missing or changed")
        elif a.get("k") not in people:
            it["status"] = "unknown-key"
            o["problems"].append(f"the attachment {a.get('name')} is signed by a key the package does not name")
        elif not verify_for(people[a["k"]], "attachment", attach_msg(a), a.get("sig", "")):
            o["problems"].append(f"the attachment {a.get('name')}’s signature does not match it")
        else:
            it["status"], it["signer"] = "valid", people[a["k"]]["name"]
        o["attachments"].append(it)
    o["versions"] = []
    for v in m.get("versions") or []:
        b = got(v.get("path"))
        if b is None:
            o["problems"].append(f"the earlier version {v.get('label') or v.get('path')} is missing")
            continue
        if v.get("fingerprint") and v["fingerprint"] != fingerprint_code(sha256(b)):
            o["problems"].append(f"the earlier version {v.get('label') or v.get('path')} is not the one its manifest names")
        o["versions"].append(v)
    lc = load("lawcheck.json")
    if lc is ValueError:
        o["warnings"].append("Its law check (lawcheck.json) could not be read.")
    else:
        o["lawcheck"] = lc
    pt = got("pdftext.txt")
    o["pdftext"] = pt.decode("utf-8", "replace") if pt is not None else None


def signoffs_unsigned(xml: bytes, act: dict | None) -> list[str]:
    """Sign-offs standing in a working copy that no valid activity entry of their examiner records (section and hash)."""
    if not act:
        return []
    from lxml import etree
    A, L = "http://docs.oasis-open.org/legaldocml/ns/akn/3.0", "urn:x-lbdc:akn:1.0"
    try:
        doc = etree.fromstring(xml)
    except etree.XMLSyntaxError:
        return []
    names = {p.get("eId"): p.get("showAs") for p in doc.iter("{%s}TLCPerson" % A)}
    standing = {}
    for wf in doc.iter("{%s}workflow" % A):
        if wf.get("source") != "#lbdc-review":
            continue
        for st in wf.iter("{%s}step" % A):
            sec = st.get("{%s}section" % L)
            if not sec:
                continue
            if st.get("refersTo") == "#signedOff":
                standing[sec] = st
            elif st.get("refersTo") == "#signoffWithdrawn":
                standing.pop(sec, None)
    out = []
    for sec, st in standing.items():
        who = names.get((st.get("by") or "").lstrip("#"), (st.get("by") or "").lstrip("#"))
        d = f"{sec} {st.get('{%s}hash' % L)}"
        if not any(e["status"] == "valid" and e.get("e") == "signedOff" and e.get("by") == who and e.get("d") == d for e in act["entries"]):
            out.append(f"The sign-off of {sec.replace('sec_', '§ ')} by {who} is not in {who}’s signed activity.")
    return out


def profile_findings(xml: bytes) -> list[str]:
    """The profile validator's errors and warnings on the package's bill, stale sign-offs among them."""
    sys.path.insert(0, str(PROFILE))
    from validate import Validator  # noqa: E402
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "bill.akn.xml"
        p.write_bytes(xml)
        r = Validator().validate(p)
    return [f"Profile {pr.severity}: {pr.where}: {pr.message}" for pr in r.problems]


def pdf_package(pdf: bytes) -> tuple[bytes, list[str]]:  # noqa: D401
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(pdf))
    att = reader.attachments
    if "bill.nysakn" not in att:
        raise Unreadable("This PDF does not carry a signed bill package (bill.nysakn), so it cannot be checked.")
    pages = [p.extract_text() or "" for p in reader.pages]
    return att["bill.nysakn"][0], pages


def squeeze(s: str) -> str:
    return re.sub(r"\s+", "", s)


FOOT = re.compile(r"Signed package fingerprint ([0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4})")


def find_typst_and_template() -> tuple[str | None, Path | None]:
    root = PROFILE.parent  # the clean-copy folder, or the Word add-in (its template is in clean-copy/)
    typst = next((str(p) for p in (root / "bin" / "typst", root / "bin" / "typst.exe") if p.is_file()), None) or shutil.which("typst")
    template = next((t for t in (root / "bill.typ", root / "clean-copy" / "bill.typ") if t.is_file()), None)
    return typst, template


def rerender_pages(xml: bytes, code: str) -> list[str] | None:
    typst, template = find_typst_and_template()
    if not typst or not template:
        return None
    from pypdf import PdfReader
    with tempfile.TemporaryDirectory() as d:
        dd = Path(d)
        for f in template.parent.glob("*.typ"):
            shutil.copy(f, dd / f.name)
        for f in template.parent.glob("hyphenation*.json"):
            shutil.copy(f, dd / f.name)
        (dd / "bill.xml").write_bytes(xml)
        out = dd / "out.pdf"
        r = subprocess.run([typst, "compile", "--root", str(dd), "--font-path", str(template.parent / "fonts"),
                            "--input", "xml=bill.xml", "--input", f"fingerprint={code}", str(dd / "bill.typ"), str(out)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            return None
        return [p.extract_text() or "" for p in PdfReader(str(out)).pages]


def check(path: Path, password: str = "", stored_key: dict | None = None, trusted: set | None = None,
          profile: bool = True, rerender: bool = False) -> dict:
    data = path.read_bytes()
    pages = None
    if data[:4] == b"%PDF":
        data, pages = pdf_package(data)
    raw_pdf = path.read_bytes() if pages is not None else None
    o = open_package(data, password, stored_key, trusted)
    o["file"] = str(path)
    o["pdf"] = pages is not None
    if raw_pdf is not None and o.get("pdftext") is not None:
        drawn, want = pdf_pages_text(raw_pdf), o["pdftext"].split("\f")
        if len(drawn) != len(want):
            o["problems"].append(f"the PDF has {len(drawn)} pages, but its signed package says {len(want)}")
        else:
            for i, (a, b) in enumerate(zip(drawn, want), 1):
                if squeeze_text(a) != squeeze_text(b):
                    o["problems"].append(f"the words on page {i} of the PDF are not the words it was signed with")
            o["pages_checked"] = len(drawn) if not any("words on page" in p for p in o["problems"]) else 0
    if o.get("xml") is not None:
        o["warnings"].extend(signoffs_unsigned(o["xml"], o.get("activity")))
    if pages is not None and o.get("fingerprint"):
        code = o["fingerprint"]
        for i, t in enumerate(pages, 1):
            got = FOOT.findall(t)
            if not got:
                o["problems"].append(f"page {i} of the PDF does not carry the package’s fingerprint")
            elif any(g != code for g in got):
                o["problems"].append(f"page {i} of the PDF carries another fingerprint ({got[0]}, not {code})")
        if rerender:
            want = rerender_pages(o["xml"], code)
            if want is None:
                o["warnings"].append("The pages could not be compared with the XML: Typst or the clean-copy template was not found.")
            elif len(want) != len(pages):
                o["problems"].append(f"the PDF has {len(pages)} pages, but its signed XML prints {len(want)}")
            else:
                for i, (a, b) in enumerate(zip(pages, want), 1):
                    if squeeze(a) != squeeze(b):
                        o["problems"].append(f"the words on page {i} of the PDF are not the words its signed XML prints")
    if profile and o.get("xml") is not None:
        o["warnings"].extend(profile_findings(o["xml"]))
    o["void"] = {"reasons": list(dict.fromkeys(o["problems"]))} if o["problems"] else None
    return o


def report(o: dict) -> str:
    m, s = o.get("manifest", {}), o.get("signature", {})
    lines = []
    head = "VOID" if o["void"] else ("Signed and unchanged" if s.get("trust") == "trusted" else "Signed and unchanged, by a key not yet trusted")
    lines.append(f"{head}: {o['file']}")
    bill = m.get("bill", {})
    lines.append(f"  {m.get('copy', '?')} copy" + (f" of {bill['lbd']}" if bill.get("lbd") else "")
                 + (f" ({bill['expression']})" if bill.get("expression") else "") + (f", {bill['status']}" if bill.get("status") else ""))
    if s.get("signer"):
        lines.append(f"  signed by {card_text(s['signer'])}, {s.get('at', '')}; key {s.get('fingerprint')} ({s.get('trust')}); signature {s.get('status')}")
    if o.get("fingerprint"):
        lines.append(f"  fingerprint {o['fingerprint']}" + (" (on every page of the PDF)" if o.get("pdf") and not any("page" in p for p in o["problems"]) else ""))
    if o.get("encrypted"):
        lines.append("  was encrypted for " + ", ".join(o.get("recipients", [])))
    if o.get("pages_checked"):
        lines.append(f"  the words on all {o['pages_checked']} pages are the words it was signed with")
    pk = o.get("packet")
    if pk:
        lines.append(f"  review packet for the {pk.get('to', '').lower()}" + (f", due {pk['due']}" if pk.get("due") else "") + (f": {pk['note']}" if pk.get("note") else ""))
    if m.get("note"):
        lines.append(f"  note: {m['note']}")
    act = o.get("activity")
    if act:
        who = ", ".join(f"{v['card']['name']} ({v['count']})" for v in act["signers"].values())
        lines.append(f"  activity: {len(act['entries'])} signed entr{'y' if len(act['entries']) == 1 else 'ies'}" + (f" by {who}" if who else "") + ("" if act["problems"] else "; every chain is whole"))
    for a in o.get("attachments") or []:
        lines.append(f"  attachment {a['name']} ({a['size']:,} bytes)" + (f", signed by {a['signer']}" if a.get("signer") else f", {a['status']}"))
    for v in o.get("versions") or []:
        lines.append(f"  earlier version {v.get('label') or v['path']}" + (f", {v['at'][:10]}" if v.get("at") else "") + f", fingerprint {v.get('fingerprint')}")
    lc = o.get("lawcheck")
    if lc:
        lines.append(f"  when signed, the checks found {lc.get('errors', 0)} error(s) and {lc.get('warnings', 0)} warning(s)"
                     + (" against the Bank: " + ", ".join(f"{k} ({v or 'not in the Bank'})" for k, v in (lc.get("bank") or {}).items()) if lc.get("bank") else ""))
    for p in (o["void"] or {}).get("reasons", []):
        lines.append(f"  VOID: {p}")
    for w in o["warnings"]:
        lines.append(f"  warning: {w}")
    return "\n".join(lines)


def read_card(arg: str) -> dict:
    v = json.loads(Path(arg).read_text())
    return v.get("card", v)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Signed bill packages (.nysakn).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("key", help="make a new key pair")
    k.add_argument("--name", required=True)
    k.add_argument("--role", required=True, choices=["drafter", "examiner", "proofreader"])
    k.add_argument("--device", default="the command line")
    k.add_argument("-o", "--out", type=Path, required=True)
    c = sub.add_parser("card", help="write the public card of a key file")
    c.add_argument("key", type=Path)
    c.add_argument("-o", "--out", type=Path)
    mk = sub.add_parser("make", help="sign a package")
    mk.add_argument("xml", type=Path)
    mk.add_argument("--key", type=Path, required=True)
    mk.add_argument("--copy", choices=["working", "clean"], default="working")
    mk.add_argument("--note", default="")
    mk.add_argument("--packet-to", choices=["Drafter", "Examiner", "Proofreader"], help="send it as a review packet for this role")
    mk.add_argument("--due", default="", help="the review packet's due date (YYYY-MM-DD)")
    mk.add_argument("--attach", type=Path, nargs="*", default=[], help="files to attach (signed with --key)")
    mk.add_argument("--version", type=Path, nargs="*", default=[], dest="versions", help="earlier versions of the bill (.akn.xml)")
    mk.add_argument("--lawcheck", type=Path, help="a law check to carry (JSON, as the Word add-in writes it)")
    mk.add_argument("--password-env", metavar="VAR", help="encrypt with the password in this environment variable")
    mk.add_argument("--to", type=Path, nargs="*", default=[], help="encrypt for these people (card files)")
    mk.add_argument("-o", "--out", type=Path, required=True)
    ck = sub.add_parser("check", help="check a package, or a clean-copy PDF that carries one")
    ck.add_argument("file", type=Path)
    ck.add_argument("--password-env", metavar="VAR")
    ck.add_argument("--key", type=Path, help="your key file, to open a package encrypted for you")
    ck.add_argument("--trust", nargs="*", default=[], help="card files or key ids to treat as trusted")
    ck.add_argument("--no-profile", action="store_true", help="skip the profile validator")
    ck.add_argument("--rerender", action="store_true", help="for a PDF: typeset the signed XML again and compare the words page by page")
    ck.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    if a.cmd == "key":
        a.out.write_text(json.dumps(make_keys(a.name, a.role, a.device), indent=1))
        os.chmod(a.out, 0o600)
        print(f"Key for {a.name} ({a.role}) in {a.out}; fingerprint {key_fingerprint(json.loads(a.out.read_text())['card']['keyId'])}")
        return 0
    if a.cmd == "card":
        card = json.loads(a.key.read_text())["card"]
        text = json.dumps({"kind": "AKN-NY person card", "version": 1, "card": card, "fingerprint": key_fingerprint(card["keyId"])}, indent=1)
        (a.out.write_text(text) if a.out else print(text))
        return 0
    if a.cmd == "make":
        stored = json.loads(a.key.read_text())
        import mimetypes
        log = add_entry(stored, [], "packageSaved", f"{a.copy} {fingerprint_code(sha256(a.xml.read_bytes()))}")
        atts = [(attachment(stored, f.name, f.read_bytes(), mimetypes.guess_type(f.name)[0] or ""), f.read_bytes()) for f in a.attach]
        vers = [{"xml": f.read_bytes(), "label": re.sub(r"(\.akn)?\.xml$", "", f.name), "at": datetime.fromtimestamp(f.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")} for f in a.versions]
        inner = build(a.xml.read_bytes(), stored, a.copy, "" if a.packet_to else a.note,
                      packet={"to": a.packet_to, "due": a.due, "note": a.note} if a.packet_to else None,
                      versions=vers, attachments=atts, activity=log, lawcheck=json.loads(a.lawcheck.read_text()) if a.lawcheck else None)
        out = encrypt(inner, stored["card"], os.environ.get(a.password_env, "") if a.password_env else "", [read_card(str(p)) for p in a.to])
        a.out.write_bytes(out)
        print(f"Signed {a.out} ({len(out):,} bytes); fingerprint {fingerprint_code(sha256(a.xml.read_bytes()))}")
        return 0
    trusted = set()
    for t in a.trust:
        trusted.add(read_card(t)["keyId"] if Path(t).is_file() else t.replace(" ", "").lower())
    try:
        o = check(a.file, os.environ.get(a.password_env, "") if a.password_env else "",
                  json.loads(a.key.read_text()) if a.key else None, trusted, not a.no_profile, a.rerender)
    except Unreadable as e:
        print(json.dumps({"file": str(a.file), "unreadable": str(e)}) if a.json else f"Not opened: {a.file}: {e}")
        return 3
    if a.json:
        o = {k: v for k, v in o.items() if k not in ("xml", "pdftext")}
        print(json.dumps(o, indent=1, ensure_ascii=False))
    else:
        print(report(o))
    return 1 if o["void"] else 0


if __name__ == "__main__":
    sys.exit(main())
