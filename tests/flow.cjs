// End-to-end flow in Chromium with the Word stand-in (tests/word-mock.js) and real Bank files.
// node tests/flow.cjs <bank-dir> <out-dir>
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const BANK = process.argv[2], OUT = process.argv[3] || '.';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 380, height: 900 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.route('https://appsforoffice.microsoft.com/**', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'word-mock.js'), 'utf8') }));
  await p.goto('http://localhost:8123/taskpane.html');
  const notice = async () => (await p.textContent('#notice')).trim();
  const step = async (label, fn) => { await fn(); await p.waitForTimeout(150); console.log('-', label, '|', await notice()); };
  await step('bank', async () => { await p.click('[data-tab=bank]'); await p.setInputFiles('#bank-files', fs.readdirSync(BANK).map(f => path.join(BANK, f))); await p.waitForFunction(() => /Loaded/.test(document.querySelector('#notice').textContent), null, { timeout: 60000 }); });
  await p.screenshot({ path: OUT + '/1-bank.png' });
  await p.click('[data-tab=draft]');
  await step('new bill', async () => { await p.fill('#nb-subject', 'affidavits'); await p.click('#nb-go'); });
  const amend = async (law, q, act, extra) => {
    await p.fill('#law-filter', law); await p.waitForTimeout(100);
    await p.selectOption('#law', law); await p.dispatchEvent('#law', 'change'); await p.waitForTimeout(100);
    await p.fill('#sec-q', q); await p.waitForTimeout(300);
    if (act !== 'add') await p.click('#sec-results li >> nth=0');
    await p.check('input[name=act][value=' + act + ']');
    if (extra) await extra();
    await p.click('#insert-amend'); await p.waitForTimeout(200);
  };
  await step('amend GCN 12', () => amend('GCN', '12', 'amend', () => p.fill('#history', 'as amended by chapter 300 of the laws of 1990')));
  await p.screenshot({ path: OUT + '/2-amend.png', fullPage: false });
  await step('amend EXC 296 subd 1', () => amend('EXC', '296', 'amendSub', () => p.fill('#history', '')));
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
  await step('mark changes', () => p.click('#mark'));
  await step('short title', async () => { await p.fill('#st-name', 'affidavit modernization act'); await p.click('#add-short'); });
  await step('severability', () => p.click('#add-sev'));
  await step('effective', async () => { await p.selectOption('#eff-form', { index: 2 }); await p.check('#eff-addons input[value=rules]'); await p.click('#add-eff'); });
  await step('title', async () => { await p.fill('#subject', 'affidavits and unlawful discriminatory practices'); await p.click('#title-update'); });
  await p.screenshot({ path: OUT + '/3-draft.png', fullPage: true });
  await p.click('[data-tab=checks]'); await step('checks', () => p.click('#run-checks')); await p.waitForTimeout(300);
  console.log(await p.$$eval('#findings li', l => l.map(x => x.className + ' ' + x.textContent)));
  await p.screenshot({ path: OUT + '/4-checks.png', fullPage: true });
  await p.click('[data-tab=export]'); await p.fill('#lbd', '12345-01-6'); await step('akn', () => p.click('#to-akn'));
  fs.writeFileSync(OUT + '/bill.akn.xml', await p.inputValue('#akn-out'));
  await p.screenshot({ path: OUT + '/5-export.png' });
  fs.writeFileSync(OUT + '/document.xml', await p.evaluate(() => __docXml()));
  console.log('ops', await p.evaluate(() => __ops.join(', ')));
  console.log('errors', errors);
  await b.close();
})();
