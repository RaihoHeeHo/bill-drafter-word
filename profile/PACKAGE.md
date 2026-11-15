# Signed bill packages (`.nysakn`) — AKN-NY 0.4 draft

A signed package carries one AKN-NY document (a working copy or the XML a clean copy is printed from) in a file
that only its signer could have made. Anyone who has it can check who signed it and that nothing in it changed
since. A package, or a clean copy PDF, that fails a check is **VOID**.

It follows the Chrome extension's `.nysbill` version 2 files (a zip with a manifest of hashes and a signature
over the manifest's exact bytes, per-person Ed25519 and X25519 keys, a password or named-person lock), with
the AKN-NY file in place of the extension's `draft.json`. The XML is signed as bytes, not canonicalised: the
package says *these exact bytes*, which is what a clean copy is printed from. (Section sign-offs inside a
working copy use the exclusive-C14N hash described in the README, so they survive re-serialisation; the
package signature deliberately does not.)

The format is written and checked by the Bill Drafter for Word (`src/lib/package.js`) and by
`tools/nysakn.py`; each checks the other's packages in the tests.

## The package

A zip (stored or deflated entries, no zip64, no encryption at the zip level), with the parts in this order:

| Part | |
|---|---|
| `mimetype` | `application/vnd.lbdc.akn-ny+zip`, stored, first |
| `manifest.json` | what the package is, who signed it, and every other file's size and SHA-256 |
| `signature.json` | `{"alg": "Ed25519", "keyId", "at", "sig"}`: the signature over the exact bytes of `manifest.json` |
| `bill.akn.xml` | the AKN-NY document |
| `README.txt` | a note for anyone who opens the zip by hand |

`manifest.json` (comments added here):

```jsonc
{
 "kind": "AKN-NY bill package", "format": "akn-ny-package", "version": 1,
 "created": "2026-11-15T19:51:38.630Z", "app": "Bill Drafter for Word",
 "copy": "working",                       // or "clean"
 "signer": { …the signer's card… },
 "bill": { "lbd": "LBD12345-01-6", "expression": "/akn/us-ny/bill/2025/s1234/eng@/!main", "status": "examination" },
 "fingerprint": "4A47-D4B4-D206",         // the first 12 hex digits of SHA-256(bill.akn.xml), grouped
 "note": "Please look at section 2 again.",
 "files": [ { "path": "bill.akn.xml", "size": 41210, "sha256": "…" }, { "path": "README.txt", … } ]
}
```

`bill.status` is the working copy's `lbdc:working/@status`, present only for working copies. `bill` is a
convenience for listing packages; the XML is what counts.

### Signatures

Every signature is Ed25519 over a message with a purpose prefix, so a signature made for one purpose cannot be
passed off as another:

    "AKN-NY-PKG-v1" 0x00 purpose 0x00 message        purpose = "manifest"

### Cards

Each person has a key pair: Ed25519 to sign, X25519 to receive encrypted packages. Their **card** is public:

```json
{ "v": 1, "keyId": "244d3902104198c6a5ef", "name": "Kim Lo", "role": "drafter", "device": "Word",
  "sign": "<Ed25519 public key, base64>", "box": "<X25519 public key, base64>",
  "created": "2026-11-15T19:40:02.118Z", "self": "<Ed25519 signature, base64>" }
```

- `keyId` is the first 20 hex digits of SHA-256(`sign` raw bytes ‖ `box` raw bytes). Its **fingerprint** is
  the key id in groups of four, upper case (`244D 3902 1041 98C6 A5EF`), read aloud to compare.
- `self` signs `"AKN-NY-CARD-v1" 0x00` followed by the card's other eight fields as compact JSON with sorted
  keys (`json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`). A card whose fields were
  changed after it was made no longer checks.
- `role` is the LBDC review role (`drafter`, `examiner`, `proofreader`), as in the working copy's `TLCRole`.

A card says who a key *claims* to belong to. Whether to believe it is a matter of **trust**: compare the
fingerprint with the person, in person or by phone, not in the same email as the file. The Word add-in keeps a
list of trusted keys per person on each computer; `nysakn.py check --trust` takes card files or key ids.

The Word add-in keeps each person's card in the document (the review's custom XML part), so the others can see
who signed what and send them encrypted packages.

## Encryption

An encrypted package is a second zip around the first:

| Part | |
|---|---|
| `mimetype` | the same |
| `encrypted.json` | how to get the content key |
| `payload.bin` | the inner package, AES-256-GCM, additional data `akn-ny-package-v1 payload` |

```json
{ "kind": "AKN-NY bill package", "format": "akn-ny-package", "version": 1, "encrypted": true,
  "cipher": "AES-256-GCM", "created": "…", "from": { …the sender's card… }, "nonce": "<12 bytes>",
  "recipients": [
    { "type": "password", "salt": "<16 bytes>", "iter": 310000, "nonce": "…", "wrapped": "…" },
    { "type": "x25519", "keyId": "…", "label": "Lee Smith (examiner) on Word", "epk": "…", "nonce": "…", "wrapped": "…" } ] }
```

The 32-byte content key is wrapped (AES-256-GCM, additional data `akn-ny-package-v1 key`) once per recipient:

- **password**: the key-encryption key is PBKDF2-HMAC-SHA-256(password, salt, `iter`); readers accept
  100,000 to 5,000,000 iterations.
- **x25519**: a fresh ephemeral key pair per recipient; the key-encryption key is
  HKDF-SHA-256(X25519(ephemeral, recipient `box`), salt = `epk` ‖ recipient `box`, info `akn-ny-package-v1 wrap`).

`from` is not signed (the inner package is). Encryption decides who can read a package; the signature inside
decides whether to believe it.

## Clean copy PDFs

When the signer is known, the Word add-in signs every clean copy it makes:

- the template prints `Signed package fingerprint XXXX-XXXX-XXXX` at the foot of every page (the bill's
  fingerprint: `bill.typ` and `resolution.typ` take it as the `fingerprint` input);
- the PDF carries the signed package as an embedded file, `bill.nysakn` (and `bill.akn.xml` beside it, for
  convenience), with `AFRelationship /Source`.

A printed page names the exact XML it was printed from; the PDF names its own signed source.

## Checks

| Finding | |
|---|---|
| no signature, or a signature that does not match the manifest | **VOID** |
| the signer's card does not check (`self`, or `keyId` not the keys' hash) | **VOID** |
| a file the manifest lists is missing, or its size or SHA-256 differs | **VOID** |
| the manifest's `fingerprint` is not the bill's | **VOID** |
| no `bill.akn.xml` | **VOID** |
| a PDF: a page without the package's fingerprint, or with another | **VOID** |
| a PDF, re-typeset (`nysakn.py check --rerender`): a page whose words differ from the words the signed XML prints | **VOID** |
| the signer's key is not trusted | warning |
| a file in the zip that the manifest does not list (added after signing) | warning; it is left out |
| a section signed off in the working copy has changed since (a stale sign-off) | warning |
| the profile's own errors and warnings on `bill.akn.xml` (`nysakn.py check`, without `--no-profile`) | warnings |
| not a zip, a part with an unsafe name or a duplicate name, too large, an unknown mimetype | not opened |
| encrypted, without the password or the key of a person it was sent to | not opened |

A VOID package can still be looked at: the Word add-in prints it with VOID across every page (the `void`
template input) and saves its XML with VOID in the file name, so nobody takes it for the signed text.

`nysakn.py check` exits 0 when the package is sound (warnings allowed), 1 when it is VOID, and 3 when it could
not be opened.

```sh
python3 tools/nysakn.py key  --name "Kim Lo" --role drafter -o kim.key.json
python3 tools/nysakn.py card kim.key.json -o kim.card.json
python3 tools/nysakn.py make bill.akn.xml --key kim.key.json --copy clean -o bill.nysakn
LEE_PW='…' python3 tools/nysakn.py make bill.akn.xml --key kim.key.json --password-env LEE_PW --to lee.card.json -o for-lee.nysakn
python3 tools/nysakn.py check bill.nysakn --trust kim.card.json
python3 tools/nysakn.py check "clean copy.pdf" --rerender
```

## What this is not

- **Keys kept on the computer are for the demonstration.** The Word add-in keeps each person's private key in
  the browser's storage; `nysakn.py key` writes it to a file. In production, signatures would rest on the
  state's own sign-ins or certificates (an organisational PKI, smart cards or a signing service), and trust
  would come from that directory instead of fingerprints read aloud.
- **No time-stamping.** `created` and `at` are the signer's clock. A trusted time-stamp (RFC 3161) would show
  a package existed by a given time.
- **Sign-offs are hashed, not signed.** A working copy's sign-off records its section's hash and who signed
  off; the package signature covers the whole document, so the sign-offs in a signed package are the signer's
  account of them. Signing each sign-off with its examiner's own key is a possible next step.
- **No revocation.** A lost key is replaced by making a new one and telling people to stop trusting the old
  fingerprint.
