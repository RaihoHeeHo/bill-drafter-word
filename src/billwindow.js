/* Bill Drafter for Word (demo) - the bill window: the whole budget bill, to browse and search, beside Word, which
   holds only the schedules being worked on. The pane hands over the bill's XML and its status through the browser's
   storage (src/lib/windowstore.js) and says when they change; the window asks the pane to open a schedule into the
   document or to go to an item. */
'use strict';
(() => {
  const B = BD.budget, BW = BD.budgetWord, { all, kids, kid, ln, hc, text, norm, cls } = B._;
  const $ = id => document.getElementById(id);
  const el = (tag, props, ...k) => { const e = Object.assign(document.createElement(tag), props || {}); for (const x of k) if (x != null) e.append(x); return e; };
  const fmt = B.fmt, pl = (n, w, ws) => Number(n).toLocaleString('en-US') + ' ' + (n === 1 ? w : (ws || w + 's'));
  const W = { doc: null, version: -1, status: null, agencies: [], current: null, index: null, selected: null };

  /* ---------- talking to the pane ---------- */
  const office = () => window.Office && Office.context && Office.context.ui && Office.context.ui.messageParent;
  function send(msg) {
    if (office()) Office.context.ui.messageParent(JSON.stringify(msg));
    else if (window.opener) window.opener.postMessage({ ...msg, billWindow: true }, location.origin);
  }
  window.addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.billPane) sync(); });
  async function sync() {
    const st = await BD.windowStore.get('status'); if (!st) return;
    const fresh = st.version !== W.version;
    W.status = st;
    if (fresh || !W.doc) { W.doc = B.parse(await BD.windowStore.get('xml')); W.version = st.version; W.index = null; W.agencies = B.outline(W.doc).agencies; }
    drawList();
    if (W.current) showSchedule(W.current, fresh ? null : 'keep');
    else if (W.agencies.length) showSchedule(W.agencies[0].eId);
    $('w-title').textContent = st.title || st.bill;
    $('w-status').textContent = W.agencies.length + ' schedules · ' + B.items(W.doc).length.toLocaleString() + ' items · ' + st.open.length + ' open in Word';
    if ($('w-search').value.trim().length >= 3) search();
  }

  /* ---------- the list of schedules ---------- */
  function drawList() {
    const ol = $('w-list'), f = $('w-filter').value.trim().toLowerCase(), st = W.status; ol.innerHTML = '';
    for (const a of W.agencies) {
      if (f && !a.name.toLowerCase().includes(f)) continue;
      const badges = el('span', { className: 'badges' });
      if (st.open.includes(a.eId)) badges.append(el('span', { className: 'b on', textContent: 'in Word' }));
      if (st.problems[a.eId]) badges.append(el('span', { className: 'b warn', textContent: pl(st.problems[a.eId], 'amount') }));
      const v = st.vetoes.filter(x => x.eId.startsWith(a.eId + '__')).length; if (v) badges.append(el('span', { className: 'b', textContent: pl(v, 'veto', 'vetoes') }));
      const ed = st.edited.filter(x => x.startsWith(a.eId + '__')).length; if (ed) badges.append(el('span', { className: 'b err', textContent: ed + ' edited' }));
      const li = el('li', { className: W.current === a.eId ? 'sel' : '' }, el('button', { title: a.heading + ' · ' + a.sub }, el('span', { className: 'nm', textContent: a.name.replace(/ \(reappropriations\)$/, '') }), el('span', { className: 'kd', textContent: (a.reapp ? 'reappropriations' : 'appropriations') + ' · ' + pl(a.items, 'item') }), badges));
      li.firstChild.onclick = () => { $('w-results').hidden = true; showSchedule(a.eId); };
      ol.append(li);
    }
  }

  /* ---------- a schedule as the print reads ---------- */
  const runsHtml = rs => rs.map(r => r.k === 'del' ? el('span', { className: 'del', textContent: r.t }) : r.k === 'ins' ? el('u', { textContent: r.t }) : document.createTextNode(r.t));
  const firstP = e => { const c = kid(e, 'content') || kid(e, 'intro'); return c ? kid(c, 'p') : null; };
  function line(words, amount, cl) { return el('div', { className: 'ln ' + (cl || '') }, el('span', { className: 'w' }, ...words), el('span', { className: 'lead' }), amount != null ? el('span', { className: 'amt', textContent: amount }) : null); }
  function tableHtml(tb) {
    const t = el('table', { className: 'wt' });
    const cap = kid(tb, 'caption'); if (cap) t.append(el('caption', { textContent: norm(text(cap)) }));
    for (const r of kids(tb).filter(x => ln(x) === 'tr')) t.append(el('tr', { className: cls(r) }, ...kids(r).map(c => el(ln(c) === 'th' ? 'th' : 'td', { textContent: norm(text(c)), className: /^\(?-?\$?[\d,]+\)?$/.test(norm(text(c))) ? 'num' : '' }))));
    return t;
  }
  function itemHtml(e) {
    const name = e.getAttribute('name'), p = firstP(e), rs = p ? BW.runsOf(p).map(r => ({ ...r, t: r.t.replace(/\s+/g, ' ') })) : [];
    let node;
    if (name === 'appropriation') {
      const last = rs[rs.length - 1], m = last && /\s+(\$?[\d,]+)\s*$/.exec(last.t);
      if (m) { last.t = last.t.slice(0, m.index); node = line(runsHtml(rs), m[1], 'item'); } else node = el('div', { className: 'ln item' }, el('span', { className: 'w' }, ...runsHtml(rs)));
    } else if (name === 'reappropriation') {
      const all_ = rs.map(r => r.t).join(''), at = all_.lastIndexOf('(re. ');
      if (at > 0 && rs.length && rs[rs.length - 1].t.includes('(re. ')) { const last = rs[rs.length - 1], i = last.t.lastIndexOf('(re. '); const tail = last.t.slice(i).trim(); last.t = last.t.slice(0, i); node = line(runsHtml(rs), tail, 'item re'); }
      else node = el('div', { className: 'ln item re' }, el('span', { className: 'w' }, ...runsHtml(rs)));
    } else node = el('div', { className: 'ln purpose' }, el('span', { className: 'w' }, ...runsHtml(rs)));
    node.dataset.eid = e.getAttribute('eId');
    const st = W.status, id = e.getAttribute('eId');
    const v = st.vetoes.find(x => x.eId === id); if (v) node.append(el('span', { className: 'tag veto', textContent: 'line veto #' + v.number }));
    if (st.edited.includes(id)) node.append(el('span', { className: 'tag err', textContent: 'edited in Word, not marked' }));
    if (st.problemIds.includes(id)) node.append(el('span', { className: 'tag warn', textContent: 'amount to check' }));
    node.onclick = () => select(id);
    const frag = [node];
    for (const tb of all(e, x => ln(x) === 'table')) frag.push(tableHtml(tb));
    return frag;
  }
  function render(e, out) {
    const name = e.getAttribute('name');
    if (name === 'agencySummary') { const intro = kid(e, 'intro'); if (intro) for (const p of kids(intro).filter(x => ln(x) === 'p')) out.push(el('p', { className: 'ln intro', textContent: norm(text(p)) })); for (const tb of all(e, x => ln(x) === 'table')) out.push(tableHtml(tb)); return; }
    if (name === 'program') { const h = kid(e, 'heading'), q = h && kids(h).find(B._.isQ('programTotal')); const d = line([document.createTextNode(norm(B._.lastTextAll(h)))], q ? norm(text(q)) : null, 'prog'); d.dataset.eid = e.getAttribute('eId'); out.push(d); }
    else if (name === 'account') { const h = kid(e, 'heading'); if (h) out.push(el('div', { className: 'ln acct', textContent: norm(text(h)) })); }
    else if (name === 'reappropriationSource') { const i = kid(e, 'intro'); if (i) out.push(el('div', { className: 'ln src' }, ...runsHtml(BW.runsOf(kid(i, 'p') || i)))); }
    else if (name === 'appropriation' || name === 'reappropriation' || name === 'purpose') { out.push(...itemHtml(e)); return; }
    else if (name === 'subtotal') { const p = firstP(e), t = p ? norm(text(p)) : '', m = /^(.*?)\s+([\d,]+)$/.exec(t); const d = line([document.createTextNode(m ? m[1] : t)], m ? m[2] : null, 'sub'); d.dataset.eid = e.getAttribute('eId'); out.push(d); return; }
    else if (name !== 'agency') { const h = kid(e, 'heading'), c = kid(e, 'content') || kid(e, 'intro'); if (h) out.push(el('div', { className: 'ln acct', textContent: norm(text(h)) })); if (c) for (const x of kids(c)) { if (ln(x) === 'p') out.push(el('div', { className: 'ln', textContent: norm(text(x)) })); else if (ln(x) === 'table') out.push(tableHtml(x)); } }
    for (const k of kids(e).filter(hc => ln(hc) === 'hcontainer')) render(k, out);
  }
  function showSchedule(eId, keep) {
    const a = B._.byEId(W.doc, eId); if (!a) return;
    const y = keep ? $('w-view').scrollTop : 0;
    W.current = eId; drawList();
    const info = W.agencies.find(x => x.eId === eId), isOpen = W.status.open.includes(eId);
    $('w-head').hidden = false; $('w-name').textContent = norm(text(kid(a, 'heading'))); $('w-sub').textContent = norm(text(kid(a, 'subheading'))) + ' · ' + pl(info ? info.items : 0, 'item') + (isOpen ? ' · open in Word' : '');
    $('w-open').textContent = isOpen ? 'Close in Word' : 'Open in Word'; $('w-open').classList.toggle('primary', !isOpen);
    $('w-goto').hidden = !isOpen;
    const out = []; render(a, out);
    const box = $('w-sched'); box.innerHTML = ''; box.append(...out);
    $('w-view').scrollTop = y;
    if (W.selected && W.selected.startsWith(eId)) mark(W.selected, false);
  }
  function select(id) {
    W.selected = id; mark(id, false);
    const e = B._.byEId(W.doc, id);
    $('w-bar').hidden = false; $('w-sel-what').textContent = (e ? e.getAttribute('name') : '') + ': ' + norm(text(firstP(e) || e)).slice(0, 110) + '…';
  }
  function mark(id, scroll) {
    for (const x of document.querySelectorAll('.ln.sel')) x.classList.remove('sel');
    const n = document.querySelector('[data-eid="' + id + '"]');
    if (n) { n.classList.add('sel'); if (scroll) n.scrollIntoView({ block: 'center' }); }
  }

  /* ---------- searching the whole bill ---------- */
  function buildIndex() {
    W.index = all(B._.docEl(W.doc), e => hc('appropriation')(e) || hc('reappropriation')(e) || hc('purpose')(e)).map(e => {
      const t = norm(text(firstP(e) || e)), ag = /^(sec_\d+__agency_\d+)/.exec(e.getAttribute('eId'))[1];
      return { eId: e.getAttribute('eId'), ag, t, low: t.toLowerCase() };
    });
  }
  function search() {
    const q = $('w-search').value.trim().toLowerCase(), box = $('w-results');
    if (q.length < 3) { box.hidden = true; return; }
    if (!W.index) buildIndex();
    const hits = W.index.filter(x => x.low.includes(q)), names = Object.fromEntries(W.agencies.map(a => [a.eId, a.name]));
    box.hidden = false; box.innerHTML = '';
    box.append(el('div', { className: 'rhead' }, el('b', { textContent: hits.length ? pl(hits.length, 'item') + ' with "' + q + '"' : 'Nothing in the bill reads "' + q + '"' }), hits.length > 200 ? el('span', { className: 'hint', textContent: ' (the first 200)' }) : null, el('button', { className: 'link', textContent: 'Close', onclick: () => { box.hidden = true; } })));
    for (const h of hits.slice(0, 200)) {
      const i = h.low.indexOf(q), from = Math.max(0, i - 60);
      const snip = el('span', {}, (from ? '…' : '') + h.t.slice(from, i), el('mark', { textContent: h.t.slice(i, i + q.length) }), h.t.slice(i + q.length, i + q.length + 80) + '…');
      const b = el('button', { className: 'hit' }, el('span', { className: 'ag', textContent: names[h.ag] }), snip);
      b.onclick = () => { box.hidden = true; showSchedule(h.ag); select(h.eId); mark(h.eId, true); };
      box.append(b);
    }
  }

  /* ---------- wiring ---------- */
  $('w-filter').oninput = drawList;
  let st; $('w-search').oninput = () => { clearTimeout(st); st = setTimeout(search, 200); };
  $('w-open').onclick = () => { const isOpen = W.status.open.includes(W.current); send({ type: isOpen ? 'close' : 'open', eId: W.current }); $('w-open').disabled = true; setTimeout(() => { $('w-open').disabled = false; }, 1500); };
  $('w-goto').onclick = () => send({ type: 'goto', eId: W.current });
  $('w-sel-go').onclick = () => W.selected && send({ type: 'goto', eId: W.selected });
  const start = () => { send({ type: 'ready' }); sync(); setInterval(async () => { const s = await BD.windowStore.get('status'); if (s && (!W.status || s.at !== W.status.at)) sync(); }, 2000); };
  if (window.Office && Office.onReady) Office.onReady(() => {
    try { if (Office.context.ui && Office.context.ui.addHandlerAsync) Office.context.ui.addHandlerAsync(Office.EventType.DialogParentMessageReceived, () => sync()); } catch (e) { /* the window polls */ }
    start();
  });
  else start();
  window.__billWindow = W;
})();
