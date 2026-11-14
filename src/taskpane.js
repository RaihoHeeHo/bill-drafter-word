/* Bill Drafter for Word (demo) - the task pane: the Word side of the libraries in src/lib.
   Every change to the document goes through tagged content controls (FORMAT.md). */
'use strict';
const $ = id => document.getElementById(id);
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props || {}); for (const k of kids) e.append(k); return e; };
let inWord = false;

/* ---------- small helpers ---------- */
function notice(text, isError) {
  const n = $('notice'); $('notice-text').textContent = text; n.className = 'notice' + (isError ? ' error' : ''); n.hidden = !text;
  clearTimeout(notice.t); if (text && !isError) notice.t = setTimeout(() => { n.hidden = true; }, 8000);
}
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { console.error(e); notice(e && e.message ? e.message : String(e), true); }
  finally { if (btn) btn.disabled = false; }
}
function needWord() { if (!inWord) throw new Error('Open this pane from Word (Home > Bill Drafter) to change the document.'); }
const word = fn => { needWord(); return Word.run(fn); };
const getLaw = id => BD.bank.get(id);
async function lawNamesFor(model, infos) {
  const out = {};
  for (const s of model.sections) if (s.law && !out[s.law]) { const law = await getLaw(s.law); out[s.law] = law ? BD.lawName(law.info) : 'the ' + s.law + ' law'; if (infos && law) infos[s.law] = law.info; }
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

// Word merges the first and last paragraph of inserted OOXML into the paragraph where it lands, which turns a
// one-paragraph content control into an inline one. An empty paragraph on each side takes that merge instead;
// tidy() then removes the empty paragraphs left between the bill's parts.
const padded = xml => BD.pkg('<w:p/>' + xml + '<w:p/>');
async function tidy(ctx) {
  const ps = ctx.document.body.paragraphs; ps.load('items/text'); await ctx.sync();
  const empty = ps.items.map((p, i) => i < ps.items.length - 1 && !p.text.trim() ? p : null);
  const parents = empty.map(p => p && p.parentContentControlOrNullObject);
  parents.forEach(c => c && c.load('isNullObject')); await ctx.sync();
  empty.forEach((p, i) => { if (p && parents[i].isNullObject) p.delete(); });
  await ctx.sync();
}
// Put new OOXML where a content control is and remove the control (works whether Word made it inline or not).
async function replaceControl(ctx, cc, xml) {
  cc.getRange('Whole').insertOoxml(padded(xml), 'Before'); await ctx.sync();
  cc.delete(false); await ctx.sync();
  await tidy(ctx);
}

/* ---------- writing sections ---------- */
async function insertSection(kind, xml) {
  await word(async ctx => quietly(ctx, async () => {
    const secs = await sectionControls(ctx);
    const kinds = secs.map(c => BD.parseTag(c.tag).act);
    const idx = BD.insertIndex(kinds, kind), P = padded(xml);
    // A blank section (just its number, as New bill leaves section 1) is taken over by the section inserted.
    const blank = [];
    if (kind !== 'new') {
      secs.forEach(c => c.load('text')); await ctx.sync();
      secs.forEach((c, i) => { if (kinds[i] === 'new' && !c.text.replace(/^\s*(Section|\u00a7)\s*[\d_]+\.\s*/, '').trim()) blank.push(c); });
    }
    if (idx < secs.length) secs[idx].getRange('Whole').insertOoxml(P, 'Before');
    else if (secs.length) secs[secs.length - 1].getRange('Whole').insertOoxml(P, 'After');
    else {
      const en = await controlsByName(ctx, 'akn:enactingFormula');
      if (en.length) en[0].getRange('Whole').insertOoxml(P, 'After'); else ctx.document.body.insertOoxml(P, 'End');
    }
    await ctx.sync();
    if (blank.length && kind !== 'shortTitle' && kind !== 'findings' && kind !== 'severability' && kind !== 'effective') { blank.forEach(c => c.delete(false)); await ctx.sync(); }
    await tidy(ctx);
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
  if (!quiet) { await updateTitle(null); notice('Sections renumbered and the title rebuilt.'); }
}
async function updateTitle(subjectFromPane) {
  await word(async ctx => quietly(ctx, async () => {
    const model = await readModel(ctx);
    const names = await lawNamesFor(model);
    const subject = (subjectFromPane != null ? subjectFromPane : $('subject').value).trim() || (model.title && model.title.subject) || '____';
    const t = BD.longTitle(model.sections.filter(s => s.act !== 'new').map(s => ({ ...s, lawName: names[s.law] })), subject);
    const old = await controlsByName(ctx, 'akn:longTitle');
    if (old.length) await replaceControl(ctx, old[0], BD.titleXml(t));
    else { ctx.document.body.insertOoxml(padded(BD.titleXml(t)), 'Start'); await ctx.sync(); await tidy(ctx); }
  }));
  await refresh();
}
async function newBill() {
  await word(async ctx => quietly(ctx, async () => {
    const t = BD.longTitle([], $('nb-subject').value);
    // Section 1 blank for the drafter to type in (or to be taken over by the first section inserted), § 2 the effective date.
    const xml = BD.titleXml(t) + BD.enactingXml() + BD.sectionXml({ act: 'new', num: 'Section 1.', content: [] }) +
      BD.sectionXml({ act: 'effective', num: '\u00a7 2.', content: [{ t: BD.effectiveText('immediately.'), k: '' }] });
    ctx.document.body.insertOoxml(padded(xml), 'Start'); await ctx.sync();
    await tidy(ctx);
  }));
  $('subject').value = $('nb-subject').value;
  await refresh(); notice('Bill started. Now add sections: the first one you add takes the place of the blank section 1.');
}

/* ---------- amending a law ----------
   One box finds both: "GCN 12", "executive 296", "tax 606(c)", "general construction affidavit". The words that
   name a law (its Bank ID or words of its name) come first; what follows is a section number or heading words. */
const pick = { law: null, sec: null, unit: null };
let bankIdx = {};
async function fillLaws() {
  bankIdx = await BD.bank.index();
  const empty = !Object.keys(bankIdx).length;
  $('bank-empty').hidden = !empty; $('sec-q').disabled = empty;
  welcome();
  return bankIdx;
}
// Which laws do these words name?
function lawsNamed(words) {
  const w = words.toLowerCase(), ids = Object.keys(bankIdx).sort();
  const exact = ids.filter(id => id.toLowerCase() === w);
  if (exact.length) return exact;
  return ids.filter(id => { const n = bankIdx[id].name.toLowerCase().replace(/&/g, 'and'); return w.length > 2 && (n === w || n.split(/[\s,]+/).some((x, i, a) => a.slice(i).join(' ').startsWith(w))); });
}
function parseQuery(q) {
  const toks = q.replace(/§/g, ' ').trim().split(/\s+/).filter(Boolean);
  for (let k = toks.length; k >= 1; k--) {
    const laws = lawsNamed(toks.slice(0, k).join(' '));
    if (laws.length) return { laws, rest: toks.slice(k).join(' ') };
  }
  return { laws: pick.law ? [pick.law.info.lawId] : [], rest: toks.join(' ') };
}
let active = -1;
async function search() {
  const ul = $('sec-results'); ul.innerHTML = ''; active = -1;
  const q = $('sec-q').value.trim(); if (!q) return;
  const { laws, rest } = parseQuery(q);
  const item = (lawId, main, sub, fn) => { const li = el('li', { role: 'option' }, el('span', { className: 'law', textContent: lawId }), el('b', { textContent: main }), sub ? ' ' + sub : ''); li.onclick = fn; ul.append(li); };
  if (!laws.length) { ul.append(el('li', { className: 'hint', textContent: 'No law in the Bank matches "' + q.split(/\s+/)[0] + '". Start with the law\'s ID (GCN) or a word of its name (construction).' })); return; }
  if (!rest) {
    for (const id of laws.slice(0, 12)) item(id, bankIdx[id].name, '', () => { $('sec-q').value = id + ' '; $('sec-q').focus(); search(); });
    if (laws.length === 1) ul.append(el('li', { className: 'hint', textContent: 'Now type a section number or words of its heading.' }));
    return;
  }
  // "606(c)" or "296 subd 1": a section and one of its units.
  const m = /^([\w.-]+)\s*(?:\(([\w-]+)\)|\s+(?:subd(?:ivision)?\.?|subsec(?:tion)?\.?)\s*\(?([\w-]+)\)?)$/i.exec(rest);
  const secQ = m ? m[1] : rest, unitQ = m ? (m[2] || m[3]) : null;
  let n = 0;
  for (const id of laws.slice(0, 6)) {
    const law = await getLaw(id); if (!law) continue;
    for (const s of BD.searchSections(law, secQ, 30)) {
      if (n++ >= 40) break;
      item(id, '§ ' + BD.secId(s.loc), s.title + (s.repealed ? ' (repealed)' : ''), () => chooseSec(law, s, unitQ));
    }
    // A number that is not in the law yet: offer to add it.
    const k = BD.locKey(secQ);
    if (laws.length === 1 && /\d/.test(k) && !BD.findSection(law, k)) item(id, '§ ' + BD.secId(k), 'is not in the law: add it as a new section', () => chooseSec(law, { loc: k, title: '', text: '', missing: true }));
  }
  if (!ul.children.length) ul.append(el('li', { className: 'hint', textContent: 'No section of ' + laws.join(', ') + ' matches "' + rest + '".' }));
}
function moveActive(d) {
  const items = [...$('sec-results').querySelectorAll('li[role=option]')]; if (!items.length) return;
  active = (active + d + items.length) % items.length;
  items.forEach((x, i) => x.classList.toggle('active', i === active)); items[active].scrollIntoView({ block: 'nearest' });
}
function chooseSec(law, s, unit) {
  pick.law = law; pick.sec = s; pick.unit = unit || null;
  $('sec-results').innerHTML = '';
  $('picked').hidden = false;
  $('picked-title').textContent = law.info.lawId + ' § ' + BD.secId(s.loc) + (s.title ? '. ' + s.title : '') + (s.missing ? ' (new)' : '');
  $('sec-preview').textContent = BD.lawParagraphs(s.text).join('\n');
  $('sec-preview-box').hidden = !!s.missing; $('sec-preview-box').open = false;
  showActions();
}
function clearPick() {
  pick.law = null; pick.sec = null; pick.unit = null;
  $('picked').hidden = true; $('action').disabled = true; $('sec-q').value = ''; $('sec-q').focus();
}
const subsecs = () => BD.usesSubsections(pick.law && pick.law.info.lawId);
function showActions() {
  const s = pick.sec, subs = s.missing ? [] : BD.subdivisions(BD.lawParagraphs(s.text), subsecs());
  $('action').disabled = false;
  const word = subsecs() ? 'subsection' : 'subdivision';
  $('sub-word').textContent = word; $('sub-word2').textContent = word;
  const sub = $('sub'); sub.innerHTML = '';
  for (const x of subs) sub.append(el('option', { value: x.unit, textContent: subsecs() ? '(' + x.unit + ')' : x.unit }));
  const radio = v => document.querySelector('input[name=act][value=' + v + ']');
  radio('amendSub').disabled = !subs.length; sub.disabled = !subs.length;
  radio('amend').disabled = radio('repeal').disabled = !!s.missing; radio('addSub').disabled = !!s.missing;
  $('add-num').value = s.missing ? BD.secId(s.loc) : BD.nextFreeSection(pick.law, s.loc);
  const last = subs.length ? subs[subs.length - 1].unit : (subsecs() ? '' : '0');
  $('add-sub').value = subsecs() ? (last ? String.fromCharCode(last.charCodeAt(0) + 1) : 'a') : /^\d+$/.test(last) ? String(+last + 1) : last + '-a';
  if (s.missing) radio('add').checked = true;
  else if (pick.unit && subs.some(x => x.unit.toLowerCase() === pick.unit.toLowerCase())) { radio('amendSub').checked = true; sub.value = subs.find(x => x.unit.toLowerCase() === pick.unit.toLowerCase()).unit; }
  else if (radio('add').checked || radio('amendSub').disabled && radio('amendSub').checked) radio('amend').checked = true;
  actionChanged();
}
// The button says what will happen; history only matters for an amendment or a repeal.
function actionChanged() {
  if (!pick.sec) { $('insert-amend').textContent = 'Insert section'; return; }
  const how = (document.querySelector('input[name=act]:checked') || {}).value, id = pick.law.info.lawId, sec = BD.secId(pick.sec.loc);
  const unit = subsecs() ? '(' + $('sub').value + ')' : $('sub').value;
  $('history-row').hidden = !(how === 'amend' || how === 'amendSub' || how === 'repeal');
  $('insert-amend').textContent = {
    amend: 'Insert: amend ' + id + ' § ' + sec,
    amendSub: 'Insert: amend ' + id + ' § ' + sec + ' ' + (subsecs() ? 'subsec. ' : 'subd. ') + unit,
    add: 'Insert: add ' + id + ' § ' + ($('add-num').value || '?'),
    addSub: 'Insert: add ' + (subsecs() ? 'subsec. (' + $('add-sub').value + ')' : 'subd. ' + $('add-sub').value) + ' to ' + id + ' § ' + sec,
    repeal: 'Insert: repeal ' + id + ' § ' + sec,
  }[how] || 'Insert section';
}
async function insertAmendment() {
  const law = pick.law, s = pick.sec; if (!law || !s) throw new Error('Find the section first: type the law and the section, e.g. "GCN 12", and pick it from the list.');
  const how = document.querySelector('input[name=act]:checked').value, history = historyText();
  let o;
  if (how === 'amend') o = { act: 'amend', loc: s.loc, quoted: BD.lawParagraphs(s.text).map(t => [{ t, k: '' }]) };
  else if (how === 'amendSub') {
    const unit = $('sub').value, sub = BD.subdivisions(BD.lawParagraphs(s.text), BD.usesSubsections(law.info.lawId)).find(x => x.unit === unit);
    o = { act: 'amend', loc: s.loc, unit, quoted: sub.paras.map(t => [{ t, k: '' }]) };
  } else if (how === 'add') {
    const loc = BD.locKey($('add-num').value); if (!loc) throw new Error('Type the new section\'s number.');
    o = { act: 'add', loc, quoted: [[{ t: '§ ' + BD.secId(loc) + '. ____. ____', k: 'ins' }]] };
  } else if (how === 'addSub') {
    const unit = $('add-sub').value.trim(); if (!unit) throw new Error('Type the new subdivision\'s number.');
    o = { act: 'add', loc: s.loc, unit, quoted: [[{ t: (BD.usesSubsections(law.info.lawId) ? '(' + unit.replace(/[()]/g, '') + ')' : unit + '.') + ' ____', k: 'ins' }]] };
  } else o = { act: 'repeal', loc: s.loc };
  o.law = law.info.lawId;
  o.clause = BD.amendingClause({ act: o.act, info: law.info, loc: o.loc, unit: o.unit, history: o.act === 'add' ? '' : history });
  await insertSection(o.act, BD.sectionXml(o));
  await updateTitle(null);
  $('history').value = '';
  notice(o.act === 'repeal' ? 'Repeal inserted.' : o.act === 'add' ? 'New ' + (o.unit ? 'unit' : 'section') + ' inserted, all underlined. Type over the ____ in the document.' : 'Section inserted with the law\'s text. Edit it in the document like plain text, then press Mark changes.');
}
// Brackets and underlines from comparing each amended text with the Bank.
async function markChanges() {
  let done = 0; const problems = [];
  await word(async ctx => quietly(ctx, async () => {
    const secs = await sectionControls(ctx);
    for (const c of secs) {
      const tag = BD.parseTag(c.tag); if (tag.act !== 'amend' && tag.act !== 'add') continue;
      const ox = c.getOoxml(); await ctx.sync();
      const inner = BD.readBill(ox.value).sections, s = inner[0];
      if (!s || !s.quoted) continue;
      const now = BD.readings(s.quoted.paras).now;
      let out;
      if (tag.act === 'add') out = now.map(t => [{ t, k: 'ins' }]);
      else {
        const law = await getLaw(tag.law), want = law && BD.lawTextFor(law, { loc: tag.loc, unit: tag.unit });
        if (!want) { problems.push((c.title || tag.loc) + ': the law is not in the Bank on this computer'); continue; }
        out = BD.markChanges(want, now);
      }
      if (inner.length === 1) {
        // The whole section is written again (number, heading, clause, marked text), so it comes out right
        // even where Word made a part of it an inline control.
        await replaceControl(ctx, c, BD.sectionXml({ act: tag.act, law: tag.law, loc: tag.loc, unit: tag.unit, num: s.num, heading: s.heading, clause: s.clause, content: s.paras[0] || [], more: s.paras.slice(1), quoted: out }));
      } else { // another section sits inside this one: change only the quoted text
        const q = (await controlsByName(ctx, 'akn:quoted', c))[0]; if (!q) continue;
        q.insertOoxml(BD.pkg(BD.quotedInner(out)), 'Replace'); await ctx.sync();
        await dropTrailingEmpty(ctx, q);
      }
      done++;
    }
  }));
  notice(done ? 'Marked changes in ' + done + ' section' + (done === 1 ? '' : 's') + '.' + (problems.length ? ' Skipped: ' + problems.join('; ') : '') : 'No amended sections to mark.' + (problems.length ? ' ' + problems.join('; ') : ''), !!problems.length && !done);
}

// "As amended by …": what the drafter typed, as the clause will cite it.
function historyText(id) {
  const h = $(id || 'history').value.trim().replace(/^,\s*/, '').replace(/[,.]\s*$/, '');
  return !h ? '' : /^as (amended|added|renumbered|relettered)\b/i.test(h) ? h.replace(/^As/, 'as') : 'as amended by ' + h;
}
// The bill section that holds the cursor (or the selection).
async function sectionAtCursor(ctx) {
  let cc = ctx.document.getSelection().parentContentControlOrNullObject;
  for (let i = 0; i < 8; i++) {
    cc.load('tag'); await ctx.sync();
    if (cc.isNullObject) break;
    if ((cc.tag || '').split(';')[0] === 'akn:section') return cc;
    cc = cc.parentContentControlOrNullObject;
  }
  return null;
}
// Put the history into the amending clause of the section at the cursor, in place of any history it cites.
async function applyHistory() {
  const h = historyText('history-fix');
  if (!h) throw new Error('Type the history first, e.g. "chapter 55 of the laws of 2023".');
  let where = '';
  await word(async ctx => quietly(ctx, async () => {
    const sec = await sectionAtCursor(ctx);
    if (!sec) throw new Error('Click inside the section in the document (its amending clause or the law\'s text), then press the button again.');
    const tag = BD.parseTag(sec.tag);
    if (tag.act !== 'amend' && tag.act !== 'repeal') throw new Error('That section does not amend or repeal a provision, so it cites no history.');
    const mod = (await controlsByName(ctx, 'akn:mod', sec))[0];
    if (!mod) throw new Error('That section has no amending clause to put the history in.');
    mod.load('text'); await ctx.sync();
    const old = mod.text.trim(), without = old.replace(/,\s*as (amended|added|renumbered|relettered)\b[^]*?,\s*(?=is (amended|REPEALED))/, ' ');
    let clause = /\s(is amended to read|is REPEALED)/.test(without) ? without.replace(/\s+(is amended to read|is REPEALED)/, ', ' + h + ', $1') : '';
    if (!clause) { const law = await getLaw(tag.law); if (!law) throw new Error('The clause has an unusual form; type the history into it by hand.'); clause = BD.amendingClause({ act: tag.act, info: law.info, loc: tag.loc, unit: tag.unit, history: h }); }
    mod.insertText(clause, 'Replace'); await ctx.sync();
    where = sec.title || '';
  }));
  $('history-fix').value = ''; $('history-card').hidden = true;
  notice('History put in the amending clause' + (where ? ' (' + where + ')' : '') + '.');
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
    if (old.length) { await replaceControl(ctx, old[old.length - 1], xml); replaced = true; }
  }));
  if (!replaced) await insertSection('effective', xml); else await renumber(true);
  notice(replaced ? 'Effective date replaced.' : 'Effective date added.');
}

/* ---------- outline and checks ---------- */
const KIND = { amend: 'Amend', add: 'Add', repeal: 'Repeal', new: '', shortTitle: 'Short title', findings: 'Findings', severability: 'Severability', effective: 'Effective date' };
async function refresh() {
  if (!inWord) return;
  const model = await Word.run(readModel);
  hasBill = !!(model.title || model.sections.length);
  $('no-bill').hidden = hasBill; $('bill-card').hidden = !hasBill; $('dock').hidden = !hasBill;
  welcome();
  if (model.title && document.activeElement !== $('subject')) $('subject').value = model.title.subject.replace(/^_+$/, '');
  const ol = $('outline'); ol.innerHTML = '';
  model.sections.forEach((s, i) => {
    const what = s.law ? KIND[s.act] + ' ' + s.law + ' § ' + BD.secId(s.loc) + (s.unit ? ' subd. ' + s.unit : '') : (KIND[s.act] || (s.text || '').slice(0, 40));
    const li = el('li', {}, el('span', { className: 'n', textContent: s.num || '?' }), el('span', { className: 'k', textContent: what }));
    li.onclick = () => goTo(i); ol.append(li);
  });
  return model;
}
// The getting-started card shows until the Bank is loaded and a bill is started.
let hasBill = false;
function welcome() {
  const bank = Object.keys(bankIdx).length > 0;
  $('step-bank').classList.toggle('done', bank); $('step-bill').classList.toggle('done', hasBill);
  $('welcome').hidden = bank && hasBill || !inWord && bank;
}
async function goTo(i) {
  await word(async ctx => { const secs = await sectionControls(ctx); if (secs[i]) { secs[i].select('Start'); await ctx.sync(); } });
}
async function runChecks() {
  const model = await word(readModel);
  const found = await BD.check(model, getLaw);
  const ul = $('findings'); ul.innerHTML = '';
  const errs = found.filter(f => f.level === 'error').length, warns = found.filter(f => f.level === 'warning').length, notes = found.length - errs - warns;
  $('check-count').textContent = String(errs); $('check-count').hidden = !errs;
  const sum = $('check-summary'), pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  sum.className = 'summary ' + (errs ? 'bad' : warns ? 'meh' : 'good');
  sum.textContent = !found.length ? 'No problems found. The bill is ready for its clean copy.' : [errs && pl(errs, 'error') + ' to fix', warns && pl(warns, 'warning'), notes && pl(notes, 'note')].filter(Boolean).join(', ') + '.';
  if (!found.length) return;
  found.sort((a, b) => ['error', 'warning', 'info'].indexOf(a.level) - ['error', 'warning', 'info'].indexOf(b.level));
  const FIX = { history: ['Add history', async f => { showTab('draft'); await goTo(f.sec); openHistory(); notice('The cursor is in ' + ((model.sections[f.sec].num || '').replace(/\.$/, '') || 'that section') + '. Type its last amendment and press "Put it in that section".'); }], renumber: ['Renumber', () => renumber()], title: ['Update title', () => updateTitle(null)], mark: ['Mark changes', markChanges], effective: ['Add effective date', setEffective], subject: ['Go to the title', () => { showTab('draft'); $('subject').focus(); }] };
  for (const f of found) {
    const li = el('li', { className: f.level }, el('span', { className: 'rule', textContent: f.rule + ':' }), f.text);
    if (f.sec != null) { const w = el('div', { className: 'where' }); const b = el('button', { textContent: 'Go to ' + ((model.sections[f.sec].num || '').replace(/\.$/, '') || 'section') }); b.onclick = () => goTo(f.sec); w.append(b); li.append(w); }
    if (f.fix && FIX[f.fix]) { const b = el('button', { textContent: FIX[f.fix][0] }); b.onclick = () => busy(b, async () => { await FIX[f.fix][1](f); if (f.fix !== 'history') await runChecks(); }); li.append(b); }
    ul.append(li);
  }
}

/* ---------- export ---------- */
const INFO = [['lbd', 'LBD'], ['year', 'SessionYear'], ['house', 'House'], ['billno', 'BillNumber'], ['sponsor', 'Sponsor'], ['committee', 'Committee'], ['bdate', 'BillDate']];
async function loadInfo() {
  if (!inWord || !Office.context.requirements.isSetSupported('WordApi', '1.3')) return {};
  return Word.run(async ctx => {
    const cp = ctx.document.properties.customProperties; cp.load('items/key,items/value'); await ctx.sync();
    const out = {}; for (const [id, key] of INFO) { const p = cp.items.find(x => x.key === key); out[id] = p ? String(p.value) : ''; }
    return out;
  });
}
async function saveInfo(quiet) {
  infoSummary();
  if (!inWord) return;
  await word(async ctx => {
    const cp = ctx.document.properties.customProperties;
    for (const [id, key] of INFO) cp.add(key, $(id).value.trim());
    await ctx.sync();
  });
  if (!quiet) notice('Saved in the document\'s properties.');
}
// One line saying what the clean copy will be.
function infoSummary() {
  const i = paneInfo(), H = i.house === 'assembly' ? 'Assembly' : 'Senate', missing = [];
  if (!i.lbd) missing.push('the LBD number'); if (!i.sponsor) missing.push('the sponsor'); if (i.billNumber && !i.date) missing.push('the date introduced');
  const what = i.billNumber ? H + ' bill ' + (i.house === 'assembly' ? 'A. ' : 'S. ') + i.billNumber.replace(/-+/, '--') + (i.date ? ', introduced ' + new Date(i.date + 'T12:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '') : 'Draft for the ' + H + (i.lbd ? ', LBD ' + i.lbd : '') + ' (no bill number yet)';
  const sum = $('info-summary');
  sum.className = 'summary ' + (missing.length ? 'meh' : 'good');
  sum.textContent = what + '.' + (missing.length ? ' Add ' + missing.join(' and ') + ' under Bill information below.' : '');
}
const paneInfo = () => ({ lbd: $('lbd').value.trim(), year: $('year').value.trim(), house: $('house').value, billNumber: $('billno').value.trim(), sponsor: $('sponsor').value.trim(), committee: $('committee').value.trim(), date: $('bdate').value || undefined });
let aknText = '';
async function toAkn() {
  const model = await word(readModel);
  const laws = {}, info = { ...paneInfo(), lawNames: await lawNamesFor(model, laws), laws };
  if (!info.year && info.date) info.year = info.date.slice(0, 4);
  aknText = BD.toAkn(model, info);
  $('akn-out').value = aknText; $('akn-copy').disabled = $('akn-save').disabled = false;
  const errs = (await BD.check(model, getLaw)).filter(f => f.level === 'error').length;
  notice(errs ? 'Done, but Check found ' + errs + ' error' + (errs === 1 ? '' : 's') + ' to fix (Check tab).' : 'Done.', false);
}
function saveAkn() {
  const name = ($('lbd').value.trim() || 'bill') + '.akn.xml';
  const a = el('a', { href: URL.createObjectURL(new Blob([aknText], { type: 'application/xml' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

let pdfUrl = null;
async function toPdf() {
  await toAkn();
  const status = t => { $('pdf-status').textContent = t; };
  const t0 = Date.now();
  const pdf = await BD.cleanCopyPdf(aknText, status);
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  $('pdf-open').disabled = $('pdf-save').disabled = false; $('pdf-actions').hidden = false;
  status('Clean copy ready (' + Math.max(1, Math.round(pdf.length / 1024)) + ' KB, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s).');
}
function savePdf() {
  const a = el('a', { href: pdfUrl, download: ($('lbd').value.trim() || 'bill') + ' clean copy.pdf' });
  document.body.append(a); a.click(); a.remove();
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
  // Opening a tab brings it up to date: checks run, the clean-copy summary reflects the bill information.
  if (name === 'checks' && inWord) busy($('run-checks'), runChecks);
  if (name === 'export') infoSummary();
  if (name === 'draft' && inWord) busy(null, refresh);
}
function openHistory() { $('history-card').hidden = false; $('history-card').scrollIntoView({ block: 'nearest' }); $('history-fix').focus(); }
function showSeg(name) {
  for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-selected', String(b.dataset.seg === name));
  for (const p of document.querySelectorAll('[data-segpanel]')) p.hidden = p.dataset.segpanel !== name;
}
function effPreview() {
  const addons = [...document.querySelectorAll('#eff-addons input:checked')].map(i => i.value);
  $('eff-preview').textContent = BD.effectiveText($('eff-form').value, addons);
}
function wire() {
  for (const b of document.querySelectorAll('nav button')) b.onclick = () => showTab(b.dataset.tab);
  for (const b of document.querySelectorAll('.seg button')) b.onclick = () => showSeg(b.dataset.seg);
  const on = (id, fn) => { const b = $(id); b.onclick = () => busy(b, fn); };
  $('notice-close').onclick = () => { $('notice').hidden = true; };
  on('go-bank', async () => showTab('bank')); on('go-bank2', async () => showTab('bank'));
  on('nb-go', newBill); on('renumber', () => renumber());
  $('nb-subject').onkeydown = e => { if (e.key === 'Enter') $('nb-go').click(); };
  // The title follows the subject line: rebuilt when it changes.
  $('subject').onchange = () => busy(null, async () => { await updateTitle(null); notice('Title rebuilt.'); });
  $('subject').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  on('insert-amend', insertAmendment); on('mark', markChanges); on('history-apply', applyHistory);
  on('dock-check', async () => showTab('checks'));
  on('history-open', async () => openHistory()); $('history-close').onclick = () => { $('history-card').hidden = true; };
  $('history-fix').onkeydown = e => { if (e.key === 'Enter') $('history-apply').click(); };
  on('picked-clear', async () => clearPick());
  on('add-short', () => addStandard('shortTitle')); on('add-findings', () => addStandard('findings'));
  on('add-sev', () => addStandard('severability')); on('add-new', () => addStandard('new')); on('add-eff', setEffective);
  $('st-name').onkeydown = e => { if (e.key === 'Enter') $('add-short').click(); };
  on('refresh', refresh); on('run-checks', runChecks);
  on('to-akn', async () => { await toAkn(); $('akn-card').open = true; });
  on('akn-copy', async () => { $('akn-out').select(); try { await navigator.clipboard.writeText(aknText); } catch (e) { document.execCommand('copy'); } notice('Copied.'); });
  on('akn-save', async () => saveAkn());
  on('to-pdf', toPdf); on('pdf-save', async () => savePdf());
  on('pdf-open', async () => { if (!window.open(pdfUrl, '_blank')) savePdf(); });
  on('bank-clear', async () => { if (!confirmClear()) return; await BD.bank.clear(); await showBank(); await fillLaws(); notice('The Bank was removed from this computer.'); });
  // Bill information is saved as it is typed.
  let st; for (const [id] of INFO) $(id).addEventListener('input', () => { infoSummary(); clearTimeout(st); st = setTimeout(() => busy(null, () => saveInfo(true)), 600); });
  // Law and section search, with the arrow keys and Enter.
  // A new search puts the last pick away, so the form always acts on what is shown.
  let t; $('sec-q').oninput = () => { if (pick.sec) { pick.sec = null; $('picked').hidden = true; $('action').disabled = true; } clearTimeout(t); t = setTimeout(() => busy(null, search), 150); };
  $('sec-q').onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveActive(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter') { e.preventDefault(); const items = [...$('sec-results').querySelectorAll('li[role=option]')]; const li = items[active >= 0 ? active : 0]; if (li) li.click(); }
  };
  for (const r of document.querySelectorAll('input[name=act]')) r.onchange = actionChanged;
  for (const id of ['sub', 'add-num', 'add-sub']) $(id).addEventListener('input', actionChanged);
  for (const id of ['bank-folder', 'bank-files']) $(id).onchange = e => busy(null, () => loadBankFiles(e.target.files));
  const form = $('eff-form');
  for (const [label, text] of BD.EFF_FORMS) form.append(el('option', { value: text, textContent: label }));
  for (const [key, label] of BD.EFF_ADDONS) $('eff-addons').append(el('label', {}, el('input', { type: 'checkbox', value: key }), label));
  form.onchange = effPreview; $('eff-addons').onchange = effPreview; effPreview();
}
// The pane's own dialogs can't use confirm() inside Word, so the button asks by changing its label once.
function confirmClear() {
  const b = $('bank-clear');
  if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Remove the Bank from this computer'; return true; }
  b.dataset.armed = '1'; b.textContent = 'Press again to remove all laws from this computer';
  setTimeout(() => { delete b.dataset.armed; b.textContent = 'Remove the Bank from this computer'; }, 5000);
  return false;
}

async function start(host) {
  wire();
  inWord = host === 'Word';
  if (!inWord) notice('This pane works inside Word. Here you can still load the Bank.', false);
  await showBank(); await fillLaws();
  if (inWord) {
    await busy(null, refresh);
    const info = await loadInfo().catch(() => ({}));
    for (const [id] of INFO) if (info[id]) $(id).value = info[id];
    if (!$('year').value) { const y = new Date().getFullYear(); $('year').value = String(y % 2 ? y : y - 1); }
  }
  infoSummary(); welcome();
}
if (window.Office && Office.onReady) Office.onReady(info => start(info && info.host));
else document.addEventListener('DOMContentLoaded', () => start(null));
