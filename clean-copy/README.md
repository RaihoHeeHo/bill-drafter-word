# Clean copy from the add-in's Akoma Ntoso

Step 2 of LBDC's clean-copy demo pipeline (Akoma Ntoso XML -> clean-copy PDF), the same template the desktop demo uses,
fed the AKN-NY profile XML that Bill Drafter for Word exports. Step 1 (Word -> Akoma Ntoso) is the add-in itself: **Export > Convert to
Akoma Ntoso > Save .xml**, or `node tools/docx2akn.cjs bill.docx bill.akn.xml` for a saved document.

```
Word (add-in) ──Export──▶ bill.akn.xml ──bill.typ (Typst)──▶ clean-copy.pdf
```

## Build the PDF

In Word: **Export > Make clean copy (PDF)** does this inside the pane (Typst compiled to WebAssembly, loaded from the add-in's site; nothing to install). Outside Word:

With [Typst](https://typst.app/) installed (0.15 or later), from this folder:

```
typst compile --font-path fonts --input xml=bill.akn.xml bill.typ clean-copy.pdf
```

LBDC's demo app (`clean_copy.py`) works too: drop the add-in's `.akn.xml` into its window.

## The template

`bill.typ` and `hyphenation.json` are the desktop demo's, unchanged (AKN-NY profile 0.3). The template reads the
profile's XML and prints it line for line as the public PDFs do: 10.5-point FreeMono, 72 characters a line, 56 lines a
page, bold front matter and enacting clause, new matter underscored, old matter in brackets (a pair split across units
with `spanStart` / `spanMiddle` / `spanEnd` prints as one pair), the running header, and the EXPLANATION and LBD
number on page 1. Words are divided at a line end only at the points in `hyphenation.json`, learned from real prints.
The pane loads both files and compiles with Typst 0.15.1 for the browser, the same Typst as the desktop app.

## The add-in's XML is profile XML

* Front matter as the profile's classed paragraphs, and `lbdc:documentInfo` (house, session, print number, LBD
  number) for the running header and the page-1 footer.
* The whole lead-in inside the `mod`, the citation a `ref` to the provision by Bank ID, `quotedStructure` after it,
  nested by numbering with New York's unit names.
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
