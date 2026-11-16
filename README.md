# Bill Drafter (demo) for Word

A Word add-in that brings parts of the bill drafter into Word:

1. **Amendments from the Bank.** Pick a law and a section from this computer's own copy of the laws (the NY-Law-Exporter JSON files). The add-in writes the amending clause ("Section 12 of the general construction law, as amended by …, is amended to read as follows:") and pastes the law's text. Edit the text like any other text, then **Mark changes**: deleted words go in [brackets], new words are underlined. Also: amend one subdivision, add a new section or subdivision (the next free number is suggested), repeal a section.
2. **Tables.** A table in the law comes in from the Bank as a real Word table. Change it in Word or in the pane's table editor, which shows the table as the law will read: cells to type in, row kinds (headings, group, note), add or delete rows and columns, and paste rows from Excel or text. Saving marks it against the Bank: changed amounts bracketed and underlined, struck rows in brackets, new rows underlined.
3. **Standard sections.** Short title, legislative findings, severability clause and effective date (the desktop drafter's forms and add-ons), each put where the Manual puts it, with the sections renumbered. The title ("AN ACT to amend … in relation to …; and to repeal …") is rebuilt from what the sections do.
4. **Drafting checks.** Title and enacting clause, section numbers, order of the standard sections, effective date last, amending clause form and history, every amended text checked against the Bank (unmarked changes, nothing amended), added sections fully underlined and not already in the law, blanks left in, and style in new matter (gendered words, "said", "must", session-law citations, sums of money, "§" in text, stray brackets).
5. **Akoma Ntoso in LBDC's profile.** Every part that means something is a tagged content control or a Bill Insert / Bill Delete run, so the .docx converts without guessing to Akoma Ntoso 3.0 XML in the shape of LBDC's **AKN-NY profile, version 0.3**: classed front matter and LBDC metadata, laws addressed by their Bank ID alone (`/akn/us-ny/act/consolidated/gcn/~sec_12`), the whole lead-in inside the `mod` with the history linked, New York's unit names (subdivision, or subsection for the Tax and Insurance Laws), renumbered and struck units, and bracket pairs split across units. The output passes the profile's validator. See [FORMAT.md](FORMAT.md). Get it from the pane (**Clean copy > For other systems**), or `node tools/docx2akn.cjs bill.docx`.

6. **Budget mode.** Changes to an appropriation bill, with every check of LBDC's budget tools (below).

A bill being drafted does **not** try to look like a printed bill: no line numbers, no bill spacing or fonts (the clean copy is the printed form). A budget bill is laid out as the print reads, with amounts at the margin.

**Guides:** [PIPELINE.md](PIPELINE.md), Part 2, is the plain-language guide to everything in the pane, step by step; Part 1 is how it works. [FORMAT.md](FORMAT.md) is the document's structure and its Akoma Ntoso mapping.

Nothing is installed on the computer and there is no .exe: Word loads the add-in from this site, and the laws stay on the computer.

## Clean copy

Nothing leaves the add-in with unmarked changes: **Make the clean copy**, **Show the XML**, **Copy** and **Save .xml** first run Mark changes against the Bank, so a copy can't show the law as other than it stands (words taken out of the law silently, or words passed off as law). A section that can't be checked against the Bank (its law not loaded, the provision not in the law as cited, its text missing) stops the export and is named.

**Clean copy > Make the clean copy (PDF)** typesets the bill right in the pane with LBDC's clean-copy template (`clean-copy/bill.typ`, profile 0.3), the one that matches the public PDFs line for line: bold front matter, the enacting clause underscored (its printed form, not new matter), 72-character lines, 56 lines a page, and words divided only where real prints divide them (`clean-copy/hyphenation.json`). It uses the Typst compiler built for the browser (`vendor/typst`, Typst 0.15.1, the same version as LBDC's desktop demo, so the pane's PDF and the desktop's are identical); nothing is installed and the bill never leaves the computer. See [clean-copy/](clean-copy/README.md); `examples/Example bill - clean copy.pdf` is the example bill printed that way.

## Add it to Word on Windows

You need the manifest file: [manifest.xml](https://raihoheeho.github.io/bill-drafter-word/manifest.xml) (right-click > Save link as).

**Word for Windows (Microsoft 365)** — from a shared network folder:

1. Put `manifest.xml` in a folder on a network share you can reach, e.g. `\\server\share\Word add-ins`.
2. In Word: **File > Options > Trust Center > Trust Center Settings > Trusted Add-in Catalogs**.
3. Type the folder's network path in **Catalog Url**, click **Add catalog**, tick **Show in Menu**, click OK, and restart Word.
4. **Home > Add-ins > More Add-ins** (or **Insert > Get Add-ins > My Add-ins**) > **SHARED FOLDER** > **Bill Drafter (demo)** > **Add**.
5. A **Bill Drafter** button appears on the Home tab.

**Word on the web** — **Home > Add-ins > More Add-ins > My Add-ins > Upload My Add-in**, pick `manifest.xml`.

If the add-in options are greyed out, the organization has turned off adding add-ins; IT can deploy the same manifest from the Microsoft 365 admin center (Settings > Integrated apps).

## First use

The **Draft** tab opens with a short *Getting started* list until both steps are done.

1. Open the pane (Home > Bill Drafter) and press **Load the Bank** at the top right.
2. **Choose a folder…** and pick the folder with the law files (e.g. `Downloads\NYS Law Library\NY-Law-Exporter\Downloads\<date>`), or **Choose files…** for a few laws. They are kept in Word's storage on this computer; nothing leaves it. Do this again when the Bank is updated (the button at the top right shows how many laws are loaded).
3. Type what the bill is in relation to and click **Start the bill**.
4. Under **Add a section**, type the law and the section in one box (`GCN 12`, `executive 296`, `tax 606(c)`), press Enter, choose what the bill does (amend, add, renumber or repeal), and insert it.
5. Edit the law's text in the document, then press **Mark changes** in the bar at the bottom of the pane.
6. On **Clean copy**, fill in the bill information and make the PDF.

## While drafting

The section list under **This bill** shows what each section does and what it still needs, and it brings itself up to date whenever you come back to the pane from the document:

- **Not marked**: the law's text was edited but not bracketed and underlined yet. Press it (or **Mark changes**).
- **Add history**: the amending clause doesn't cite the last amendment, which the Bank doesn't hold. Press it, type e.g. *chapter 55 of the laws of 2023*, and **Put it in**.
- **Fill in the blank**, **Citation** and similar: an error; press it to see it on the **Check** tab.
- **✓**: nothing to fix in that amendment.

Click a section to go to it in the document; the section holding the cursor is highlighted. If the numbers or the title stop matching the sections (after deleting one in the document, say), a note above the list offers to renumber or rebuild the title. The bar at the bottom says whether the brackets and underlines are up to date. Standard sections already in the bill offer to go to them instead of adding another, and the effective date says whether it adds one or replaces the one in the bill.

## Working with others

Word's **Track Changes** are suggestions: what a reviewer types or deletes with it on is kept in their name, to be accepted or rejected in Word's **Review** tab. Word's comments work as usual.

- A section with suggestions shows **suggestions waiting**. **Mark changes** leaves it alone until they are accepted or rejected, then brackets and underlines the accepted ones against the Bank like any other change.
- **No clean copy** is made while a suggestion waits.
- **Review** tab: say who you are (name and role, kept on this computer). **Where the draft is** sends it on, drafter → examiner → proofreader → examiner → drafter, by whoever's turn it is. **Suggested changes** can be accepted or rejected there, keeping to the rules (proofreaders don't decide; an examiner doesn't decide a drafter's), and each decision is recorded. Examiners **sign off** sections and proofreaders mark them **proofread**; a sign-off shows as stale when its section changes afterwards.
- **People** (Review tab) lists everyone who made a suggestion or a comment or took a step; give each a role (drafter, examiner or proofreader). The roles and the review are saved in the document.
- **Show the XML** then gives a *working copy* in the profile's terms: the bill with the suggestions, comments and review steps, who made them, and their roles.
- **Signed package** (Clean copy tab) saves the working copy or the clean copy's XML in a `.nysakn` file signed with your key, for anyone, with a password, or only for people in the document (no password to share). **Check a package or PDF…** shows who signed it, whether anything changed since (if so it's **VOID**), stale sign-offs and the note; a VOID one prints with VOID across every page. Your key is made when you first say who you are and is kept on this computer (a demonstration: production would use the state's sign-ins or certificates); your public card goes into the document so others can send you packages. Compare a signer's fingerprint with them before trusting their key.
- **Signed clean copies**: once you've said who you are, every clean copy prints the bill's fingerprint at the foot of each page and carries its signed package inside the PDF. The profile's `tools/nysakn.py check` checks packages and PDFs from the command line, and with `--rerender` compares every page's words with the signed XML. See `profile/PACKAGE.md`.

## Budget mode

Switch the pane to **Budget** at the top. It works on an appropriation bill as LBDC changes one for an amended print:

- **Open a budget bill.** The bill is laid out in the document from its Akoma Ntoso XML, which is kept in the document (a custom XML part), so the document carries the record with it. Two demo bills come with the add-in, converted from the 2025 prints (`samples/budget/`): **S.3003-D**, Aid to Localities, Department of Labor and SUNY, with last year's chapter and the 2025 line vetoes; and **S.3000-D**, State Operations, Department of Public Service and CUNY, with the C print before it. Or open any appropriation bill's XML.
- **Make changes in the document**, then **Mark changes**. A *reappropriation* continues existing law: changed words and original amounts are put in [brackets] and underlined, the way the prints show them ("[(15126)] (60501) ... [1,312,000] 1,433,000 ... (re. $1,433,000)"); the amount reappropriated is this year's figure and is reprinted. An *appropriation* is new money in this bill: it takes the new words and amount. The item at the cursor is shown in the pane, where an appropriation can be added after it or an item taken out.
- **Totals.** Program totals, subtotals and agency summaries (fund rows and All Funds) are computed from the items; those that no longer add up are listed with a button to update them.
- **Check** runs the budget tools' checks on the XML, the same way they run in Python: the print-error report's amount checks; reappropriations against **last year's chapter** (by agency, account, program and object, as `prior_check.py`); **changes in this print**, against the bill as opened or another print (`compare_prints.py`); and **line vetoes** placed on the items printed on their lines, each with its line veto memorandum (`line_vetoes.py`). `tests/budget-expected.json` holds what the Python tools find in the samples, and the unit tests check the add-in finds the same.
- **Clean copy** reads the document's edits back first, refuses if any reappropriation no longer reads as existing law once its brackets and underlines are taken into account (or if an item has tracked changes waiting), and typesets the bill with the same template.

### A whole budget bill

The third demo bill is **all of S.3003-D**: 98 schedules, 8,497 items, 1,518 pages.

- **The XML of the whole bill is the record**, kept in the document (compressed: 8 MB of XML is about 1 MB stored). **Word holds only the schedules being worked on**: the bill opens with none laid out, and each schedule in the list has **Open** and **Close**. Closing a schedule reads its edits into the XML first. A bill of up to 1,200 items (the other demo bills) is laid out whole, as before.
- **Every check runs on the whole bill**, open in the document or not: the amount checks (41 in S.3003-D as printed), all 6,720 reappropriations against chapter 53 of 2024, all 24 line vetoes, and the changes since the bill was opened. On the whole bill they take a second or two, and they are worked out again only when the XML changes.
- **The bill window** (Draft > *Open the bill window*) shows the whole bill as the print lays it out, schedule by schedule, with a search over every item. **Open in Word** and **Go to in Word** ask the pane to put the schedule in the document and go to the item. In Word it is an Office dialog; the pane hands it the bill through the browser's storage on this computer.
- **The clean copy is printed in parts** of about 280 pages, split between agencies (each agency begins a page of its own, so the parts paginate as the whole bill does), each beginning on the page after the last, and joined into one PDF with pdf-lib (`vendor/pdf-lib`). The typesetter runs in a worker of its own (`src/cleancopy-worker.js`), so the pane stays responsive. All of S.3003-D takes about 70 seconds; every one of its 671,255 words lands in the same place on the same page as in the desktop typesetter's single run. The template takes the part's first page (`page-offset`), whether it carries the front matter (`front`) and the table of contents (`toc`), and the pages of the agencies in earlier parts (`agency-pages`).

## For developers

```
src/lib/drafting.js   wording: amending clauses, title, numbering, boilerplate, effective dates, word diff (Mark changes)
src/lib/bank.js       reading NY-Law-Exporter JSON; IndexedDB storage
src/lib/ooxml.js      writing the content controls and styles; reading .docx XML into a model
src/lib/checks.js     drafting checks
src/lib/laws.js       the laws the profile can address (Bank ID, consolidated or not, subsections)
src/lib/tables.js     tables: found in the Bank's fixed-width text, marked row by row and cell by cell
src/lib/akn.js        model -> Akoma Ntoso 3.0, AKN-NY profile 0.3
src/lib/budget.js     appropriation bills: item keys, amount checks, last year's chapter, print comparison, line vetoes
src/lib/budgetword.js an appropriation bill in Word: laid out from its XML, edits read back and marked, totals
src/budgetpane.js     the pane's budget mode, the working set of schedules
src/billwindow.js     the bill window (bill-window.html): the whole bill, schedule list, search
src/lib/windowstore.js what the pane hands the bill window (IndexedDB on this computer)
src/cleancopy-worker.js the typesetter in a worker; src/cleancopy.js prints long bills in parts and joins them
samples/budget/       the demo budget bills and what comes with them; full/ is all of S.3003-D (tools/make-budget-sample.py)
vendor/pdf-lib/       pdf-lib 1.17.1 (MIT), to join the parts of a long clean copy
src/taskpane.*        the pane (Office.js)
src/cleancopy.js      clean copy PDF in the pane (Typst in WebAssembly + clean-copy/bill.typ)
tools/docx2akn.cjs    command-line converter (same code)
clean-copy/           Typst clean-copy template (from LBDC's demo) for the exported XML
profile/              the AKN-NY profile's validator: schemas and Schematron rules (python3 profile/validate.py x.xml)
tests/unit.cjs        unit tests, including the profile validator on the add-in's output   (npm install && npm test)
tests/cleancopy.mjs   makes clean copies with the pane's own code and compiler   (node tests/cleancopy.mjs [bill.akn.xml ...])
tests/flow.cjs        whole flow in Chromium against a Word stand-in (tests/word-mock.js):
                      python3 -m http.server 8123 & node tests/flow.cjs tests/bank-fixture out/
tests/renumber-flow.cjs renumbering in Chromium: paragraphs lettered up and marked, a renumbering section with a
                      new subdivision, a section renumbered onto a taken number (caught) and then a free one
tests/renum-real.cjs  the add-in's renumberings in real bills against the converter's (node tests/renum-real.cjs x.xml)
tests/bank-fixture/   three small Bank files for the flow (tests/make-bank-fixture.cjs)
tests/budget-flow.cjs budget mode in Chromium against the Word stand-in   (node tests/budget-flow.cjs out/)
tests/budget-whole.cjs all of S.3003-D: schedules opened and closed, checks, the bill window, the clean copy in parts
```

The libraries have no Office dependency, so they run in Node. To try the pane against a real Word, sideload `manifest.xml` as above; to point it at another host, replace `https://raihoheeho.github.io/bill-drafter-word/` in the manifest.

This is a demo by an individual; it is not an official product of any state agency.
