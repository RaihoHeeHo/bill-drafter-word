# Bill drafting pipeline: Word → Akoma Ntoso → clean copy

*13 November 2026, updated 14 November 2026 for the AKN-NY profile 0.3 · Bill Drafter (demo) for Word, repo `RaihoHeeHo/bill-drafter-word`*

## In one picture

```
 Bank on this computer          Word + the Bill Drafter pane                      In the same pane
 (NY-Law-Exporter JSON)   ─────────────────────────────────────────────▶  ───────────────────────────
        │                  1. Draft: amend / add / repeal from the Bank,     3. Export
        │ loaded once       standard sections, Mark changes                    .docx ──▶ Akoma Ntoso XML
        ▼                  2. Checks against the Manual's forms                         │
   IndexedDB  ◀── compared with ──  the bill (.docx with tagged structure)              ▼
                                                                                Typst + bill.typ
                                                                                        │
                                                                                        ▼
                                                                                 clean-copy PDF
```

Three things leave the pane: the Word document itself (an ordinary .docx), the Akoma Ntoso XML, and the clean-copy PDF. Everything runs on the drafter's computer. The only thing fetched from the internet is the add-in's own code, from GitHub Pages.

---

# Part 1: technical

## 1. Where the code runs

| Piece | What it is | Where it runs |
|---|---|---|
| `manifest.xml` | Office add-in manifest (XML, task pane, WordApi 1.3). It tells Word where the pane lives and adds a **Bill Drafter** button on the Home tab. | Read by Word when the add-in is added |
| Task pane (`taskpane.html`, `src/*.js`) | HTML and JavaScript using Office.js | Word's built-in browser (WebView2 on Windows), loaded from `https://raihoheeho.github.io/bill-drafter-word/` |
| Shared libraries (`src/lib/*.js`) | Drafting rules, Bank reader, docx reader and writer, checks, the table of laws, the Akoma Ntoso writer (AKN-NY profile 0.3). They make no Office calls. | In the pane, and in Node for the command-line converter and tests |
| Typst compiler (`vendor/typst`, 30 MB WebAssembly) | The Typst typesetter built for browsers (typst.ts 0.8.0-rc4, which is Typst 0.15.1, the same version as LBDC's desktop demo; Apache-2.0) | In the pane. It loads the first time **Make clean copy** is used, then stays in the browser cache. |
| `clean-copy/bill.typ`, `hyphenation.json` + FreeMono | LBDC's clean-copy template from the desktop demo (profile 0.3, line for line with the public PDFs), unchanged | Compiled in the pane, or by the Typst command line |

There is no server-side code. GitHub Pages only serves static files. There is no .exe and no installer.

**Install on Windows:** put `manifest.xml` in a folder on a network share. In Word, go to Trust Center > Trusted Add-in Catalogs, add the share, and add the add-in from the Shared Folder tab. In Word on the web, use **Upload My Add-in** instead. IT can also push the same manifest to everyone from the Microsoft 365 admin center.

## 2. The Bank

* **Source.** These are the JSON files the desktop app downloads: one per law, Open Legislation "law-tree" format. The drafter picks the folder once on the Bank tab.
* **Storage.** `bank.js` flattens each law into its sections (location id, heading, text, article path) and stores them in the browser's IndexedDB under the add-in's web address. All 124 laws (38,411 sections) load in about 3 seconds. Nothing is uploaded.
* **Law text.** The Bank text comes in 70-column lines. A line that starts with spaces begins a new paragraph, and the other lines are joined to the one before. Subdivisions are found by "1.", "2."… at the start of a paragraph, including "1." in the middle of a section's first line ("§ 2-d. … information. 1. Definitions.").
* **Law names.** These come from the law's catalog entry: "General Construction" becomes *the general construction law*, "Civil Practice Law & Rules" becomes *the civil practice law and rules*, court acts keep "act", and unconsolidated laws become *chapter 576 of the laws of 1974, constituting the …*.
* **Missing piece.** The Bank files don't include amendment history, so the "as amended by …" part of a clause is typed by the drafter. The checks warn when it's missing.

## 3. The Word document's structure

Meaning lives in **tagged content controls** and two **character styles**. Nothing depends on layout or paragraph styles, which is why the formatting can be anything at all.

| Content control tag | Holds |
|---|---|
| `akn:longTitle`, with `akn:subject` inside it | "AN ACT to amend …, in relation to *subject*" |
| `akn:enactingFormula` | "The People of the State of New York …" |
| `akn:section;act=amend\|add\|repeal\|new\|shortTitle\|findings\|severability\|effective;law=GCN;loc=12;unit=3` | One bill section |
| `akn:num`, `akn:heading`, `akn:mod` (inline, first line of a section) | "§ 2.", "Short title.", and the amending clause |
| `akn:quoted;law=…;loc=…;unit=…` (block, inside a section) | The text of the law as the bill would leave it |

| Character style | Meaning |
|---|---|
| **Bill Insert** (underlined) | New matter |
| **Bill Delete** (text in typed [brackets]) | Old matter to be omitted |

Word's own Track Changes marks and plain underlining are read the same way. Bill information (LBD number, house, bill number, sponsor, committee, date, session year) is stored as **custom document properties**. The full mapping is in `FORMAT.md`.

## 4. Writing the bill (task pane → Word)

* **Start the bill** inserts the title, the enacting clause, a blank section 1 and an effective-date section.
* **Insert section** (Amend a law) builds the section's OOXML: the number control, the amending clause control, and the quoted-text control holding the Bank text as plain runs. Word inserts it with `insertOoxml` in the right position:
  * a short title is always first
  * findings come second
  * severability goes just before the effective date
  * the effective date is always last
  * everything else goes before severability

  Then **Renumber** rewrites each `akn:num` ("Section 1.", "§ 2." …), and **Update title** rebuilds the title from what the sections do.
* **Mark changes** takes each `akn:quoted` and reads the drafter's current text from it: unmarked plus inserted words, ignoring words already bracketed. It looks up the same provision in the Bank and runs a word diff:
  * The diff works word by word, with punctuation as separate tokens. It finds the fewest changes.
  * Short kept runs between bigger changes are folded into one change, using the idea behind diff-match-patch's semantic cleanup.
  * Deletions come before additions.

  The text is then rewritten as runs styled Bill Delete "[…]" and Bill Insert. Track Changes is paused while this happens, so the rewrite isn't recorded as a revision. The two readings always round-trip: the unmarked plus bracketed words are exactly the law, and the unmarked plus underlined words are exactly the drafter's text.

## 5. Checks

`checks.js` reads the whole document back into a model and checks it:

* **Structure:** title begins "AN ACT", the subject is filled in, and the title matches what the sections do. The enacting clause is word for word. Sections are numbered "Section 1.", "§ 2." …. The short title is first, severability is next to last, and the effective date is last and begins "This act shall take effect". No ____ blanks are left.
* **Amendments, against the Bank:**
  * the provision exists (and isn't repealed)
  * a new section isn't already in the law (the next free number is suggested)
  * the clause has the right ending ("is amended to read as follows:", "is REPEALED.", "is amended by adding …")
  * the history is cited
  * the law's name is lower case
  * the unmarked and bracketed words equal the Bank text (this catches unmarked edits)
  * the section actually changes something
  * an added provision is fully underlined, with nothing bracketed
  * no provision is amended twice
  * sections amending one law follow that law's section order
* **Style in new matter:** gendered words, "said" used as an adjective, "must", session-law citation form, sums of money without words, "§" in text, two spaces in a row, stray brackets.

Each finding has a **Go to** button, and where possible a one-click fix (Renumber, Update title, Mark changes, Add effective date).

## 6. Word → Akoma Ntoso

`ooxml.js` reads WordprocessingML into a model, either from `body.getOoxml()` in the pane or from `word/document.xml` in a saved .docx. `akn.js` writes Akoma Ntoso 3.0 from that model in the shape of LBDC's **AKN-NY profile, version 0.3**. The pane's **Clean copy** tab and the command line (`node tools/docx2akn.cjs bill.docx`) run the same code and give identical output.

| Word | Akoma Ntoso (AKN-NY 0.3) |
|---|---|
| Bill information | Work `/akn/us-ny/bill/2025/s1234`, Expression `eng@` (or `eng@a` for the A print). `preface` as classed paragraphs: `authority` STATE OF NEW YORK, `number` ("1234", or "1234--A"), `session`, `stage` ("IN SENATE"), `date` (introduction), `introduction` (`docProponent`, `docCommittee`). `proprietary/lbdc:documentInfo`: profile version, house, session, print number, LBD number. |
| `akn:longTitle` | `preface/longTitle`, with the subject as `span refersTo="#subject"` |
| `akn:enactingFormula` | `preamble/formula[@name="enactingFormula"]` |
| `akn:section` | `body/section eId="sec_N"`; standard sections carry `refersTo` (`#shortTitle`, `#legislativeFindings`, `#severability`, `#effectiveDate`), and the effective date a `class` saying what kind (`immediate`, `daysAfter`, `sunset` …) |
| Amending clause | The whole lead-in inside `p/mod`: the citation as a `ref` to the provision, addressed by Bank law ID alone (`/akn/us-ny/act/consolidated/exc/~sec_296__subdvs_1`); each act in the history as `ref class="amendmentHistory amended"` pointing to the chapter (`/akn/us-ny/act/2023/55`); the rest of the clause; then the `quotedStructure`. A repeal is the lead-in alone, ending "is REPEALED." |
| `akn:quoted` | `mod/quotedStructure eId="…__qstr"`, nested by numbering and named as New York names its units: section › subdivision › paragraph › subparagraph › clause, or section › subsection › paragraph … for the Tax and Insurance Laws. eIds end in the printed number; a renumbered unit takes its new number, a unit struck out whole ends in `-old`. Text before sub-units goes in `intro`. |
| Bill Insert / Bill Delete | `ins` / `del` (brackets dropped; the template adds them back). One pair of brackets running from a unit's number into its text, or into the next unit, becomes `del` pieces marked `spanStart` / `spanMiddle` / `spanEnd`. |
| A Word table in the law's text | `table` in the unit's text; a table with a caption or groups is the profile's named table (`hcontainer name="table"`, `tableGroup`, `tableNote`), with headings as `th` and line breaks in cells as `eol`. See FORMAT.md, *Tables*. |
| Each amending section | `meta/analysis/activeModifications/textualMod`: substitution, insertion or repeal, from the `mod` to the provision |

The table of laws (`src/lib/laws.js`, from the profile's `laws.json`) says whether a law is consolidated or not and whether its sections divide into subsections. The citations in the amending clause follow it too ("Subsection (c) of section 606 of the tax law").

The output passes all three layers of the profile's validator: the OASIS Akoma Ntoso 3.0 schema, LBDC's extension schema, and the profile's Schematron rules. The validator ships in `profile/`, and `npm test` runs it on the add-in's output.

**Before a bill has a number.** At the drafter's desk a bill usually has only an LBD number. The add-in then writes the profile's draft form: the bill is addressed by its LBD route number (`/akn/us-ny/bill/2025/lbd12345`), the LBD version is the Expression (`eng@01`), and the print number, printed bill number and introduction date are left out. The clean copy leaves those lines blank, with everything else in place.

## 7. Akoma Ntoso → clean copy

**Make clean copy (PDF)** does the following:

1. Converts the document to Akoma Ntoso, as in section 6.
2. Loads the Typst compiler (WebAssembly), the FreeMono fonts and `hyphenation.json` from the add-in's site.
3. Places the XML in Typst's in-memory file system.
4. Compiles `clean-copy/bill.typ` with `xml=` pointing at it.

`bill.typ` is the desktop demo's profile-0.3 template, unchanged: it prints line for line as the public PDFs do. That means bold front matter, the enacting clause underscored (its printed form, not new matter), 72-character lines, 56 lines a page, new matter underscored, old matter in brackets, the "S./A. number" running header, the EXPLANATION and LBD number on page 1, and words divided only where real prints divide them. The pane's Typst is 0.15.1, the same as the desktop app's, so the two produce the same PDF: the example bill matches word for word, at the same positions. The example takes about 0.6 seconds once the compiler is loaded.

## 8. What was tested, and what wasn't

* **Unit tests (Node):**
  * law names
  * amending clauses
  * section placement
  * titles
  * Mark changes round trips
  * subdivision splitting
  * the docx reader and writer
  * Akoma Ntoso nesting
* **Whole flow in Chromium,** against a stand-in for Word's API, using a small test Bank (`tests/bank-fixture`, built from the example's law text):
  * load the Bank
  * new bill
  * amend a section and a subdivision
  * add a section
  * repeal
  * edit the text
  * Mark changes
  * standard sections
  * checks
  * Akoma Ntoso
  * clean-copy PDF in the pane
* **Against the profile:** the add-in's output (the example bill, a Tax Law amendment with renumbered, struck and inserted units, and an A print) passes the AKN-NY 0.3 validator, as part of `npm test`, both as a printed bill and as a draft.
* **External checks:**
  * the pane's clean copy and the desktop Typst's are identical for the example bill
  * the example .docx opens and renders in LibreOffice
  * the demo's round-trip check agrees with the output
* **Not yet tested: real Word.** The stand-in behaves the way Word's API is documented to behave, but Word's own quirks (for example, how `insertOoxml` treats content controls next to each other) will only show up in the first real sideload.

---

# Part 2: what the drafter sees

The pane has four tabs, in the order of the work: **Draft**, **Check**, **Clean copy**, **Bank**. Until the Bank is loaded and a bill is started, the Draft tab opens with a five-step *Getting started* list. Each step is crossed out as it is done.

**Once per computer.** On the **Bank** tab, click **Choose a folder…** and pick the law files folder. The pane shows "124 laws, 38,411 sections, laws as of …". Do this again whenever the Bank is updated. While the Bank is empty, the Draft tab says so and links to the Bank tab.

**Starting a bill.** Type what the bill is "in relation to" and click **Start the bill** (Enter works too). The document gets the title, the enacting clause, a blank section 1 and the effective date. The **This bill** card then shows the subject line and an outline of the sections; clicking a section jumps to it. Changing the subject line rebuilds the title.

**Amending a law.** Under **Add a section > Amend a law** there is one box for the law and the section:
1. Type the law and the section together: `GCN 12`, `executive 296`, `general construction affidavit`, or `tax 606(c)` for a unit of a section. The law can be its Bank ID or words of its name. Matching sections are listed; the arrow keys move through them, and Enter picks one. A number not yet in the law is offered as a new section.
2. The pick is shown with its text one click away (**Show the law's text**). Choose what the bill does: amend the whole section, amend one subdivision (subsection for the Tax and Insurance Laws, with the unit already chosen when it was typed as `606(c)`), add a new section (the next free number is filled in), add a new subdivision, or repeal.
3. For an amendment or a repeal, **Last amended by** (optional) takes the history. Left blank, Check reminds you.
4. The button says exactly what will be inserted: "Insert: amend EXC § 296 subd. 1".

The new section appears in place, the sections after it renumber, and the title updates to name the law. Typing a new search puts the last pick away, so the form always acts on what is on screen.

**Editing.** The drafter edits the law's text in the document like any other text: typing, deleting, pasting, with Word's spelling check and Track Changes if wanted. Each part of the bill sits in a thin labeled box (Word's content-control outline, e.g. "§ 2 Amend GCN 12" and "Text of the law"). That outline is the only sign of the structure.

**Mark changes.** It sits in a bar at the bottom of the Draft tab, always in reach, next to **Check the bill**. One click and every amended text gets its marks: words taken out appear in [brackets] (shown in dark red on screen), and new words are underlined. Clicking it again after more edits re-marks from scratch, so the marks always match the Bank.

**Standard sections.** Under **Add a section > Standard section**, each standard section is listed with where it goes: **Short title** (type the name, then Add), **Legislative findings**, **Severability clause** and **Blank section**. Below them is the **Effective date**: pick when (immediately, the 30th, 60th or 90th … day, January 1 next, a date), open **Add-ons** for rules and regulations, sunsets, retroactivity, applicability and provisos, and the sentence is shown as it will read before **Use this effective date**. Each section lands in its proper place, and the numbers update by themselves.

**Tables.** A table in a section the bill amends comes in from the Bank as a real Word table: column headings as a header row, "Group A:" and "{3}" notes as rows across the table, "TABLE ONE." as its caption. The drafter can change it right in the document with Word's own table tools, or in the pane's **Tables** card. That card lists every table in the bill with an **Edit** button, and offers **New table** for any amended or added section.

The editor shows the table as the law will read:
- one box per cell, with Enter for a line break inside a cell;
- a kind for each row: Row, Headings, Group or Note;
- buttons to add a row above or below, delete a row, and add or delete a column;
- a caption box;
- **Paste rows from text…**, which takes rows copied from Excel or Word (tab-separated) or typed with two spaces between cells.

**Save to the bill** writes the table into the document and runs Mark changes: a changed amount comes out `[$100,000] $400,000`, a deleted row stays in brackets, and new rows are underlined. A new table can be placed at the end of the text or after any paragraph.

**History for a section already in the bill.** Use **Add history** on a Check finding, or the link under *Last amended by*. Either way the cursor goes to the section and a small card asks for the history, with **Put it in that section**.

**Check.** Opening the tab (or **Check the bill** in the bottom bar) runs the checks. A summary line comes first ("1 warning, 1 note", or "No problems found. The bill is ready for its clean copy."). Below it, errors (red), warnings (amber) and notes (blue) are listed in that order, in plain language, for example "The amending clause should cite the provision's last amendment" or "Gendered: 'he or she'; use 'they' where possible". Each has **Go to** and, where possible, a fix button. A red count on the tab shows how many errors remain.

**Clean copy.**
1. A line at the top says what will be printed: "Draft for the Senate, LBD 12345-01-6 (no bill number yet)" or "Senate bill S. 1234, introduced January 15, 2025". It also says what is missing (the LBD number, the sponsor).
2. **Make the clean copy (PDF)** produces the formatted bill: cover page, numbered lines, brackets and underscores. Use **Open** or **Save .pdf**. The first time, it takes a moment to load the typesetter; after that, about a second.
3. **Bill information** (LBD number, house, sponsor, committee) is saved in the document as it is typed; there is no Save button. The bill number and the date introduced sit under *When the bill is introduced*. Left blank, the bill is a draft and the clean copy leaves those lines empty.
4. **Akoma Ntoso XML**, folded away at the bottom, shows the XML the clean copy is printed from, with **Copy** and **Save .xml**.

**What the drafter never has to do:** type amending-clause wording, work out section numbers, rebuild the title, apply brackets or underlining by hand, retype anything for the XML or the clean copy, install software, or send the bill anywhere.

---

# Limits and next steps

* **First real-Word test.** This is the open item. Sideload it and try the flow above. Anything odd will most likely be in how Word inserts sections next to each other.
* **Amendment history** isn't in the Bank files. If the desktop app's history lists (`data/history`) were copied into the Bank folder, the "as amended by" text could be filled in automatically.
* **Nesting** follows numbering only, so schedules and appropriations come out as plain paragraphs, not the profile's appropriation structures. Tables are handled (section 6).
* **Table detection** in the Bank's text has been built from the profile's examples, not yet tried over every Bank table. The table editor fixes any table it misreads.
* **Laws not in the table** (`src/lib/laws.js`) are addressed from the Bank's law type. The checks flag unconsolidated laws for review.
* **Amendment history** is typed by the drafter. In deployment it comes from LBDC's own records, not the Bank.
