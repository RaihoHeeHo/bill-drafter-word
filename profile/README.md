# AKN-NY: Akoma Ntoso profile for New York legislation (draft 0.3)

How New York bills, budget bills, resolutions, chapters and laws are written
in Akoma Ntoso. The full specification is the "AKN-NY: Akoma Ntoso Profile for
New York Legislation" document; this folder holds the machine-readable parts.

```
profile/
  validate.py                 run all three checks on any files
  schema/akn/                 official Akoma Ntoso 3.0 schema (OASIS, CC BY 2.0)
  schema/lbdc-akn.xsd         LBDC metadata extension (lbdc:documentInfo)
  rules/ny-akn-profile.sch    New York profile rules (ISO Schematron)
  examples/                   one fictional, valid document per type
  tests/test_profile.py       examples are valid; every rule catches a planted mistake
```

## Run

```
pip install lxml
python3 profile/validate.py profile/examples/*.xml
python3 profile/tests/test_profile.py
```

A document conforms when it passes:

1. the official Akoma Ntoso 3.0 schema,
2. the LBDC extension schema, applied to `lbdc:documentInfo`,
3. the profile rules: addresses, identifiers, front matter, section sequence,
   effective dates, Parts and Subparts, amendment markup and legislative
   history, repeals, appropriation schedules and arithmetic, resolutions,
   detail sheets, chapters, line vetoes.

Version 0.2 folds in the LBDC Bill Drafting Manual. Rules that enforce a
house rule or a "must" in the manual are errors; the manual's drafting
advice is reported as warnings.

## Examples (fictional, except the excerpt)

| File | Document |
| --- | --- |
| bill-s1234a.xml | bill, amended print; Tax Law and Education Law amendments |
| draft-lbd01234.xml | the same bill as a draft, before introduction: addressed by its LBD number |
| budget-artvii-s3005b.xml | Article VII uni-bill: Parts, omitted Part, Subparts, chapter amendment, repeal |
| chapter-amendment-a7001.xml | "as proposed in" chapter amendment; short title; history; repeal |
| detail-sheet-s1234.xml | detail sheet amending S.1234 into S.1234-A |
| federal-ratification-a8100.xml | concurrent resolution ratifying a federal amendment |
| approp-s3000d.xml | appropriation uni-bill: schedule, totals, legislative addition, reappropriations |
| approp-s3000d-excerpt.xml | real: pages 1-8 of S.3000-D, converted from the print by `tools/approp2akn.py` |
| concurrent-resolution-s4410.xml | state constitutional amendment, first passage |
| legislative-resolution-j123.xml | Senate legislative resolution |
| chapter-2025-245.xml | enacted chapter with its fiscal note attached |
| consolidated-tax-606-excerpt.xml | consolidated law excerpt, as exported from the Bank |
| line-veto-memo-2025-1.xml | line veto citing an appropriation item by eId |

## Status

Draft for discussion with LBDC and Propylon. The demo converter
(`docx2akn.py`) and template (`bill.typ`) don't yet produce profile-conformant
XML; the specification's Validation section lists the gaps.

The schema in `schema/akn/` is the Akoma Ntoso 3.0 release of 30 March 2017
from the OASIS LegalDocML repository (github.com/oasis-open/legaldocml-akomantoso),
licensed CC BY 2.0 (see LICENSE-OASIS.txt).

## Version 0.3: first pass against real prints

Version 0.3 changes rules that real 2025 prints broke: omitted Parts keep
their heading in the body (`part class="omitted"`), resolutions in the
resolution series are headed "Senate Resolution No. N" with no caption,
budget prints carry no session line, reappropriation source lines may recite
amendment history, and schedules may carry offset and net-total lines
(`hcontainer name="adjustment"`). See `tests/real-patterns/README.md`.
Uni-bills changed too: each house's bill is its own Work, and `lbdc:uniBill`
marks a print made jointly for both houses. A later print can be made by one
house alone (S.3005 was joint; S.3005-B is Senate-only).

Four real prints are marked up in full under `real/`, with tools to extract a
print's text with its underscoring (`tools/pdfmarked.py`), to check XML against
the print word for word (`tools/compare_text.py`), to compare two prints
(`tools/compare_prints.py`) and to convert a bill that enacts new free-standing
law (`tools/newact2akn.py`).

Tables in statute text: a named table is `hcontainer name="table"`, with
`tableGroup` and `tableNote` parts that bills can cite and amend; rows are a
standard `table`. See `examples/consolidated-isc-4103-excerpt.xml` and the real
bill `real/S10226.xml`.

Decisions recorded 2026-11-14: column positions are layout, not part of the bill,
so tables store cells only; amounts are stored without padding (a warning flags
"$ 50,000"); two provisions with one number follow the Bank: the first is `para_34`,
later ones `para_34*2`, `para_34*3`, and the marker is never printed.

Typed line breaks inside table cells are kept as `<eol/>` markers (layout only,
allowed nowhere else), so tables print line for line like the original.

## Drafts (added in 0.3)

A bill before it is introduced has an LBD number but no bill number. The draft
form addresses it by the LBD route number, and each LBD version is an
Expression:

| | Draft | Printed bill |
| --- | --- | --- |
| Work | `/akn/us-ny/bill/2025/lbd01234` | `/akn/us-ny/bill/2025/s1234` |
| Expression | `eng@01`, `eng@02` (LBD version, in `FRBRversionNumber`) | `eng@`, `eng@a` (print letter) |
| `lbdc:printNumber`, `FRBRnumber` | none | `S1234A`, `S1234` |
| `docNumber` | empty | `1234--A` |
| `docDate` | none (no introduction yet) | date of introduction |
| Sponsor | expected (warning if neither a sponsor nor `lbdc:requestedBy`) | required |

The route and version in the addresses must match `lbdc:lbdNumber`. At
introduction the printed bill becomes a new Work with the same LBD number. The
clean-copy template leaves the number and date lines blank on a draft, so the
rest of the cover sits where it will on the printed bill.

## Appropriation bills (added in 0.3)

An agency's reappropriations are its own schedule, right after its
appropriations and still in section 1, as in S.3000-D:
`hcontainer name="agency" class="reappropriations"`. An appropriation bill has
no effective-date section. `examples/approp-s3000d.xml` follows this.

Also in 0.3, from converting the whole of S.3000-D:

* the program code a purpose ends with is marked (`inline name="programCode"`);
  an item that is a paragraph of its own ends in a program code, not an object
  code;
* an offset ("Less the amount appropriated to ...") is `hcontainer
  name="adjustment"` with `quantity class="offset"`; a subtotal, program total or
  agency summary may be the items or the items less the offsets above it;
* a project schedule under an item is a `table class="projectSchedule"` in the
  item: its projects are allocations, never added into totals;
* a heading inside an account ("STUDENT GRANTS AND LOANS") heads an
  `objectGroup`; a centred heading over programs is a program with
  `class="fundGroup"`;
* an "All Funds" account heading has no account number;
* the table of contents is `conclusions/toc`: one `tocItem` per entry, its index
  name ("AGING, OFFICE FOR THE"), its level, and `href` to the agency schedule;
  the template works out the pages;
* a warning when a reappropriation is more than the original appropriation and
  the source line names no supplement by transfer.

From converting S.3003-D (Aid to Localities) and S.3004-D (Capital Projects):

* a sub-schedule ("pursuant to the following sub-schedule") is a
  `table class="projectSchedule"` titled "sub-schedule"; a schedule's offsets
  ("Less an amount to be allocated by the board of trustees ... (52,000)") are
  `quantity class="offset"` and come off its total;
* a capital project schedule is `class="projectSchedule wide"` when it is 58
  columns; its unit is the caption ("(thousands of dollars)"); its stacked column
  heads are one `th` per column with one `p` per printed line; a campus or college
  over its projects is a `tr class="groupRow"`, the projects under it
  `summaryRow level1` (`noHang` where their lines don't hang); words printed
  after an amount are a second `p class="afterAmount"`; a schedule laid out as a
  table of its own is kept line for line (`preformatted`);
* struck schedule rows put one pair of brackets over the run (`del` with
  `spanStart`, `spanMiddle`, `spanEnd`), and an amended total is
  `<del>old</del><quantity>new</quantity>`;
* a schedule's total, in thousands where its caption says so, must be the amount
  of the item it allocates (new rule);
* an account's purpose under its heading is `inline name="purposeName"`; a
  letter after the account number ("31900(M)") stays outside `accountCode`;
* an agency summary that also covers the agencies after it in its department
  lists them all in its `refersTo` (CUNY Senior Colleges and Community Colleges);
  the rules add up every agency it covers;
* the department's note in the running head ("(APPROPRIATED TO THE CITY
  UNIVERSITY CONSTRUCTION FUND)") is `lbdc:headNote` on the agency;
* a note over all of an agency's reappropriations is an `hcontainer
  name="text"` before its programs;
* a reappropriation with no original amount printed (old bond acts) is
  `class="noOriginal"`: allowed, with a warning;
* agency summaries with no "SCHEDULE" line under them (Capital Projects) are
  `class="noScheduleLine"`.

Tools:

* `tools/approp_irregularities.py` lists the layout and wording irregularities
  of a budget print (missing line numbers, variant "(re. $...)" forms, misspelled
  fund types, ...), with page and line.
* `tools/budget_report/` builds the print-error report of a budget bill from its
  XML (`findings.py`, then `build.py` and `report2.typ`).
* `tools/approp2akn.py` converts an appropriation print to profile XML
  (`tools/aprint.py` reads the print line by line with its positions; it
  measures each page's line spacing, character width and margin, so an original
  print set tighter, such as S.3002, is read correctly).
* `tools/fund2akn.py` converts the bills set out under centred headings in the
  flow of the text (Legislature and Judiciary, Debt Service): funds,
  departments and agencies in the order printed, items with their own schedules,
  object groups, totals and reappropriations.
* `tools/prior_check.py` checks a bill's reappropriations against last year's
  chapter (its appropriations and its reappropriations), item by item.
* `tools/budget_items.py` lists every item with its key (agency, account,
  program, object) and checks a bill's reappropriations against the chapter they
  cite (`--prior`).
* `tools/compare_pdf_sequence.py` compares two prints line by line in reading
  order and page by page once aligned, so one page break doesn't hide the rest.
* `tools/learn_approp_hyphens.py` learns where budget prints divide words, for
  the template (`hyphenation-approp.json`; `--out hyphenation-flow.json` for the
  Legislature and Judiciary and Debt Service prints).

Validation is fast on a whole budget bill now (S.3000-D, 880 pages: about 6
seconds, from 11 minutes): the rules look identifiers, references and textual
modifications up by key instead of searching the whole document each time.
An account with no heading (the print has none) no longer needs an account
number.
