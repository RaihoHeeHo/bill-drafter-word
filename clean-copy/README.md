# Clean copy from the add-in's Akoma Ntoso

Step 2 of LBDC's clean-copy demo pipeline (Akoma Ntoso XML -> clean-copy PDF), set up to take the XML that
Bill Drafter for Word exports. Step 1 (Word -> Akoma Ntoso) is the add-in itself: **Export > Convert to
Akoma Ntoso > Save .xml**, or `node tools/docx2akn.cjs bill.docx bill.akn.xml` for a saved document.

```
Word (add-in) ──Export──▶ bill.akn.xml ──bill.typ (Typst)──▶ clean-copy.pdf
```

## Build the PDF

With [Typst](https://typst.app/) installed:

```
typst compile --font-path fonts --input xml=bill.akn.xml bill.typ clean-copy.pdf
```

LBDC's demo app (`clean_copy.py`) works too: drop the add-in's `.akn.xml` into its window. Use this folder's
`bill.typ` in place of the demo's.

## What changed from the demo's `bill.typ`

Two small additions, marked "Bill Drafter for Word" in the file:

1. A unit that has sub-units keeps its opening words ("1. It shall be an unlawful discriminatory practice:")
   in `<intro>`, which is how Akoma Ntoso's schema wants it; the template now prints `<intro>` like `<content>`.
2. A bill section's `<heading>` ("Section 1. Short title. …") is printed after its number.

Nothing else changed, so the demo's own sample XML prints the same as before.

## The add-in's XML matches the demo's shape

* Front matter: `docAuthority`, `docNumber`, `session`, `docStage`, `docDate`, the "Introduced by" paragraph and
  `longTitle`, from the Export tab's bill information (saved in the document's properties).
* `<proprietary>` with `lbdc:house` and `lbdc:lbdNumber` (the running header and the page-1 footer).
* The lead-in ("Section 12 of the … law … is amended to read as follows:") stays in the section's paragraph, with
  a `<ref>` to the law; `<mod><quotedStructure>` holds the amended text, nested section / subsection / paragraph /
  subparagraph … by the same numbering rules as the demo's `docx2akn.py`.
* `<ins>` for new matter, `<del>` for old matter (no brackets in the XML; the template adds them).

## Cross-check with the demo's round-trip check

The demo's `docx2akn.py --check` compares an XML file with a Word document word for word. As shipped it can't see
the add-in's documents: python-docx's `doc.paragraphs` skips paragraphs inside content controls, and it only counts
direct underlining, not the Bill Insert style. `docx2akn-content-controls.patch` fixes both in `read_paragraphs`
(its own 19 tests still pass). With it:

```
python3 docx2akn.py --check "Example bill.docx" "Example bill.akn.xml"
```

reports only the front matter (which the add-in writes from the bill information, not from the document's text).

The fonts are FreeMono from the demo (GPL with the font exception).
