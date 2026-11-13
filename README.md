# Bill Drafter (demo) for Word

A Word add-in that brings parts of the bill drafter into Word:

1. **Amendments from the Bank.** Pick a law and a section from this computer's own copy of the laws (the NY-Law-Exporter JSON files). The add-in writes the amending clause ("Section 12 of the general construction law, as amended by …, is amended to read as follows:") and pastes the law's text. Edit the text like any other text, then **Mark changes**: deleted words go in [brackets], new words are underlined. Also: amend one subdivision, add a new section or subdivision (the next free number is suggested), repeal a section.
2. **Standard sections.** Short title, legislative findings, severability clause and effective date (the desktop drafter's forms and add-ons), each put where the Manual puts it, with the sections renumbered. The title ("AN ACT to amend … in relation to …; and to repeal …") is rebuilt from what the sections do.
3. **Drafting checks.** Title and enacting clause, section numbers, order of the standard sections, effective date last, amending clause form and history, every amended text checked against the Bank (unmarked changes, nothing amended), added sections fully underlined and not already in the law, blanks left in, and style in new matter (gendered words, "said", "must", session-law citations, sums of money, "§" in text, stray brackets).
4. **A standard format for Akoma Ntoso.** Every part that means something is a tagged content control or a Bill Insert / Bill Delete run, so the .docx converts to Akoma Ntoso 3.0 XML without guessing. See [FORMAT.md](FORMAT.md). Export from the task pane, or `node tools/docx2akn.cjs bill.docx`.

It does **not** try to look like a printed bill: no line numbers, no bill spacing or fonts.

Nothing is installed on the computer and there is no .exe: Word loads the add-in from this site, and the laws stay on the computer.

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

1. Open the pane (Home > Bill Drafter) and go to the **Bank** tab.
2. **Choose a folder…** and pick the folder with the law files (e.g. `Downloads\NYS Law Library\NY-Law-Exporter\Downloads\<date>`), or **Choose files…** for a few laws. They are kept in Word's storage on this computer; nothing leaves it. Do this again when the Bank is updated.
3. On **Draft**, type what the bill is in relation to and click **New bill**.

## For developers

```
src/lib/drafting.js   wording: amending clauses, title, numbering, boilerplate, effective dates, word diff (Mark changes)
src/lib/bank.js       reading NY-Law-Exporter JSON; IndexedDB storage
src/lib/ooxml.js      writing the content controls and styles; reading .docx XML into a model
src/lib/checks.js     drafting checks
src/lib/akn.js        model -> Akoma Ntoso 3.0
src/taskpane.*        the pane (Office.js)
tools/docx2akn.cjs    command-line converter (same code)
tests/unit.cjs        unit tests          (npm install && npm test)
tests/flow.cjs        whole flow in Chromium against a Word stand-in (tests/word-mock.js)
```

The libraries have no Office dependency, so they run in Node. To try the pane against a real Word, sideload `manifest.xml` as above; to point it at another host, replace `https://raihoheeho.github.io/bill-drafter-word/` in the manifest.

This is a demo by an individual; it is not an official product of any state agency.
