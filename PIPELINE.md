# Bill drafting pipeline: Word → Akoma Ntoso → clean copy

*13 November 2026, updated 15 November 2026: the drafter's pane, exports marked against the Bank, budget mode and whole budget bills · Bill Drafter (demo) for Word, repo `RaihoHeeHo/bill-drafter-word`*

This guide has two parts. **Part 1** is technical: how the add-in works, for whoever maintains it. **Part 2** is the plain-language guide: what a drafter sees and does, step by step.

## In one picture

```
 BILLS
 Bank on this computer          Word + the Bill Drafter pane                      In the same pane
 (NY-Law-Exporter JSON)   ─────────────────────────────────────────────▶  ───────────────────────────
        │                  1. Draft: amend / add / repeal from the Bank,     3. Clean copy and XML
        │ loaded once         standard sections, Mark changes                  (always marked against
        ▼                  2. Checks, shown on each section                     the Bank first)
   IndexedDB  ◀── compared with ──  the bill (.docx with tagged structure)  ──▶ Akoma Ntoso ──▶ PDF

 BUDGET BILLS
 The bill's Akoma Ntoso XML ──▶ kept in the document ──▶ Word shows the schedules being worked on
                                       │                        │ edits read back (Mark changes)
                                       ▼                        ▼
                         checks on the whole bill:      clean copy (printed in parts for a
                         amounts, last year's chapter,  whole bill) and the XML
                         changes in this print, vetoes
                         + the bill window: the whole bill to browse and search
```

What leaves the pane: the Word document itself (an ordinary .docx), the Akoma Ntoso XML, the clean-copy PDF, and for budget bills the line veto memoranda. Everything runs on the drafter's computer. The only thing fetched from the internet is the add-in's own code (and the demo bills), from GitHub Pages.

---

# Part 1: technical

## 1. Where the code runs

| Piece | What it is | Where it runs |
|---|---|---|
| `manifest.xml` | Office add-in manifest (XML, task pane, WordApi 1.3). It tells Word where the pane lives and adds a **Bill Drafter** button on the Home tab. | Read by Word when the add-in is added |
| Task pane (`taskpane.html`, `src/taskpane.js`, `src/budgetpane.js`) | HTML and JavaScript using Office.js. `taskpane.js` is bill mode, `budgetpane.js` budget mode. | Word's built-in browser (WebView2 on Windows, WebKit on the Mac), loaded from `https://raihoheeho.github.io/bill-drafter-word/` |
| Bill window (`bill-window.html`, `src/billwindow.js`) | The whole budget bill, to browse and search | An Office dialog opened by the pane |
| Shared libraries (`src/lib/*.js`) | Drafting rules, Bank reader, docx reader and writer, checks, the table of laws, the Akoma Ntoso writer (AKN-NY profile 0.3); for budget bills `budget.js` (the budget tools' checks) and `budgetword.js` (the bill in Word). They make no Office calls. | In the pane, and in Node for the command-line converter and the tests |
| Typst compiler (`vendor/typst`, 30 MB WebAssembly) | The Typst typesetter built for browsers (typst.ts 0.8.0-rc4, which is Typst 0.15.1, the same version as LBDC's desktop demo; Apache-2.0) | In a worker of the pane's own (`src/cleancopy-worker.js`), so the pane stays responsive. It loads the first time a clean copy is made, then stays in the browser cache. |
| pdf-lib (`vendor/pdf-lib`, MIT) | Joins the parts of a long clean copy into one PDF | In the pane |
| `clean-copy/bill.typ`, `hyphenation*.json` + FreeMono | LBDC's clean-copy template from the desktop demo (profile 0.3, line for line with the public PDFs) | Compiled in the pane, or by the Typst command line |
| `samples/budget/` | The demo budget bills, converted from the 2025 prints, with last year's chapter, the 2025 line vetoes and the print's line positions | Fetched by the pane when a demo bill is opened |

There is no server-side code. GitHub Pages only serves static files. There is no .exe and no installer.

**Install on Windows:** put `manifest.xml` in a folder on a network share. In Word, go to Trust Center > Trusted Add-in Catalogs, add the share, and add the add-in from the Shared Folder tab. In Word on the web, use **Upload My Add-in** instead. IT can also push the same manifest to everyone from the Microsoft 365 admin center. Updates need nothing on the computer: they reach Word when the site changes (close and reopen the pane; if Word keeps the old copy, empty its add-in cache, the `Wef` folder).

## 2. The Bank

* **Source.** These are the JSON files the desktop app downloads: one per law, Open Legislation "law-tree" format. The drafter picks the folder once, from the **Bank** button at the top of the pane.
* **Storage.** `bank.js` flattens each law into its sections (location id, heading, text, article path) and stores them in the browser's IndexedDB under the add-in's web address. All 124 laws (38,411 sections) load in about 3 seconds. Nothing is uploaded.
* **Law text.** The Bank text comes in 70-column lines. A line that starts with spaces begins a new paragraph, and the other lines are joined to the one before. Subdivisions are found by "1.", "2."… at the start of a paragraph, including "1." in the middle of a section's first line ("§ 2-d. … information. 1. Definitions.").
* **Law names.** These come from the law's catalog entry: "General Construction" becomes *the general construction law*, "Civil Practice Law & Rules" becomes *the civil practice law and rules*, court acts keep "act", and unconsolidated laws become *chapter 576 of the laws of 1974, constituting the …*.
* **Missing piece.** The Bank files don't include amendment history, so the "as amended by …" part of a clause is typed by the drafter. The section list asks for it.

## 3. The Word document's structure (bills)

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

Word's own Track Changes marks and plain underlining are read the same way. Bill information (LBD number, house, bill number, sponsor, committee, date, session year) is stored as **custom document properties**. The full mapping is in `FORMAT.md`; budget bills are in section 9 and in `FORMAT.md`, *Budget bills*.

## 4. Writing the bill (task pane → Word)

* **Start the bill** inserts the title, the enacting clause, a blank section 1 and an effective-date section.
* **Insert section** (Amend a law) builds the section's OOXML: the number control, the amending clause control, and the quoted-text control holding the Bank text as plain runs. Word inserts it with `insertOoxml` in the right position:
  * a short title is always first
  * findings come second
  * severability goes just before the effective date
  * the effective date is always last
  * everything else goes before severability

  The sections are then renumbered (each `akn:num` rewritten: "Section 1.", "§ 2." …) and the title rebuilt from what the sections do.
* **Mark changes** takes each `akn:quoted` and reads the drafter's current text from it: unmarked plus inserted words, ignoring words already bracketed. It looks up the same provision in the Bank and runs a word diff:
  * The diff works word by word, with punctuation as separate tokens and a sum of money as one word. It finds the fewest changes.
  * Short kept runs between bigger changes are folded into one change, using the idea behind diff-match-patch's semantic cleanup.
  * Deletions come before additions.

  The text is then rewritten as runs styled Bill Delete "[…]" and Bill Insert, but only in sections whose marking would change. Track Changes is paused while this happens, so the rewrite isn't recorded as a revision. The two readings always round-trip: the unmarked plus bracketed words are exactly the law, and the unmarked plus underlined words are exactly the drafter's text.

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

Each finding carries the section it belongs to and, where possible, a fix (renumber, rebuild the title, mark changes, add history, add an effective date). The pane runs the checks every time it reads the bill: after each change it makes, and whenever the drafter comes back to the pane from the document (the window's `focus` event). That is how the section list shows each section's state; the Check tab lists every finding.

## 6. Word → Akoma Ntoso

`ooxml.js` reads WordprocessingML into a model, either from `body.getOoxml()` in the pane or from `word/document.xml` in a saved .docx. `akn.js` writes Akoma Ntoso 3.0 from that model in the shape of LBDC's **AKN-NY profile, version 0.3**. The pane and the command line (`node tools/docx2akn.cjs bill.docx`) run the same code and give identical output.

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

**Nothing leaves unmarked.** Every export (**Make the clean copy**, **Show the XML**, **Copy**, **Save .xml**) first runs Mark changes against the Bank (`markedForExport` in `taskpane.js`), so a clean copy can't show the law as other than it stands: words taken out of the law silently, or words passed off as law. If a section can't be checked against the Bank (its law isn't loaded, the provision isn't in the law as cited, or its text is missing), nothing is made and the sections are named.

**Before a bill has a number.** At the drafter's desk a bill usually has only an LBD number. The add-in then writes the profile's draft form: the bill is addressed by its LBD route number (`/akn/us-ny/bill/2025/lbd12345`), the LBD version is the Expression (`eng@01`), and the print number, printed bill number and introduction date are left out. The clean copy leaves those lines blank, with everything else in place.

## 7. Akoma Ntoso → clean copy

**Make the clean copy (PDF)** does the following:

1. Marks changes against the Bank and converts the document to Akoma Ntoso, as in section 6 (for a budget bill, reads the document's edits into the bill's XML, section 9).
2. Starts the typesetter in its worker: the Typst compiler (WebAssembly), the FreeMono fonts and the `hyphenation*.json` files from the add-in's site.
3. Places the XML in Typst's in-memory file system and compiles `clean-copy/bill.typ` with `xml=` pointing at it.

`bill.typ` is the desktop demo's profile-0.3 template: it prints line for line as the public PDFs do. That means bold front matter, the enacting clause underscored (its printed form, not new matter), 72-character lines, 56 lines a page, new matter underscored, old matter in brackets, the "S./A. number" running header, the EXPLANATION and LBD number on page 1, and words divided only where real prints divide them. The pane's Typst is 0.15.1, the same as the desktop app's, so the two produce the same PDF: the example bill matches word for word, at the same positions. The example takes about 0.6 seconds once the compiler is loaded.

**Long bills are printed in parts.** The browser's typesetter can't hold a whole budget bill at once (all of S.3003-D, 1,518 pages, runs it out of memory). `src/cleancopy.js` splits such a bill between agencies into parts of about 280 pages; each agency begins a page of its own, so the parts paginate exactly as the whole bill does. Each part is compiled with the template's part inputs: `page-offset` (the page before its first), `front` (only the first part has the front matter), `toc` (only the last has the table of contents) and `agency-pages` (where the agencies of earlier parts begin, for that table of contents, read from each part with Typst's query). pdf-lib joins the parts. All of S.3003-D takes about 70 seconds, and every one of its 671,255 words lands in the same place on the same page as in the desktop typesetter's single run.

## 8. What was tested (bills)

* **Unit tests (Node, `npm test`):** law names, amending clauses, section placement, titles, Mark changes round trips, subdivision splitting, tables, the docx reader and writer, Akoma Ntoso nesting, and the add-in's output against the profile's validator, both as a printed bill and as a draft.
* **Whole flow in Chromium** (`tests/flow.cjs`), against a stand-in for Word's API, using a small test Bank (`tests/bank-fixture`):
  * load the Bank, start a bill, amend a section and a subdivision, add a section, repeal
  * edit the law's text, come back to the pane and see the sections flagged "Not marked", Mark changes
  * a table in the editor; standard sections; the effective date replaced
  * history typed in the section list; a pick after a repeal starts at "Amends the whole section"
  * the clean copy after an unmarked edit (the edit comes out bracketed); the clean copy refused once the Bank is removed
  * a section deleted in the document, and the offer to renumber
  * Akoma Ntoso and the clean-copy PDF in the pane, saved
* **External checks:** the pane's clean copy and the desktop Typst's are identical; the example .docx opens in LibreOffice; the desktop demo's round-trip check agrees with the output.

## 9. Budget mode

Budget mode works on an appropriation bill as LBDC changes one for an amended print. The record is the bill's Akoma Ntoso XML; Word shows it laid out as the print reads.

**Storage.** The XML is kept in the document as two custom XML parts in the namespace `urn:x-lbdc:bill-drafter`: `role="current"` (the bill as changed) and `role="opened"` (the bill as it was opened, for "changes since it was opened" and for the export check below). Where the browser can, the XML is stored gzip-compressed and base64-encoded (`encoding="gzip-base64"`): 8 MB of XML is about 1 MB stored. The document carries the record with it.

**The layout in Word** (`budgetword.js`). Each part that can change is a content control tagged `akn:b;e=<short eId>;k=<kind>`, kinds `agency`, `summary`, `program`, `purpose`, `appropriation`, `reappropriation`, `subtotal`, plus `front` (the title block and section 1's opening) and `schedule` (a whole agency schedule, so it can be taken out again). Word allows 64 characters in a tag, and budget eIds run to 96, so the tag holds a short form: `sec_1__agency_48__program_2__account_1__reappropriationSource_19__reappropriation_1` is `1.a48.p2.c1.s19.r1`. Amounts sit at the right margin after a dot leader, as in print.

**The working set.** A bill of up to 1,200 items is laid out whole when opened. A larger one (a whole budget bill) opens with only the front laid out; the drafter opens the schedules to work on, and closing one reads its edits into the XML first. The schedules in the document are read from the document itself, so a schedule deleted there counts as closed.

**Reading edits back.** The pane compares the first paragraph of each item in the document with what the XML says it shows; those that differ were edited. Their runs are read back (Bill Insert, Bill Delete, typed brackets, Word's tracked changes) and written into the XML (`applyEdit`):

* A **reappropriation** (and a purpose under a reappropriation source) is existing law. Its words and its original amount are marked against the law as it stands, as the prints show them: `[(15126)] (60501) ... [1,312,000] 1,433,000`. A code in parentheses is one word to the diff. The amount reappropriated, "(re. $…)", is this year's figure and is reprinted, not marked.
* An **appropriation** is new money in this bill: it takes the new words and amount, unmarked.
* Codes and amounts are tagged again (`programCode`, `objectCode`, `amount`, `originalAmount`, `reappropriatedAmount`). Struck matter stays plain words in `del`, as the converter reads the prints; the new amount is a `quantity` inside `ins`, and the clean-copy template prints it underscored after the struck one.
* An item deleted in an open schedule is taken out of the XML.

**Totals.** Program totals, program account subtotals and agency summaries (each fund's row and All Funds) are computed from the items; those that differ from what is printed are listed, and **Update** sets them (a total is reprinted, not marked).

**The checks** (`budget.js`) are LBDC's budget tools, done the same way on the XML:

| Python tool (desktop) | In the add-in | What it checks |
|---|---|---|
| `budget_items.py` | `items`, `key`, `numbered` | Each item's key: agency, account, program code, object code; the same key next year is the same money |
| `budget_report/findings.py` | `findings` | Account headings without a number; agency summaries, subtotals and program totals against the items; project schedules against their rows and the item they allocate; reappropriations larger than their original, or with no original |
| `prior_check.py` | `priorCheck` | Every reappropriation against the chapter it continues: found by key (or by account and amount), original amount as appropriated, no more reappropriated than last year; last year's items not continued |
| `compare_prints.py` | `compare` | Items added, removed, recoded or reworded, amounts and totals changed, between two prints (or the bill as opened and as changed) |
| `line_vetoes.py` | `placeVetoes`, `vetoMemo` | Each line veto, cited by the print's page and lines, placed on the item printed wholly on those lines, its words and amounts compared, and its line veto memorandum written |

Python's `difflib.SequenceMatcher` is ported too, so similarity scores come out the same. `tests/budget-expected.json` holds what the Python tools find in the samples, and the unit tests check that the add-in finds exactly the same: for the Labor and SUNY sample and for all of S.3003-D (8,497 items, 41 amount findings, all 6,720 reappropriations in the same categories, all 24 vetoes on the same items). On the whole bill the checks take a second or two; they are kept until the XML changes. Elements are found through an index of eIds, made once.

**The clean copy and the XML** read the document's edits back first, then check that every reappropriation's law (its words and original amount, before "(re. $") still reads as the bill as opened has it, once its brackets and underlines are taken into account. If one doesn't, nothing is made.

**The bill window.** `bill-window.html` shows the whole bill laid out as the print reads, schedule by schedule, with the state of each (in Word, amounts to check, vetoes, edits) and a search over every item. The pane hands it the bill's XML and its status in IndexedDB (`src/lib/windowstore.js`) and says when they change; the window asks the pane to open or close a schedule or to go to an item. In Word it is an Office dialog (`displayDialogAsync`, messages with `messageParent` and `messageChild`); elsewhere a browser window (`postMessage`). It also checks the store every two seconds.

**The demo bills** (`samples/budget/`, made by `tools/make-budget-sample.py` from the desktop project's converted prints):

* S.3003-D Aid to Localities (2025), Department of Labor and SUNY (288 items), with chapter 53 of the laws of 2024 (S.8303-D), the Governor's line vetoes of May 20, 2025 and the print's line positions.
* All of S.3003-D (98 schedules, 8,497 items, 1,518 pages), with the same.
* S.3000-D State Operations (2025), Department of Public Service and CUNY (118 items), with the C print before it. (The original print S.3003 isn't used: its conversion's text is garbled.)

**Tested:** `tests/budget-flow.cjs` (open, the checks, an appropriation and a reappropriation edited in the document and marked, totals updated, an item added at the cursor, the comparison, a veto memorandum saved, the clean copy after an unmarked edit, the bill loaded again from the document, S.3000-C to D) and `tests/budget-whole.cjs` (all of S.3003-D: a schedule opened, edited and closed, the checks on the whole bill, the bill window's search and Go to in Word, and the 1,518-page clean copy with the edit in it).

---

# Part 2: the plain-language guide

This is what you see in the Bill Drafter pane in Word, and what to do.

## Finding your way around

* **The pane** opens from **Home > Bill Drafter** in Word.
* **Bill or Budget**, at the top right: choose what you're working on. Bill is for drafting a bill from the laws. Budget is for changing an appropriation bill.
* **The Bank button**, next to it, shows how many laws this computer has (for example "Bank · 124 laws"). If it says **Load the Bank**, the laws aren't loaded yet.
* **Three tabs**, in the order of the work: **Draft**, **Check** and **Clean copy**. A red number on Check shows how many problems there are.
* **Messages** pop up just above the buttons at the bottom, right where you clicked. Errors stay until you close them; other messages go away by themselves.

## Drafting a bill

**Once per computer: load the laws.** Click the **Bank** button at the top right, then **Choose a folder…** and pick the folder with the law files. They stay on this computer; nothing is sent anywhere. Do this again when the Bank is updated, then click **Back to the bill**.

**Start a bill.** Type what the bill is "in relation to" and click **Start the bill**. The document gets the title, the enacting clause, a blank section 1 and an effective date. Until both the laws and a bill are there, a short *Getting started* list reminds you what's next.

**Amend a law.** Under **Add a section**, with **Amend a law** chosen:

1. Type the law and the section in the one box, for example `GCN 12`, `executive 296` or `tax 606(c)`. You can use the law's short name or a word of its name. Pick the section from the list (the arrow keys and Enter work too).
2. Choose what the bill does: amend the whole section, amend one subdivision, add a new section (the next free number is filled in), add a new subdivision, or repeal it. Each pick starts at "amend the whole section", or at the subdivision you typed, never at your last choice.
3. If you know the provision's last amendment, type it under **Last amended by**, for example *chapter 55 of the laws of 2023*. You can also add it later.
4. Click the button. It says exactly what it will do, for example "Insert: amend EXC § 296 subd. 1". The section goes in its proper place, the sections renumber, and the title is rebuilt to name the law.

**Edit the law's text** in the document like any other text: type, delete, paste. You don't put in brackets or underlining yourself.

**Mark changes.** The button is in the bar at the bottom of the pane. One click and every amended text gets its marks: words taken out of the law go in [brackets], and new words are underlined. The bar tells you when this is needed, for example "§ 2 has edits not yet bracketed and underlined", and when it isn't: "Brackets and underlines are up to date."

**The section list** under *This bill* shows every section and what it still needs:

* **Not marked**: you edited the law's text but haven't marked it yet. Click it to mark.
* **Add history**: the amending clause should cite the last amendment, and the Bank doesn't have it. Click it, type the chapter (for example *chapter 55 of the laws of 2023*), and click **Put it in**.
* **Fill in the blank**, **Citation**, **Number taken** and the like: a problem to fix. Click it to see it on the Check tab.
* **✓**: nothing to fix in that amendment.

Click a section's name to go to it in the document. The section your cursor is in is highlighted. The list updates itself whenever you come back to the pane from the document. If the section numbers or the title stop matching (say, after you delete a section in the document), a note above the list offers to renumber them or rebuild the title.

**Standard sections.** Switch to **Standard section** under *Add a section*. Add a **Short title** (type its name first), **Legislative findings**, a **Severability clause** or a **Blank section** for new law in your own words. If one is already in the bill, its button says "Go to Section 1" instead of adding another. For the **Effective date**, choose when, open **Add-ons** for rules and regulations, sunsets and the like, check the sentence shown, and click **Add this effective date** (or **Replace the effective date**, if the bill has one).

**Tables.** A table in the law comes in as a real Word table. Change it in the document, or open the **Tables** card (it appears once the bill amends a law) and click **Edit**. The editor shows the table as the law will read: a box per cell, a kind for each row (row, headings, group, note), buttons to add or delete rows and columns, and **Paste rows from text…** for rows copied from Excel. **Save to the bill** puts it in and marks it: a changed amount comes out `[$100,000] $400,000`, a deleted row stays in brackets, new rows are underlined.

**Check.** The Check tab lists every problem, errors first, then warnings, then notes, each in plain words, with **Go to** and, where it can, a button that fixes it. "No problems found. The bill is ready for its clean copy." means you're done.

**Clean copy.**

1. The line at the top says what will be printed, for example "Draft for the Senate, LBD 12345-01-6 (no bill number yet)", and links to anything missing, such as the LBD number or the sponsor.
2. Click **Make the clean copy (PDF)**. The pane first marks changes against the Bank, so the copy always shows the law as it stands. If a section can't be checked (for example, its law isn't in the Bank), it says which and makes nothing.
3. Click **Open the PDF** or **Save .pdf**. The first time, the typesetter takes a few seconds to load; after that a bill takes about a second.
4. **Bill information** (LBD number, house, sponsor, committee) saves as you type. Leave the bill number and date blank for a draft: the clean copy leaves those lines empty.
5. **For other systems**, folded at the bottom, gives the bill's Akoma Ntoso XML (**Show the XML**, **Copy**, **Save .xml**). It's marked against the Bank first, like the clean copy.

## Changing a budget bill

Click **Budget** at the top right.

**Open a budget bill.** Pick one of the demo bills and click **Open**, or **Open a bill's XML…** for another. It's best to start in a blank document. The bill is laid out in the document as the print reads, and the bill's data is kept inside the document, so it travels with the file.

* A **small bill** (like the Labor and SUNY demo) is laid out whole.
* A **whole budget bill** (like all of Aid to Localities, 1,518 pages) opens with no schedules laid out, because Word can't comfortably hold all of it. Every schedule is listed, and every check still covers the whole bill. Click **Open** next to the schedules you're working on to put them in the document, and **Close** when you're done (your changes are saved into the bill first). The box above the list finds a schedule by name.

**Make changes in the document**, then click **Mark changes** in the bar at the bottom.

* A **reappropriation** continues existing law. If you change its words or its original amount, the old is put in [brackets] and the new is underlined, the way the prints show it: `[15,000,000] 14,000,000`. The amount reappropriated, "(re. $…)", is this year's figure, so it's simply reprinted.
* An **appropriation** is new money in this bill. It takes your new words and amount as you typed them.
* Delete an item in the document and Mark changes takes it out of the bill.

The bar at the bottom tells you when the document has edits that aren't in the bill yet, for example "2 items edited in the document, not yet in the bill's XML."

**At the cursor.** Click an item in the document, and the pane shows it: what kind it is, its account and codes, and how a change to it will be treated. For an appropriation you can **Add an appropriation after it** (its words, with the program code in parentheses at the end, and its amount). You can also **Remove it from the bill**.

**Totals.** When totals no longer add up, a note on the Draft tab lists them (for example a program total, or an agency summary's General Fund row), with **Update them**. Updating also fixes totals the print itself got wrong.

**Check** has four parts:

* **Amounts**: the print-error checks. Program totals, subtotals and agency summaries that don't match their items, project schedules whose rows or item don't match, and reappropriations larger than their original. Each has **Go to it**; totals have **Update the totals**.
* **Last year's chapter**: every reappropriation is looked up in the chapter it continues. Its original amount must be what that chapter appropriated, and no more can be reappropriated than last year. You see how many fall in each group, the ones to look at, and last year's items this bill doesn't continue. **Use another chapter** checks against a different one.
* **Changes in this print**: what was added, removed, recoded, reworded or changed in amount, against the bill as you opened it, the print before (where there is one), or another print's file.
* **Line vetoes**: each veto on the Governor's list is placed on the item printed on its page and lines, with **Go to it** and **Save the memorandum** for its line veto memorandum.

**The bill window.** Click **Open the bill window** on the Draft tab. It shows the whole bill as the print reads, one schedule at a time, with the schedules listed on the left and what each needs (in Word, amounts to check, vetoes, edits). Type in the search box at the top to find any words, code or amount anywhere in the bill. Click a result to see it in place. **Open in Word** puts that schedule in the document, and **Go to in Word** takes you to the item there.

**Clean copy.** Click **Make the clean copy (PDF)**. The pane reads your edits into the bill first. If any reappropriation would no longer read as the law as it stands, it says so and makes nothing. A whole budget bill is printed in parts and joined into one PDF; the status line counts the parts (about 70 seconds for all of Aid to Localities). **For other systems** saves the bill's XML.

## What you never have to do

Type amending-clause wording, work out section numbers, rebuild the title, put in brackets or underlining by hand, add up a budget schedule, look up a reappropriation in last year's chapter, find a vetoed item from its page and line, retype anything for the XML or the clean copy, install software, or send the bill anywhere.

---

# Limits and next steps

* **First real-Word test.** This is the open item. Everything above was tested against a stand-in for Word that behaves as Word's API is documented to behave. Things only Word can show: the pane refreshing when you come back to it, the highlight following the cursor, how Word handles a schedule of 800 or more items, the bill window as an Office dialog (it relies on the pane and the dialog sharing the browser's storage), saving a PDF from Word for Mac's built-in browser, and the memory the 70-second clean copy of a whole bill needs.
* **Amendment history** isn't in the Bank files. In deployment it comes from LBDC's own records, not the Bank.
* **Table detection** in the Bank's text has been built from the profile's examples, not yet tried over every Bank table. The table editor fixes any table it misreads.
* **Laws not in the table** (`src/lib/laws.js`) are addressed from the Bank's law type. The checks flag unconsolidated laws for review.
* **Budget bills:** new items are added as appropriations (not reappropriations or purposes); project schedules inside items are shown and checked but edited only through the XML; summaries over several agencies are checked but not rewritten; a veto is placed by the print's lines, so the vetoes belong to the bill as passed.
