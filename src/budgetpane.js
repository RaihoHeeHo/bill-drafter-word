/* Bill Drafter for Word (demo) - the task pane's budget mode: an appropriation bill laid out in the document from
   its XML (kept in the document as a custom XML part), changed in the document, checked and printed from the XML.
   Uses the pane's helpers in taskpane.js ($, el, notice, busy, word, quietly, replaceControl, padded, tidy). */
'use strict';
const BUD = (() => {
  const B = BD.budget, BW = BD.budgetWord, NSX = 'urn:x-lbdc:bill-drafter';
  const S = { doc: null, opened: null, sample: null, parts: {}, index: null, prior: null, priorInfo: null, vetoes: null, lines: null, vetoDate: null, earlier: {}, pending: { edited: [], missing: [] }, cursor: null, totals: [], pdfUrl: null };
  const xml = d => new XMLSerializer().serializeToString(d).replace(/^<\?xml[^>]*>\s*/, '');
  const byEId = id => S.doc && B._.byEId(S.doc, id);
  const flat = t => String(t || '').replace(/\s+/g, ' ').trim();
  const fmt = B.fmt, pl = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
  const sampleUrl = f => new URL('samples/budget/' + f, document.baseURI).href;
  async function fetchText(f) { const r = await fetch(sampleUrl(f)); if (!r.ok) throw new Error('Could not load ' + f + ' (' + r.status + ').'); return r.text(); }
  const readFile = f => f.text();

  /* ---------- the XML in the document (custom XML parts) ---------- */
  const call = (fn, ...a) => new Promise((res, rej) => fn(...a, r => (r.status === 'succeeded' || (Office.AsyncResultStatus && r.status === Office.AsyncResultStatus.Succeeded)) ? res(r.value) : rej(new Error((r.error && r.error.message) || 'Word could not store the bill\'s XML.'))));
  const cxp = () => Office.context.document.customXmlParts;
  const cdata = s => '<![CDATA[' + s.replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
  async function putPart(role, d) {
    if (S.parts[role]) { try { await call(S.parts[role].deleteAsync.bind(S.parts[role])); } catch (e) { /* already gone */ } }
    S.parts[role] = await call(cxp().addAsync.bind(cxp()), '<budget xmlns="' + NSX + '" role="' + role + '"' + (S.sample ? ' sample="' + S.sample.id + '"' : '') + '>' + cdata(xml(d)) + '</budget>');
  }
  const store = () => putPart('current', S.doc);
  async function load() {
    if (!inWord || !Office.context.document || !Office.context.document.customXmlParts) return false;
    const ps = await call(cxp().getByNamespaceAsync.bind(cxp()), NSX);
    let sampleId = null;
    for (const p of ps) {
      const r = new DOMParser().parseFromString(await call(p.getXmlAsync.bind(p)), 'application/xml').documentElement;
      const role = r.getAttribute('role'); S.parts[role] = p; sampleId = r.getAttribute('sample') || sampleId;
      if (role === 'current') S.doc = B.parse(r.textContent); else if (role === 'opened') S.opened = B.parse(r.textContent);
    }
    if (!S.doc) return false;
    if (!S.opened) S.opened = B.parse(xml(S.doc));
    if (sampleId) { await index(); S.sample = (S.index.bills || []).find(b => b.id === sampleId) || null; await companions(); }
    return true;
  }
  async function index() { if (!S.index) S.index = JSON.parse(await fetchText('index.json')); return S.index; }
  // The files that come with a demo bill: last year's chapter, the line vetoes, the earlier print.
  async function companions() {
    const s = S.sample; if (!s) return;
    if (s.prior && !S.prior) { S.prior = B.parse(await fetchText(s.prior.file)); S.priorInfo = { chapter: s.prior.chapter, year: s.prior.year, title: s.prior.title }; }
    if (s.vetoes && !S.vetoes) { S.vetoes = JSON.parse(await fetchText(s.vetoes.file)); S.lines = JSON.parse(await fetchText(s.vetoes.lines)); S.vetoDate = s.vetoes.date; S.vetoTitle = s.vetoes.title; }
    if (s.earlier && !S.earlier.sample) S.earlier.sample = { doc: B.parse(await fetchText(s.earlier.file)), title: s.earlier.title };
  }

  /* ---------- opening a bill ---------- */
  async function openBill(text, sample) {
    const d = B.parse(text);
    if (d.getElementsByTagName('parsererror').length) throw new Error('That file is not well-formed XML.');
    const bill = d.getElementsByTagNameNS(B.A, 'bill')[0];
    if (!bill || !B.items(d).length) throw new Error('That XML is not an appropriation bill: it has no agencies and items.');
    S.doc = d; S.opened = B.parse(text); S.sample = sample || null; S.prior = null; S.vetoes = null; S.earlier = {};
    const pieces = BW.renderBill(d);
    await word(async ctx => quietly(ctx, async () => {
      for (let i = 0; i < pieces.length; i++) {
        notice('Laying out the bill in the document… ' + (i + 1) + ' of ' + pieces.length);
        // padded: Word merges the first and last paragraph of inserted OOXML into its neighbours, which would turn
        // a one-paragraph item into an inline control; tidy() takes the empty paragraphs out again
        ctx.document.body.insertOoxml(padded(pieces[i]), 'End'); await ctx.sync();
      }
      await tidy(ctx);
    }));
    await putPart('opened', S.opened); await store();
    await companions();
    await refresh();
    const o = B.outline(d);
    notice(o.bill + ' laid out: ' + pl(o.agencies.length, 'schedule') + ', ' + B.items(d).length.toLocaleString() + ' items. Edit items in the document, then press Mark changes.');
  }
  async function showOpen() {
    $('b-open').hidden = false; for (const id of ['b-bill', 'b-item', 'b-help', 'b-dock']) $(id).hidden = true;
    document.body.classList.remove('has-dock');
    const ix = await index().catch(() => ({ bills: [] })), box = $('b-samples'); box.innerHTML = '';
    for (const s of ix.bills) {
      const b = el('button', { className: 'primary', textContent: 'Open' });
      b.onclick = () => busy(b, async () => openBill(await fetchText(s.file), s));
      const extras = [s.prior && 'last year\'s chapter', s.vetoes && 'line vetoes', s.earlier && 'the print before'].filter(Boolean);
      box.append(el('div', { className: 'std' }, el('div', {}, el('b', { textContent: s.title.split(':')[0] }), el('span', { className: 'hint', textContent: ' · ' + (s.title.split(':')[1] || '').trim() + (extras.length ? '. With ' + extras.join(', ') + '.' : '') })), b));
    }
    if (inWord) { const t = await Word.run(async ctx => { const b = ctx.document.body; b.load('text'); await ctx.sync(); return b.text; }).catch(() => ''); $('b-notempty').hidden = !flat(t); }
  }

  /* ---------- what was edited in the document ---------- */
  const ITEM = /^(appropriation|reappropriation|purpose)$/;
  async function ours(ctx) {
    const ccs = ctx.document.contentControls; ccs.load('items/tag'); await ctx.sync();
    return ccs.items.map(c => ({ c, t: BW.parseTag(c.tag) })).filter(x => x.t);
  }
  async function pending() {
    return Word.run(async ctx => {
      const items = (await ours(ctx)).filter(x => ITEM.test(x.t.kind));
      const firsts = items.map(x => { const p = x.c.paragraphs.getFirst(); p.load('text'); return p; }); await ctx.sync();
      const edited = [], seen = new Set();
      items.forEach((x, i) => { seen.add(x.t.eId); const e = byEId(x.t.eId); if (e && flat(firsts[i].text) !== flat(BW.shownText(e))) edited.push(x.t.eId); });
      const missing = B.items(S.doc).map(i => i.eId).filter(id => !seen.has(id));
      return { edited, missing };
    });
  }
  // Read the edited items back into the XML (reappropriations marked against the law, appropriations as typed),
  // take out the items deleted in the document, and lay the edited items out again.
  async function mark(quiet) {
    const pend = await pending();
    let marked = 0, replaced = 0, removed = 0;
    if (pend.edited.length) await word(async ctx => quietly(ctx, async () => {
      const map = new Map((await ours(ctx)).map(x => [x.t.eId, x.c]));
      for (const id of pend.edited) {
        const cc = map.get(id), e = byEId(id); if (!cc || !e) continue;
        const ox = cc.getOoxml(); await ctx.sync();
        const how = BW.applyEdit(e, BW.wordRuns(ox.value));
        if (how === 'same') continue;
        if (how === 'marked') marked++; else replaced++;
        await replaceControl(ctx, cc, BW.render(e));
      }
    }));
    for (const id of pend.missing) { const e = byEId(id); if (e) { BW.removeItem(e); removed++; } }
    if (marked || replaced || removed) await store();
    await refresh();
    if (!quiet) notice(marked || replaced || removed ? [marked && pl(marked, 'reappropriation') + ' marked against the law', replaced && pl(replaced, 'appropriation') + ' changed', removed && pl(removed, 'item') + ' taken out'].filter(Boolean).join(', ') + '.' + (S.totals.length ? ' ' + pl(S.totals.length, 'total') + ' no longer add up: update them below.' : '') : 'No edits to mark: the document and the XML agree.');
    return { marked, replaced, removed };
  }
  // Totals computed from the items, set where they differ, and laid out again.
  async function updateTotals() {
    await mark(true);
    const changed = BW.totals(S.doc, true); if (!changed.length) { notice('The totals already add up.'); return; }
    const ids = [...new Set(changed.map(c => c.eId))];
    await word(async ctx => quietly(ctx, async () => {
      const map = new Map((await ours(ctx)).map(x => [x.t.eId, x.c]));
      for (const id of ids) { const cc = map.get(id), e = byEId(id); if (cc && e) await replaceControl(ctx, cc, BW.renderOwn(e)); }
    }));
    await store(); await refresh();
    notice('Updated ' + pl(changed.length, 'total') + ': ' + changed.slice(0, 3).map(c => c.what.replace(/^Agency summary, /, '') + ' ' + fmt(c.was) + ' → ' + fmt(c.now)).join('; ') + (changed.length > 3 ? '; …' : '') + '.');
  }

  // The amount problems: the print-error report's findings, and summary rows the totals update would change that
  // no finding already covers (a fund's row in an agency summary).
  function problems(F, T) {
    const extra = T.filter(t => t.kind === 'summary' && !/All Funds/.test(t.what) && !F.summaries.some(s => s.eId === t.eId && t.what.includes(s.column)))
      .concat(T.filter(t => t.kind !== 'summary' && !F.totals.some(x => x.eId === t.eId)));
    return { list: Object.values(F).flat(), extra, count: Object.values(F).flat().length + extra.length };
  }
  /* ---------- the pane ---------- */
  async function refresh() {
    if (!inWord) return;
    if (!S.doc && !(await load())) return showOpen();
    $('b-open').hidden = true; for (const id of ['b-bill', 'b-help', 'b-dock']) $(id).hidden = false;
    document.body.classList.toggle('has-dock', !$('b-dock').closest('[data-panel]').hidden);
    S.pending = await pending();
    S.totals = BW.totals(S.doc, false);
    const o = B.outline(S.doc), F = B.findings(S.doc), its = B.items(S.doc);
    $('b-title').textContent = o.bill.replace(/^S(\d+)/, 'S.$1').replace(/^A(\d+)/, 'A.$1') + (S.sample ? ' · ' + (S.sample.title.split(':')[0].replace(/^\S+\s/, '')) : '');
    const changes = B.compare(S.opened, S.doc).changes.length;
    $('b-summary').className = 'summary ' + (S.totals.length || S.pending.edited.length ? 'meh' : 'good');
    $('b-summary').textContent = its.filter(i => i.kind === 'appropriation').length + ' appropriations and ' + its.filter(i => i.kind === 'reappropriation').length + ' reappropriations in ' + pl(o.agencies.length, 'schedule') + '. ' +
      (changes ? pl(changes, 'change') + ' since it was opened.' : 'No changes yet.');
    // totals that no longer add up
    const fx = $('b-fixes'); fx.innerHTML = '';
    if (S.totals.length) {
      const b = el('button', { className: 'link', textContent: 'Update ' + (S.totals.length === 1 ? 'it' : 'them') });
      b.onclick = () => busy(b, updateTotals);
      const places = new Set(S.totals.map(t => t.eId)).size;
      fx.append(el('div', { className: 'callout' }, el('span', { textContent: (places === 1 ? 'A total doesn\'t' : places + ' totals don\'t') + ' add up' + (S.totals.length > places ? ' (' + S.totals.length + ' figures)' : '') + ': ' + S.totals.slice(0, 2).map(t => t.what.replace(/^Agency summary, /, 'summary, ') + ' printed ' + fmt(t.was) + ', the items ' + fmt(t.now)).join('; ') + (S.totals.length > 2 ? '; …' : '') + '. ' }), b));
    }
    // the schedules, each with what it needs
    const ol = $('b-outline'); ol.innerHTML = '';
    const vetoed = S.vetoes && S.lines ? new Set(B.placeVetoes(S.doc, S.vetoes, S.lines).flatMap(v => v.items)) : new Set();
    for (const a of o.agencies) {
      const mine = id => id && id.startsWith(a.eId + '__') || id === a.eId;
      const P = problems(F, S.totals), errs = P.list.filter(f => mine(f.eId)).length + P.extra.filter(t => mine(t.eId)).length;
      const edited = S.pending.edited.filter(mine).length, v = [...vetoed].filter(mine).length;
      const main = el('button', { className: 'row-main', title: a.heading + ' ' + a.sub }, el('span', { className: 'k', textContent: a.name.replace(/ \(reappropriations\)$/, '') }), el('span', { className: 'n2', textContent: a.reapp ? 'reapprop.' : 'approp.' }));
      main.onclick = () => busy(null, () => goTo(a.eId));
      const chips = el('span', { className: 'chips' });
      if (edited) chips.append(el('span', { className: 'chip err', textContent: edited + ' not marked' }));
      if (errs) chips.append(el('span', { className: 'chip warn', textContent: pl(errs, 'amount'), title: 'Amounts that don\'t add up: see Check' }));
      if (v) chips.append(el('span', { className: 'chip', textContent: pl(v, 'veto', 'vetoes') }));
      if (!edited && !errs) chips.append(el('span', { className: 'ok', textContent: '✓' }));
      const li = el('li', {}, el('div', { className: 'line' }, main, chips));
      if (a.programs.length) {
        const sub = el('ol', { className: 'programs' });
        for (const p of a.programs) { const b = el('button', { className: 'row-main sub', textContent: p.heading.replace(/\s+\(CCP\)$/, '') + (p.total != null ? ' · ' + fmt(p.total) : '') + ' · ' + pl(p.items, 'item') }); b.onclick = () => busy(null, () => goTo(p.eId)); sub.append(el('li', {}, b)); }
        li.append(sub);
      }
      ol.append(li);
    }
    // the dock
    const st = $('b-dock-status'), n = S.pending.edited.length, m = S.pending.missing.length;
    st.className = 'dock-status' + (n || m ? ' need' : '');
    st.textContent = n || m ? [n && pl(n, 'item') + ' edited', m && pl(m, 'item') + ' deleted'].filter(Boolean).join(' and ') + ' in the document, not yet in the bill\'s XML.' : 'The document and the bill\'s XML agree.';
    $('b-mark').classList.toggle('primary', !!(n || m));
    const errCount = problems(F, S.totals).count;
    $('check-count').textContent = String(errCount); $('check-count').hidden = !errCount;
    if (S.cursor) showCursor(S.cursor);
  }
  async function goTo(eId) {
    // the element's own content control, or the nearest one above it
    let id = eId;
    await word(async ctx => {
      const map = new Map((await ours(ctx)).map(x => [x.t.eId, x.c]));
      while (id && !map.has(id)) id = id.includes('__') ? id.replace(/__[^_]+(?:_[^_]+)*$/, '') : null;
      if (id) { map.get(id).select('Start'); await ctx.sync(); }
    });
    if (id) { S.cursor = id; showCursor(id); }
  }
  // The item at the cursor, and what can be done with it.
  async function cursor() {
    if (!inWord || !S.doc) return;
    const id = await Word.run(async ctx => {
      let cc = ctx.document.getSelection().parentContentControlOrNullObject;
      for (let i = 0; i < 6; i++) { cc.load('tag'); await ctx.sync(); if (cc.isNullObject) return null; const t = BW.parseTag(cc.tag); if (t) return t.eId; cc = cc.parentContentControlOrNullObject; }
      return null;
    }).catch(() => null);
    if (id) { S.cursor = id; showCursor(id); }
  }
  const KIND = { appropriation: 'Appropriation', reappropriation: 'Reappropriation', purpose: 'Purpose', program: 'Program', agency: 'Schedule', agencySummary: 'Agency summary', subtotal: 'Subtotal' };
  function showCursor(id) {
    const e = byEId(id); if (!e) { $('b-item').hidden = true; return; }
    const name = e.getAttribute('name'), it = B.numbered(B.items(S.doc)).find(i => i.eId === id);
    $('b-item').hidden = false; $('b-item-kind').textContent = KIND[name] || name;
    $('b-item-what').textContent = (it ? [it.account, it.program, it.object].filter(Boolean).join(' · ') + ' — ' : '') + flat(BW.shownText(e) || B._.text(e)).slice(0, 220) + (flat(BW.shownText(e)).length > 220 ? '…' : '');
    $('b-item-rule').textContent = name === 'reappropriation' ? 'Existing law: changes to its words or original amount are put in [brackets] and underlined; "(re. $…)" is reprinted.' + (S.pending.edited.includes(id) ? ' Edited: press Mark changes.' : '')
      : name === 'appropriation' ? 'New money in this bill: it takes the new words and amount as typed.' + (S.pending.edited.includes(id) ? ' Edited: press Mark changes.' : '')
      : name === 'purpose' && BW.isLaw(e) ? 'Words of existing law: changes are put in [brackets] and underlined.' : name === 'purpose' ? 'Words over the appropriations below.' : '';
    const canAdd = (name === 'appropriation' || name === 'purpose') && !B._.ancestors(e).some(a => B._.hc('agency')(a) && B._.cls(a) === 'reappropriations') && !BW.isLaw(e);
    $('b-add-box').hidden = !canAdd; $('b-remove').hidden = !(name === 'appropriation' || name === 'reappropriation');
  }
  async function addAfter() {
    const id = S.cursor, e = byEId(id); if (!e) throw new Error('Click an appropriation in the document first.');
    const words = flat($('b-add-words').value), amount = $('b-add-amount').value.replace(/[^\d]/g, '');
    if (!words) throw new Error('Type the new item\'s words.'); if (!amount) throw new Error('Type the amount.');
    const n = BW.addItem(S.doc, e, words, amount);
    await word(async ctx => quietly(ctx, async () => {
      const cc = (await ours(ctx)).find(x => x.t.eId === id); if (!cc) throw new Error('That item is no longer in the document.');
      cc.c.getRange('Whole').insertOoxml(padded(BW.render(n)), 'After'); await ctx.sync(); await tidy(ctx);
    }));
    await store(); $('b-add-words').value = ''; $('b-add-amount').value = ''; $('b-add-box').open = false;
    S.cursor = n.getAttribute('eId'); await refresh();
    notice('Appropriation added. ' + (S.totals.length ? pl(S.totals.length, 'total') + ' now ' + (S.totals.length === 1 ? 'needs' : 'need') + ' updating: press Update above.' : ''));
  }
  async function removeAt() {
    const id = S.cursor, e = byEId(id); if (!e) return;
    await word(async ctx => quietly(ctx, async () => { const cc = (await ours(ctx)).find(x => x.t.eId === id); if (cc) { cc.c.delete(false); await ctx.sync(); } }));
    BW.removeItem(e); await store(); S.cursor = null; $('b-item').hidden = true; await refresh();
    notice('Item taken out of the bill.' + (S.totals.length ? ' Update the totals above.' : ''));
  }

  /* ---------- Check ---------- */
  const go = (eId, label) => { const b = el('button', { textContent: label || 'Go to it' }); b.onclick = () => busy(b, async () => { showTab('draft'); await goTo(eId); }); return b; };
  async function runChecks() {
    if (!S.doc) { $('b-amt-summary').textContent = 'Open a budget bill on Draft first.'; return; }
    S.pending = await pending();
    const F = B.findings(S.doc), T = BW.totals(S.doc, false), ul = $('b-amt'); ul.innerHTML = '';
    const add = (level, rule, text, eId, extra) => { const li = el('li', { className: level }, el('span', { className: 'rule', textContent: rule + ':' }), text); const w = el('div', { className: 'where' }); if (eId) w.append(go(eId)); if (extra) w.append(extra); li.append(w); ul.append(li); };
    if (S.pending.edited.length || S.pending.missing.length) { const b = el('button', { textContent: 'Mark changes' }); b.onclick = () => busy(b, async () => { await mark(); await runChecks(); }); add('warning', 'Not marked', pl(S.pending.edited.length + S.pending.missing.length, 'item') + ' changed in the document ' + (S.pending.edited.length + S.pending.missing.length === 1 ? 'isn\'t' : 'aren\'t') + ' in the XML yet, so these checks don\'t see ' + (S.pending.edited.length + S.pending.missing.length === 1 ? 'it' : 'them') + '.', null, b); }
    const upd = () => { const b = el('button', { textContent: 'Update the totals' }); b.onclick = () => busy(b, async () => { await updateTotals(); await runChecks(); }); return b; };
    for (const x of F.summaries) add('error', 'Agency summary', x.agency + ', ' + x.column + ': printed ' + fmt(x.printed) + '; the items add to ' + fmt(x.items) + ' (' + (x.diff > 0 ? fmt(x.diff) + ' more' : fmt(-x.diff) + ' less') + ').', x.eId, upd());
    for (const x of F.totals) add('error', 'Total', x.what + ': printed ' + fmt(x.printed) + '; the ' + pl(x.n, 'item') + ' add to ' + fmt(x.items) + '.', x.eId, upd());
    for (const t of problems(F, T).extra) add('warning', t.kind === 'summary' ? 'Agency summary' : 'Total', t.what.replace(/^Agency summary, /, '') + ': printed ' + fmt(t.was) + '; the items add to ' + fmt(t.now) + '.', t.eId, upd());
    $('check-count').textContent = String(problems(F, T).count); $('check-count').hidden = !problems(F, T).count;
    for (const x of F.schedules) add('error', 'Project schedule', 'Schedule ' + x.code + (x.thousands ? ' (in thousands)' : '') + ': total printed ' + fmt(x.printed) + '; its ' + pl(x.n || 0, 'row') + ' add to ' + fmt(x.rows) + '.', x.item);
    for (const x of F.schedule_items) add('error', 'Project schedule', 'Schedule ' + x.code + ': its total ' + fmt(x.total) + (x.thousands ? ' thousand' : '') + ' isn\'t the amount of the item it allocates (' + fmt(x.amount) + ').', x.item);
    for (const x of F.reapprop_over) add('error', 'Reappropriation', 'Reappropriates ' + fmt(x.reappropriated) + ', more than the original ' + fmt(x.original) + '.', x.eId);
    for (const x of F.no_original) add('info', 'Reappropriation', 'Prints no original amount, only the amount reappropriated (' + fmt(x.reappropriated) + ').', x.eId);
    for (const x of F.headings) add('warning', 'Account', 'No account number in the heading "' + x.heading + '".', x.eId);
    const n = ul.querySelectorAll('li.error').length, w = ul.querySelectorAll('li.warning').length;
    $('b-amt-summary').className = 'summary ' + (n ? 'bad' : w ? 'meh' : 'good');
    $('b-amt-summary').textContent = !ul.children.length ? 'Every total, summary and schedule adds up.' : [n && pl(n, 'amount') + ' that don\'t add up', w && pl(w, 'other thing') + ' to look at'].filter(Boolean).join(', ') + '.';
    priorView(); compareOptions(); vetoView();
  }
  // Last year's chapter
  function priorView() {
    const box = $('b-prior'); box.innerHTML = '';
    if (!S.prior) { box.append(el('p', { className: 'hint', textContent: 'Choose the XML of the chapter this bill\'s reappropriations continue (last year\'s bill as it passed), with its chapter number and year.' })); $('b-prior-pick').open = true; return; }
    const r = B.priorCheck(S.doc, S.prior, S.priorInfo.chapter, S.priorInfo.year);
    const total = Object.values(r.res).reduce((n, v) => n + v.length, 0), probs = B.PRIOR_ORDER.filter(k => B.PRIOR_PROBLEMS.has(k) && (r.res[k] || []).length);
    const nprob = probs.reduce((n, k) => n + r.res[k].length, 0);
    box.append(el('p', { className: 'summary ' + (nprob ? 'meh' : 'good'), textContent: 'Against ' + S.priorInfo.title + ': ' + pl(total, 'reappropriation') + ' checked; ' + (nprob ? pl(nprob, 'to look at', 'to look at') + '.' : 'all as last year\'s chapter has them.') }));
    const tbl = el('table', { className: 'counts' });
    for (const k of B.PRIOR_ORDER) if ((r.res[k] || []).length) tbl.append(el('tr', { className: B.PRIOR_PROBLEMS.has(k) ? 'prob' : '' }, el('td', { textContent: k.replace(/^new: /, 'Last year\'s appropriation: ').replace(/^old: /, 'Older, reappropriated last year: ') }), el('td', { textContent: String(r.res[k].length) })));
    box.append(tbl);
    const ul = el('ul', { className: 'findings' });
    for (const k of probs) for (const [it, p] of r.res[k].slice(0, 20)) {
      const li = el('li', { className: 'warning' }, el('span', { className: 'rule', textContent: k.replace(/^(new|old): /, '') + ':' }),
        it.words.split(' ').slice(0, 9).join(' ') + '… original ' + fmt(it.amount) + ' (re. ' + fmt(it.reappropriated) + ')' + (p ? '; last year ' + fmt(p.amount) + (p.reappropriated != null ? ' (re. ' + fmt(p.reappropriated) + ')' : '') : '') + '.');
      li.append(el('div', { className: 'where' }, go(it.eId))); ul.append(li);
    }
    box.append(ul);
    const lapsed = r.lapsed.filter(l => l.count);
    if (lapsed.length) box.append(el('p', { className: 'hint', textContent: 'Not continued from last year\'s chapter (lapsed, spent or left out): ' + lapsed.map(l => pl(l.count, l.kind.replace(/s$/, '')) + ' of ' + l.agency.replace(/-/g, ' ') + ' (' + fmt(l.amount) + ')').join('; ') + '.' }));
  }
  // Changes in this print
  function compareOptions() {
    const sel = $('b-cmp-with'), cur = sel.value; sel.innerHTML = '';
    sel.append(el('option', { value: 'opened', textContent: 'The bill as it was opened' }));
    if (S.earlier.sample) sel.append(el('option', { value: 'sample', textContent: S.earlier.sample.title + ' (the print before)' }));
    if (S.earlier.file) sel.append(el('option', { value: 'file', textContent: S.earlier.file.title }));
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  function compareView() {
    const w = $('b-cmp-with').value, base = w === 'opened' ? { doc: S.opened, title: 'the bill as it was opened' } : S.earlier[w];
    const r = B.compare(base.doc, S.doc), out = $('b-cmp-out'); out.innerHTML = '';
    const by = {}; for (const c of r.changes) by[c.change] = (by[c.change] || 0) + 1;
    out.append(el('p', { className: 'summary ' + (r.changes.length ? 'meh' : 'good'), textContent: !r.changes.length && !r.totals.length ? 'No changes from ' + base.title + '.' : 'From ' + base.title + ': ' + Object.entries(by).map(([k, n]) => n + ' ' + k).join(', ') + (r.totals.length ? '; ' + pl(r.totals.length, 'total') + ' changed' : '') + '.' }));
    const ul = el('ul', { className: 'findings' });
    for (const c of r.changes.slice(0, 60)) {
      const amt = c.was || c.now ? ' ' + [c.was && (fmt(c.was[0]) + (c.was[1] != null && c.kind === 'reappropriation' ? ' (re. ' + fmt(c.was[1]) + ')' : '')), c.now && (fmt(c.now[0]) + (c.now[1] != null && c.kind === 'reappropriation' ? ' (re. ' + fmt(c.now[1]) + ')' : ''))].filter(Boolean).join(' → ') : '';
      const li = el('li', { className: c.change === 'removed' ? 'error' : c.change === 'added' ? 'ok' : 'info' }, el('span', { className: 'rule', textContent: c.change[0].toUpperCase() + c.change.slice(1) + ' ' + c.kind + ':' }),
        (c.text || c.words || c.key || '').slice(0, 160) + amt + (c.source ? ' · ' + c.source : ''));
      if (c.new && byEId(c.new)) li.append(el('div', { className: 'where' }, go(c.new)));
      ul.append(li);
    }
    for (const t of r.totals) ul.append(el('li', { className: 'info' }, el('span', { className: 'rule', textContent: 'Total:' }), t.agency.replace(/-/g, ' ') + ', ' + t.what + ': ' + JSON.stringify(t.was).replace(/[\[\]]/g, '') + ' → ' + JSON.stringify(t.now).replace(/[\[\]]/g, '')));
    out.append(ul);
    if (r.changes.length > 60) out.append(el('p', { className: 'hint', textContent: 'And ' + (r.changes.length - 60) + ' more.' }));
  }
  // Line vetoes
  function vetoView() {
    const box = $('b-vetoes'); box.innerHTML = '';
    if (!S.vetoes) { box.append(el('p', { className: 'hint', textContent: 'No veto list for this bill. The demo bill S.3003-D comes with the Governor\'s line vetoes of May 20, 2025 in its agencies.' })); return; }
    const V = B.placeVetoes(S.doc, S.vetoes, S.lines);
    box.append(el('p', { className: 'summary ' + (V.every(v => !v.problem) ? 'good' : 'meh'), textContent: (S.vetoTitle ? S.vetoTitle[0].toUpperCase() + S.vetoTitle.slice(1) : 'The vetoes') + ': ' + V.filter(v => !v.problem).length + ' of ' + pl(V.length, 'veto', 'vetoes') + ' tied to exactly the item printed on their lines. The lines are those of the print as passed.' }));
    const ul = el('ul', { className: 'findings' });
    for (const v of V) {
      const e = v.items[0] && byEId(v.items[0]);
      const li = el('li', { className: v.problem ? 'warning' : 'info' }, el('span', { className: 'rule', textContent: 'Line veto #' + v.number + ':' }),
        'page ' + v.page + ', line' + (v.to !== v.from ? 's ' + v.from + '–' + v.to : ' ' + v.from) + ' · ' + v.agency.toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase()) + ' · ' + (v.reason || '') + '. ' +
        (e ? 'Placed on the ' + e.getAttribute('name') + ': "' + flat(BW.shownText(e)).slice(0, 90) + '…"' : '') + (v.similarity != null ? ' (words ' + Math.round(v.similarity * 100) + '% the same)' : '') + (v.problem ? ' ' + v.problem + '.' : ''));
      const w = el('div', { className: 'where' });
      if (e) w.append(go(v.items[0]));
      const save = el('button', { textContent: 'Save the memorandum' });
      save.onclick = () => download(B.vetoMemo(v, S.doc, S.vetoDate || new Date().toISOString().slice(0, 10)), 'line-veto-' + v.year + '-' + v.number + '.xml', 'application/xml');
      if (v.items.length) w.append(save);
      li.append(w); ul.append(li);
    }
    box.append(ul);
  }
  function download(content, name, type) {
    const a = el('a', { href: URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- Clean copy ---------- */
  // Nothing leaves with edits unread: the document's edits are read back and marked first, and every
  // reappropriation's law (its words and original amount, before "(re. $") must still read as the bill as opened
  // has it, once its brackets and underlines are taken into account. Otherwise nothing is made.
  function lawIntact() {
    const head = t => { const i = t.lastIndexOf('(re. '); return flat(i < 0 ? t : t.slice(0, i)); };
    const bad = [];
    for (const e of B._.all(B._.docEl(S.doc), x => B._.hc('reappropriation')(x) || B._.hc('purpose')(x))) {
      if (!BW.isLaw(e)) continue;
      const o = B._.byEId(S.opened, e.getAttribute('eId')); if (!o) continue;
      const p = x => { const c = B._.kid(x, 'content'); return c && B._.kid(c, 'p'); };
      if (!p(e) || !p(o)) continue;
      const now = BW.readingsOf(BW.runsOf(p(e))).old, was = BW.readingsOf(BW.runsOf(p(o))).old;
      if (!BD.sameText([head(now)], [head(was)])) bad.push(e.getAttribute('eId'));
    }
    return bad;
  }
  async function forExport() {
    const r = await mark(true);
    const bad = lawIntact();
    if (bad.length) throw new Error('Not made: ' + pl(bad.length, 'reappropriation') + ' no longer read' + (bad.length === 1 ? 's' : '') + ' as existing law once its brackets and underlines are taken into account, so the copy could misstate the law. ' + bad.slice(0, 3).map(x => x.split('__').slice(1).join(' ')).join('; ') + '.');
    return r;
  }
  function ccSummary() {
    if (!S.doc) { $('b-cc-summary').textContent = 'Open a budget bill on Draft first.'; $('b-pdf').disabled = true; return; }
    $('b-pdf').disabled = false;
    const o = B.outline(S.doc), T = BW.totals(S.doc, false);
    $('b-cc-summary').className = 'summary ' + (T.length ? 'meh' : 'good');
    $('b-cc-summary').textContent = o.bill + ', ' + pl(o.agencies.length, 'schedule') + '.' + (T.length ? ' ' + pl(T.length, 'total') + ' don\'t add up yet (Draft or Check).' : '');
  }
  async function makePdf() {
    $('b-pdf-actions').hidden = true; $('b-pdf-status').textContent = 'Reading the document\'s edits back into the XML…';
    const r = await forExport();
    const t0 = Date.now(), pdf = await BD.cleanCopyPdf(xml(S.doc), t => { $('b-pdf-status').textContent = t; });
    if (S.pdfUrl) URL.revokeObjectURL(S.pdfUrl);
    S.pdfUrl = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    $('b-pdf-actions').hidden = false;
    const T = BW.totals(S.doc, false);
    $('b-pdf-status').textContent = 'Clean copy ready (' + Math.max(1, Math.round(pdf.length / 1024)) + ' KB, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s). ' +
      (r.marked || r.replaced || r.removed ? 'The document\'s edits were marked first.' : 'The document and the XML agreed.') + (T.length ? ' ' + pl(T.length, 'total') + ' still don\'t add up.' : '');
    ccSummary();
  }
  const pdfName = () => (B.outline(S.doc).bill || 'budget') + ' clean copy.pdf';

  /* ---------- wiring ---------- */
  function wire() {
    const on = (id, fn) => { const b = $(id); b.onclick = () => busy(b, fn); };
    on('b-mark', () => mark()); on('b-dock-check', async () => showTab('checks'));
    on('b-add', addAfter); on('b-remove', removeAt); on('b-goto', async () => S.cursor && goTo(S.cursor));
    on('b-run', runChecks);
    on('b-cmp', async () => compareView());
    on('b-pdf', makePdf);
    on('b-pdf-save', async () => download(await (await fetch(S.pdfUrl)).blob(), pdfName()));
    on('b-pdf-open', async () => { if (!window.open(S.pdfUrl, '_blank')) download(await (await fetch(S.pdfUrl)).blob(), pdfName()); });
    on('b-xml-save', async () => { await forExport(); download('<?xml version="1.0" encoding="UTF-8"?>\n' + xml(S.doc), (B.outline(S.doc).bill || 'budget') + '.akn.xml', 'application/xml'); });
    $('b-file').onchange = e => busy(null, async () => { const f = e.target.files[0]; if (f) await openBill(await readFile(f), null); e.target.value = ''; });
    $('b-cmp-file').onchange = e => busy(null, async () => { const f = e.target.files[0]; if (!f) return; S.earlier.file = { doc: B.parse(await readFile(f)), title: f.name }; compareOptions(); $('b-cmp-with').value = 'file'; compareView(); e.target.value = ''; });
    $('b-prior-file').onchange = e => busy(null, async () => {
      const f = e.target.files[0]; if (!f) return;
      const ch = +$('b-prior-ch').value, yr = +$('b-prior-yr').value;
      if (!ch || !yr) throw new Error('Type the chapter number and the year it was enacted, then choose the file again.');
      S.prior = B.parse(await readFile(f)); S.priorInfo = { chapter: ch, year: yr, title: 'chapter ' + ch + ' of the laws of ' + yr + ' (' + f.name + ')' }; priorView(); e.target.value = '';
    });
  }
  async function init() { wire(); if (inWord && await load().catch(() => false)) return true; return false; }
  function onTab(name, focusSec) {
    if (name === 'checks') busy($('b-run'), runChecks);
    if (name === 'export') ccSummary();
    if (name === 'draft') busy(null, refresh);
    void focusSec;
  }
  return { init, refresh, cursor, onTab, mark, updateTotals, S };
})();
