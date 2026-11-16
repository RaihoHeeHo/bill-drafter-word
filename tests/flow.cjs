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
  // Several people and the review. Kim, the drafter, sends the draft to examination; Lee, an examiner, signs off § 2
  // and then suggests a change in it with Track Changes on: the sign-off goes stale, Mark changes leaves the section
  // alone, no clean copy is made, and Ana (a proofreader) may not decide it; Kim accepts it. The working copy carries
  // the steps, and the profile's checker accepts it.
  const who = async (name, role) => { await p.fill('#me-name', name); await p.dispatchEvent('#me-name', 'change'); await p.selectOption('#me-role', role); await p.waitForTimeout(400); };
  await p.click('[data-tab=review]'); await p.waitForTimeout(600);
  await who('Kim Lo', 'drafter');
  console.log('review:', await p.textContent('#rv-status'), '|', await p.textContent('#rv-send'));
  await step('send to examination', () => p.click('#rv-send')); await p.waitForTimeout(300);
  if (!/in examination/.test(await p.textContent('#rv-status'))) throw new Error('not in examination: ' + await p.textContent('#rv-status'));
  if (!(await p.isDisabled('#rv-send'))) throw new Error('the drafter can send the draft on while it is in examination');
  await who('Lee Smith', 'examiner');
  await step('sign off § 2', async () => { await p.click('#rv-secs li:nth-child(2) button:has-text("Sign off")'); await p.waitForFunction(() => /Signed off/.test(document.querySelector('#rv-secs li:nth-child(2)').textContent) || /Not|first|error/i.test(document.querySelector('#notice').textContent), null, { timeout: 20000 }).catch(() => {}); });
  console.log('sections:', await p.$$eval('#rv-secs li', l => l.slice(0, 3).map(x => x.textContent.replace(/\s+/g, ' ').trim())));
  if (!/Signed off by Lee Smith/.test(await p.textContent('#rv-secs li:nth-child(2)'))) throw new Error('no sign-off on § 2');
  console.log('suggested:', await p.evaluate(() => __suggestInLaw('When an affidavit is authorized', 'commissioner of deeds or ', 'Lee Smith')));
  await p.click('[data-tab=draft]'); await p.click('[data-tab=review]'); await p.waitForTimeout(800);
  if (!/stale/.test(await p.textContent('#rv-secs li:nth-child(2)'))) throw new Error('the sign-off did not go stale: ' + await p.textContent('#rv-secs li:nth-child(2)'));
  console.log('suggestions:', await p.$$eval('#rv-sugs li', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim())));
  await p.screenshot({ path: OUT + '/5b-review.png', fullPage: true });
  await p.click('[data-tab=draft]');
  await step('mark changes with a suggestion waiting', () => p.click('#mark'));
  if (!/suggested changes wait/.test(await notice())) throw new Error('Mark changes did not leave the section with a suggestion alone');
  await p.click('[data-tab=export]');
  await step('clean copy with a suggestion waiting', async () => { await p.click('#to-pdf'); await p.waitForTimeout(800); });
  if (!/Not made: 1 suggested change/.test(await p.textContent('#pdf-status'))) throw new Error('a clean copy was made with a suggestion waiting');
  await p.click('[data-tab=review]'); await p.waitForTimeout(600);
  await who('Ana Ruiz', 'proofreader');
  if (!(await p.isDisabled('#rv-sugs li button:has-text("Accept")'))) throw new Error('a proofreader may accept a suggestion');
  await who('Kim Lo', 'drafter');
  await step('XML: a working copy', async () => { await p.click('[data-tab=export]'); await p.click('#to-akn'); });
  const wc = await p.inputValue('#akn-out');
  if (!/<lbdc:working status="examination">/.test(wc) || !/lbdc:suggest="insert" lbdc:by="#staff-lee-smith"[^>]*>commissioner of deeds or ?<\/span>/.test(wc) || !/refersTo="#signedOff" lbdc:section="sec_2" lbdc:hash="[0-9a-f]{64}"/.test(wc)) throw new Error('no working copy: ' + (wc.match(/<workflow.{0,400}/) || [''])[0]);
  fs.writeFileSync(OUT + '/working-copy.akn.xml', wc);
  await p.click('[data-tab=review]'); await p.waitForTimeout(600);
  await step('Kim accepts Lee\'s suggestion', () => p.click('#rv-sugs li button:has-text("Accept")')); await p.waitForTimeout(500);
  console.log('history:', await p.$$eval('#rv-history li', l => l.map(x => x.textContent)));
  if (!/accepted by Kim Lo/.test(await p.textContent('#rv-history'))) throw new Error('the acceptance was not recorded');
  await p.click('[data-tab=export]');
  await step('clean copy once it is accepted', async () => { await p.click('#to-pdf'); await p.waitForFunction(() => /ready|Not made/.test(document.querySelector('#pdf-status').textContent + document.querySelector('#notice').textContent), null, { timeout: 120000 }); });
  console.log('pdf status:', await p.textContent('#pdf-status'));
  if (!/commissioner of deeds[^<]*<\/ins>|<ins>[^<]*commissioner of deeds/.test(await p.inputValue('#akn-out'))) throw new Error('the accepted suggestion was not marked as new matter: ' + ((await p.inputValue('#akn-out')).match(/.{80}commissioner.{40}/) || [''])[0]);
  // Signed: the clean copy carries the fingerprint on its pages and its signed package; the profile's checker agrees.
  if (!/Signed by Kim Lo: every page carries the fingerprint [0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/.test(await p.textContent('#pdf-status'))) throw new Error('the clean copy was not signed: ' + await p.textContent('#pdf-status'));
  const signedPdf = OUT + '/signed clean copy.pdf';
  fs.writeFileSync(signedPdf, Buffer.from(await p.evaluate(async () => { const u = new Uint8Array(await (await fetch(pdfUrl)).arrayBuffer()); let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s); }), 'base64'));
  const cp = require('child_process'), tool = path.join(__dirname, '..', 'profile', 'tools', 'nysakn.py');
  const py = cp.spawnSync('python3', [tool, 'check', signedPdf, '--no-profile'], { encoding: 'utf8' });
  console.log('nysakn.py on the clean copy:', py.status, py.stdout.split('\n').slice(0, 4).join(' / '));
  if (py.status !== 0) throw new Error('the profile\'s checker does not accept the signed clean copy: ' + py.stdout + py.stderr);
  if (!/the words on all \d+ pages are the words it was signed with/.test(py.stdout)) throw new Error('the profile\'s checker did not compare the pages with pdftext.txt: ' + py.stdout);
  // Kim sends Lee a working copy only Lee can open; Lee checks it; a changed copy is VOID; the PDF checks too.
  await step('save a signed package for Lee', async () => {
    await p.check('#pk-working'); await p.check('#pk-lock-people'); await p.waitForTimeout(200);
    await p.check('#pk-people input[value="Lee Smith"]'); await p.fill('#pk-note', 'Please look at section 2 again.');
    await p.setInputFiles('#pk-att-file', { name: 'request memo.txt', mimeType: 'text/plain', buffer: Buffer.from('Request from the sponsor: notaries.') }); await p.waitForTimeout(500);
    if (!/request memo\.txt/.test(await p.textContent('#pk-atts'))) throw new Error('the attachment did not go in: ' + await p.textContent('#pk-atts'));
    await p.check('#pk-packet'); await p.selectOption('#pk-to', 'Examiner'); await p.fill('#pk-due', '2026-11-20');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#pk-save')]);
    await dl.saveAs(OUT + '/for-lee.nysakn'); console.log('saved:', dl.suggestedFilename(), fs.statSync(OUT + '/for-lee.nysakn').size, 'bytes');
  });
  const checkFile = async f => { await p.setInputFiles('#pk-file', f); await p.waitForFunction(() => !document.querySelector('#pk-result').hidden && document.querySelector('#pk-result').textContent.length > 20, null, { timeout: 30000 }); await p.waitForTimeout(300); return (await p.textContent('#pk-result')).replace(/\s+/g, ' '); };
  let res = await checkFile(OUT + '/for-lee.nysakn'); console.log('Kim checks it:', res.slice(0, 120));
  if (!/encrypted/.test(res)) throw new Error('Kim could open a package sent only to Lee: ' + res);
  await p.click('[data-tab=review]'); await who('Lee Smith', 'examiner'); await p.click('[data-tab=export]');
  res = await checkFile(OUT + '/for-lee.nysakn'); console.log('Lee checks it:', res.slice(0, 260));
  if (!/Signed and unchanged, by a key this computer does not yet trust/.test(res) || !/Working copy/.test(res) || !/Please look at section 2 again/.test(res)) throw new Error('Lee could not check the package: ' + res);
  for (const want of [/Review packet for the examiner · due Nov 20/, /request memo\.txt [\d]+ bytes, added and signed by Kim Lo/, /Earlier versions/, /Activity: \d+ signed entries by .*Kim Lo.*every chain is whole/, /When it was signed, the checks found \d+ errors? and \d+ warnings?/, /signed with Lee Smith's key/])
    if (!want.test(res)) throw new Error('the package check does not show ' + want + ': ' + res);
  await p.screenshot({ path: OUT + '/7-package.png', fullPage: true });
  await step('Lee trusts Kim\'s key', () => p.click('#pk-result button:has-text("trust this key")')); await p.waitForTimeout(800);
  if (!/^Signed and unchanged ?Working/.test((await p.textContent('#pk-result')).replace(/\s+/g, ' ').trim())) throw new Error('trusting did not take: ' + await p.textContent('#pk-result'));
  // A copy of an unencrypted package with one word changed.
  await p.click('[data-tab=review]'); await who('Kim Lo', 'drafter'); await p.click('[data-tab=export]'); await p.check('#pk-lock-none');
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#pk-save')]); await dl2.saveAs(OUT + '/open.nysakn');
  const bad = await p.evaluate(async b64 => { const P = BD.nysakn, u = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { files, order } = await P.readZip(u);
    files.set('bill.akn.xml', new TextEncoder().encode(new TextDecoder().decode(files.get('bill.akn.xml')).replace('notary public', 'notary publick')));
    const z = await P.writeZip(order.map(k => ({ path: k, data: files.get(k), store: k === 'mimetype' }))); let s = ''; for (const c of z) s += String.fromCharCode(c); return btoa(s); }, fs.readFileSync(OUT + '/open.nysakn').toString('base64'));
  fs.writeFileSync(OUT + '/changed.nysakn', Buffer.from(bad, 'base64'));
  res = await checkFile(OUT + '/changed.nysakn'); console.log('a changed copy:', res.slice(0, 160));
  if (!/VOID/.test(res) || !/bill.akn.xml was changed after the package was signed/.test(res)) throw new Error('a changed package was not VOID: ' + res);
  await p.screenshot({ path: OUT + '/7b-void.png', fullPage: true });
  res = await checkFile(signedPdf); console.log('the clean copy PDF:', res.slice(0, 160));
  if (!/^Signed and unchanged ?Clean copy/.test(res.trim())) throw new Error('the signed clean copy did not check: ' + res);
  if (!/The words on all \d+ pages are the words it was signed with/.test(res)) throw new Error('the pane did not compare the PDF\'s pages: ' + res);
  // the same PDF with one letter of page 1 changed (in its content stream, as another program would)
  {
    const PL = require('pdf-lib'), doc = await PL.PDFDocument.load(fs.readFileSync(signedPdf)), pg = doc.getPages()[0], c = pg.node.Contents();
    const st = c instanceof PL.PDFArray ? doc.context.lookup(c.get(0)) : doc.context.lookup(pg.node.get(PL.PDFName.of('Contents')));
    const raw = Buffer.from(PL.decodePDFRawStream(st).decode()), at = raw.indexOf(')]TJ', raw.indexOf('/f1'));
    raw[at - 1] = raw[at - 1] === 0x01 ? 0x02 : 0x01; // the last glyph of a line, another glyph
    const ns = doc.context.flateStream(raw); pg.node.set(PL.PDFName.of('Contents'), doc.context.register(ns));
    fs.writeFileSync(OUT + '/edited clean copy.pdf', await doc.save());
  }
  res = await checkFile(OUT + '/edited clean copy.pdf'); console.log('an edited clean copy:', res.slice(0, 160));
  if (!/VOID/.test(res) || !/The words on page 1 of the PDF are not the words it was signed with/.test(res)) throw new Error('an edited PDF page was not VOID: ' + res);
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
