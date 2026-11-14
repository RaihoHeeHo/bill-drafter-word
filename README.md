# Bill Drafter (demo) for Word

A Word add-in that brings parts of the bill drafter into Word:

1. **Amendments from the Bank.** Pick a law and a section from this computer's own copy of the laws (the NY-Law-Exporter JSON files). The add-in writes the amending clause ("Section 12 of the general construction law, as amended by …, is amended to read as follows:") and pastes the law's text. Edit the text like any other text, then **Mark changes**: deleted words go in [brackets], new words are underlined. Also: amend one subdivision, add a new section or subdivision (the next free number is suggested), repeal a section.
2. **Standard sections.** Short title, legislative findings, severability clause and effective date (the desktop drafter's forms and add-ons), each put where the Manual puts it, with the sections renumbered. The title ("AN ACT to amend … in relation to …; and to repeal …") is rebuilt from what the sections do.
3. **Drafting checks.** Title and enacting clause, section numbers, order of the standard sections, effective date last, amending clause form and history, every amended text checked against the Bank (unmarked changes, nothing amended), added sections fully underlined and not already in the law, blanks left in, and style in new matter (gendered words, "said", "must", session-law citations, sums of money, "§" in text, stray brackets).
4. **Akoma Ntoso in LBDC's profile.** Every part that means something is a tagged content control or a Bill Insert / Bill Delete run, so the .docx converts without guessing to Akoma Ntoso 3.0 XML in the shape of LBDC's **AKN-NY profile, version 0.3**: classed front matter and LBDC metadata, laws addressed by their Bank ID alone (`/akn/us-ny/act/consolidated/gcn/~sec_12`), the whole lead-in inside the `mod` with the history linked, New York's unit names (subdivision, or subsection for the Tax and Insurance Laws), renumbered and struck units, and bracket pairs split across units. The output passes the profile's validator. See [FORMAT.md](FORMAT.md). Get it from the pane (**Clean copy > Akoma Ntoso XML**), or `node tools/docx2akn.cjs bill.docx`.

It does **not** try to look like a printed bill: no line numbers, no bill spacing or fonts.

Nothing is installed on the computer and there is no .exe: Word loads the add-in from this site, and the laws stay on the computer.

## Clean copy

**Clean copy > Make the clean copy (PDF)** typesets the bill right in the pane with LBDC's clean-copy template (`clean-copy/bill.typ`, profile 0.3), the one that matches the public PDFs line for line: bold front matter, 72-character lines, 56 lines a page, and words divided only where real prints divide them (`clean-copy/hyphenation.json`). It uses the Typst compiler built for the browser (`vendor/typst`, Typst 0.15.1, the same version as LBDC's desktop demo, so the pane's PDF and the desktop's are identical); nothing is installed and the bill never leaves the computer. See [clean-copy/](clean-copy/README.md); `examples/Example bill - clean copy.pdf` is the example bill printed that way.

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

1. Open the pane (Home > Bill Drafter) and go to the **Bank** tab.
2. **Choose a folder…** and pick the folder with the law files (e.g. `Downloads\NYS Law Library\NY-Law-Exporter\Downloads\<date>`), or **Choose files…** for a few laws. They are kept in Word's storage on this computer; nothing leaves it. Do this again when the Bank is updated.
3. On **Draft**, type what the bill is in relation to and click **Start the bill**.
4. Under **Add a section**, type the law and the section in one box (`GCN 12`, `executive 296`, `tax 606(c)`), press Enter, choose what the bill does, and insert it.
5. Edit the law's text in the document, then press **Mark changes** in the bar at the bottom of the pane.
6. **Check the bill**, then on **Clean copy** fill in the bill information and make the PDF.

## For developers

```
src/lib/drafting.js   wording: amending clauses, title, numbering, boilerplate, effective dates, word diff (Mark changes)
src/lib/bank.js       reading NY-Law-Exporter JSON; IndexedDB storage
src/lib/ooxml.js      writing the content controls and styles; reading .docx XML into a model
src/lib/checks.js     drafting checks
src/lib/laws.js       the laws the profile can address (Bank ID, consolidated or not, subsections)
src/lib/akn.js        model -> Akoma Ntoso 3.0, AKN-NY profile 0.3
src/taskpane.*        the pane (Office.js)
src/cleancopy.js      clean copy PDF in the pane (Typst in WebAssembly + clean-copy/bill.typ)
tools/docx2akn.cjs    command-line converter (same code)
clean-copy/           Typst clean-copy template (from LBDC's demo) for the exported XML
profile/              the AKN-NY profile's validator: schemas and Schematron rules (python3 profile/validate.py x.xml)
tests/unit.cjs        unit tests, including the profile validator on the add-in's output   (npm install && npm test)
tests/flow.cjs        whole flow in Chromium against a Word stand-in (tests/word-mock.js):
                      python3 -m http.server 8123 & node tests/flow.cjs tests/bank-fixture out/
tests/bank-fixture/   three small Bank files for the flow (tests/make-bank-fixture.cjs)
```

The libraries have no Office dependency, so they run in Node. To try the pane against a real Word, sideload `manifest.xml` as above; to point it at another host, replace `https://raihoheeho.github.io/bill-drafter-word/` in the manifest.

This is a demo by an individual; it is not an official product of any state agency.
