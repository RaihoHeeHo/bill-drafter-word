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
| `renumber` | Renumbers subdivisions / Renumbers the section | — | `unit` = the units renumbered (`6,7`; none for a section). The new numbers, and any unit added, are read from the amending clause itself ("… are renumbered subdivisions 5 and 6 and a new subdivision 7 is added to read as follows:"), so editing the clause changes them. Each unit cited is its own `ref`; one `textualMod type="renumbering"` per unit (`destination` the old address, `new` the new one), and `type="insertion"` with quoted text for a unit added |
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

Plain underlining and strike-through are read as new and old matter too. **Mark changes** rewrites each amended text with the two styles by comparing it word by word with this computer's Bank, so the unmarked and bracketed words are always exactly the law.

**Word's own tracked changes are suggestions, not new matter** (since 2026-11-15, with the profile's working copies). A tracked insertion or deletion (`w:ins`, `w:del`, `w:moveTo`, `w:moveFrom`) is someone's suggestion, with their name (`w:author`) and the time (`w:date`), waiting to be accepted or rejected in Word's Review tab. Until it is, the draft reads without it: a suggested insertion is not in the text, a suggested deletion is still there. Mark changes leaves a section with suggestions alone, and no clean copy is made while any wait. Once a suggestion is accepted, Mark changes works out the new and old matter against the Bank as usual. Comments come from the package's `comments.xml` (with replies and "resolved" from `commentsExtended.xml`), anchored by `w:commentRangeStart` / `w:commentRangeEnd`.

In the XML (a **working copy**, profile 0.4 draft) a suggestion is `<span lbdc:suggest="insert|delete" lbdc:by="#staff-…" lbdc:at="…">`, inside the `ins` or `del` it sits in, and the text a comment is on is `<span lbdc:comment="c1">`, with the thread in `lbdc:working`. Each person is a `TLCPerson` with their review role (`lbdc:role`).

**The review** (the Review tab; `src/lib/review.js`) is kept in the document in a custom XML part of its own, `<review xmlns="urn:x-lbdc:bill-drafter:review">`, holding JSON: `{roles: {name: role}, steps: [{at, by, role, event, section?, hash?, suggestionBy?}]}`. Who is at the computer (name and role) is kept in the browser's storage on that computer, not in the document. In the XML the steps are `<workflow source="#lbdc-review">`, one `step` per event (`by` the person, `as` their role, `refersTo` the event), and `lbdc:working/@status` is the stage the last hand-off put the draft in. A sign-off's `lbdc:hash` is the SHA-256 of its section's exclusive canonical XML with comment anchors left out, worked out in the pane exactly as the profile's `validate.py --section-hash` does (the unit tests check the two agree), so both can see a sign-off go stale.

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

eIds follow the profile: the `mod`'s eId, then `__qstr`, then each level (`sec_3__mod_1__qstr__sec_296__subdvs_1__para_a`). The last part is the printed number without punctuation, with its case kept (`subpara_A`). A renumbered unit (`[3.] 4.`) takes its new number, and the move is recorded as `textualMod type="renumbering"` from where the unit stood before the bill (its old number, nested by the old numbering, as the profile's converter does) to where it stands now; a unit struck out whole ends in `-old` (`para_4-old`); a second unit with the same number gets the Bank's marker (`para_34*2`), which is never printed.

## Tables

A table in the law's text is a real **Word table** inside the `akn:quoted` control, so it can be changed with Word's own table tools or with the pane's table editor.

| In Word | Means | Akoma Ntoso |
|---|---|---|
| A Word table | a table in the unit's text | `table eId="…__table_1"` in the unit's `content` (or `intro`) |
| A header row (Word's *Repeat as header row*) | the column headings | `th` cells |
| A row of one cell spanning the table, "Group A:" | a group of rows | `hcontainer name="tableGroup"` |
| A row of one cell spanning the table, "{3} …" | a note under the table | `hcontainer name="tableNote"`, `num` {3} |
| A paragraph "TABLE ONE." right above the table (style Bill Table Caption) | the table's name | `hcontainer name="table"` with that `heading` |
| A new paragraph inside a cell | a line break typed in the cell (layout only) | `<eol/>` |
| Bill Insert / Bill Delete inside cells | new and old matter, word by word | `ins` / `del`; a row taken out is one pair of brackets split with `spanStart` … `spanEnd` |

A table with a caption or groups is written as the profile's *named table*. That means `hcontainer name="table"` with the column headings in its `intro`, then its groups and notes (see the profile's `consolidated-isc-4103-excerpt.xml`). Any other table is a plain `table`.

**From the Bank.** The Bank keeps tables as fixed-width text. A block of two or more lines with gaps of three or more spaces is read as a table. Its columns are the stretches of characters some row uses. A line with words only in the first column is part of a wrapped cell; in print a row's amounts sit on its last line, so those words join the row below. The lines above the first row with an amount are the column headings. "Group A:" lines and "{3}" notes are their own rows, and "TABLE ONE." is the caption. **Insert section** puts such a table in the document as a Word table.

**Marking.** Mark changes compares each table with the Bank's: rows are lined up by their words, in order. A changed cell is marked word by word (a sum stays one word: `[$100,000] $400,000`). A new row is underlined, and a row taken out stays in brackets. A table that is new to the law is underlined whole.

## Signed packages

The review's custom XML part (`urn:x-lbdc:bill-drafter:review`) also holds `activity` (the signed, hash-chained log: `at`, `by`, `role`, `e`, `d`, `k`, `seq`, `prev`, `h`, `sig`), `attachments` (each attachment's signed record; the file itself is in its own part, `<file xmlns="urn:x-lbdc:bill-drafter:file" sha256="…">` base64), and `cards`: each person's public card (name, role, Ed25519 and X25519 public keys, key id, self-signature), added when they say who they are. Private keys stay in the browser's storage on each computer (`bill-drafter-key:<name>|<role>`), as do the keys each person trusts (`bill-drafter-trusted:<name>`). Each package or clean copy saved keeps its XML as `<version xmlns="urn:x-lbdc:bill-drafter:version" at by label fingerprint encoding="gzip-base64">`. A `.nysakn` package holds the XML the pane writes, signed; a signed clean copy PDF embeds `bill.nysakn` and `bill.akn.xml`. The format is in `profile/PACKAGE.md`.

## Document properties

The Clean copy tab saves the bill information as custom document properties as it is typed, and both converters read them:

| Property | Akoma Ntoso |
|---|---|
| `LBD` (e.g. `12345-01-6`) | `lbdc:lbdNumber` (`LBD12345-01-6`) |
| `House` (`senate` / `assembly`) | `lbdc:house`, `docStage` ("IN SENATE"), FRBR author |
| `BillNumber` (`1234`, or `1234-A` for the A print) | `docNumber` (`1234--A`), `lbdc:printNumber` (`S1234A`), FRBR number; Work `/akn/us-ny/bill/2025/s1234`, Expression `…/eng@` (original print) or `…/eng@a` |
| `Sponsor` (`SMITH`, or `SMITH, JONES`), `Committee` | the "Introduced by" paragraph (`docProponent`, `docCommittee`), with a `TLCPerson` and `TLCOrganization` for each |
| `BillDate`, `SessionYear` | `docDate` (the date of introduction, on every print), `session` and `lbdc:session` ("2025-2026"); the Work IRI's year is the first year of the session |

The front matter is written as the profile's classed paragraphs (`authority`, `number`, `session`, `stage`, `date`, `introduction`) and the `longTitle`; the clean-copy template prints the cover from them.

**Before a bill number is given** the XML is the profile's draft form: the bill is addressed by its LBD route number (`/akn/us-ny/bill/2025/lbd12345`), each LBD version is an Expression (`eng@01`, `eng@02` …), and there is no print number, no printed bill number and no introduction date. The clean copy leaves those lines blank, so the rest of the cover sits where it will on the printed bill. Once the house gives the number, fill in **Bill number** and the date: the printed bill is a new Work (`/akn/us-ny/bill/2025/s1234`) with the same LBD number.

## What the converter adds

* `meta/analysis/activeModifications`: one `textualMod` per amending section, `type` = `substitution` (amend), `insertion` (add) or `repeal`, with `source` = the `mod` and `destination` = the provision. Laws are addressed by their Bank law ID alone, never with a year: `/akn/us-ny/act/consolidated/gcn/~sec_12`, `/akn/us-ny/act/unconsolidated/fct/~sec_1012`, `/akn/us-ny/act/constitution/cns`. An unconsolidated law the Bank names by chapter ("Emergency Tenant Protection Act 576/74") is addressed as that chapter, `/akn/us-ny/act/1974/576`. The table of laws is `src/lib/laws.js`, from the profile's `tools/laws.json`.
* `meta/references`: TLC entries for the Commission, the house, the sponsors, the committee and each concept used in `refersTo`.
* `meta/proprietary/lbdc:documentInfo`: profile name and version, house, session, print number, LBD number.

The output validates against the OASIS Akoma Ntoso 3.0 schema, LBDC's extension schema and the profile's Schematron rules (`python3 profile/validate.py bill.akn.xml`); `examples/Example bill.akn.xml` is a sample and `examples/Example bill - clean copy.pdf` is its clean copy.

## Converting a saved .docx

The task pane converts the open document (**Clean copy > For other systems**; Mark changes runs first, so the XML is always marked against the Bank). For a saved file:

```
npm install
node tools/docx2akn.cjs "My bill.docx" "My bill.akn.xml"
```

Both use the same code (`src/lib/ooxml.js` reads the .docx, `src/lib/akn.js` writes Akoma Ntoso).

## Budget bills

In budget mode the document doesn't hold the bill's meaning: the bill's **Akoma Ntoso XML** does, and Word shows it laid out as the print reads.

**The XML in the document.** Two custom XML parts, namespace `urn:x-lbdc:bill-drafter`:

| Part | Holds |
|---|---|
| `<budget role="current" …>` | The bill as changed: the record the checks, the clean copy and the XML export use |
| `<budget role="opened" …>` | The bill as it was opened: "changes since it was opened", and the check that every reappropriation still reads as the law as opened |

Each holds the whole AKN-NY XML, gzip-compressed and base64-encoded where the browser can (`encoding="gzip-base64"`), otherwise as CDATA. A demo bill also records `sample="S3003D"`, so its companions (last year's chapter, the vetoes) are found again when the document is reopened.

**Content controls.** Tag `akn:b;e=<short eId>;k=<kind>`. The short eId drops `sec_` and abbreviates each level (`agency` a, `program` p, `account` c, `reappropriationSource` s, `reappropriation` r, `appropriation` i, `purpose` u, `subtotal` t, `agencySummary` m, `table` b), joined with dots: `1.a48.p2.c1.s19.r1` is `sec_1__agency_48__program_2__account_1__reappropriationSource_19__reappropriation_1`.

| `k=` | Holds |
|---|---|
| `front` | The title block and section 1's opening paragraphs |
| `schedule` | A whole agency schedule, as laid out (a large bill shows only the schedules opened) |
| `agency` | The agency's heading and subheading |
| `summary` | The agency summary: its words and its table |
| `program` | A program's heading and total |
| `purpose` | A purpose's words |
| `appropriation`, `reappropriation` | An item: its words and amounts, and any project schedule under it |
| `subtotal` | A program account subtotal |

Account headings and reappropriation source lines ("By chapter 53, section 1, of the laws of 2024:") are plain paragraphs: they aren't edited here.

**An item edited in Word** is read back from its first paragraph (Bill Insert, Bill Delete and typed brackets, as for bills) and written into the XML. An item with Word's tracked changes in it is left alone until they are accepted or rejected, and the bill's XML and clean copy are not made while any wait:

| Item | In the XML after Mark changes |
|---|---|
| Reappropriation, words or original amount changed | The change marked against the law as it stands: `<del>(34218)</del> <ins>(34219)</ins> ... <del>15,000,000</del> <ins><quantity class="originalAmount" normalized="14000000">14,000,000</quantity></ins>`. Struck matter is plain words in `del`, as the converter reads the prints; the current amount is the `quantity`. The amount reappropriated is reprinted: `(re. $<quantity class="reappropriatedAmount" …>12,500,000</quantity>)`. |
| Appropriation | The new words and amount, unmarked, with `programCode` / `objectCode` and `quantity class="amount"` tagged again |
| Deleted in an open schedule | Taken out |
| Added in the pane | A new `hcontainer name="appropriation"` after the item at the cursor, numbered after the account's last |

Totals updated in the pane set the `quantity` of a `programTotal`, a `subtotal`, or an agency summary's `summaryAppropriations` / `summaryReappropriations`, unmarked.

## Known limits of the mapping

* A law missing from `src/lib/laws.js` is addressed from the Bank's own law type; check those `ref`s.
* Table detection in the Bank's text (below) is built from the profile's examples and the real prints, not yet from a run over every Bank table; where it misreads a table, fix it in the pane's table editor or in Word.
* A row taken out of a table is printed in one pair of brackets, from its first cell to its last. Confirm that this is how LBDC brackets a struck row.
* The amendment history is whatever the drafter types; in deployment it comes from LBDC's own records, not the Bank.
