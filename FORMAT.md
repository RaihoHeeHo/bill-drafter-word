# The bill's structure in the .docx, and how it maps to Akoma Ntoso

The add-in never guesses meaning from the layout. Everything that matters is either a **tagged content control** or a run in one of two **character styles**. Paragraph styles are only for the eye; a document can be restyled freely without changing its meaning, and nothing about it tries to look like a printed bill.

## Content controls

Each tag starts with `akn:` and may carry `;key=value` properties (Word allows 64 characters).

| Tag | Kind | Holds | Akoma Ntoso |
|---|---|---|---|
| `akn:longTitle` | block | The title paragraph ("AN ACT to amend …") | `preface/longTitle/p` |
| `akn:subject` | inline, inside the title | What the bill is "in relation to" | `span refersTo="#subject"` |
| `akn:enactingFormula` | block | "The People of the State of New York, represented in Senate and Assembly, do enact as follows:" | `preamble/formula[@name="enactingFormula"]` |
| `akn:section;act=…;law=…;loc=…;unit=…` | block | One section of the bill | `body/section` with `eId="sec_N"` and `refersTo` from `act` |
| `akn:num` | inline, first paragraph of a section | "Section 1." / "§ 2." | `section/num` |
| `akn:heading` | inline, after the number | "Short title.", "Severability clause." … | `section/heading` |
| `akn:mod` | inline, after the number | The amending clause ("Section 12 of the general construction law, as amended by …, is amended to read as follows:") | text of `content/p`, with the law's name linked as `ref`; the `mod` follows it in the same `p` |
| `akn:quoted;law=…;loc=…;unit=…` | block, inside a section | The text of the provision as the bill would leave it | `p/mod/quotedStructure`, nested by numbering (below) |

### Section `act` values

| `act` | Made by | `refersTo` | Notes |
|---|---|---|---|
| `amend` | Amend a law > Amend the section / subdivision | `#amendment` | `law` = Bank law id (e.g. `GCN`), `loc` = section id as the Bank has it (`37-A`), `unit` = subdivision |
| `add` | Add a new section / subdivision | `#amendment` | all of the quoted text is new matter |
| `repeal` | Repeal the section | `#repeal` | no quoted text |
| `shortTitle` | Standard sections | `#shortTitle` | always section 1 |
| `findings` | Standard sections | `#legislativeFindings` | after the short title |
| `new` | Blank section | `#newMatter` | free text, not underlined (new law, notwithstanding clauses, …) |
| `severability` | Standard sections | `#severability` | just before the effective date |
| `effective` | Standard sections | `#effectiveDate` | always last |

Section numbers are not stored anywhere else: **Renumber sections** rewrites every `akn:num` from the order of the sections.

## Character styles inside the law's text

| Style (id) | Means | Akoma Ntoso |
|---|---|---|
| Bill Insert (`BillInsert`, underlined) | New matter | `ins` |
| Bill Delete (`BillDelete`, text in brackets) | Matter in the law to be omitted. The brackets are typed characters for readers; the converter drops them. | `del` |
| anything else | The law's words, unchanged | text |

Readers match a style by how its id starts (`BillInsert…`, `BillDelete…`), because Word makes a style's id from its name and documents made with earlier versions of the add-in have `BillInsertnewmatter` / `BillDeletematteromitted`. Brackets typed in plain text also open and close omitted matter.

Word keeps a content control that holds a single paragraph *inside* that paragraph (an inline control), so a title or a one-paragraph section (often the effective date) is saved as `w:p > w:sdt`. Readers treat a paragraph whose text sits in an `akn:longTitle`, `akn:enactingFormula`, `akn:section` or `akn:quoted` control exactly like the block control it was written as.

Word's own tracked changes (`w:ins` / `w:del`) and plain underlining are read the same way, so a document edited with Track Changes on still converts correctly. **Mark changes** rewrites each amended text with the two styles by comparing it word by word with this computer's Bank, so the unmarked and bracketed words are always exactly the law.

## Paragraph styles (look only)

`Bill Title`, `Bill Enacting Clause`, `Bill Section`, `Bill Amended Text`, plus character styles `Bill Section Number` and `Bill Section Heading`.

## Amended text: nesting by numbering

Inside `quotedStructure`, each numbered paragraph is a unit, nested by the order in which the kinds of number first appear, with the same rules as LBDC's clean-copy demo converter:

| Number | Kind |
|---|---|
| `§ 296.` | section (then subsection, paragraph, …) |
| `1.` `(a)` `(1)` `(i)` `(A)` `a.` | the next level down, in order of first appearance; `(i)` right after `(h)` is a letter, otherwise roman |

A section's short verbless sentence after its number is its `heading` ("§ 12. Affidavit."); on other units, a short sentence standing alone before a deeper unit. "§ 296. Unlawful discriminatory practices. 1. It shall be …" is split into the section and its subsection 1. Text before a unit's sub-units goes in `intro`; unnumbered paragraphs join the unit above. eIds are prefixed with the `mod`'s (`sec_3__mod_1__subsec_1__para_a`) so two amendments of the same provision never collide.

## Document properties

The Export tab saves the bill information as custom document properties, and both converters read them:

| Property | Akoma Ntoso |
|---|---|
| `LBD` (e.g. `12345-01-6`) | `proprietary/lbdc:lbdNumber` (`LBD12345-01-6`) |
| `House` (`senate` / `assembly`) | `proprietary/lbdc:house`, `docStage` ("IN SENATE"), FRBR author |
| `BillNumber` | `docNumber`, FRBR number; work URI `/akn/us-ny/bill/<year>/S1234` (or `…/lbd-<lbd>` before printing) |
| `Sponsor`, `Committee` | the "Introduced by" paragraph (`docProponent`, `docCommittee`) |
| `BillDate`, `SessionYear` | `docDate`, `session` ("2025-2026 Regular Sessions"), FRBR dates |

The front matter (`docAuthority` … `longTitle`) and `proprietary` follow the shape of LBDC's clean-copy demo, so its Typst template prints the cover; see `clean-copy/`.

## What the converter adds

* `meta/analysis/activeModifications`: one `textualMod` per amending section, `type` = `substitution` (amend), `insertion` (add) or `repeal`, with `source` = the `mod` and `destination` = the law's URI, e.g. `/akn/us-ny/act/consolidated/gcn/!main#sec_12__subsec_1`.
* `meta/references`: TLC entries for the legislature, the drafter, and each concept used in `refersTo`.

The output validates against the OASIS Akoma Ntoso 3.0 schema (`akomantoso30.xsd`); `examples/Example bill.akn.xml` is a sample and `examples/Example bill - clean copy.pdf` is its clean copy.

## Converting a saved .docx

The task pane's **Export** tab converts the open document. For a saved file:

```
npm install
node tools/docx2akn.cjs "My bill.docx" "My bill.akn.xml"
```

Both use the same code (`src/lib/ooxml.js` reads the .docx, `src/lib/akn.js` writes Akoma Ntoso).

## Known limits of the mapping

* Unconsolidated laws get a consolidated-style URI built from their Bank id; check those `ref`s.
* Tables inside amended text are kept as plain text.
