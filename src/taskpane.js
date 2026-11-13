/* Bill Drafter for Word (demo) - the task pane: the Word side of the libraries in src/lib.
   Every change to the document goes through tagged content controls (FORMAT.md). */
'use strict';
const $ = id => document.getElementById(id);
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props || {}); for (const k of kids) e.append(k); return e; };
let inWord = false;

/* ---------- small helpers ---------- */
function notice(text, isError) {
  const n = $('notice'); n.textContent = text; n.className = 'notice' + (isError ? ' error' : ''); n.hidden = !text;
  clearTimeout(notice.t); if (text && !isError) notice.t = setTimeout(() => { n.hidden = true; }, 6000);
}
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { console.error(e); notice(e && e.message ? e.message : String(e), true); }
  finally { if (btn) btn.disabled = false; }
}
function needWord() { if (!inWord) throw new Error('Open this pane from Word (Home > Bill Drafter) to change the document.'); }
const word = fn => { needWord(); return Word.run(fn); };
const getLaw = id => BD.bank.get(id);
async function lawNamesFor(model) {
  const out = {};
  for (const s of model.sections) if (s.law && !out[s.law]) { const law = await getLaw(s.law); out[s.law] = law ? BD.lawName(law.info) : 'the ' + s.law + ' law'; }
  return out;
}

/* ---------- reading the document ---------- */
async function readModel(ctx) {
  const ox = ctx.document.body.getOoxml(); await ctx.sync();
  return BD.readBill(ox.value);
}
async function sectionControls(ctx) {
  const ccs = ctx.document.contentControls; ccs.load('items/tag,items/title'); await ctx.sync();
  return ccs.items.filter(c => (c.tag || '').split(';')[0] === 'akn:section');
}
async function controlsByName(ctx, name, within) {
  const ccs = (within || ctx.document).contentControls; ccs.load('items/tag'); await ctx.sync();
  return ccs.items.filter(c => (c.tag || '').split(';')[0] === name);
}
// Word's Track Changes would record our own rewrites as revisions; it is paused while we write.
async function quietly(ctx, fn) {
  let mode = null;
  if (Office.context.requirements.isSetSupported('WordApi', '1.4')) {
    ctx.document.load('changeTrackingMode'); await ctx.sync(); mode = ctx.document.changeTrackingMode;
    if (mode !== 'Off') { ctx.document.changeTrackingMode = 'Off'; await ctx.sync(); }
  }
  try { return await fn(); }
  finally { if (mode && mode !== 'Off') { ctx.document.changeTrackingMode = mode; await ctx.sync(); } }
}
// insertOoxml can leave an empty paragraph at the end of a control; take it out.
async function dropTrailingEmpty(ctx, cc) {
  const ps = cc.paragraphs; ps.load('items/text'); await ctx.sync();
  if (ps.items.length > 1 && !ps.items[ps.items.length - 1].text.trim()) { ps.items[ps.items.length - 1].delete(); await ctx.sync(); }
}

/* ---------- writing sections ---------- */
async function insertSection(kind, xml) {
  await word(async ctx => quietly(ctx, async () => {
    const secs = await sectionControls(ctx);
    const kinds = secs.map(c => BD.parseTag(c.tag).act);
    const idx = BD.insertIndex(kinds, kind), P = BD.pkg(xml);
    if (idx < secs.length) secs[idx].getRange('Whole').insertOoxml(P, 'Before');
    else if (secs.length) secs[secs.length - 1].getRange('Whole').insertOoxml(P, 'After');
    else {
      const en = await controlsByName(ctx, 'akn:enactingFormula');
      if (en.length) en[0].getRange('Whole').insertOoxml(P, 'After'); else ctx.document.body.insertOoxml(P, 'End');
    }
    await ctx.sync();
  }));
  await renumber(true);
}
async function renumber(quiet) {
  await word(async ctx => quietly(ctx, async () => {
    const secs = await sectionControls(ctx);
    const nums = secs.map(c => { const n = c.contentControls; n.load('items/tag'); return n; });
    await ctx.sync();
    secs.forEach((c, i) => {
      const want = BD.sectionNum(i), n = nums[i].items.find(x => x.tag === 'akn:num');
      if (n) n.insertText(want, 'Replace');
      c.title = (want + ' ' + (c.title || '').replace(/^(Section \d+\.|§ \d+\.|§ __\.)\s*/, '')).trim();
    });
    await ctx.sync();
  }));
  await refresh();
  if (!quiet) notice('Sections renumbered.');
}
async function updateTitle(subjectFromPane) {
  await word(async ctx => quietly(ctx, async () => {
    const model = await readModel(ctx);
    const names = await lawNamesFor(model);
    const subject = (subjectFromPane != null ? subjectFromPane : $('subject').value).trim() || (model.title && model.title.subject) || '____';
    const t = BD.longTitle(model.sections.filter(s => s.act !== 'new').map(s => ({ ...s, lawName: names[s.law] })), subject);
    const old = await controlsByName(ctx, 'akn:longTitle');
    if (old.length) { old[0].getRange('Whole').insertOoxml(BD.pkg(BD.titleXml(t)), 'Before'); await ctx.sync(); old[0].delete(false); }
    else ctx.document.body.insertOoxml(BD.pkg(BD.titleXml(t)), 'Start');
    await ctx.sync();
  }));
  await refresh();
}
async function newBill() {
  await word(async ctx => quietly(ctx, async () => {
    const t = BD.longTitle([], $('nb-subject').value);
    const xml = BD.titleXml(t) + BD.enactingXml() + BD.sectionXml({ act: 'effective', num: 'Section 1.', content: [{ t: BD.effectiveText('immediately.'), k: '' }] });
    ctx.document.body.insertOoxml(BD.pkg(xml), 'Start'); await ctx.sync();
  }));
  $('subject').value = $('nb-subject').value;
  await refresh(); notice('Bill started. Add sections with Amend a law or Standard sections.');
}

/* ---------- amending a law ---------- */
const pick = { law: null, sec: null };
async function fillLaws() {
  const idx = await BD.bank.index(), ids = Object.keys(idx).sort();
  $('bank-empty').hidden = ids.length > 0;
  const f = $('law-filter').value.trim().toLowerCase(), sel = $('law'), keep = sel.value;
  sel.innerHTML = '';
  for (const id of ids) {
    const i = idx[id], label = id + ' – ' + i.name;
    if (f && !label.toLowerCase().includes(f)) continue;
    sel.append(el('option', { value: id, textContent: label }));
  }
  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
  else if (sel.options.length === 1) { sel.selectedIndex = 0; chooseLaw(); }
  return idx;
}
async function chooseLaw() {
  const id = $('law').value; pick.law = id ? await getLaw(id) : null; pick.sec = null;
  $('sec-results').innerHTML = ''; $('sec-preview').hidden = true; $('action').disabled = true;
  if ($('sec-q').value.trim()) searchSecs();
}
function searchSecs() {
  const ul = $('sec-results'); ul.innerHTML = '';
  if (!pick.law) return;
  for (const s of BD.searchSections(pick.law, $('sec-q').value, 40)) {
    const li = el('li', {}, el('b', { textContent: '§ ' + BD.secId(s.loc) }), s.title + (s.repealed ? ' (repealed)' : ''));
    li.onclick = () => { for (const x of ul.children) x.classList.remove('on'); li.classList.add('on'); chooseSec(s); };
    ul.append(li);
  }
  if (!ul.children.length) ul.append(el('li', { className: 'hint', textContent: 'No section matches. To add a new one, type its number and pick "Add a new section".' }));
  // A number that is not in the law yet: offer to add it.
  const k = BD.locKey($('sec-q').value);
  if (/\d/.test(k) && !BD.findSection(pick.law, k)) { pick.sec = { loc: k, title: '', text: '', missing: true }; showActions(); }
}
function chooseSec(s) {
  pick.sec = s;
  const paras = BD.lawParagraphs(s.text);
  $('sec-preview').textContent = paras.join('\n'); $('sec-preview').hidden = false;
  showActions();
}
function showActions() {
  const s = pick.sec, subs = s.missing ? [] : BD.subdivisions(BD.lawParagraphs(s.text));
  $('action').disabled = false;
  const sub = $('sub'); sub.innerHTML = '';
  for (const x of subs) sub.append(el('option', { value: x.unit, textContent: x.unit }));
  const radio = v => document.querySelector('input[name=act][value=' + v + ']');
  radio('amendSub').disabled = !subs.length; sub.disabled = !subs.length;
  radio('amend').disabled = radio('repeal').disabled = !!s.missing; radio('addSub').disabled = !!s.missing;
  $('add-num').value = s.missing ? BD.secId(s.loc) : BD.nextFreeSection(pick.law, s.loc);
  const last = subs.length ? subs[subs.length - 1].unit : '0';
  $('add-sub').value = /^\d+$/.test(last) ? String(+last + 1) : last + '-a';
  if (s.missing) radio('add').checked = true;
  else if (radio('add').checked) radio('amend').checked = true;
}
async function insertAmendment() {
  const law = pick.law, s = pick.sec; if (!law || !s) throw new Error('Pick a law and a section first.');
  const how = document.querySelector('input[name=act]:checked').value, history = $('history').value;
  let o;
  if (how === 'amend') o = { act: 'amend', loc: s.loc, quoted: BD.lawParagraphs(s.text).map(t => [{ t, k: '' }]) };
  else if (how === 'amendSub') {
    const unit = $('sub').value, sub = BD.subdivisions(BD.lawParagraphs(s.text)).find(x => x.unit === unit);
    o = { act: 'amend', loc: s.loc, unit, quoted: sub.paras.map(t => [{ t, k: '' }]) };
  } else if (how === 'add') {
    const loc = BD.locKey($('add-num').value); if (!loc) throw new Error('Type the new section\'s number.');
    o = { act: 'add', loc, quoted: [[{ t: '§ ' + BD.secId(loc) + '. ____. ____', k: 'ins' }]] };
  } else if (how === 'addSub') {
    const unit = $('add-sub').value.trim(); if (!unit) throw new Error('Type the new subdivision\'s number.');
    o = { act: 'add', loc: s.loc, unit, quoted: [[{ t: unit + '. ____', k: 'ins' }]] };
  } else o = { act: 'repeal', loc: s.loc };
  o.law = law.info.lawId;
  o.clause = BD.amendingClause({ act: o.act, info: law.info, loc: o.loc, unit: o.unit, history: o.act === 'add' ? '' : history });
  await insertSection(o.act, BD.sectionXml(o));
  await updateTitle(null);
  notice(o.act === 'repeal' ? 'Repeal inserted.' : 'Section inserted. Edit the law\'s text in the document, then Mark changes.');
}
// Brackets and underlines from comparing each amended text with the Bank.
async function markChanges() {
  let done = 0; const problems = [];
  await word(async ctx => quietly(ctx, async () => {
    const secs = await sectionControls(ctx);
    for (const c of secs) {
      const tag = BD.parseTag(c.tag); if (tag.act !== 'amend' && tag.act !== 'add') continue;
      const q = (await controlsByName(ctx, 'akn:quoted', c))[0]; if (!q) continue;
      const ox = q.getOoxml(); await ctx.sync();
      const paras = BD.parasOf(ox.value), now = BD.readings(paras).now;
      let out;
      if (tag.act === 'add') out = now.map(t => [{ t, k: 'ins' }]);
      else {
        const law = await getLaw(tag.law), want = law && BD.lawTextFor(law, { loc: tag.loc, unit: tag.unit });
        if (!want) { problems.push((c.title || tag.loc) + ': the law is not in the Bank on this computer'); continue; }
        out = BD.markChanges(want, now);
      }
      q.insertOoxml(BD.pkg(BD.quotedInner(out)), 'Replace'); await ctx.sync();
      await dropTrailingEmpty(ctx, q); done++;
    }
  }));
  notice(done ? 'Marked changes in ' + done + ' section' + (done === 1 ? '' : 's') + '.' + (problems.length ? ' Skipped: ' + problems.join('; ') : '') : 'No amended sections to mark.' + (problems.length ? ' ' + problems.join('; ') : ''), !!problems.length && !done);
}

/* ---------- standard sections ---------- */
const std = {
  shortTitle: () => ({ act: 'shortTitle', heading: 'Short title.', content: [{ t: BD.SHORT_TITLE($('st-name').value.trim().replace(/^"|"$/g, '')), k: '' }] }),
  findings: () => ({ act: 'findings', heading: 'Legislative findings and intent.', content: [{ t: BD.FINDINGS(), k: '' }] }),
  severability: () => ({ act: 'severability', heading: 'Severability clause.', content: [{ t: BD.SEVERABILITY, k: '' }] }),
  new: () => ({ act: 'new', content: [{ t: '____', k: '' }] }),
};
async function addStandard(kind) {
  await insertSection(kind, BD.sectionXml(std[kind]()));
  notice({ shortTitle: 'Short title added as section 1.', findings: 'Findings added. Fill in the blank.', severability: 'Severability clause added before the effective date.', new: 'Blank section added. Type over the ____.' }[kind]);
}
async function setEffective() {
  const addons = [...document.querySelectorAll('#eff-addons input:checked')].map(i => i.value);
  const xml = BD.sectionXml({ act: 'effective', num: '§ __.', content: [{ t: BD.effectiveText($('eff-form').value, addons), k: '' }] });
  let replaced = false;
  await word(async ctx => quietly(ctx, async () => {
    const secs = await sectionControls(ctx), old = secs.filter(c => BD.parseTag(c.tag).act === 'effective');
    if (old.length) { old[old.length - 1].getRange('Whole').insertOoxml(BD.pkg(xml), 'After'); await ctx.sync(); old[old.length - 1].delete(false); await ctx.sync(); replaced = true; }
  }));
  if (!replaced) await insertSection('effective', xml); else await renumber(true);
  notice(replaced ? 'Effective date replaced.' : 'Effective date added.');
}

/* ---------- outline and checks ---------- */
const KIND = { amend: 'Amend', add: 'Add', repeal: 'Repeal', new: '', shortTitle: 'Short title', findings: 'Findings', severability: 'Severability', effective: 'Effective date' };
async function refresh() {
  if (!inWord) return;
  const model = await Word.run(readModel);
  $('no-bill').hidden = !!(model.title || model.sections.length);
  if (model.title && document.activeElement !== $('subject')) $('subject').value = model.title.subject.replace(/^_+$/, '');
  const ol = $('outline'); ol.innerHTML = '';
  model.sections.forEach((s, i) => {
    const what = s.law ? KIND[s.act] + ' ' + s.law + ' § ' + BD.secId(s.loc) + (s.unit ? ' subd. ' + s.unit : '') : (KIND[s.act] || (s.text || '').slice(0, 40));
    const li = el('li', {}, el('span', { className: 'n', textContent: s.num || '?' }), el('span', { className: 'k', textContent: what }));
    li.onclick = () => goTo(i); ol.append(li);
  });
  if (!model.sections.length) ol.append(el('li', { className: 'hint', textContent: 'No sections yet.' }));
  return model;
}
async function goTo(i) {
  await word(async ctx => { const secs = await sectionControls(ctx); if (secs[i]) { secs[i].select('Start'); await ctx.sync(); } });
}
async function runChecks() {
  const model = await word(readModel);
  const found = await BD.check(model, getLaw);
  const ul = $('findings'); ul.innerHTML = '';
  const errs = found.filter(f => f.level === 'error').length;
  $('check-count').textContent = String(errs); $('check-count').hidden = !errs;
  if (!found.length) { ul.append(el('li', { className: 'ok', textContent: 'No problems found.' })); return; }
  const FIX = { renumber: ['Renumber', () => renumber()], title: ['Update title', () => updateTitle(null)], mark: ['Mark changes', markChanges], effective: ['Add effective date', setEffective], subject: ['Go to the title', () => { showTab('draft'); $('subject').focus(); }] };
  for (const f of found) {
    const li = el('li', { className: f.level }, el('span', { className: 'rule', textContent: f.rule + ':' }), f.text);
    if (f.sec != null) { const w = el('div', { className: 'where' }); const b = el('button', { textContent: 'Go to ' + (model.sections[f.sec].num || 'section') }); b.onclick = () => goTo(f.sec); w.append(b); li.append(w); }
    if (f.fix && FIX[f.fix]) { const b = el('button', { textContent: FIX[f.fix][0] }); b.onclick = () => busy(b, async () => { await FIX[f.fix][1](); await runChecks(); }); li.append(b); }
    ul.append(li);
  }
}

/* ---------- export ---------- */
async function loadInfo() {
  if (!inWord || !Office.context.requirements.isSetSupported('WordApi', '1.3')) return {};
  return Word.run(async ctx => {
    const cp = ctx.document.properties.customProperties; cp.load('items/key,items/value'); await ctx.sync();
    const get = k => { const p = cp.items.find(x => x.key === k); return p ? String(p.value) : ''; };
    return { lbd: get('LBD'), year: get('SessionYear') };
  });
}
async function saveInfo() {
  await word(async ctx => {
    const cp = ctx.document.properties.customProperties;
    cp.add('LBD', $('lbd').value.trim()); cp.add('SessionYear', $('year').value.trim()); await ctx.sync();
  });
  notice('Saved in the document\'s properties.');
}
let aknText = '';
async function toAkn() {
  const model = await word(readModel);
  const info = { lbd: $('lbd').value.trim(), year: $('year').value.trim(), lawNames: await lawNamesFor(model) };
  aknText = BD.toAkn(model, info);
  $('akn-out').value = aknText; $('akn-copy').disabled = $('akn-save').disabled = false;
  const errs = (await BD.check(model, getLaw)).filter(f => f.level === 'error').length;
  notice(errs ? 'Converted, but the checks found ' + errs + ' problem' + (errs === 1 ? '' : 's') + ' to fix first (Checks tab).' : 'Converted.', false);
}
function saveAkn() {
  const name = ($('lbd').value.trim() || 'bill') + '.akn.xml';
  const a = el('a', { href: URL.createObjectURL(new Blob([aknText], { type: 'application/xml' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- the Bank ---------- */
async function loadBankFiles(files) {
  files = [...files].filter(f => /\.json$/i.test(f.name) && !/^(catalog|manifest)\.json$/i.test(f.name));
  if (!files.length) throw new Error('No law files (.json) were picked.');
  const bar = $('bank-progress'); bar.hidden = false; bar.max = files.length; bar.value = 0;
  let ok = 0; const bad = [], empty = [];
  for (const f of files) {
    try { const law = BD.parseLaw(await f.text()); if (law && law.sections.length) { await BD.bank.put(law); ok++; } else if (law) empty.push(law.info.lawId); else bad.push(f.name); }
    catch (e) { bad.push(f.name); }
    bar.value++;
  }
  bar.hidden = true;
  await showBank(); await fillLaws();
  notice('Loaded ' + ok + ' law' + (ok === 1 ? '' : 's') + ' into the Bank.' + (empty.length ? ' Without sections (skipped): ' + empty.join(', ') + '.' : '') + (bad.length ? ' Not law files: ' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? '…' : '') : ''));
}
async function showBank() {
  const idx = await BD.bank.index(), ids = Object.keys(idx).sort();
  const dates = ids.map(i => idx[i].activeDate).filter(Boolean).sort();
  $('bank-status').textContent = ids.length ? ids.length + ' laws, ' + ids.reduce((n, i) => n + idx[i].count, 0).toLocaleString() + ' sections' + (dates.length ? ', laws as of ' + dates[dates.length - 1] : '') + '.' : 'Nothing loaded yet.';
  const ul = $('bank-list'); ul.innerHTML = '';
  for (const id of ids) ul.append(el('li', { textContent: id + ' – ' + idx[id].name }));
}

/* ---------- tabs and wiring ---------- */
function showTab(name) {
  for (const b of document.querySelectorAll('nav button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
}
function wire() {
  for (const b of document.querySelectorAll('nav button')) b.onclick = () => showTab(b.dataset.tab);
  const on = (id, fn) => { const b = $(id); b.onclick = () => busy(b, fn); };
  on('nb-go', newBill); on('title-update', () => updateTitle(null)); on('renumber', () => renumber());
  on('insert-amend', insertAmendment); on('mark', markChanges);
  on('add-short', () => addStandard('shortTitle')); on('add-findings', () => addStandard('findings'));
  on('add-sev', () => addStandard('severability')); on('add-new', () => addStandard('new')); on('add-eff', setEffective);
  on('refresh', refresh); on('run-checks', runChecks); on('to-akn', toAkn); on('save-info', saveInfo);
  on('akn-copy', async () => { $('akn-out').select(); try { await navigator.clipboard.writeText(aknText); } catch (e) { document.execCommand('copy'); } notice('Copied.'); });
  on('akn-save', async () => saveAkn());
  on('bank-clear', async () => { await BD.bank.clear(); await showBank(); await fillLaws(); notice('The Bank was removed from this computer.'); });
  $('law-filter').oninput = () => fillLaws();
  $('law').onchange = () => busy(null, chooseLaw);
  let t; $('sec-q').oninput = () => { clearTimeout(t); t = setTimeout(searchSecs, 150); };
  for (const id of ['bank-folder', 'bank-files']) $(id).onchange = e => busy(null, () => loadBankFiles(e.target.files));
  const form = $('eff-form');
  for (const [label, text] of BD.EFF_FORMS) form.append(el('option', { value: text, textContent: label + ' – ' + text }));
  for (const [key, label] of BD.EFF_ADDONS) $('eff-addons').append(el('label', {}, el('input', { type: 'checkbox', value: key }), label));
}

async function start(host) {
  wire();
  inWord = host === 'Word';
  if (!inWord) notice('This pane works inside Word. Here you can still load the Bank.', false);
  await showBank(); await fillLaws();
  if (inWord) {
    await busy(null, refresh);
    const info = await loadInfo().catch(() => ({}));
    $('lbd').value = info.lbd || ''; $('year').value = info.year || String(new Date().getFullYear());
  }
}
if (window.Office && Office.onReady) Office.onReady(info => start(info && info.host));
else document.addEventListener('DOMContentLoaded', () => start(null));
