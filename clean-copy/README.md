# Clean copy from the add-in's Akoma Ntoso

Step 2 of LBDC's clean-copy demo pipeline (Akoma Ntoso XML -> clean-copy PDF), the same template the desktop demo uses,
fed the AKN-NY profile XML that Bill Drafter for Word exports. Step 1 (Word -> Akoma Ntoso) is the add-in itself: **Clean copy > For other systems > Save .xml**
(budget mode: **Save the bill's XML**), or `node tools/docx2akn.cjs bill.docx bill.akn.xml` for a saved document.

```
Word (add-in) ──Export──▶ bill.akn.xml ──bill.typ (Typst)──▶ clean-copy.pdf
```

## Build the PDF

In Word: **Clean copy > Make the clean copy (PDF)** does this inside the pane (Typst compiled to WebAssembly, loaded from the add-in's site, run in a worker so the pane stays responsive; nothing to install). Outside Word:

With [Typst](https://typst.app/) installed (0.15 or later), from this folder:

```
typst compile --font-path fonts --input xml=bill.akn.xml bill.typ clean-copy.pdf
```

LBDC's demo app (`clean_copy.py`) works too: drop the add-in's `.akn.xml` into its window.

## The template

`bill.typ` and the `hyphenation*.json` files are the desktop demo's (AKN-NY profile 0.3), kept identical with it. The template reads the
profile's XML and prints it line for line as the public PDFs do: 10.5-point FreeMono, 72 characters a line, 56 lines a
page, bold front matter, the enacting clause underscored (not new matter), new matter underscored, old matter in brackets (a pair split across units
with `spanStart` / `spanMiddle` / `spanEnd` prints as one pair), the running header, and the EXPLANATION and LBD
number on page 1. Words are divided at a line end only at the points in `hyphenation.json`, learned from real prints
(`hyphenation-approp.json` for appropriation schedules, which budget prints divide their own way).
The pane loads both files and compiles with Typst 0.15.1 for the browser, the same Typst as the desktop app.

A reappropriation whose original amount the bill changes prints as the prints show it, the struck amount in brackets
and the new one underscored after it (`[15,000,000] 14,000,000 ........ (re. $12,500,000)`): the new amount is a
`quantity` inside `ins`, which the template finds and underscores.

## Printing a long bill in parts

A whole budget bill is too much for the browser's typesetter in one go (all of S.3003-D, 1,518 pages, runs it out
of memory), so the pane prints it in parts and joins them. Four inputs make that work:

| Input | Default | Means |
|---|---|---|
| `page-offset` | `0` | The part begins on page `page-offset + 1`: running headers and the table of contents count from there |
| `front` | `yes` | Whether this part carries the front matter and page 1's foot |
| `toc` | `yes` | Whether this part carries the table of contents |
| `agency-pages` | `{}` | JSON `{eId: page}`: where the agencies of earlier parts begin, for the table of contents |

Each agency is `metadata` labelled `<agency-page>` with its page, so after a part is laid out the next part's inputs
can be read from it:

```
typst compile --input xml=part1.xml --input front=no --input toc=no --input page-offset=260 \
  --input agency-pages='{"sec_1__agency_1":5,...}' bill.typ part1.pdf
typst eval 'query(<agency-page>).map(it => it.value)' --in bill.typ --input xml=part1.xml ...
```

Each agency begins a page of its own, so the parts paginate exactly as the whole bill does: joined, the pane's six
parts of S.3003-D put every one of its 671,255 words in the same place on the same page as a single run of the
desktop typesetter. Without these inputs the template prints a bill whole, as before.

`resolution.typ` (also the desktop demo's) prints resolutions in the resolution series (an AKN `statement`) as Open
Legislation sets them: 72 characters a line, no word divided, the spare spaces put in from the left and the right on
alternate lines. The add-in drafts bills, so the pane uses `bill.typ`; the desktop app picks the template by the
document.

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
