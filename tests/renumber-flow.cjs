// Renumbering in the pane, end to end, in Chromium with the Word stand-in (tests/word-mock.js) and the Bank fixture.
//   node tests/renumber-flow.cjs <bank-dir> <out-dir>      (serve the repo on :8123 first)
// 1. Amend Executive Law § 296(1), take out paragraph (b) and letter the rest up: Mark changes strikes (b) whole and
//    marks "[(c)] (b)" …; the XML records each move as a renumbering from the old address to the new.
// 2. Renumber § 296 subdivision 2 as 3 and add a new subdivision 2 (Draft tab).
// 3. Renumber General Construction Law § 13 as § 12 (taken: the checker says so), then as § 13-a.
// The XML passes the profile's validator.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const BANK = process.argv[2], OUT = process.argv[3] || '.';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 380, height: 900 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.route('https://appsforoffice.microsoft.com/**', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'word-mock.js'), 'utf8') }));
  await p.goto('http://localhost:8123/taskpane.html'); await p.waitForTimeout(300);
  const notice = async () => (await p.textContent('#notice')).trim();
  const step = async (label, fn) => { await fn(); await p.waitForTimeout(150); console.log('-', label, '|', await notice()); };
  const fail = m => { throw new Error(m); };
  await step('bank', async () => { await p.click('#bank-btn'); await p.setInputFiles('#bank-files', fs.readdirSync(BANK).map(f => path.join(BANK, f))); await p.waitForFunction(() => /Loaded/.test(document.querySelector('#notice').textContent), null, { timeout: 60000 }); });
  await p.click('#bank-back');
  await step('new bill', async () => { await p.fill('#nb-subject', 'unlawful discriminatory practices'); await p.click('#nb-go'); });
  const pickSec = async (q) => { await p.fill('#sec-q', q); await p.waitForTimeout(400); await p.press('#sec-q', 'Enter'); await p.waitForTimeout(100); };
  const insert = async () => { console.log('  button:', await p.textContent('#insert-amend')); await p.click('#insert-amend'); await p.waitForTimeout(250); };

  // 1. paragraphs lettered up inside an amended text
  await step('amend EXC 296(1)', async () => { await pickSec('executive 296(1)'); await p.check('input[name=act][value=amendSub]'); await p.fill('#history', 'as amended by chapter 75 of the laws of 2024'); await insert(); });
  const typed = await p.evaluate(() => {
    const out = [__emptyParaWith('(b) For an employment agency')];
    for (const [a, z] of [['c', 'b'], ['d', 'c'], ['e', 'd'], ['f', 'e'], ['g', 'f'], ['h', 'g']]) out.push(__typeInLaw('(' + a + ') For', '(' + z + ') For') || __typeInLaw('(' + a + ') Nothing', '(' + z + ') Nothing'));
    return out;
  });
  console.log('typed', typed);
  await step('mark changes', () => p.click('#mark'));

  // 2. a renumbering section that adds a subdivision
  await step('renumber EXC 296 subd 2 as 3, add 2', async () => {
    await pickSec('executive 296'); await p.check('input[name=act][value=renumber]');
    await p.fill('#rn-from', '2'); await p.fill('#rn-to', '3'); await p.check('#rn-add-on'); await p.fill('#rn-add', '2');
    await p.fill('#history', 'as amended by chapter 75 of the laws of 2024');
    await (await p.$('#action')).screenshot({ path: OUT + '/r0-form.png' }); await insert();
  });
  await p.evaluate(() => __typeInLaw('2. ____', '2. A new subdivision for tests.'));
  await step('mark changes again', () => p.click('#mark'));

  // 3. a section renumbered: a taken number first
  await step('renumber GCN 13 as 12', async () => { await pickSec('GCN 13'); await p.check('input[name=act][value=renumberSec]'); await p.fill('#rn-sec', '12'); await p.fill('#history', 'as added by chapter 100 of the laws of 1990'); await insert(); });
  await p.click('[data-tab=checks]'); await p.waitForTimeout(800);
  const found = await p.$$eval('#findings li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  console.log('findings:', found.filter(f => /renumber|Already|Section 12|subdivision/i.test(f)));
  if (!found.some(f => /Section 12 is already in the general construction law/.test(f))) fail('a renumbering onto a section the law already has was not caught');
  if (found.some(f => /subdivision.*already in the law and stays|still has a subdivision/i.test(f))) fail('a sound renumbering was flagged: ' + found.join(' | '));
  await p.screenshot({ path: OUT + '/r1-check.png', fullPage: true });
  // fix it: the clause is the record, so retype the new number in it
  await step('fix: § 13-a', () => p.evaluate(() => __typeInLaw('is renumbered section 12.', 'is renumbered section 13-a.')));
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(800);
  await p.click('[data-tab=checks]'); await p.waitForTimeout(800);
  const found2 = await p.$$eval('#findings li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  if (found2.some(f => /already in/i.test(f))) fail('still flagged after the fix: ' + found2.join(' | '));

  // the outline and the XML
  await p.click('[data-tab=draft]'); await p.waitForTimeout(300);
  console.log('outline:', await p.$$eval('#outline li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim())));
  await p.screenshot({ path: OUT + '/r2-draft.png', fullPage: true });
  await p.click('[data-tab=export]'); await p.fill('#lbd', '12345-01-6'); await p.click('#akn-card summary'); await step('akn', () => p.click('#to-akn'));
  const xml = await p.inputValue('#akn-out'); fs.writeFileSync(OUT + '/renumber.akn.xml', xml);
  const mods = (xml.match(/<textualMod [^>]*type="renumbering">[\s\S]*?<\/textualMod>/g) || []).map(t => t.replace(/<source[^>]*>/, '').replace(/\/akn\/us-ny\/act\/consolidated\//g, '').replace(/<\/?textualMod[^>]*>/g, '').replace(/<(destination|new) href="([^"]+)"\/>/g, '$1 $2 '));
  console.log('renumberings:\n  ' + mods.join('\n  '));
  const want = ['exc/~sec_296__subdvs_1__para_c new exc/~sec_296__subdvs_1__para_b', 'exc/~sec_296__subdvs_1__para_h new exc/~sec_296__subdvs_1__para_g', 'exc/~sec_296__subdvs_2 new exc/~sec_296__subdvs_3', 'gcn/~sec_13 new gcn/~sec_13-a'];
  for (const w of want) if (!mods.some(m => m.includes(w))) fail('missing renumbering ' + w);
  if (!/\[\(b\) For an employment agency|<del[^>]*>\(b\)<\/del>/.test(xml) && !/para_b-old/.test(xml)) fail('paragraph (b) is not struck whole');
  if (!/<num><del>\(c\)<\/del> <ins>\(b\)<\/ins><\/num>/.test(xml)) fail('(c) is not marked as renumbered (b)');
  const res = cp.spawnSync('python3', [path.join(__dirname, '..', 'profile', 'validate.py'), OUT + '/renumber.akn.xml'], { encoding: 'utf8' });
  console.log('validate:', res.status, res.stdout.trim().split('\n').slice(-3).join(' / '));
  if (res.status !== 0) fail('the XML does not pass the profile:\n' + res.stdout);
  console.log('errors', errors);
  await b.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
