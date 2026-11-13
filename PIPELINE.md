# Bill drafting pipeline: Word → Akoma Ntoso → clean copy

*13 November 2026 · Bill Drafter (demo) for Word, repo `RaihoHeeHo/bill-drafter-word`*

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
| Shared libraries (`src/lib/*.js`) | Drafting rules, Bank reader, docx reader and writer, checks, Akoma Ntoso writer. They make no Office calls. | In the pane, and in Node for the command-line converter and tests |
| Typst compiler (`vendor/typst`, 28 MB WebAssembly) | The Typst typesetter built for browsers (typst.ts 0.7.0, Apache-2.0) | In the pane. It loads the first time **Make clean copy** is used, then stays in the browser cache. |
| `clean-copy/bill.typ` + FreeMono | LBDC's clean-copy template from the demo, with two small additions | Compiled in the pane, or by the Typst command line |

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

* **New bill** inserts the title, the enacting clause and an effective-date section.
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

`ooxml.js` reads WordprocessingML into a model, either from `body.getOoxml()` in the pane or from `word/document.xml` in a saved .docx. `akn.js` writes Akoma Ntoso 3.0 from that model. The pane's **Export** and the command line (`node tools/docx2akn.cjs bill.docx`) run the same code and give identical output.

| Word | Akoma Ntoso |
|---|---|
| Bill information | `preface`: `docAuthority` STATE OF NEW YORK, `docNumber`, `session` ("2025-2026 Regular Sessions"), `docStage` ("IN SENATE"), `docDate`, the "Introduced by" paragraph (`docProponent`, `docCommittee`). Also `meta/proprietary`: `lbdc:house`, `lbdc:lbdNumber`, plus the FRBR identification. |
| `akn:longTitle` | `preface/longTitle`, with the subject as `span refersTo="#subject"` |
| `akn:enactingFormula` | `preamble/formula[@name="enactingFormula"]` |
| `akn:section` | `body/section eId="sec_N" refersTo="#amendment\|#repeal\|#shortTitle\|#severability\|#effectiveDate…"` with `num` and `heading` |
| Amending clause | Text of the section's `p`, with the law's name as a `ref` to the law's URI (e.g. `/akn/us-ny/act/consolidated/gcn/!main#sec_296__subsec_1`). The `mod` follows it in the same `p`, as in LBDC's demo XML. |
| `akn:quoted` | `mod/quotedStructure`, nested section › subsection › paragraph › subparagraph … by numbering (§ 296. › 1. › (a) › (1) › (i) › (A) › a.). These are the demo converter's rules, including "(i) after (h) is a letter". A short sentence after the number is the `heading`, and text before sub-units goes in `intro`. |
| Bill Insert / Bill Delete | `ins` / `del` (brackets dropped; the template adds them back) |
| Each amending section | `meta/analysis/activeModifications/textualMod`: substitution, insertion or repeal, pointing from the `mod` to the law |

The output validates against the OASIS Akoma Ntoso 3.0 schema. The demo's `docx2akn.py --check` agrees with it word for word, brackets and underlining included, once its Word reader is patched to see content controls. The patch is in `clean-copy/`, and the demo's own tests still pass with it.

## 7. Akoma Ntoso → clean copy

**Make clean copy (PDF)** does the following:

1. Converts the document to Akoma Ntoso, as in section 6.
2. Loads the Typst compiler (WebAssembly) and the FreeMono fonts from the add-in's site.
3. Places the XML in Typst's in-memory file system.
4. Compiles `clean-copy/bill.typ` with `xml=` pointing at it.

`bill.typ` lays out the cover page, the hanging-indent title and enacting clause, and the body with page-numbered lines (56 lines, 72 characters, 6 lines per inch). New matter is underscored, old matter is in brackets, there is an "S./A. number" running header, and page 1 has the EXPLANATION footer and the LBD number. The example bill takes about 0.7 seconds once the compiler is loaded. **Open** and **Save .pdf** hand the PDF to the drafter.

The template is LBDC's, with two additions: it prints `intro` (the words before (a), (b)…) and bill-section headings ("Section 1. Short title."). The demo's own sample prints exactly as before. The same template works from the command line (`typst compile --font-path fonts --input xml=bill.akn.xml bill.typ out.pdf`) or with the demo's `clean_copy.py`.

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
* **Whole flow in Chromium,** against a stand-in for Word's API, using real Bank files:
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
* **External checks:**
  * the Akoma Ntoso passes the OASIS schema
  * the example .docx opens and renders in LibreOffice
  * the demo's round-trip check agrees with the output
* **Not yet tested: real Word.** The stand-in behaves the way Word's API is documented to behave, but Word's own quirks (for example, how `insertOoxml` treats content controls next to each other) will only show up in the first real sideload.

---

# Part 2: what the drafter sees

**Once per computer.** Open Word, click **Home > Bill Drafter**, open the **Bank** tab, click **Choose a folder…**, and pick the law files folder. The pane shows "124 laws, 38,411 sections, laws as of …". Do this again whenever the Bank is updated.

**Starting a bill.** On the **Draft** tab, type what the bill is "in relation to" and click **New bill**. Three things appear in the document: the title, the enacting clause, and "Section 1. This act shall take effect immediately."

**Amending a law.**
1. Filter for the law (e.g. "EDN" or "education") and type a section number or words from its heading. Matching sections are listed, and clicking one shows its text in a preview.
2. Choose what the bill does: amend the section, amend one subdivision, add a new section (the next free number is already filled in), add a subdivision, or repeal.
3. Optionally type the history ("as amended by chapter 55 of the laws of 2023").
4. Click **Insert section**.

The new section appears in place, for example "§ 2. Section 12 of the general construction law, as amended by …, is amended to read as follows:" followed by the law's text. The sections after it renumber, and the title updates to name the law.

**Editing.** The drafter edits the law's text in the document like any other text: typing, deleting, pasting, with Word's spelling check and Track Changes if wanted. Each part of the bill sits in a thin labeled box (Word's content-control outline, e.g. "§ 2 Amend GCN 12" and "Text of the law"). That outline is the only sign of the structure.

**Mark changes.** One click and every amended text gets its marks: words taken out appear in [brackets] (shown in dark red on screen), and new words are underlined. Clicking it again after more edits re-marks from scratch, so the marks always match the Bank.

**Standard sections.** Buttons for **Short title** (type the name first), **Legislative findings**, **Severability** and **Blank section**, plus an effective-date picker (immediately, 30th/60th/90th… day, January 1 next, a date) with add-ons such as rules and regulations, sunsets, retroactivity, applicability and provisos. Each one lands in its proper place, and numbers update by themselves. A **Sections** list at the bottom of the pane shows the outline ("§ 3 Amend EXC § 296 subd. 1"), and clicking an entry jumps to that section.

**Checks.** **Run checks** lists errors (red), warnings (amber) and notes (blue) in plain language, for example "The amending clause should cite the provision's last amendment" or "Gendered: 'he or she'; use 'they' where possible". Each has **Go to** and, where possible, a fix button. A red count on the Checks tab shows how many errors remain.

**Export.**
1. Fill in the bill information once (LBD number, house, bill number when known, sponsor, committee, date) and click **Save in the document**. It travels with the .docx.
2. **Convert to Akoma Ntoso** shows the XML, with **Copy** and **Save .xml** buttons. It also warns if the checks still find errors.
3. **Make clean copy (PDF)** produces the formatted bill: cover page, numbered lines, brackets and underscores. Use **Open** or **Save .pdf**. The first time, it takes a moment to load the typesetter. After that it takes about a second.

**What the drafter never has to do:** type amending-clause wording, work out section numbers, rebuild the title, apply brackets or underlining by hand, retype anything for the XML or the clean copy, install software, or send the bill anywhere.

---

# Limits and next steps

* **First real-Word test.** This is the open item. Sideload it and try the flow above. Anything odd will most likely be in how Word inserts sections next to each other.
* **Amendment history** isn't in the Bank files. If the desktop app's history lists (`data/history`) were copied into the Bank folder, the "as amended by" text could be filled in automatically.
* **Nesting** follows numbering only, so unusual numbering (tables, schedules, appropriations) comes out as plain paragraphs.
* **Unconsolidated laws** get a best-guess citation and URI. The checks flag these for review.
* **Clean-copy layout** is LBDC's demo template. Settling its spec (line length, lines per page, reprint headers) is template work, independent of the add-in.
