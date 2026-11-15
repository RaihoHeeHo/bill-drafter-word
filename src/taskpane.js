/* Bill Drafter for Word (demo) - the task pane: the Word side of the libraries in src/lib.
   Every change to the document goes through tagged content controls (FORMAT.md). */
'use strict';
const $ = id => document.getElementById(id);
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props || {}); for (const k of kids) e.append(k); return e; };
let inWord = false;
// 'bill': drafting a bill from the Bank. 'budget': an appropriation bill laid out from its XML (src/budgetpane.js).
let mode = 'bill';

/* ---------- small helpers ---------- */
// Messages show as a toast just above the buttons at the bottom, where the drafter's eyes are after pressing one.
// Errors stay until dismissed; other messages go after a few seconds.
function notice(text, isError) {
  const n = $('notice'); $('notice-text').textContent = text; n.className = 'notice' + (isError ? ' error' : ''); n.hidden = !text;
  clearTimeout(notice.t); if (text && !isError) notice.t = setTimeout(() => { n.hidden = true; }, 7000);
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
  await refresh(); notice('Bill started. Add its sections below: the first one you add takes the place of the blank section 1.');
}

/* ---------- amending a law ----------
   One box finds both: "GCN 12", "executive 296", "tax 606(c)", "general construction affidavit". The words that
   name a law (its Bank ID or words of its name) come first; what follows is a section number or heading words. */
const pick = { law: null, sec: null, unit: null };
let bankIdx = {};
async function fillLaws() {
  bankIdx = await BD.bank.index();
  const empty = !Object.keys(bankIdx).length;
  $('bank-empty').hidden = !empty; $('sec-q').disabled = empty; $('sec-help').hidden = empty || !!pick.sec;
  const n = Object.keys(bankIdx).length, b = $('bank-btn');
  b.textContent = empty ? 'Load the Bank' : 'Bank · ' + n + ' law' + (n === 1 ? '' : 's'); b.classList.toggle('warn', empty);
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
  $('sec-preview').textContent = BD.lawParagraphs(s.text).map(p => BD.isTable(p) ? '[table, ' + p.rows.length + ' rows]\n' + p.rows.map(r => r.cells.map(c => String(c).replace(/\n/g, ' ')).join('  |  ')).join('\n') : p).join('\n');
  $('sec-preview-box').hidden = !!s.missing; $('sec-preview-box').open = false;
  $('sec-help').hidden = true;
  showActions();
  $('action').scrollIntoView({ block: 'nearest' });
}
function clearPick() {
  pick.law = null; pick.sec = null; pick.unit = null;
  $('picked').hidden = true; $('action').hidden = true; $('sec-help').hidden = false; $('sec-q').value = ''; $('sec-q').focus();
}
const subsecs = () => BD.usesSubsections(pick.law && pick.law.info.lawId);
function showActions() {
  const s = pick.sec, subs = s.missing ? [] : BD.subdivisions(BD.lawParagraphs(s.text), subsecs());
  $('action').hidden = false;
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
  // Every pick starts from what was asked for, never from the last section's choice (a repeal left selected
  // would repeal the next section too): a new number adds it, a unit typed amends that unit, otherwise amend.
  if (s.missing) radio('add').checked = true;
  else if (pick.unit && subs.some(x => x.unit.toLowerCase() === pick.unit.toLowerCase())) { radio('amendSub').checked = true; sub.value = subs.find(x => x.unit.toLowerCase() === pick.unit.toLowerCase()).unit; }
  else radio('amend').checked = true;
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
// The Bank's text as the document holds it: a paragraph as one run; a table as it is (its cells are text).
const asRuns = p => BD.isTable(p) ? p : [{ t: p, k: '' }];
async function insertAmendment() {
  const law = pick.law, s = pick.sec; if (!law || !s) throw new Error('Find the section first: type the law and the section, e.g. "GCN 12", and pick it from the list.');
  const how = document.querySelector('input[name=act]:checked').value, history = historyText();
  let o;
  if (how === 'amend') o = { act: 'amend', loc: s.loc, quoted: BD.lawParagraphs(s.text).map(asRuns) };
  else if (how === 'amendSub') {
    const unit = $('sub').value, sub = BD.subdivisions(BD.lawParagraphs(s.text), BD.usesSubsections(law.info.lawId)).find(x => x.unit === unit);
    o = { act: 'amend', loc: s.loc, unit, quoted: sub.paras.map(asRuns) };
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
  clearPick(); $('sec-q').blur();
  notice(o.act === 'repeal' ? 'Repeal inserted.' : o.act === 'add' ? 'New ' + (o.unit ? 'unit' : 'section') + ' inserted, all underlined. Type over the ____ in the document.' : 'Section inserted with the law\'s text. Edit it in the document as you would any text, then press Mark changes.');
}
// Brackets and underlines from comparing each amended text with the Bank.
// The marking as one string, to tell whether marking again would change anything (tables always count as changed).
const canonRuns = rs => { if (typeof rs === 'string') rs = [{ t: rs, k: '' }]; const m = []; for (const r of rs) { const t = String(r.t).replace(/\s+/g, ' '), l = m[m.length - 1]; if (l && l.k === (r.k || '')) l.t += t; else m.push({ k: r.k || '', t }); } return m.map(x => x.k + '\u0001' + x.t.trim()).filter(x => x.length > 2); };
const canon = paras => JSON.stringify(paras.map(p => BD.isTable(p) ? { caption: canonRuns(p.caption || ''), rows: p.rows.map(r => [r.kind || '', ...r.cells.map(canonRuns)]) } : canonRuns(p)));
// Compares each amended text with the Bank and writes the brackets and underlines; returns what it did.
// quiet: no message (Make the clean copy and the XML export run it first and report themselves).
async function markChanges(quiet) {
  let done = 0, checked = 0; const problems = [];
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
        if (!want) { problems.push({ where: (c.title || tag.loc), why: law ? 'the provision it amends is not in the Bank as cited' : 'the ' + tag.law + ' law is not in the Bank on this computer' }); continue; }
        out = BD.markChanges(want, now);
      }
      checked++;
      const was = canon(s.quoted.paras), will = canon(out);
      if (was === will) continue; // already marked as the Bank says
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
  await refresh();
  const skipped = problems.map(x => x.where + ': ' + x.why).join('; ');
  if (!quiet) notice(done ? 'Brackets and underlines put in ' + done + ' section' + (done === 1 ? '' : 's') + '.' + (skipped ? ' Not marked: ' + skipped : '')
    : checked ? 'Brackets and underlines were already as the Bank says.' + (skipped ? ' Not marked: ' + skipped : '') : problems.length ? 'Not marked: ' + skipped : 'No amended sections to mark.', !!problems.length);
  return { done, checked, problems };
}
// Nothing leaves the add-in with unmarked changes. Before a clean copy or the XML is made, every amended text is
// marked again against the Bank, so the bill can't print the law as other than it stands (words taken out of the
// law silently, or words shown as law that aren't). A section that can't be checked against the Bank stops it.
async function markedForExport() {
  const r = await markChanges(true);
  const model = await word(readModel), found = await BD.check(model, getLaw);
  const stop = found.filter(f => f.sec != null && f.level === 'error' && (f.rule === 'Marking' || f.rule === 'Citation' || f.rule === 'Structure' && /text of the law/.test(f.text)) || f.rule === 'Bank' && f.sec != null);
  // one line per section: what marking found, else what Check found
  const numOf_ = t => (/^(Section \d+|§ \d+)/.exec(t) || [t])[0];
  const lines = new Map(r.problems.map(x => [numOf_(x.where), x.where.replace(/\.$/, '') + ' (' + x.why + ')']));
  for (const f of stop) { const n = numOf_(model.sections[f.sec].num || ''); if (!lines.has(n)) lines.set(n, n + ' (' + f.text.replace(/\.$/, '') + ')'); }
  const where = [...lines.values()];
  if (where.length) throw new Error('Not made: the brackets and underlines of ' + (where.length === 1 ? 'this section' : 'these sections') + ' can\'t be checked against the Bank, so the copy could show the law as other than it stands. ' + where.join('; ') + '. Load the Bank, or fix the citation, and try again.');
  return { model, found, marked: r.done };
}

// "As amended by …": what the drafter typed, as the clause will cite it.
function historyText(id, typed) {
  const h = (typed != null ? typed : $(id || 'history').value).trim().replace(/^,\s*/, '').replace(/[,.]\s*$/, '');
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
// Put the history into the amending clause of section i, in place of any history it cites.
async function applyHistory(i, typed) {
  const h = historyText(null, typed);
  if (!h) throw new Error('Type the history first, e.g. "chapter 55 of the laws of 2023".');
  let where = '';
  await word(async ctx => quietly(ctx, async () => {
    const sec = (await sectionControls(ctx))[i];
    if (!sec) throw new Error('That section is no longer in the bill.');
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
  await refresh();
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
  notice({ shortTitle: 'Short title added as section 1.', findings: 'Findings added. Fill in the blank in the document.', severability: 'Severability clause added before the effective date.', new: 'Blank section added. Type over the ____ in the document.' }[kind]);
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

/* ---------- the section list, kept up to date ----------
   refresh() reads the bill and runs the checks, so the list can show each section's state (to fix, edits not
   marked, history wanted) with its fix next to it. It runs after every change the pane makes and whenever the
   drafter comes back to the pane from the document. */
const KIND = { amend: 'Amend', add: 'Add', repeal: 'Repeal', new: '', shortTitle: 'Short title', findings: 'Findings', severability: 'Severability', effective: 'Effective date' };
const SHORT = { Blanks: 'Fill in the blank', Citation: 'Citation', 'Already in law': 'Number taken', 'Amending clause': 'Clause', 'Effective date': 'Effective date', 'Short title': 'Short title', Structure: 'Missing text', Brackets: 'Brackets' };
// openRow: the section whose history is being typed (rowDraft keeps what was typed across refreshes).
let state = { model: null, found: [] }, hasBill = false, refreshing = null, again = false, openRow = null, rowDraft = '', rowFocus = false;
const numOf = s => (s && s.num || '').replace(/\.$/, '') || 'that section';
async function refresh() {
  if (!inWord) return;
  if (mode === 'budget') return BUD.refresh();
  if (refreshing) { again = true; return refreshing; }
  refreshing = (async () => {
    do { again = false; await refreshOnce(); } while (again);
  })().finally(() => { refreshing = null; });
  return refreshing;
}
// Clicking the pane focuses it, which starts a refresh; the list is not redrawn while the mouse button is down, or
// the button under it would be replaced before the click lands.
let pointerDown = false, released = [];
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', () => { pointerDown = false; setTimeout(() => { const r = released; released = []; r.forEach(f => f()); }, 0); }, true);
const mouseUp = () => pointerDown ? new Promise(r => released.push(r)) : null;
async function refreshOnce() {
  const model = await Word.run(readModel);
  const found = await BD.check(model, getLaw);
  await mouseUp();
  state = { model, found, at: Date.now() };
  hasBill = !!(model.title || model.sections.length);
  for (const id of ['add-card', 'dock']) $(id).hidden = !hasBill;
  $('no-bill').hidden = hasBill; $('bill-card').hidden = !hasBill;
  document.body.classList.toggle('has-dock', hasBill && !$('dock').closest('[data-panel]').hidden);
  welcome();
  if (model.title && document.activeElement !== $('subject')) $('subject').value = model.title.subject.replace(/^_+$/, '');
  $('subject').classList.toggle('need', found.some(f => f.fix === 'subject'));
  drawOutline(model, found); billFixes(found); dockStatus(model, found); stdButtons(model); listTables(model);
  const errs = found.filter(f => f.level === 'error').length;
  $('check-count').textContent = String(errs); $('check-count').hidden = !errs || !hasBill;
  return model;
}
function drawOutline(model, found) {
  const ol = $('outline'); ol.innerHTML = '';
  model.sections.forEach((s, i) => {
    const what = s.law ? KIND[s.act] + ' ' + s.law + ' § ' + BD.secId(s.loc) + (s.unit ? (BD.usesSubsections(s.law) ? '(' + s.unit + ')' : ' subd. ' + s.unit) : '') : (KIND[s.act] || (s.heading || s.text || '').replace(/_{2,}/g, '…').slice(0, 40) || 'Blank section');
    const mine = found.filter(f => f.sec === i);
    const main = el('button', { className: 'row-main', title: (s.num || '') + ' ' + what + ': go to it in the document' }, el('span', { className: 'n', textContent: s.num || '?' }), el('span', { className: 'k', textContent: what }));
    main.onclick = () => busy(null, () => goTo(i));
    const chips = el('span', { className: 'chips' });
    const chip = (text, cls, title, fn) => { const b = el('button', { className: 'chip ' + cls, textContent: text, title }); b.onclick = e => { e.stopPropagation(); busy(b, fn); }; chips.append(b); };
    const mark = mine.find(f => f.fix === 'mark'), hist = mine.find(f => f.fix === 'history');
    const others = mine.filter(f => f.level === 'error' && f.fix !== 'mark' && f.fix !== 'renumber');
    if (mark) chip('Not marked', 'err', 'Edits in the law\'s text are not bracketed and underlined yet. Press to mark them.', () => markChanges());
    if (others.length) chip(others.length === 1 ? (SHORT[others[0].rule] || others[0].rule) : others.length + ' to fix', 'err', others.map(f => f.text).join('\n'), async () => showTab('checks', i));
    if (hist) chip('Add history', 'warn', 'The amending clause should cite the last amendment. The Bank does not have it: type it in.', async () => { openRow = openRow === i ? null : i; rowDraft = ''; rowFocus = true; drawOutline(state.model, state.found); });
    if (!mine.some(f => f.level === 'error' || f.fix === 'history') && (s.act === 'amend' || s.act === 'add' || s.act === 'repeal')) chips.append(el('span', { className: 'ok', textContent: '✓', title: 'Nothing to fix' }));
    const li = el('li', { className: openRow === i ? 'open' : '' }, el('div', { className: 'line' }, main, chips));
    li.dataset.i = String(i);
    if (openRow === i && hist) {
      const inp = el('input', { placeholder: 'chapter 55 of the laws of 2023', autocomplete: 'off', value: rowDraft });
      inp.oninput = () => { rowDraft = inp.value; };
      inp.setAttribute('aria-label', 'As amended by');
      const put = el('button', { className: 'primary', textContent: 'Put it in' });
      put.onclick = () => busy(put, async () => { await applyHistory(i, inp.value); openRow = null; drawOutline(state.model, state.found); });
      inp.onkeydown = e => { if (e.key === 'Enter') put.click(); if (e.key === 'Escape') { openRow = null; drawOutline(state.model, state.found); } };
      li.append(el('div', { className: 'row-edit' }, el('label', { textContent: 'As amended by' }), el('div', { className: 'row' }, inp, put)));
      if (rowFocus) { rowFocus = false; setTimeout(() => inp.focus()); }
    }
    ol.append(li);
  });
  markCurrent();
}
// Problems with the bill as a whole, each with its fix.
function billFixes(found) {
  const box = $('bill-fixes'); box.innerHTML = '';
  const add = (text, label, fn) => {
    const d = el('div', { className: 'callout' }, el('span', { textContent: text }));
    if (label) { const b = el('button', { className: 'link', textContent: label }); b.onclick = () => busy(b, fn); d.append(' ', b); }
    box.append(d);
  };
  if (found.some(f => f.fix === 'renumber')) add('The sections are not numbered in order.', 'Renumber them', () => renumber());
  else if (found.some(f => f.fix === 'title' && f.level !== 'error' || f.fix === 'title' && /no title/.test(f.text))) add('The title does not match what the sections do.', 'Rebuild the title', async () => { await updateTitle(null); notice('Title rebuilt.'); });
  if (found.some(f => f.fix === 'effective')) add('No effective-date section.', 'Add "This act shall take effect immediately."', async () => { $('eff-form').selectedIndex = 0; effPreview(); await setEffective(); });
  const en = found.find(f => f.rule === 'Enacting clause'); if (en) add(en.text);
}
// The dock says whether the brackets and underlines are up to date.
function dockStatus(model, found) {
  const marked = model.sections.filter(s => s.act === 'amend' || s.act === 'add').length;
  const need = [...new Set(found.filter(f => f.fix === 'mark').map(f => f.sec))].map(i => numOf(model.sections[i]));
  const st = $('dock-status'), m = $('mark');
  m.classList.toggle('primary', need.length > 0 || !marked);
  st.className = 'dock-status' + (need.length ? ' need' : '');
  st.textContent = need.length ? (need.length === 1 ? need[0] + ' has edits' : need.slice(0, -1).join(', ') + ' and ' + need[need.length - 1] + ' have edits') + ' not yet bracketed and underlined.'
    : marked ? 'Brackets and underlines are up to date.' : 'After you edit a law\'s text in the document, Mark changes brackets and underlines it.';
}
// Standard sections already in the bill say so, and the effective date says whether it adds or replaces.
function stdButtons(model) {
  const at = act => model.sections.findIndex(s => s.act === act);
  for (const [id, act, label] of [['add-short', 'shortTitle', 'Add'], ['add-findings', 'findings', 'Add'], ['add-sev', 'severability', 'Add']]) {
    const i = at(act), b = $(id);
    b.textContent = i < 0 ? label : 'Go to ' + numOf(model.sections[i]);
    b.dataset.go = i < 0 ? '' : String(i);
  }
  $('st-name').hidden = at('shortTitle') >= 0;
  const e = model.sections.map(s => s.act).lastIndexOf('effective');
  $('add-eff').textContent = e < 0 ? 'Add this effective date' : 'Replace the effective date (' + numOf(model.sections[e]) + ')';
}
// The getting-started card shows until the Bank is loaded and a bill is started.
function welcome() {
  const bank = Object.keys(bankIdx).length > 0;
  $('step-bank').classList.toggle('done', bank); $('step-bill').classList.toggle('done', hasBill);
  $('welcome').hidden = bank && hasBill || !inWord && bank;
}
async function goTo(i) {
  await word(async ctx => { const secs = await sectionControls(ctx); if (secs[i]) { secs[i].select('Start'); await ctx.sync(); } });
  current = i; markCurrent();
}
// The section holding the cursor is highlighted in the list.
let current = -1;
function markCurrent() { for (const li of $('outline').children) li.classList.toggle('current', +li.dataset.i === current); }
async function findCurrent() {
  if (!inWord) return;
  const i = await Word.run(async ctx => {
    const cc = await sectionAtCursor(ctx); if (!cc) return -1;
    const secs = await sectionControls(ctx); cc.load('id'); secs.forEach(c => c.load('id')); await ctx.sync();
    return secs.findIndex(c => c.id === cc.id);
  }).catch(() => -1);
  if (i !== current) { current = i; markCurrent(); }
}
async function runChecks(focusSec) {
  const model = await refresh() || state.model, found = state.found;
  const ul = $('findings'); ul.innerHTML = '';
  const errs = found.filter(f => f.level === 'error').length, warns = found.filter(f => f.level === 'warning').length, notes = found.length - errs - warns;
  const sum = $('check-summary'), pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  sum.className = 'summary ' + (errs ? 'bad' : warns ? 'meh' : 'good');
  sum.textContent = !found.length ? 'No problems found. The bill is ready for its clean copy.' : [errs && pl(errs, 'error') + ' to fix', warns && pl(warns, 'warning'), notes && pl(notes, 'note')].filter(Boolean).join(', ') + '.';
  if (!found.length) return;
  const FIX = { history: ['Add history', async f => { showTab('draft'); openRow = f.sec; rowDraft = ''; rowFocus = true; drawOutline(state.model, state.found); $('outline').children[f.sec].scrollIntoView({ block: 'center' }); }], renumber: ['Renumber', () => renumber()], title: ['Rebuild the title', () => updateTitle(null)], mark: ['Mark changes', () => markChanges()], effective: ['Add effective date', setEffective], subject: ['Go to the title', async () => { showTab('draft'); $('subject').focus(); }] };
  for (const f of found) {
    const li = el('li', { className: f.level }, el('span', { className: 'rule', textContent: f.rule + ':' }), f.text);
    if (f.sec != null) li.dataset.sec = String(f.sec);
    const acts = el('div', { className: 'where' });
    if (f.sec != null) { const b = el('button', { textContent: 'Go to ' + numOf(model.sections[f.sec]) }); b.onclick = () => busy(b, () => goTo(f.sec)); acts.append(b); }
    if (f.fix && FIX[f.fix]) { const b = el('button', { textContent: FIX[f.fix][0] }); b.onclick = () => busy(b, async () => { await FIX[f.fix][1](f); if (f.fix !== 'history' && f.fix !== 'subject') await runChecks(); }); acts.append(b); }
    if (acts.children.length) li.append(acts);
    ul.append(li);
  }
  if (focusSec != null) { const li = ul.querySelector('li[data-sec="' + focusSec + '"]'); if (li) { li.classList.add('flash'); li.scrollIntoView({ block: 'center' }); } }
}

/* ---------- tables ----------
   The pane's table editor works on the table as the law will read (the "now" reading): rows taken out are not
   shown, new words are plain. Saving writes it into the quoted text as a Word table and runs Mark changes, which
   compares it with the Bank and puts back the brackets and underlines. */
const ed = { sec: null, item: null, table: null, act: '' };
const KINDS = [['', 'Row'], ['head', 'Headings'], ['group', 'Group'], ['note', 'Note']];
const secLabel = s => (s.num || '').replace(/\.$/, '') + ' ' + (KIND[s.act] || '') + (s.law ? ' ' + s.law + ' § ' + BD.secId(s.loc) + (s.unit ? (BD.usesSubsections(s.law) ? '(' + s.unit + ')' : ' subd. ' + s.unit) : '') : '');
function listTables(model) {
  const ul = $('table-list'), sel = $('table-target'); ul.innerHTML = ''; sel.innerHTML = '';
  let any = false;
  model.sections.forEach((s, si) => {
    if (!s.quoted) return;
    sel.append(el('option', { value: String(si), textContent: 'Add to ' + secLabel(s) }));
    s.quoted.paras.forEach((p, pi) => {
      if (!BD.isTable(p)) return;
      any = true;
      const r = BD.tableReadings(p).now, n = BD.tableCols(r);
      const b = el('button', { textContent: 'Edit' }); b.onclick = () => busy(b, async () => openEditor(await word(readModel), si, pi));
      ul.append(el('li', {}, el('span', { className: 'what' }, secLabel(s) + (p.caption ? ', ' + p.caption.replace(/\.$/, '') : ''), el('small', { textContent: n + ' column' + (n === 1 ? '' : 's') + ', ' + r.rows.length + ' row' + (r.rows.length === 1 ? '' : 's') })), b));
    });
  });
  $('table-new-row').hidden = !sel.options.length;
  $('tables-card').hidden = !sel.options.length || !$('table-editor').hidden;
  const n = ul.children.length; $('table-count').textContent = n ? '· ' + n + ' in the bill' : '';
  if (sel.options.length && !any) ul.append(el('li', { className: 'hint', textContent: 'No tables in the bill yet.' }));
}
function openEditor(model, si, pi) {
  const s = model.sections[si];
  ed.sec = si; ed.item = pi; ed.act = s.act;
  if (pi != null) {
    const now = BD.tableReadings(s.quoted.paras[pi]).now;
    ed.table = { caption: now.caption || '', rows: now.rows.map(r => ({ kind: r.kind, cells: r.cells.slice() })) };
  } else ed.table = { caption: '', rows: BD.emptyTable(3, 3).rows };
  $('te-title').textContent = (pi != null ? 'Edit table: ' : 'New table: ') + secLabel(s);
  $('te-hint').textContent = s.act === 'add' ? 'Everything in an added provision is new matter: the whole table will be underlined.' : pi != null ? 'This is the table as the law will read. Rows you delete stay in the bill in brackets; new rows and words are underlined.' : 'A new table in the law is new matter: it will be underlined.';
  $('te-caption').value = ed.table.caption;
  const place = $('te-place'); place.innerHTML = '';
  $('te-place-row').hidden = pi != null;
  if (pi == null) {
    place.append(el('option', { value: String(s.quoted.paras.length - 1), textContent: 'At the end of the text' }));
    s.quoted.paras.forEach((p, i) => { if (!BD.isTable(p)) place.append(el('option', { value: String(i), textContent: 'After "' + BD.textOf(p).slice(0, 48) + '…"' })); });
  }
  $('te-paste').hidden = true;
  drawGrid();
  $('table-editor').hidden = false; $('tables-card').hidden = true;
  $('table-editor').scrollIntoView({ block: 'start' });
}
function closeEditor() { $('table-editor').hidden = true; $('tables-card').hidden = false; ed.table = null; }
const ncols = () => Math.max(1, ...ed.table.rows.map(r => r.cells.length));
function grow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
function drawGrid() {
  const g = $('te-grid'), n = ncols(); g.innerHTML = '';
  for (const r of ed.table.rows) while (r.cells.length < n) r.cells.push('');
  // column tools
  const top = el('tr', {}, el('th', { textContent: '' }));
  for (let c = 0; c < n; c++) {
    const x = el('button', { className: 'mini', textContent: '×', title: 'Delete column ' + (c + 1), disabled: n < 2 });
    x.onclick = () => { for (const r of ed.table.rows) r.cells.splice(c, 1); drawGrid(); };
    top.append(el('th', {}, 'Column ' + (c + 1) + ' ', x));
  }
  g.append(top);
  ed.table.rows.forEach((r, i) => {
    const tr = el('tr', { className: r.kind });
    const kind = el('select', { title: 'What this row is' });
    for (const [v, t] of KINDS) kind.append(el('option', { value: v, textContent: t, selected: r.kind === v }));
    kind.onchange = () => {
      r.kind = kind.value;
      if (r.kind === 'group' || r.kind === 'note') { r.cells = [r.cells.filter(Boolean).join(' ') || (r.kind === 'group' ? 'Group A:' : '{1} ')].concat(new Array(n - 1).fill('')); }
      drawGrid();
    };
    const btn = (t, title, fn) => { const b = el('button', { className: 'mini', textContent: t, title }); b.onclick = fn; return b; };
    const blank = () => ({ kind: '', cells: new Array(n).fill('') });
    tr.append(el('td', { className: 'tools' }, kind,
      btn('+↑', 'Add a row above', () => { ed.table.rows.splice(i, 0, blank()); drawGrid(); }),
      btn('+↓', 'Add a row below', () => { ed.table.rows.splice(i + 1, 0, blank()); drawGrid(); }),
      btn('×', 'Delete this row', () => { ed.table.rows.splice(i, 1); if (!ed.table.rows.length) ed.table.rows.push(blank()); drawGrid(); })));
    const span = r.kind === 'group' || r.kind === 'note';
    for (let c = 0; c < (span ? 1 : n); c++) {
      const ta = el('textarea', { value: r.cells[c] || '', rows: 1, 'aria-label': 'Row ' + (i + 1) + ', column ' + (c + 1) });
      ta.setAttribute('aria-label', span ? 'Row ' + (i + 1) : 'Row ' + (i + 1) + ', column ' + (c + 1));
      ta.oninput = () => { r.cells[c] = ta.value; grow(ta); };
      const td = el('td', {}, ta); if (span) td.colSpan = n;
      tr.append(td);
      setTimeout(() => grow(ta));
    }
    g.append(tr);
  });
}
async function saveTable() {
  const t = ed.table, n = ncols();
  const rows = t.rows.map(r => ({ kind: r.kind, cells: r.cells.slice(0, n).map(c => String(c || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()) }))
    .filter(r => r.cells.some(Boolean));
  if (!rows.some(r => r.kind === '' || r.kind === 'group')) throw new Error('The table has no rows yet: type at least one row.');
  const caption = $('te-caption').value.trim().replace(/^table\b/i, m => m.toUpperCase());
  const table = caption ? { table: true, caption, rows } : { table: true, rows };
  const si = ed.sec, item = ed.item, after = +$('te-place').value;
  await word(async ctx => quietly(ctx, async () => {
    const secs = await sectionControls(ctx), c = secs[si];
    if (!c) throw new Error('That section is no longer in the bill.');
    const ox = c.getOoxml(); await ctx.sync();
    const s = BD.readBill(ox.value).sections[0];
    const paras = s.quoted.paras.slice();
    if (item != null) paras[item] = table; else paras.splice(after + 1, 0, table);
    const tag = BD.parseTag(c.tag);
    await replaceControl(ctx, c, BD.sectionXml({ act: tag.act, law: tag.law, loc: tag.loc, unit: tag.unit, num: s.num, heading: s.heading, clause: s.clause, content: s.paras[0] || [], more: s.paras.slice(1), quoted: paras }));
  }));
  closeEditor();
  await markChanges();
  await refresh();
  notice((item != null ? 'Table saved' : 'Table added') + ' and marked against the Bank.');
}
function pasteRows() {
  const t = BD.tableFromText($('te-paste-text').value, $('te-paste-head').checked);
  if (!t) throw new Error('Paste or type the rows first.');
  ed.table.rows = t.rows.map(r => ({ kind: r.kind, cells: r.cells.map(String) }));
  $('te-paste').hidden = true; $('te-paste-text').value = '';
  drawGrid();
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
  sum.textContent = what + '.';
  for (const [id] of INFO) $(id).classList.remove('need');
  if (missing.length) {
    const ids = { 'the LBD number': 'lbd', 'the sponsor': 'sponsor', 'the date introduced': 'bdate' };
    for (const m of missing) $(ids[m]).classList.add('need');
    const b = el('button', { className: 'link', textContent: 'Add ' + missing.join(' and ') });
    b.onclick = () => { const f = $(ids[missing[0]]); f.scrollIntoView({ block: 'center' }); f.focus(); };
    sum.append(' ', b, '.');
  }
}
const paneInfo = () => ({ lbd: $('lbd').value.trim(), year: $('year').value.trim(), house: $('house').value, billNumber: $('billno').value.trim(), sponsor: $('sponsor').value.trim(), committee: $('committee').value.trim(), date: $('bdate').value || undefined });
let aknText = '';
async function toAkn() {
  const { model, found, marked } = await markedForExport();
  const laws = {}, info = { ...paneInfo(), lawNames: await lawNamesFor(model, laws), laws };
  if (!info.year && info.date) info.year = info.date.slice(0, 4);
  aknText = BD.toAkn(model, info);
  $('akn-out').value = aknText; $('akn-copy').disabled = $('akn-save').disabled = false;
  return { errs: found.filter(f => f.level === 'error').length, marked };
}
function saveAkn() {
  const name = ($('lbd').value.trim() || 'bill') + '.akn.xml';
  const a = el('a', { href: URL.createObjectURL(new Blob([aknText], { type: 'application/xml' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

let pdfUrl = null;
async function toPdf() {
  $('pdf-actions').hidden = true; $('pdf-status').textContent = 'Checking the brackets and underlines against the Bank…';
  const { errs, marked } = await toAkn();
  const status = t => { $('pdf-status').textContent = t; };
  const t0 = Date.now();
  const pdf = await BD.cleanCopyPdf(aknText, status);
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  $('pdf-open').disabled = $('pdf-save').disabled = false; $('pdf-actions').hidden = false;
  status('Clean copy ready (' + Math.max(1, Math.round(pdf.length / 1024)) + ' KB, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s). ' +
    (marked ? 'Changes were marked against the Bank first in ' + marked + ' section' + (marked === 1 ? '' : 's') + '.' : 'Brackets and underlines checked against the Bank.'));
  if (errs) {
    const b = el('button', { className: 'link', textContent: 'Show them' }); b.onclick = () => showTab('checks');
    $('pdf-status').append(' Check found ' + errs + ' error' + (errs === 1 ? '' : 's') + ' to fix before it goes out. ', b);
  }
  $('pdf-actions').scrollIntoView({ block: 'nearest' });
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
function showTab(name, focusSec) {
  for (const b of document.querySelectorAll('nav button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
  $('bank-btn').classList.toggle('on', name === 'bank');
  document.body.classList.toggle('has-dock', name === 'draft' && hasBill);
  if (!$('notice').classList.contains('error')) $('notice').hidden = true;
  window.scrollTo(0, 0);
  // Opening a tab brings it up to date: checks run, the clean-copy summary reflects the bill information.
  if (mode === 'budget') { document.body.classList.toggle('has-dock', name === 'draft' && !$('b-dock').hidden); BUD.onTab(name, focusSec); return; }
  if (name === 'checks' && inWord) busy($('run-checks'), () => runChecks(focusSec));
  if (name === 'export') infoSummary();
  if (name === 'draft' && inWord) busy(null, refresh);
}
// Bill or budget: each tab shows the part of itself for that kind of work.
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('.mode button')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
  for (const d of document.querySelectorAll('[data-mode]:not(button)')) d.hidden = d.dataset.mode !== m;
  $('bank-btn').hidden = m === 'budget';
  const cur = document.querySelector('nav button[aria-selected="true"]');
  showTab(cur ? cur.dataset.tab : 'draft');
}
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
  for (const b of document.querySelectorAll('.mode button')) b.onclick = () => setMode(b.dataset.mode);
  const on = (id, fn) => { const b = $(id); b.onclick = () => busy(b, fn); };
  $('notice-close').onclick = () => { $('notice').hidden = true; };
  on('go-bank', async () => showTab('bank')); on('go-bank2', async () => showTab('bank'));
  on('bank-btn', async () => showTab('bank')); on('bank-back', async () => showTab('draft'));
  on('nb-go', newBill);
  $('nb-subject').onkeydown = e => { if (e.key === 'Enter') $('nb-go').click(); };
  // The title follows the subject line: rebuilt when it changes.
  $('subject').onchange = () => busy(null, async () => { await updateTitle(null); notice('Title rebuilt.'); });
  $('subject').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  on('insert-amend', insertAmendment); on('mark', () => markChanges());
  on('dock-check', async () => showTab('checks'));
  on('picked-clear', async () => clearPick());
  // A standard section already in the bill: its button goes to it instead of adding another.
  const stdOr = (id, kind) => on(id, async () => { const g = $(id).dataset.go; if (g) await goTo(+g); else await addStandard(kind); });
  stdOr('add-short', 'shortTitle'); stdOr('add-findings', 'findings'); stdOr('add-sev', 'severability');
  on('add-new', () => addStandard('new')); on('add-eff', setEffective);
  $('st-name').onkeydown = e => { if (e.key === 'Enter') $('add-short').click(); };
  on('run-checks', () => runChecks());
  // Tables
  on('table-new', async () => { const model = await word(readModel); openEditor(model, +$('table-target').value, null); });
  on('te-add-row', async () => { ed.table.rows.push({ kind: '', cells: new Array(ncols()).fill('') }); drawGrid(); });
  on('te-add-col', async () => { for (const r of ed.table.rows) r.cells.push(''); drawGrid(); });
  on('te-paste-toggle', async () => { $('te-paste').hidden = !$('te-paste').hidden; if (!$('te-paste').hidden) $('te-paste-text').focus(); });
  on('te-paste-go', async () => pasteRows());
  on('te-save', saveTable);
  $('te-cancel').onclick = closeEditor; $('te-close').onclick = closeEditor;
  on('to-akn', async () => { await toAkn(); $('akn-card').open = true; });
  on('akn-copy', async () => { await toAkn(); $('akn-out').select(); try { await navigator.clipboard.writeText(aknText); } catch (e) { document.execCommand('copy'); } notice('Copied.'); });
  on('akn-save', async () => { await toAkn(); saveAkn(); });
  on('to-pdf', toPdf); on('pdf-save', async () => savePdf());
  on('pdf-open', async () => { if (!window.open(pdfUrl, '_blank')) savePdf(); });
  on('bank-clear', async () => { if (!confirmClear()) return; await BD.bank.clear(); await showBank(); await fillLaws(); notice('The Bank was removed from this computer.'); });
  // Bill information is saved as it is typed.
  let st; for (const [id] of INFO) $(id).addEventListener('input', () => { infoSummary(); clearTimeout(st); st = setTimeout(() => busy(null, () => saveInfo(true)), 600); });
  // Law and section search, with the arrow keys and Enter.
  // A new search puts the last pick away, so the form always acts on what is shown.
  let t; $('sec-q').oninput = () => { if (pick.sec) { pick.sec = null; $('picked').hidden = true; $('action').hidden = true; } $('sec-help').hidden = !!$('sec-q').value.trim(); clearTimeout(t); t = setTimeout(() => busy(null, search), 150); };
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
  // A document that holds a budget bill opens in budget mode.
  const hasBudget = await BUD.init().catch(e => { console.error(e); return false; });
  if (inWord && hasBudget) setMode('budget');
  if (!inWord) notice('This pane works inside Word. Here you can still load the Bank.', false);
  await showBank(); await fillLaws();
  if (inWord) {
    await busy(null, refresh);
    const info = await loadInfo().catch(() => ({}));
    for (const [id] of INFO) if (info[id]) $(id).value = info[id];
    if (!$('year').value) { const y = new Date().getFullYear(); $('year').value = String(y % 2 ? y : y - 1); }
  }
  infoSummary(); welcome();
  if (inWord) {
    // Coming back to the pane after editing the document brings the section list up to date.
    const back = () => { if (!document.hidden && Date.now() - (state.at || 0) > 1500) busy(null, refresh); };
    window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
    try {
      let ct; Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => { clearTimeout(ct); ct = setTimeout(() => mode === 'budget' ? BUD.cursor() : findCurrent(), 400); });
    } catch (e) { /* not in every host */ }
  }
}
if (window.Office && Office.onReady) Office.onReady(info => start(info && info.host));
else document.addEventListener('DOMContentLoaded', () => start(null));
