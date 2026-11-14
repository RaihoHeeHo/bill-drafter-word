# The bill's structure in the .docx, and how it maps to Akoma Ntoso

The XML follows LBDC's **AKN-NY profile, version 0.3** (the profile's validator is in `profile/`; `npm test` runs it on the add-in's output).

The add-in never guesses meaning from the layout. Everything that matters is either a **tagged content control** or a run in one of two **character styles**. Paragraph styles are only for the eye; a document can be restyled freely without changing its meaning, and nothing about it tries to look like a printed bill.

## Content controls

Each tag starts with `akn:` and may carry `;key=value` properties (Word allows 64 characters).

| Tag | Kind | Holds | Akoma Ntoso |
|---|---|---|---|
| `akn:longTitle` | block | The title paragraph ("AN ACT to amend …") | `preface/longTitle/p` |
| `akn:subject` | inline, inside the title | What the bill is "in relation to" | `span refersTo="#subject"` |
| `akn:enactingFormula` | block | "The People of the State of New York, represented in Senate and Assembly, do enact as follows:" | `preamble/formula[@name="enactingFormula"]` |
| `akn:section;act=…;law=…;loc=…;unit=…` | block | One section of the bill | `body/section` with `eId="sec_N"`; standard sections get `refersTo` (below) |
| `akn:num` | inline, first paragraph of a section | "Section 1." / "§ 2." | `section/num` |
| `akn:heading` | inline, after the number | "Short title.", "Severability clause." … | `section/heading` |
| `akn:mod` | inline, after the number | The amending clause ("Section 12 of the general construction law, as amended by …, is amended to read as follows:") | the start of `content/p/mod`: the citation as `ref` to the provision, each act in the history as `ref class="amendmentHistory amended"` (or `added`, `renumbered`), then the rest of the clause |
| `akn:quoted;law=…;loc=…;unit=…` | block, inside a section | The text of the provision as the bill would leave it | `mod/quotedStructure eId="…__qstr"` after the lead-in, nested by numbering (below) |

### Section `act` values

| `act` | Made by | `refersTo` | Notes |
|---|---|---|---|
| `amend` | Amend a law > Amend the section / subdivision | — | `law` = Bank law id (e.g. `GCN`), `loc` = section id as the Bank has it (`37-A`), `unit` = subdivision (or subsection, for the Tax and Insurance Laws). `textualMod type="substitution"` |
| `add` | Add a new section / subdivision | — | all of the quoted text is new matter. `textualMod type="insertion"` |
| `repeal` | Repeal the section | — | no quoted text; the lead-in ends "is REPEALED." inside the `mod`. `textualMod type="repeal"` |
| `shortTitle` | Standard sections | `#shortTitle` | always section 1 |
| `findings` | Standard sections | `#legislativeFindings` | after the short title |
| `new` | Blank section | — | free text, not underlined (new law, notwithstanding clauses, …) |
| `severability` | Standard sections | `#severability` | just before the effective date |
| `effective` | Standard sections | `#effectiveDate` | always last; `class` says what kind (`immediate`, `daysAfter`, `nextSucceeding`, `dateCertain`, `retroactive`, `sunset`, `regulations`, `applicability`), read from the wording |

Section numbers are not stored anywhere else: **Renumber sections** rewrites every `akn:num` from the order of the sections.

## Character styles inside the law's text

| Style (id) | Means | Akoma Ntoso |
|---|---|---|
| Bill Insert (`BillInsert`, underlined) | New matter | `ins` |
| Bill Delete (`BillDelete`, text in brackets) | Matter in the law to be omitted. The brackets are typed characters for readers; the converter drops them. | `del`; one pair of brackets that runs from a unit's number into its text, or into the next unit, is split into `del class="spanStart"`, `"spanMiddle"`, `"spanEnd"` |
| anything else | The law's words, unchanged | text |

Readers match a style by how its id starts (`BillInsert…`, `BillDelete…`), because Word makes a style's id from its name and documents made with earlier versions of the add-in have `BillInsertnewmatter` / `BillDeletematteromitted`. Brackets typed in plain text also open and close omitted matter.

Word keeps a content control that holds a single paragraph *inside* that paragraph (an inline control), so a title or a one-paragraph section (often the effective date) is saved as `w:p > w:sdt`. Readers treat a paragraph whose text sits in an `akn:longTitle`, `akn:enactingFormula`, `akn:section` or `akn:quoted` control exactly like the block control it was written as.

Word's own tracked changes (`w:ins` / `w:del`) and plain underlining are read the same way, so a document edited with Track Changes on still converts correctly. **Mark changes** rewrites each amended text with the two styles by comparing it word by word with this computer's Bank, so the unmarked and bracketed words are always exactly the law.

## Paragraph styles (look only)

`Bill Title`, `Bill Enacting Clause`, `Bill Section`, `Bill Amended Text`, plus character styles `Bill Section Number` and `Bill Section Heading`.

## Amended text: nesting by numbering

Inside `quotedStructure`, each numbered paragraph is a unit, nested by the order in which the kinds of number first appear, and named as New York names them:

| Number, in order of first appearance | Most laws | Tax Law, Insurance Law |
|---|---|---|
| `§ 296.` | section (`sec`) | section (`sec`) |
| next level (`1.` / `(a)`) | subdivision (`subdvs`) | subsection (`subsec`) |
| then | paragraph (`para`) | paragraph |
| then | subparagraph (`subpara`) | subparagraph |
| then | clause (`cl`), subclause (`subcl`), point | the same |

`(i)` right after `(h)` is a letter, otherwise roman. A section's short verbless sentence after its number is its `heading` ("§ 12. Affidavit."); on other units, a short sentence standing alone before a deeper unit. "§ 296. Unlawful discriminatory practices. 1. It shall be …" is split into the section and its subdivision 1. Text before a unit's sub-units goes in `intro` (eId `…__intro`); unnumbered paragraphs join the unit above.

eIds follow the profile: the `mod`'s eId, then `__qstr`, then each level (`sec_3__mod_1__qstr__sec_296__subdvs_1__para_a`). The last part is the printed number without punctuation, with its case kept (`subpara_A`). A renumbered unit (`[3.] 4.`) takes its new number; a unit struck out whole ends in `-old` (`para_4-old`); a second unit with the same number gets the Bank's marker (`para_34*2`), which is never printed.

## Document properties

The Export tab saves the bill information as custom document properties, and both converters read them:

| Property | Akoma Ntoso |
|---|---|
| `LBD` (e.g. `12345-01-6`) | `lbdc:lbdNumber` (`LBD12345-01-6`) |
| `House` (`senate` / `assembly`) | `lbdc:house`, `docStage` ("IN SENATE"), FRBR author |
| `BillNumber` (`1234`, or `1234-A` for the A print) | `docNumber` (`1234--A`), `lbdc:printNumber` (`S1234A`), FRBR number; Work `/akn/us-ny/bill/2025/s1234`, Expression `…/eng@` (original print) or `…/eng@a` |
| `Sponsor` (`SMITH`, or `SMITH, JONES`), `Committee` | the "Introduced by" paragraph (`docProponent`, `docCommittee`), with a `TLCPerson` and `TLCOrganization` for each |
| `BillDate`, `SessionYear` | `docDate` (the date of introduction, on every print), `session` and `lbdc:session` ("2025-2026"); the Work IRI's year is the first year of the session |

The front matter is written as the profile's classed paragraphs (`authority`, `number`, `session`, `stage`, `date`, `introduction`) and the `longTitle`; the clean-copy template prints the cover from them.

**Before a bill number is given** the XML is a draft: the bill is addressed by its LBD route number (`/akn/us-ny/bill/2025/lbd12345`, Expression `eng@01` for the LBD version) and has no print number. Version 0.3 of the profile defines only printed bills, so a draft does not yet validate; everything else in it does.

## What the converter adds

* `meta/analysis/activeModifications`: one `textualMod` per amending section, `type` = `substitution` (amend), `insertion` (add) or `repeal`, with `source` = the `mod` and `destination` = the provision. Laws are addressed by their Bank law ID alone, never with a year: `/akn/us-ny/act/consolidated/gcn/~sec_12`, `/akn/us-ny/act/unconsolidated/fct/~sec_1012`, `/akn/us-ny/act/constitution/cns`. An unconsolidated law the Bank names by chapter ("Emergency Tenant Protection Act 576/74") is addressed as that chapter, `/akn/us-ny/act/1974/576`. The table of laws is `src/lib/laws.js`, from the profile's `tools/laws.json`.
* `meta/references`: TLC entries for the Commission, the house, the sponsors, the committee and each concept used in `refersTo`.
* `meta/proprietary/lbdc:documentInfo`: profile name and version, house, session, print number, LBD number.

The output validates against the OASIS Akoma Ntoso 3.0 schema, LBDC's extension schema and the profile's Schematron rules (`python3 profile/validate.py bill.akn.xml`); `examples/Example bill.akn.xml` is a sample and `examples/Example bill - clean copy.pdf` is its clean copy.

## Converting a saved .docx

The task pane's **Export** tab converts the open document. For a saved file:

```
npm install
node tools/docx2akn.cjs "My bill.docx" "My bill.akn.xml"
```

Both use the same code (`src/lib/ooxml.js` reads the .docx, `src/lib/akn.js` writes Akoma Ntoso).

## Known limits of the mapping

* A law missing from `src/lib/laws.js` is addressed from the Bank's own law type; check those `ref`s.
* Tables inside amended text are kept as plain text (the profile's `hcontainer name="table"` isn't produced yet).
* The amendment history is whatever the drafter types; in deployment it comes from LBDC's own records, not the Bank.
