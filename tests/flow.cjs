// End-to-end flow in Chromium with the Word stand-in (tests/word-mock.js) and real Bank files.
// node tests/flow.cjs <bank-dir> <out-dir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const BANK = process.argv[2], OUT = process.argv[3] || '.';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 380, height: 900 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Not made:/.test(m.text())) errors.push(m.text()); });
  await p.route('https://appsforoffice.microsoft.com/**', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'word-mock.js'), 'utf8') }));
  await p.goto('http://localhost:8123/taskpane.html');
  await p.waitForTimeout(300); await p.screenshot({ path: OUT + '/0-start.png' });
  const notice = async () => (await p.textContent('#notice')).trim();
  const step = async (label, fn) => { await fn(); await p.waitForTimeout(150); console.log('-', label, '|', await notice()); };
  await step('bank', async () => { await p.click('#bank-btn'); await p.setInputFiles('#bank-files', fs.readdirSync(BANK).map(f => path.join(BANK, f))); await p.waitForFunction(() => /Loaded/.test(document.querySelector('#notice').textContent), null, { timeout: 60000 }); });
  await p.screenshot({ path: OUT + '/1-bank.png' });
  await p.click('#bank-back');
  await p.screenshot({ path: OUT + '/1b-no-bill.png' });
  await step('new bill', async () => { await p.fill('#nb-subject', 'affidavits'); await p.click('#nb-go'); });
  // One box: the law and the section ("GCN 12"); the first result is picked with Enter.
  const amend = async (law, q, act, extra) => {
    await p.fill('#sec-q', law + ' ' + q); await p.waitForTimeout(400);
    if (law === 'executive') await p.screenshot({ path: OUT + '/2a-search.png' });
    await p.press('#sec-q', 'Enter'); await p.waitForTimeout(100);
    // A new pick never keeps the last section's choice.
    const def = await p.$eval('input[name=act]:checked', r => r.value);
    if (law === 'GCN' && q === '12' || law === 'ISC') if (def !== (q.includes('(') ? 'amendSub' : 'amend')) throw new Error('pick started at ' + def);
    await p.check('input[name=act][value=' + act + ']');
    if (extra) await extra();
    console.log('  button:', await p.textContent('#insert-amend'));
    await p.click('#insert-amend'); await p.waitForTimeout(200);
  };
  await step('amend GCN 12', () => amend('GCN', '12', 'amend', () => p.fill('#history', 'as amended by chapter 300 of the laws of 1990')));
  await p.screenshot({ path: OUT + '/2-amend.png', fullPage: false });
  await step('amend EXC 296 subd 1', () => amend('executive', '296(1)', 'amendSub', () => p.fill('#history', '')));
  await step('add GCN 12-a', () => amend('GCN', '12-a', 'add'));
  await step('repeal EDN 2-d', () => amend('EDN', '2-d', 'repeal'));
  // The drafter edits the law's text in the document.
  console.log('typed', await p.evaluate(() => [
    __typeInLaw('sworn to before any officer', 'sworn to before any notary public or officer'),
    __typeInLaw(' unless a particular officer is specified before', ' unless a particular officer, other than a notary public, is specified before'),
    __typeInLaw('§ 12-a. ____. ____', '§ 12-a. Electronic affidavit. An affidavit may be sworn to by electronic means where he or she appears by video.'),
    __typeInLaw('sexual orientation, gender identity', 'sexual orientation, height, weight, gender identity'),
    __typeInLaw('employ or to bar or to discharge', 'employ or to discharge'),
  ]));
  // The drafter comes back to the pane from the document: the list shows what is not marked yet.
  await p.waitForTimeout(1600); await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(600);
  console.log('dock:', await p.textContent('#dock-status'));
  console.log('chips:', await p.$$eval('#outline li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim())));
  if (!/not yet bracketed/.test(await p.textContent('#dock-status'))) throw new Error('coming back to the pane did not show the unmarked edits');
  await p.screenshot({ path: OUT + '/2d-unmarked.png' });
  await step('mark changes', () => p.click('#mark'));
  console.log('dock:', await p.textContent('#dock-status'));
  // A table: amend Insurance Law § 4103(a), then edit its table in the pane's editor.
  await step('amend ISC 4103(a)', () => amend('ISC', '4103(a)', 'amendSub'));
  console.log('tables:', await p.$$eval('#table-list li', l => l.map(x => x.textContent)));
  await step('open table editor', async () => { await p.click('#tables-card summary'); await p.click('#table-list li button'); await p.waitForTimeout(200); });
  await p.screenshot({ path: OUT + '/2b-table-editor.png', fullPage: false });
  const cell = (r, c) => '#te-grid textarea[aria-label="Row ' + r + ', column ' + c + '"]';
  await p.fill(cell(4, 2), '$400,000');                                   // change an amount
  await p.click('#te-grid tr:nth-child(7) td.tools button:nth-of-type(3)'); // delete the row "22" (row 6)
  await p.click('#te-grid tr:nth-child(6) td.tools button:nth-of-type(2)'); // add a row below "13 or 15"
  await p.fill(cell(6, 1), '23'); await p.fill(cell(6, 2), '$750,000'); await p.fill(cell(6, 3), '$375,000');
  await p.screenshot({ path: OUT + '/2c-table-edited.png', fullPage: false });
  await step('save table', async () => { await p.click('#te-save'); await p.waitForTimeout(400); });
  await p.click('#seg-std');
  await step('short title', async () => { await p.fill('#st-name', 'affidavit modernization act'); await p.click('#add-short'); });
  await step('severability', () => p.click('#add-sev'));
  await step('effective', async () => { await p.selectOption('#eff-form', { index: 2 }); await p.click('.std.col summary'); await p.check('#eff-addons input[value=rules]'); console.log('  preview:', await p.textContent('#eff-preview')); await p.click('#add-eff'); });
  await step('title', async () => { await p.fill('#subject', 'affidavits and unlawful discriminatory practices'); await p.press('#subject', 'Enter'); await p.waitForTimeout(300); });
  await p.screenshot({ path: OUT + '/3-draft.png', fullPage: true });
  await step('checks (run on opening the tab)', () => p.click('#dock-check')); await p.waitForTimeout(500);
  console.log('summary:', await p.textContent('#check-summary'));
  console.log(await p.$$eval('#findings li', l => l.map(x => x.className + ' ' + x.textContent)));
  // The History finding's button goes to the section; the drafter types the history and puts it in.
  await step('history fix', async () => { await p.click('#findings li.warning:has-text("History") button:has-text("Add history")'); });
  await p.screenshot({ path: OUT + '/3b-history-row.png' });
  await step('history apply', async () => { await p.fill('#outline li.open input', 'chapter 55 of the laws of 2023'); await p.click('#outline li.open button:has-text("Put it in")'); });
  console.log('chips:', await p.$$eval('#outline li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim())));
  await step('checks again', () => p.click('[data-tab=checks]')); await p.waitForTimeout(500);
  console.log('summary:', await p.textContent('#check-summary'));
  console.log(await p.$$eval('#findings li', l => l.map(x => x.className + ' ' + x.textContent)));
  await p.screenshot({ path: OUT + '/4-checks.png', fullPage: true });
  await p.click('[data-tab=export]'); await p.fill('#lbd', '12345-01-6'); await p.fill('#sponsor', 'SMITH'); await p.fill('#committee', 'Judiciary');
  console.log('summary (draft):', await p.textContent('#info-summary'));
  await p.fill('#billno', '1234'); await p.fill('#bdate', '2025-01-15'); await p.waitForTimeout(800);
  console.log('summary:', await p.textContent('#info-summary'));
  await p.click('#akn-card summary'); await step('akn', () => p.click('#to-akn'));
  fs.writeFileSync(OUT + '/bill.akn.xml', await p.inputValue('#akn-out'));
  await step('clean copy', async () => { await p.click('#to-pdf'); await p.waitForFunction(() => /ready|could not/.test(document.querySelector('#pdf-status').textContent + document.querySelector('#notice').textContent), null, { timeout: 120000 }); });
  console.log('pdf status:', await p.textContent('#pdf-status'));
  const b64 = await p.evaluate(async () => { const r = await fetch(pdfUrl); const u = new Uint8Array(await r.arrayBuffer()); let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s); });
  fs.writeFileSync(OUT + '/clean-copy.pdf', Buffer.from(b64, 'base64'));
  await step('save the clean copy', async () => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#pdf-save')]);
    const f = OUT + '/' + dl.suggestedFilename(); await dl.saveAs(f);
    const head = fs.readFileSync(f).slice(0, 5).toString();
    if (head !== '%PDF-') throw new Error('the saved file is not a PDF: ' + f);
    console.log('saved:', dl.suggestedFilename(), fs.statSync(f).size, 'bytes');
  });
  await step('save the XML', async () => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#akn-save')]);
    const f = OUT + '/' + dl.suggestedFilename(); await dl.saveAs(f);
    console.log('saved:', dl.suggestedFilename(), fs.statSync(f).size, 'bytes');
  });
  await p.screenshot({ path: OUT + '/5-export.png', fullPage: true });
  fs.writeFileSync(OUT + '/document.xml', await p.evaluate(() => __docXml()));
  // Nothing leaves unmarked: words taken out of the law in the document, without Mark changes, still come out
  // bracketed in the clean copy's XML.
  await p.click('[data-tab=draft]');
  console.log('typed unmarked:', await p.evaluate(() => __typeInLaw('the acknowledgment of deeds in this state', 'the acknowledgment of deeds')));
  await p.click('[data-tab=export]');
  await step('clean copy after an unmarked edit', async () => { await p.click('#to-pdf'); await p.waitForFunction(() => /ready|Not made/.test(document.querySelector('#pdf-status').textContent + document.querySelector('#notice').textContent), null, { timeout: 120000 }); });
  console.log('pdf status:', await p.textContent('#pdf-status'));
  const xml2 = await p.inputValue('#akn-out');
  if (!/<del>[^<]*in this state[^<]*<\/del>/.test(xml2)) throw new Error('the clean copy left an unmarked change: ' + (xml2.match(/.{80}acknowledgment of deeds.{60}/) || [''])[0]);
  console.log('marked before the clean copy:', (xml2.match(/.{30}<del>[^<]*in this state[^<]*<\/del>.{10}/) || [''])[0]);
  // Several people: an examiner's tracked change is a suggestion. Mark changes leaves its section alone, no clean
  // copy is made while it waits, and the XML (a working copy) needs everyone's review role.
  await p.click('[data-tab=draft]');
  console.log('suggested:', await p.evaluate(() => __suggestInLaw('When an affidavit is authorized', 'commissioner of deeds or ', 'Lee Smith')));
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(600);
  await step('mark changes with a suggestion waiting', () => p.click('#mark'));
  if (!/suggested changes wait/.test(await notice())) throw new Error('Mark changes did not leave the section with a suggestion alone');
  await p.click('[data-tab=export]');
  await step('clean copy with a suggestion waiting', async () => { await p.click('#to-pdf'); await p.waitForTimeout(800); });
  if (!/Not made: 1 suggested change/.test(await p.textContent('#pdf-status'))) throw new Error('a clean copy was made with a suggestion waiting');
  if (await p.isHidden('#people-card')) throw new Error('the People card is not shown');
  await step('XML without a role', () => p.click('#to-akn'));
  if (!/give a review role to Lee Smith/.test(await notice())) throw new Error('the working copy was made without review roles');
  await p.selectOption('#people select', 'examiner'); await p.waitForTimeout(300);
  await step('XML: a working copy', () => p.click('#to-akn'));
  const wc = await p.inputValue('#akn-out');
  if (!/<lbdc:working status="drafting">/.test(wc) || !/lbdc:suggest="insert" lbdc:by="#staff-lee-smith"[^>]*>commissioner of deeds or ?<\/span>/.test(wc)) throw new Error('no working copy: ' + (wc.match(/.{60}commissioner.{40}/) || [''])[0]);
  fs.writeFileSync(OUT + '/working-copy.akn.xml', wc);
  await p.screenshot({ path: OUT + '/5b-people.png', fullPage: true });
  console.log('accepted:', await p.evaluate(() => { __acceptAll(); return true; }));
  await step('clean copy once it is accepted', async () => { await p.click('#to-pdf'); await p.waitForFunction(() => /ready|Not made/.test(document.querySelector('#pdf-status').textContent + document.querySelector('#notice').textContent), null, { timeout: 120000 }); });
  console.log('pdf status:', await p.textContent('#pdf-status'));
  if (!/<ins>[^<]*commissioner of deeds/.test(await p.inputValue('#akn-out')) && !/commissioner of deeds[^<]*<\/ins>/.test(await p.inputValue('#akn-out'))) throw new Error('the accepted suggestion was not marked as new matter: ' + ((await p.inputValue('#akn-out')).match(/.{80}commissioner.{40}/) || [''])[0]);
  // The drafter deletes a section in the document: back in the pane, the list offers to renumber.
  await p.click('[data-tab=draft]');
  await p.evaluate(() => { const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const secs = [...__mockDoc.getElementsByTagNameNS(W, 'sdt')].filter(n => { const t = n.getElementsByTagNameNS(W, 'tag')[0]; return t && /^akn:section/.test(t.getAttribute('w:val')); });
    const n = secs[2]; (n.parentNode.localName === 'p' ? n.parentNode : n).remove(); });
  await p.waitForTimeout(1600); await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(600);
  const fixes = await p.textContent('#bill-fixes'); console.log('after deleting a section:', fixes);
  if (!/not numbered in order/.test(fixes)) throw new Error('no renumber offer after deleting a section');
  await p.screenshot({ path: OUT + '/6-renumber.png' });
  await step('renumber', () => p.click('#bill-fixes button:has-text("Renumber")')); await p.waitForTimeout(300);
  console.log('after renumbering:', JSON.stringify(await p.textContent('#bill-fixes')), await p.$$eval('#outline .n', l => l.map(x => x.textContent).join(' ')));
  // A section whose law isn't in the Bank can't be checked, so no clean copy is made.
  await p.click('#bank-btn'); await p.click('#bank-clear'); await p.click('#bank-clear'); await p.waitForTimeout(300);
  await p.click('[data-tab=export]'); await p.click('#to-pdf'); await p.waitForTimeout(800);
  const refused = await p.textContent('#notice'); console.log('without the Bank:', refused.slice(0, 220));
  if (!/Not made/.test(refused)) throw new Error('a clean copy was made with sections that cannot be checked against the Bank');
  console.log('ops', await p.evaluate(() => __ops.join(', ')));
  console.log('errors', errors);
  await b.close();
})();
