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
KIND, FORMAT, VERSION = "AKN-NY bill package", "akn-ny-package", 1
PBKDF2_ITER = 310000
AAD_PAYLOAD, AAD_KEY, HKDF_INFO = b"akn-ny-package-v1 payload", b"akn-ny-package-v1 key", b"akn-ny-package-v1 wrap"
CARD_FIELDS = ("box", "created", "device", "keyId", "name", "role", "sign", "v")
MAX_FILES, MAX_ONE, MAX_ALL = 200, 64 << 20, 256 << 20
README = """This is a signed bill package (.nysakn), version 1, from LBDC's Bill Drafter.

bill.akn.xml is the bill in LBDC's AKN-NY profile. manifest.json lists every file with its size and SHA-256,
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


def build(xml: bytes, stored_key: dict, copy: str = "working", note: str = "", app: str = "AKN-NY profile tools/nysakn.py") -> bytes:
    card, sk, _ = load_keys(stored_key)
    parts = [("bill.akn.xml", xml), ("README.txt", README.encode())]
    created = now()
    m = {"kind": KIND, "format": FORMAT, "version": VERSION, "created": created, "app": app,
         "copy": "clean" if copy == "clean" else "working",
         "signer": {k: card[k] for k in (*CARD_FIELDS, "self")}, "bill": bill_info(xml.decode("utf-8", "replace")),
         "fingerprint": fingerprint_code(sha256(xml))}
    if note:
        m["note"] = note
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
    return write_zip([("mimetype", MIME.encode(), True), ("encrypted.json", json.dumps(h, indent=1).encode(), False),
                      ("payload.bin", ct, True)])


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
    s = o["signature"]
    if s.get("status") == "valid" and s.get("trust") != "trusted":
        o["warnings"].append(f"Signed by {card_text(card)}, whose key is not on the trusted list. Compare the fingerprint "
                             f"{s['fingerprint']} with them (in person or by phone) before you rely on it.")
    return o


def profile_findings(xml: bytes) -> list[str]:
    """The profile validator's errors and warnings on the package's bill, stale sign-offs among them."""
    sys.path.insert(0, str(PROFILE))
    from validate import Validator  # noqa: E402
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "bill.akn.xml"
        p.write_bytes(xml)
        r = Validator().validate(p)
    return [f"Profile {pr.severity}: {pr.where}: {pr.message}" for pr in r.problems]


def pdf_package(pdf: bytes) -> tuple[bytes, list[str]]:
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
    o = open_package(data, password, stored_key, trusted)
    o["file"] = str(path)
    o["pdf"] = pages is not None
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
        inner = build(a.xml.read_bytes(), stored, a.copy, a.note)
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
        o = {k: v for k, v in o.items() if k != "xml"}
        print(json.dumps(o, indent=1, ensure_ascii=False))
    else:
        print(report(o))
    return 1 if o["void"] else 0


if __name__ == "__main__":
    sys.exit(main())
