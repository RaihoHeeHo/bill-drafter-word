// A whole budget bill (all of S.3003-D, 1,518 pages) in Chromium with the Word stand-in: the working set of
// schedules, the checks on the whole bill, the bill window, and the clean copy in parts.
// python3 -m http.server 8123 &  node tests/budget-whole.cjs <out-dir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const OUT = process.argv[2] || '.';
const must = (ok, what) => { if (!ok) throw new Error('FAILED: ' + what); console.log('  ok:', what); };
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 380, height: 900 }, acceptDownloads: true });
  await ctx.route('https://appsforoffice.microsoft.com/**', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'word-mock.js'), 'utf8') }));
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('http://localhost:8123/taskpane.html'); await p.waitForTimeout(300);
  const notice = async () => (await p.textContent('#notice')).trim();
  const controls = () => p.evaluate(W => [...__mockDoc.getElementsByTagNameNS(W, 'sdt')].map(s => s.getElementsByTagNameNS(W, 'tag')[0].getAttribute('w:val')), W);
  const t = async (label, fn) => { const t0 = Date.now(); const r = await fn(); console.log('  [' + label + ': ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s]'); return r; };

  // Open the whole bill: every schedule checked, none laid out
  await p.click('.mode button[data-mode=budget]'); await p.waitForTimeout(400);
  must(/the whole bill/.test(await p.textContent('#b-samples')), 'the whole bill is offered');
  await t('open the whole bill', async () => { await p.click('#b-samples .std:nth-child(2) button'); await p.waitForFunction(() => /opened:/.test(document.querySelector('#notice').textContent), null, { timeout: 180000 }); });
  console.log('-', await notice());
  console.log('summary:', await p.textContent('#b-summary'));
  must((await controls()).length === 1, 'only the bill\'s front is laid out in the document');
  must((await p.$$('#b-outline > li')).length === 98, 'all 98 schedules are listed');
  console.log('badge:', await p.textContent('#check-count'));
  await p.screenshot({ path: path.join(OUT, 'w1-whole.png') });

  // Open the Department of Labor's reappropriations into the document
  await p.fill('#b-filter', 'labor'); await p.waitForTimeout(700);
  must((await p.$$('#b-outline > li')).length === 2, 'finding a schedule by name');
  await t('open a schedule', async () => { await p.click('#b-outline > li:nth-child(2) .chips button:has-text("Open")'); await p.waitForFunction(() => /Opened in the document/.test(document.querySelector('#notice').textContent), null, { timeout: 60000 }); });
  console.log('-', await notice());
  const tags = await controls();
  must(tags.some(x => /k=schedule$/.test(x)) && tags.length > 200, 'the schedule is laid out (' + tags.length + ' tagged parts)');
  await p.screenshot({ path: path.join(OUT, 'w2-open.png') });

  // Edit a reappropriation in it, then close the schedule: the edit goes into the XML first
  const re = await p.evaluate(() => { const r = BD.budget.items(BUD.S.doc).find(i => i.eId.startsWith('sec_1__agency_48__') && i.kind === 'reappropriation' && i.amount === 15000000 && i.reappropriated === 15000000); return { tag: BD.budgetWord.tag(r.eId, 'reappropriation'), eId: r.eId }; });
  must(await p.evaluate(x => __typeInTag(x, '... 15,000,000 (re. $15,000,000)', '... 14,000,000 (re. $12,500,000)'), re.tag), 'typed a new amount into a reappropriation');
  await p.waitForTimeout(300); await t('come back to the pane', async () => { await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForFunction(() => /1 item edited/.test(document.querySelector('#b-dock-status').textContent), null, { timeout: 30000 }); });
  must(true, 'the edit shows as not yet in the XML');
  await t('close the schedule', async () => { await p.click('#b-outline > li:nth-child(2) .chips button:has-text("Close")'); await p.waitForFunction(() => /Closed:/.test(document.querySelector('#notice').textContent), null, { timeout: 60000 }); });
  console.log('-', await notice());
  must((await controls()).length === 1, 'the schedule is out of the document');
  const shown = await p.evaluate(id => BD.budgetWord.shownText(BD.budget._.byEId(BUD.S.doc, id)), re.eId);
  must(/\[15,000,000\] 14,000,000 \(re\. \$12,500,000\)$/.test(shown), 'its edit is in the bill\'s XML, marked: ' + shown.slice(-50));
  console.log('summary:', await p.textContent('#b-summary'));
  must(/1 change since it was opened/.test(await p.textContent('#b-summary')), 'the change is counted against the bill as opened');

  // Check: the whole bill
  await p.fill('#b-filter', ''); await p.waitForTimeout(500);
  await t('Check tab, the whole bill', async () => { await p.click('[data-tab=checks]'); await p.waitForFunction(() => document.querySelector('#b-amt-summary').textContent && !document.querySelector('#b-run').disabled, null, { timeout: 120000 }); });
  console.log('amounts:', await p.textContent('#b-amt-summary'));
  console.log('prior:', await p.textContent('#b-prior .summary'));
  console.log('vetoes:', await p.textContent('#b-vetoes .summary'));
  must(/6,720 reappropriations checked/.test(await p.textContent('#b-prior')), 'every reappropriation in the bill is checked against chapter 53 of 2024');
  must(/24 of 24 vetoes/.test(await p.textContent('#b-vetoes')), 'all 24 vetoes are placed on their items');
  await p.screenshot({ path: path.join(OUT, 'w3-checks.png'), fullPage: false });

  // The bill window: search the whole bill, open what is found into Word
  await p.click('[data-tab=draft]'); await p.waitForTimeout(500);
  const [w] = await Promise.all([ctx.waitForEvent('page'), p.click('#b-window')]);
  await w.setViewportSize({ width: 1100, height: 850 });
  await w.waitForFunction(() => document.querySelectorAll('#w-list li').length === 98, null, { timeout: 60000 });
  must(true, 'the bill window lists all 98 schedules');
  console.log('window:', await w.textContent('#w-status'));
  await w.screenshot({ path: path.join(OUT, 'w4-window.png') });
  await w.fill('#w-search', 'Yonkers'); await w.waitForSelector('#w-results .hit', { timeout: 20000 });
  console.log('search:', (await w.textContent('#w-results .rhead')).trim());
  await w.screenshot({ path: path.join(OUT, 'w5-search.png') });
  await w.click('#w-results .hit'); await w.waitForTimeout(500);
  const which = await w.textContent('#w-name');
  console.log('found in:', which, '|', (await w.textContent('#w-sel-what')).slice(0, 100));
  await w.screenshot({ path: path.join(OUT, 'w6-found.png') });
  await w.click('#w-sel-go');
  await p.waitForFunction(() => /Opened in the document/.test(document.querySelector('#notice').textContent), null, { timeout: 60000 });
  console.log('- pane:', await notice());
  must((await controls()).some(x => /k=schedule$/.test(x)), 'Go to in Word opened that schedule in the document');
  await w.waitForFunction(() => /1 open in Word/.test(document.querySelector('#w-status').textContent), null, { timeout: 10000 });
  must(true, 'the window shows the schedule as open in Word');
  await p.screenshot({ path: path.join(OUT, 'w7-pane-after-window.png') });

  // The clean copy of the whole bill, in parts
  await p.click('[data-tab=export]'); await p.$eval('#b-pdf', b => b.click());
  await t('clean copy of the whole bill', async () => { await p.waitForFunction(() => /ready|Not made|could not/.test(document.querySelector('#b-pdf-status').textContent + document.querySelector('#notice').textContent), null, { timeout: 600000 }); });
  console.log('pdf:', await p.textContent('#b-pdf-status'));
  must(!/could not|Not made/.test(await p.textContent('#notice')), 'no error making the clean copy');
  const [pdf] = await Promise.all([p.waitForEvent('download'), p.click('#b-pdf-save')]);
  const pf = path.join(OUT, pdf.suggestedFilename()); await pdf.saveAs(pf);
  const pages = +(/Pages:\s+(\d+)/.exec(cp.execFileSync('pdfinfo', [pf]).toString()) || [])[1];
  must(pages === 1518, 'the clean copy has all ' + pages + ' pages');
  const txt = cp.execFileSync('pdftotext', ['-layout', pf, '-'], { maxBuffer: 1 << 28 }).toString();
  must(/\[15,000,000\] 14,000,000 \.+ \(re\. \$12,500,000\)/.test(txt), 'the edit made earlier is in the clean copy, marked');
  console.log('errors', errors);
  await b.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
