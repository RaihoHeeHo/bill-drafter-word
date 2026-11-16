# Signed bill packages (`.nysakn`), version 2 — AKN-NY 0.4 draft

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
| `preview.html` | the bill to read in any browser, with who signed it and any review packet; it checks nothing |
| `README.txt` | a note for anyone who opens the zip by hand |

and, when the package has them (version 2; each is listed in the manifest and covered by its signature):

| Part | |
|---|---|
| `activity.json` | `{"entries": […]}`: each person's signed, hash-chained log of what they did to the draft (below) |
| `lawcheck.json` | the checks against the Bank when the package was signed (below) |
| `versions/N.akn.xml` | earlier versions of the bill |
| `attachments/<sha256>/<name>` | files that go with the bill (a request memo, a fiscal note), each signed by the person who added it |
| `pdftext.txt` | in a clean copy PDF's own package only: the text of each page as drawn, pages separated by form feeds |

These follow the parts of the Chrome extension's `.nysbill` files (`versions/`, `attachments/`, `packet.json`,
`lawcheck.json`, `pdftext.txt`, the activity log, `preview.html`); the two formats are not interchangeable.

`manifest.json` (comments added here):

```jsonc
{
 "kind": "AKN-NY bill package", "format": "akn-ny-package", "version": 1,
 "created": "2026-11-15T19:51:38.630Z", "app": "Bill Drafter for Word",
 "copy": "working",                       // or "clean"
 "signer": { …the signer's card… },
 "bill": { "lbd": "LBD12345-01-6", "expression": "/akn/us-ny/bill/2025/s1234/eng@/!main", "status": "examination" },
 "fingerprint": "4A47-D4B4-D206",         // the first 12 hex digits of SHA-256(bill.akn.xml), grouped
 "note": "Please look at section 2 again.",          // or, sent for review:
 "packet": { "to": "Examiner", "due": "2026-11-20", "note": "Please look at section 2 again." },
 "people": { "<keyId>": { …card… }, … },             // every card that signs something inside: the signer, and the
                                                       // people whose activity entries and attachments it carries
 "chainHeads": { "<keyId>": { "seq": 5, "h": "…" } }, // each person's last activity entry
 "versions": [ { "path": "versions/1.akn.xml", "label": "Working copy saved by Kim Lo", "at": "…", "by": "Kim Lo",
                 "lbd": "LBD12345-01-6", "fingerprint": "…" } ],
 "attachments": [ { "path": "attachments/<sha256>/request memo.txt", "name": "request memo.txt", "type": "text/plain",
                    "size": 35, "sha256": "…", "at": "…", "by": "Kim Lo", "k": "<keyId>", "sig": "…" } ],
 "files": [ { "path": "bill.akn.xml", "size": 41210, "sha256": "…" }, { "path": "README.txt", … } ]
}
```

A version 1 package (no `people`, no parts beyond the bill and the README) is still read; `version` above 2 brings
a warning that some of it may not show.

`bill.status` is the working copy's `lbdc:working/@status`, present only for working copies. `bill` is a
convenience for listing packages; the XML is what counts.

### Signatures

Every signature is Ed25519 over a message with a purpose prefix, so a signature made for one purpose cannot be
passed off as another:

    "AKN-NY-PKG-v1" 0x00 purpose 0x00 message        purpose = "manifest"

### Canonical JSON

Where a signature covers a JSON object rather than a file's bytes (cards, activity entries, attachments), the object
is serialised with sorted keys and no spaces: `json.dumps(v, sort_keys=True, separators=(",", ":"),
ensure_ascii=False)` in Python, a recursively key-sorted `JSON.stringify` in JavaScript.

### The activity log

Every review step (sent on, signed off, sign-off withdrawn, proofread, suggestion accepted or rejected), and every
package saved, clean copy made and attachment added or removed, is an entry signed by the person who did it:

```json
{ "at": "2026-11-16T15:24:15.935Z", "by": "Lee Smith", "role": "examiner", "e": "signedOff",
  "d": "sec_2 ae99a8bb…", "k": "<keyId>", "seq": 1, "prev": "", "h": "…", "sig": "…" }
```

- `seq` counts 1, 2, … per key and `prev` is the `h` of that key's previous entry (`""` for the first), so each
  person's entries form a chain.
- `h` is the SHA-256 of the canonical entry without `h` and `sig`; `sig` is Ed25519 over the UTF-8 of `h`, purpose
  `activity`.
- A sign-off's entry records `sec_N <hash>`: the section and its C14N hash, as the working copy's `signedOff` step
  does. The examiner's sign-off is therefore signed with the examiner's own key, and a checker can confirm each
  sign-off standing in the XML against it.
- The Word add-in keeps the log in the document (the review part) and every package carries it whole.

An entry whose hash or signature does not check, a gap in a person's `seq`, a `prev` that is not the previous
entry's hash, or a person's last entry earlier than the manifest's `chainHeads` makes the package VOID. A whole
person's chain left out by the signer cannot be seen from the log alone; a sign-off in the XML with no entry from
its examiner is reported (a warning).

### Attachments

Each attachment is signed when it is added, by the person adding it: Ed25519, purpose `attachment`, over the
canonical `{name, size, sha256, at, by, k}`. Its path is `attachments/<sha256>/<name>`; the name is cleaned of path
separators and control characters and kept to 120 characters. The Word add-in keeps attachments (up to 10 MB each)
in the document, so they travel with the .docx too.

### The law check

`lawcheck.json` records the checks as they stood when the package was signed: `at`, `bank` (each law the bill
amends and the date of its Bank file, or null when the Bank lacks it), `errors`, `warnings`, and `findings` (`level`,
`rule`, `text`, `section`). It records what the signer saw; a checker runs its own checks as well.

### Versions

The Word add-in keeps the XML of every package and clean copy saved from a document in the document (gzip, base64),
and a later package can carry those earlier versions. Each is listed with its fingerprint, which must match.

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

## Clean copy PDFs (and pdftext.txt)

When the signer is known, the Word add-in signs every clean copy it makes:

- the template prints `Signed package fingerprint XXXX-XXXX-XXXX` at the foot of every page (the bill's
  fingerprint: `bill.typ` and `resolution.typ` take it as the `fingerprint` input);
- the PDF carries the signed package as an embedded file, `bill.nysakn` (and `bill.akn.xml` beside it, for
  convenience), with `AFRelationship /Source`.

A printed page names the exact XML it was printed from; the PDF names its own signed source. The package inside
the PDF also carries `pdftext.txt`: the text of each page as drawn, so a page changed in another program is found
without typesetting the bill again.

General PDF text extractors disagree with one another (on hyphens, spaces and order), so the page text is read the
same simple way on both sides (`src/lib/pdftext.js` in the add-in, `pdf_pages_text` in `tools/nysakn.py`): every
string a page shows (`Tj`, `TJ`, `'`, `"`, inside Form XObjects too), in the order its content draws it, each code
turned into text through its font's `ToUnicode` map (two-byte codes for `Type0` fonts, one byte otherwise), then
all white space removed (space, tab, line breaks, form feed, no-break spaces, U+2000–U+200B, U+2028, U+2029,
U+202F, U+205F, U+3000, U+FEFF). A PDF that another program has rewritten (re-saved, printed to PDF) can read as
changed even when its words are not; `nysakn.py check --rerender` then compares the words with the signed XML
typeset again.

## Checks

| Finding | |
|---|---|
| no signature, or a signature that does not match the manifest | **VOID** |
| the signer's card does not check (`self`, or `keyId` not the keys' hash) | **VOID** |
| a file the manifest lists is missing, or its size or SHA-256 differs | **VOID** |
| the manifest's `fingerprint` is not the bill's | **VOID** |
| no `bill.akn.xml` | **VOID** |
| a PDF: a page without the package's fingerprint, or with another | **VOID** |
| a PDF whose package holds `pdftext.txt`: a different number of pages, or a page whose text differs | **VOID** |
| an activity entry changed, a gap or a break in a person's chain, entries fewer than `chainHeads` | **VOID** |
| an activity entry or attachment signed by a key the package does not carry, or a card in `people` that does not check | **VOID** |
| an attachment missing, changed, renamed, or its signature not matching | **VOID** |
| an earlier version missing, or not the one its fingerprint names | **VOID** |
| a sign-off standing in the working copy with no activity entry from its examiner | warning |
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
python3 tools/nysakn.py make bill.akn.xml --key kim.key.json --packet-to Examiner --due 2026-11-20 --note "§ 2 again" \
        --attach memo.pdf --version earlier.akn.xml -o for-review.nysakn
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
- **A person's whole log can be left out.** The chain shows an entry taken from the middle or the end of a
  person's log, but not every entry of someone the package no longer mentions. The cross-check of sign-offs against
  the activity covers the sign-offs; a time-stamp service or a shared record would cover the rest.
- **No revocation.** A lost key is replaced by making a new one and telling people to stop trusting the old
  fingerprint.
