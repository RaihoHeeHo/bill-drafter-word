// Budget mode end to end in Chromium with the Word stand-in (tests/word-mock.js).
// python3 -m http.server 8123 &  node tests/budget-flow.cjs <out-dir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const OUT = process.argv[2] || '.';
const must = (ok, what) => { if (!ok) throw new Error('FAILED: ' + what); console.log('  ok:', what); };
(async () => {
  const b = await chromium.launch();
  const page = async () => {
    const p = await b.newPage({ viewport: { width: 380, height: 900 }, acceptDownloads: true });
    p.errors = []; p.on('pageerror', e => p.errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Not made:/.test(m.text())) p.errors.push(m.text()); });
    await p.route('https://appsforoffice.microsoft.com/**', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'word-mock.js'), 'utf8') }));
    await p.goto('http://localhost:8123/taskpane.html'); await p.waitForTimeout(300);
    return p;
  };
  const p = await page();
  const notice = async () => (await p.textContent('#notice')).trim();
  const shot = n => p.screenshot({ path: path.join(OUT, n + '.png') });
  const focusBack = async () => { await p.waitForTimeout(200); await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(700); };

  // Budget mode: open the demo bill
  await p.click('.mode button[data-mode=budget]'); await p.waitForTimeout(400);
  await shot('b0-open');
  must(/S\.3003-D/.test(await p.textContent('#b-samples')), 'the demo bills are offered');
  await p.click('#b-samples .std:first-child button'); await p.waitForFunction(() => /laid out/.test(document.querySelector('#notice').textContent), null, { timeout: 60000 });
  console.log('-', await notice());
  must((await p.evaluate(() => window.__parts.length)) === 2, 'the bill\'s XML is kept in the document (current and as opened)');
  const ccs = await p.evaluate(() => [...window.__mockDoc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'sdt')].length);
  must(ccs > 300, 'the bill is laid out with ' + ccs + ' tagged parts');
  console.log('summary:', await p.textContent('#b-summary'));
  await shot('b1-draft');

  // Check: amounts, last year's chapter, line vetoes
  await p.click('[data-tab=checks]'); await p.waitForFunction(() => document.querySelector('#b-amt-summary').textContent && !document.querySelector('#b-run').disabled, null, { timeout: 30000 });
  console.log('amounts:', await p.textContent('#b-amt-summary'));
  console.log(await p.$$eval('#b-amt li', l => l.map(x => x.className + ' ' + x.textContent.slice(0, 140))));
  must((await p.$$('#b-amt li.error')).length === 6, 'the six print errors of these agencies are found');
  console.log('prior:', await p.textContent('#b-prior .summary'));
  must(/211 reappropriations checked/.test(await p.textContent('#b-prior')), 'every reappropriation is checked against chapter 53 of 2024');
  console.log('vetoes:', await p.textContent('#b-vetoes .summary'));
  must(/3 of 3 vetoes/.test(await p.textContent('#b-vetoes')), 'the three vetoes are placed on their items');
  await p.screenshot({ path: path.join(OUT, 'b2-checks.png'), fullPage: true });
  const [memo] = await Promise.all([p.waitForEvent('download'), p.click('#b-vetoes li button:has-text("Save the memorandum")')]);
  const mf = path.join(OUT, memo.suggestedFilename()); await memo.saveAs(mf);
  must(/name="lineVetoMemo"/.test(fs.readFileSync(mf, 'utf8')), 'a line veto memorandum is saved (' + memo.suggestedFilename() + ')');

  // Edit in the document: an appropriation's amount, a reappropriation's code and original amount, its (re. $)
  const ids = await p.evaluate(() => {
    const B = BD.budget, its = B.items(BUD.S.doc), BW = BD.budgetWord;
    const ap = its.find(i => i.kind === 'appropriation' && i.amount === 15000000), re = its.find(i => i.kind === 'reappropriation' && i.amount === 15000000 && i.reappropriated === 15000000);
    return { ap: BW.tag(ap.eId, 'appropriation'), apId: ap.eId, re: BW.tag(re.eId, 'reappropriation'), reId: re.eId };
  });
  await p.click('[data-tab=draft]'); await p.waitForTimeout(500);
  must(await p.evaluate(t => __typeInTag(t, '15,000,000', '16,250,000'), ids.ap), 'typed a new amount into an appropriation');
  must(await p.evaluate(t => __typeInTag(t, '(34218) ... 15,000,000 (re. $15,000,000)', '(34219) ... 14,000,000 (re. $12,500,000)'), ids.re), 'typed a new code and amounts into a reappropriation');
  await focusBack();
  console.log('dock:', await p.textContent('#b-dock-status'));
  must(/2 items edited/.test(await p.textContent('#b-dock-status')), 'coming back to the pane shows the two edits as not yet in the XML');
  await shot('b3-edited');
  await p.click('#b-mark'); await p.waitForTimeout(800);
  console.log('-', await notice());
  const shown = await p.evaluate(t => { const n = [...__mockDoc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'sdt')].find(s => s.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'tag')[0].getAttribute('w:val') === t); return n.textContent; }, ids.re);
  must(/\[\(34218\)\] \(34219\) \.\.\. \[15,000,000\] 14,000,000 \(re\. \$12,500,000\)/.test(shown), 'the reappropriation reads "[(34218)] (34219) ... [15,000,000] 14,000,000 (re. $12,500,000)" in the document');
  const stored = await p.evaluate(() => window.__parts.find(x => /role="current"/.test(x.xml)).xml);
  must(/<del>15,000,000<\/del> <ins><quantity class="originalAmount" normalized="14000000"/.test(stored), 'the stored XML has the old amount struck and the new one as new matter');
  must(/normalized="16250000"/.test(stored) && !/<del>15,000,000<\/del> <ins><quantity class="amount"/.test(stored), 'the appropriation simply has its new amount');
  console.log('fixes:', await p.textContent('#b-fixes'));
  must(/add up/.test(await p.textContent('#b-fixes')), 'totals that no longer add up are listed');
  await shot('b4-marked');
  await p.click('#b-fixes button'); await p.waitForTimeout(800);
  console.log('-', await notice());
  must(!(await p.textContent('#b-fixes')).trim(), 'after updating, every total adds up');

  // The item at the cursor: add an appropriation after it
  await p.evaluate(t => __selectTag(t), ids.ap); await p.waitForTimeout(700);
  console.log('cursor:', await p.textContent('#b-item-kind'), '|', (await p.textContent('#b-item-what')).slice(0, 100));
  must(!(await p.isHidden('#b-item')), 'the item at the cursor is shown');
  await p.click('#b-add-box summary');
  await p.fill('#b-add-words', 'For services and expenses of apprenticeship programs in the building trades (34218)'); await p.fill('#b-add-amount', '2,000,000');
  await shot('b5-cursor');
  await p.click('#b-add'); await p.waitForTimeout(800);
  console.log('-', await notice());
  must(/needs? updating|Update/.test(await notice()), 'adding an item asks for the totals to be updated');
  await p.click('#b-fixes button'); await p.waitForTimeout(800);

  // Changes since the bill was opened
  await p.click('[data-tab=checks]'); await p.waitForFunction(() => !document.querySelector('#b-run').disabled, null, { timeout: 30000 });
  await p.click('#b-cmp'); await p.waitForSelector('#b-cmp-out .summary', { timeout: 30000 });
  console.log('compare:', await p.textContent('#b-cmp-out .summary'));
  must(/added/.test(await p.textContent('#b-cmp-out')) && /amount/.test(await p.textContent('#b-cmp-out')), 'the comparison lists the added item and the changed amounts');
  await p.screenshot({ path: path.join(OUT, 'b6-compare.png'), fullPage: true });

  // Clean copy after an unmarked edit: the edit is read back and marked first
  await p.click('[data-tab=draft]'); await p.waitForTimeout(400);
  const re2 = await p.evaluate(() => { const its = BD.budget.items(BUD.S.doc); const r = its.filter(i => i.kind === 'reappropriation' && /34235/.test(i.program) === false)[5]; return { tag: BD.budgetWord.tag(r.eId, 'reappropriation'), amount: BD.budget.fmt(r.amount) }; });
  must(await p.evaluate(x => __typeInTag(x.tag, x.amount, '1,234,567'), re2), 'changed a reappropriation\'s original amount without marking it');
  await p.click('[data-tab=export]'); await p.click('#b-pdf');
  await p.waitForFunction(() => /ready|Not made/.test(document.querySelector('#b-pdf-status').textContent + document.querySelector('#notice').textContent), null, { timeout: 120000 });
  console.log('pdf:', await p.textContent('#b-pdf-status'));
  must(/marked first/.test(await p.textContent('#b-pdf-status')), 'the clean copy read the edit back and marked it first');
  const stored2 = await p.evaluate(() => window.__parts.find(x => /role="current"/.test(x.xml)).xml);
  must(new RegExp('<del>' + re2.amount + '</del> <ins><quantity class="originalAmount" normalized="1234567"').test(stored2), 'the unmarked edit is in the XML as [old] new');
  const [pdf] = await Promise.all([p.waitForEvent('download'), p.click('#b-pdf-save')]);
  const pf = path.join(OUT, pdf.suggestedFilename()); await pdf.saveAs(pf);
  must(fs.readFileSync(pf).slice(0, 5).toString() === '%PDF-', 'the clean copy is saved as a PDF (' + pdf.suggestedFilename() + ')');
  await shot('b7-cleancopy');

  // The pane opened again on the same document finds the bill in it
  await p.evaluate(async () => { BUD.S.doc = null; BUD.S.opened = null; BUD.S.parts = {}; await BUD.refresh(); });
  must(/S\.3003-D/.test(await p.textContent('#b-title')), 'reopening the pane loads the bill from the document');

  // The other demo bill: S.3000-D against the C print
  const q = await page();
  await q.click('.mode button[data-mode=budget]'); await q.waitForTimeout(400);
  await q.click('#b-samples .std:nth-child(2) button'); await q.waitForFunction(() => /laid out/.test(document.querySelector('#notice').textContent), null, { timeout: 60000 });
  await q.click('[data-tab=checks]'); await q.waitForFunction(() => document.querySelector('#b-amt-summary').textContent && !document.querySelector('#b-run').disabled, null, { timeout: 30000 });
  await q.selectOption('#b-cmp-with', 'sample'); await q.click('#b-cmp'); await q.waitForSelector('#b-cmp-out .summary', { timeout: 30000 });
  console.log('C to D:', await q.textContent('#b-cmp-out .summary'));
  must(/2 added/.test(await q.textContent('#b-cmp-out')), 'S.3000-C to D: the two items added in the D print');
  console.log('errors', p.errors, q.errors);
  await b.close();
  if (p.errors.length || q.errors.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
