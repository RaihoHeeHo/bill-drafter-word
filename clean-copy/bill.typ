// LBDC clean-copy template (demo), for documents that follow the AKN-NY profile.
// Reads a bill or a concurrent resolution numbered as a bill and lays it out as
// a clean copy: front matter, numbered lines, new matter underscored, old matter
// in brackets, quoted law with its units, and tables.
// Not yet handled: resolutions in the resolution series.
//
// Build:
//   typst compile --font-path fonts --input xml=sample-bill.xml bill.typ clean-copy.pdf

// ---------------------------------------------------------------------------
// Layout settings. These are the numbers to settle against LBDC's spec.
// ---------------------------------------------------------------------------
#let spec = (
  font: sys.inputs.at("font", default: "FreeMono"),  // chosen in the app, or --input font=...
  // Measured from the public prints (legislation.nysenate.gov PDFs):
  size: 10.5pt,       // type size; each character is 6.3pt wide
  pitch: 11.55pt,     // baseline to baseline
  chars: 72,          // characters per line
  lines: 56,          // numbered text lines on a full page
  indent: 2,          // first-line indent, in characters
  left: 80.03pt,      // left edge of the text
  first-line: 64.15pt,   // baseline of line 1 on every page after the first
  header: 41.05pt,       // baseline of the running header
  big: 18.9pt,        // "STATE OF NEW YORK" and "IN SENATE"
  title-line: 53.83pt,   // baseline of "STATE OF NEW YORK"
  rule-line: 67.55pt,    // baseline of the rule under it
  first-page-end: 642.75pt,  // baseline of the LBD number, the lowest line on page 1
)

// Courier is monospaced: every character is 0.6 em wide.
#let char = spec.size * 0.6
#let measure = spec.chars * char
#let body-height = (spec.lines - 1) * spec.pitch + spec.size

// ---------------------------------------------------------------------------
// Reading the XML
// ---------------------------------------------------------------------------
#let source = xml(sys.inputs.at("xml", default: "sample-bill.xml"))
#let root = source.filter(n => type(n) == dictionary and n.tag != "").first()

#let is-el(n, tag: none) = type(n) == dictionary and n.tag != "" and (tag == none or n.tag == tag)
#let kids(n, tag) = n.children.filter(c => is-el(c, tag: tag))
#let kid(n, tag) = kids(n, tag).at(0, default: none)
#let find(n, tag) = {
  if not is-el(n) { return none }
  if n.tag == tag { return n }
  for c in n.children {
    let hit = find(c, tag)
    if hit != none { return hit }
  }
  none
}
#let plain(n) = {
  if type(n) == str { n } else { n.children.map(plain).sum(default: "") }
}
#let squeeze(s) = s.replace(regex("\s+"), " ").trim()


#let attr(n, name) = if is-el(n) { n.attrs.at(name, default: "") } else { "" }
#let els(n) = n.children.filter(c => is-el(c))

#let bill = kid(root, "bill")
#let meta = kid(bill, "meta")
#let preface = kid(bill, "preface")

#let text-of(n, default: "") = if n == none { default } else { squeeze(plain(n)) }
#let house = text-of(find(meta, "house"), default: "senate")
#let numbers = kids(kids(preface, "p").find(p => find(p, "docNumber") != none), "docNumber").map(text-of)
#let joint = numbers.len() > 1          // a print made for both houses
#let bill-no = numbers.first()
#let prefix = if house == "assembly" { "A." } else { "S." }
#let lbd-no = text-of(find(meta, "lbdNumber"))

// ---------------------------------------------------------------------------
// Inline text: new matter underscored, old matter in brackets
// ---------------------------------------------------------------------------
// Words are divided at line ends only where the real prints divide them. The
// list was learned from every line-end hyphen in about 3,800 pages of prints.
#let hyph = json("hyphenation.json")
// budget bills divide words only where the budget print does (learned from S.3000-D), else as other bills
#let hyph-approp = json("hyphenation-approp.json")
#let soften(s) = s.replace(regex("[A-Za-z]+"), m => {
  let at = hyph.at(lower(m.text), default: none)
  if at == none { m.text } else {
    let cs = m.text.clusters()
    let out = ""
    for (i, c) in cs.enumerate() {
      if i in at { out += "\u{ad}" }
      out += c
    }
    out
  }
})
#let under(it) = underline(evade: false, offset: 1.5pt, stroke: 0.6pt, it)

// Quoted law is laid out after the sentence that introduces it, so it is
// skipped here. One printed pair of brackets that crosses from one unit into
// the next is stored in pieces (spanStart, spanMiddle, spanEnd).
#let inline(n) = {
  if type(n) == str { return [#soften(n.replace(regex("\s+"), " "))] }
  if not is-el(n) or n.tag == "quotedStructure" { return [] }
  let inner = n.children.map(inline).sum(default: [])
  if n.tag == "del" {
    let c = attr(n, "class")
    if c == "spanStart" { [\[#inner] }
    else if c == "spanMiddle" { inner }
    else if c == "spanEnd" { [#inner\]] }
    else { [\[#inner\]] }
  }
  else if n.tag == "ins" { under(inner) }
  else { inner }
}

// One body paragraph: first line indented, continuation lines flush left
#let body-par(it) = par(linebreaks: "simple", first-line-indent: (amount: spec.indent * char, all: true), {
  show "REPEALED": w => text(weight: "bold", w)
  it
})
#let flush-line(it) = par(first-line-indent: 0pt, justify: false, it)
// Centering is done in whole characters, as on the print.
#let center-pad(n) = h(calc.ceil((spec.chars - n) / 2) * char)
#let centered-line(it, n: 0) = par(first-line-indent: 0pt, justify: false, center-pad(n) + it)
#let plain-len(n) = squeeze(plain(n)).clusters().len()
#let blank-line = block(height: spec.size, width: 100%)

// ---------------------------------------------------------------------------
// Tables. Column positions are not part of the bill, so they are set by rule:
// text columns on the left, wrapped; amount columns right-aligned; each printed
// line is one numbered line. A long label wraps and its amounts sit on its last
// line; a new value that does not fit beside the old one goes on the next line.
// ---------------------------------------------------------------------------

// A cell as words. Each word is a list of pieces (text, kind, first, last) so
// brackets and underscoring can be drawn once per run of old or new matter.
#let pieces(n, kind, acc) = {
  if type(n) == str {
    let parts = n.split(regex("\s+"))
    let starts-space = n.starts-with(regex("\s"))
    let ends-space = n.ends-with(regex("\s"))
    for (i, w) in parts.enumerate() {
      if w == "" { continue }
      let glued = i == 0 and not starts-space
      acc.push((text: w, kind: kind, run: acc.len(), glue: glued))
    }
    if ends-space or n.trim() == "" { acc.push((text: "", kind: "", run: -1, glue: false)) }
    return acc
  }
  if not is-el(n) { return acc }
  // a line break typed in the cell is kept (layout only; not part of the bill)
  if n.tag == "eol" { acc.push((text: "", kind: "", run: -2, glue: false)); return acc }
  let k = if n.tag == "del" { "del" } else if n.tag == "ins" { "ins" } else { kind }
  let mark = acc.len()
  for c in n.children { acc = pieces(c, k, acc) }
  if n.tag == "del" or n.tag == "ins" {
    // every piece added inside this element belongs to one run; a piece of a pair of brackets split across
    // cells (a row taken out: spanStart … spanEnd) prints only its own bracket
    let span = attr(n, "class")
    let out = ()
    for (i, p) in acc.enumerate() {
      if i >= mark and p.run >= 0 { p.run = mark; p.kind = k; p.span = span }
      out.push(p)
    }
    acc = out
  }
  acc
}

#let finish-words(ps) = {
  let out = ()
  let space-before = true
  for p in ps {
    if p.run == -1 { space-before = true; continue }
    if p.run == -2 { out.push((p,)); space-before = true; continue }
    if out.len() > 0 and p.glue and not space-before { out.last().push(p) } else { out.push((p,)) }
    space-before = false
  }
  // mark the first and last piece of each run of old matter, for the brackets
  let flat = out.flatten()
  let n = flat.len()
  let res = ()
  let i = 0
  for w in out {
    let nw = ()
    for p in w {
      let prev = if i > 0 { flat.at(i - 1) } else { none }
      let next = if i + 1 < n { flat.at(i + 1) } else { none }
      let span = p.at("span", default: "")
      p.first = (prev == none or prev.run != p.run or prev.kind != p.kind) and span != "spanMiddle" and span != "spanEnd"
      p.last = (next == none or next.run != p.run or next.kind != p.kind) and span != "spanStart" and span != "spanMiddle"
      nw.push(p)
      i += 1
    }
    res.push(nw)
  }
  res
}
#let words(cell) = finish-words(pieces(kid(cell, "p"), "", ()))
#let nodes-words(nodes) = finish-words(nodes.fold((), (acc, c) => pieces(c, "", acc)))

#let word-len(w) = w.map(p => p.text.clusters().len() + if p.kind == "del" { int(p.first) + int(p.last) } else { 0 }).sum(default: 0)

#let wrap(ws, width) = {
  let lines = ()
  let cur = ()
  let n = 0
  for w in ws {
    if w.first().run == -2 { lines.push(cur); cur = (); n = 0; continue }
    let l = word-len(w)
    if cur.len() > 0 and n + 1 + l > width { lines.push(cur); cur = (); n = 0 }
    n += l + if cur.len() > 0 { 1 } else { 0 }
    cur.push(w)
  }
  if cur.len() > 0 { lines.push(cur) }
  lines
}

#let draw-piece(p) = {
  let t = [#p.text]
  if p.kind == "del" { [#if p.first [\[]#t#if p.last [\]]] } else if p.kind == "ins" { under(t) } else { t }
}
#let draw-line(ws) = {
  let out = []
  for (i, w) in ws.enumerate() {
    if i > 0 {
      let a = ws.at(i - 1).last()
      let b = w.first()
      // the space between two words of the same new matter is underscored too
      out += if a.kind == "ins" and b.kind == "ins" and a.run == b.run { under[ ] } else { [ ] }
    }
    out += w.map(draw-piece).sum(default: [])
  }
  out
}

#let is-amount(ws) = ws.len() == 0 or ws.all(w => w.first().run == -2 or w.map(p => p.text).join("").match(regex("^[$0-9,.%]+$")) != none)

#let rows-of(t) = kids(t, "tr").map(r => els(r).map(words))

// Column widths for a set of rows. Amount columns are found from the data rows only (headings such as
// "Paid-in Capital" sit over amounts but are not amounts).
#let table-layout(rows, data) = {
  let ncol = calc.max(1, ..rows.map(r => r.len()))
  let numeric = range(ncol).map(c => c > 0 and data.len() > 0 and data.all(r => c >= r.len() or is-amount(r.at(c))))
  let gap = 3
  let longest(c) = calc.max(1, ..data.map(r => if c < r.len() { calc.max(0, ..r.at(c).map(word-len)) } else { 0 }))
  let natural(c) = calc.max(1, ..rows.map(r => if c < r.len() { calc.max(0, ..wrap(r.at(c), 1000).map(l => l.map(word-len).sum(default: 0) + calc.max(0, l.len() - 1))) } else { 0 }))
  let widths = range(ncol).map(c => if numeric.at(c) { calc.max(longest(c) + gap, 15) } else { 0 })
  let text-cols = range(ncol).filter(c => not numeric.at(c))
  let room = spec.chars - widths.sum()
  for (i, c) in text-cols.enumerate() {
    let left = text-cols.len() - i
    let share = calc.floor(room / left)
    let w = if left == 1 { room } else { calc.min(natural(c) + 2, share) }
    widths.at(c) = w
    room -= w
  }
  let label-mode = ncol > 1 and not numeric.at(0) and range(1, ncol).all(c => numeric.at(c))
  (ncol: ncol, numeric: numeric, widths: widths, label-mode: label-mode)
}

#let render-rows(rows, L, headings: false) = {
  let (ncol, numeric, widths, label-mode) = L
  for r in rows {
    let cells = range(ncol).map(c => if c < r.len() { wrap(r.at(c), widths.at(c) - if numeric.at(c) { 0 } else { 1 }) } else { () })
    // column headings end on the label's last line; amounts sit on it
    let others = if ncol > 1 { calc.max(1, ..range(1, ncol).map(c => cells.at(c).len())) } else { 1 }
    let lead = if label-mode and headings { calc.max(0, cells.at(0).len() - others) } else if label-mode { calc.max(cells.at(0).len(), 1) - 1 } else { 0 }
    let total = if label-mode { lead + calc.max(1, ..range(1, ncol).map(c => cells.at(c).len())) } else { calc.max(1, ..cells.map(c => c.len())) }
    for k in range(total) {
      flush-line({
        for c in range(ncol) {
          let i = if label-mode and c > 0 { k - lead } else { k }
          let piece = if i >= 0 and i < cells.at(c).len() { draw-line(cells.at(c).at(i)) } else { [] }
          box(width: widths.at(c) * char, align(if numeric.at(c) { right } else { left }, piece))
        }
      })
    }
  }
}

#let render-table(t) = {
  let rows = rows-of(t)
  if rows.len() == 0 { return }
  render-rows(rows, table-layout(rows, rows.filter(r => true)))
}

// A named table (Insurance Law "TABLE ONE."): its column headings, groups and rows are laid out as one table,
// so the headings stand over their columns; the notes follow it.
#let render-named-table(n) = {
  let heading = kid(n, "heading")
  if heading != none {
    blank-line
    centered-line(inline(heading), n: plain-len(heading))
    blank-line
  }
  let intro = kid(n, "intro")
  let head = if intro != none { kids(intro, "table").map(rows-of).fold((), (a, b) => a + b) } else { () }
  let groups = kids(n, "hcontainer").filter(g => attr(g, "name") == "tableGroup")
  let content = kid(n, "content")
  let plain-rows = if content != none { kids(content, "table").map(rows-of).fold((), (a, b) => a + b) } else { () }
  let group-rows = groups.map(g => { let c = kid(g, "content"); if c == none { () } else { kids(c, "table").map(rows-of).fold((), (a, b) => a + b) } })
  let data = plain-rows + group-rows.fold((), (a, b) => a + b)
  let L = table-layout(head + data, data)
  render-rows(head, L, headings: true)
  render-rows(plain-rows, L)
  for (g, rows) in groups.zip(group-rows) {
    blank-line
    centered-line(inline(kid(g, "heading")), n: plain-len(kid(g, "heading")))
    blank-line
    render-rows(rows, L)
  }
  let notes = kids(n, "hcontainer").filter(x => attr(x, "name") == "tableNote")
  if notes.len() > 0 { blank-line }
  for x in notes {
    body-par(inline(kid(x, "num")) + [ ] + inline(kid(kid(x, "content"), "p")))
  }
}

// ---------------------------------------------------------------------------
// Appropriation bills (S.3000-D and its kind). A schedule is laid out line by
// line, as the print does it: purpose language justified to 44 characters
// (continuation lines indented two), items with dot leaders to an amount
// ending at column 58, program lines to 72, reappropriations across the full
// 72. A blank line separates blocks (the summary, SCHEDULE, a program line, an
// account heading, a group of purposes, a group of items, a reappropriation
// source) and is dropped at the top of a page. Each agency, and its
// reappropriations, starts a new page under a running header naming it.
// Keep-together, as printed: a program line with its rule; the last three
// items of a group with the rules and totals under them; no paragraph leaves
// one line alone at the bottom or top of a page.
// ---------------------------------------------------------------------------
#let approp = attr(bill, "name") == "appropriationBill"
#let nb(k) = "\u{a0}" * k
#let a-blank = v(2 * spec.pitch - spec.size, weak: true)
#let a-line(col, it) = flush-line(h(col * char) + it)
#let keep(..lines) = block(breakable: false, spacing: spec.pitch - spec.size, lines.pos().join())

// Split a word at a division point (from hyphenation.json) or after a hyphen it already has, so that the first
// part with its hyphen is at most `room` characters. Returns (first, rest) or none. As measured on S.3000-D (96%
// of 2,284 line ends agree): the print divides a word only where four or more letters come before the hyphen.
#let split-word(w, room, slack: 99) = {
  if w.len() != 1 or slack < 3 { return none }
  let p = w.first()
  let t = p.text
  let cuts = ()
  // the division points of each part of a compound ("cyber-re-lated"), counted from the start of the word
  let off = 0
  for part in t.split("-") {
    let m = part.match(regex("^([A-Za-z]+)"))
    if m != none {
      let w0 = lower(m.captures.at(0))
      for k in hyph-approp.at(w0, default: hyph.at(w0, default: ())) { if off + k >= 4 { cuts.push((off + k, true)) } }
    }
    off += part.clusters().len() + 1
  }
  for (i, c) in t.clusters().enumerate() { if c == "-" and i > 0 and i < t.len() - 1 { cuts.push((i + 1, false)) } }
  let best = none
  for (k, add) in cuts {
    let len = k + int(add) + if p.kind == "del" and p.first { 1 } else { 0 }
    // a hyphen the word already has ("2025-2026", "Utica-Rome") is a break only for a full line (2 or fewer
    // characters short) and after three or more characters (never "4-C"): 6 times in S.3000-D
    let before = t.clusters().slice(0, k - 1).join()
    let after = t.clusters().slice(k).join()
    let ok = add or (room - len <= 2 and after.len() >= 3 and (before.len() >= 4 or before.match(regex("^\d{3,}$")) != none))
    if ok and len <= room and (best == none or k > best.at(0)) { best = (k, add) }
  }
  if best == none { return none }
  let (k, add) = best
  let cs = t.clusters()
  let a = p
  a.text = cs.slice(0, k).join() + if add { "-" } else { "" }
  a.last = false
  let b = p
  b.text = cs.slice(k).join()
  b.first = false
  b.glue = false
  ((a,), (b,))
}
// Greedy first-fit, as the typewriter did: `first` characters on the first line, `rest` on the others.
#let wrap2(ws, first, rest) = {
  let lines = ()
  let cur = ()
  let n = 0
  let width = first
  let queue = ws
  let i = 0
  while i < queue.len() {
    let w = queue.at(i)
    if w.first().run == -2 { i += 1; continue }
    let l = word-len(w)
    let need = l + if cur.len() > 0 { 1 } else { 0 }
    if n + need <= width { cur.push(w); n += need; i += 1; continue }
    let room = width - n - if cur.len() > 0 { 1 } else { 0 }
    let sp = split-word(w, room, slack: width - n)
    if sp != none and cur.len() > 0 or sp != none and room > 0 {
      cur.push(sp.at(0))
      lines.push(cur)
      cur = ()
      n = 0
      width = rest
      queue = queue.slice(0, i) + (sp.at(1),) + queue.slice(i + 1)
      continue
    }
    if cur.len() == 0 { cur.push(w); i += 1 }
    lines.push(cur)
    cur = ()
    n = 0
    width = rest
  }
  if cur.len() > 0 { lines.push(cur) }
  lines
}
#let line-len(ws) = ws.map(word-len).sum(default: 0) + calc.max(0, ws.len() - 1)
// A justified line: the extra spaces go evenly, the odd ones from the left on even lines and from the right on
// odd ones (the spacing is not part of the bill; only the words on each line are).
#let draw-just(ws, width, k) = {
  let gaps = ws.len() - 1
  if gaps <= 0 { return draw-line(ws) }
  let extra = width - line-len(ws)
  let base = calc.floor(extra / gaps)
  let odd = extra - base * gaps
  let out = []
  for (i, w) in ws.enumerate() {
    if i > 0 {
      let g = i - 1
      let more = if calc.rem(k, 2) == 0 { g < odd } else { g >= gaps - odd }
      let sp = nb(1 + base + int(more))
      let a = ws.at(i - 1).last()
      let b = w.first()
      out += if a.kind == "ins" and b.kind == "ins" and a.run == b.run { under(sp) } else { sp }
    }
    out += w.map(draw-piece).sum(default: [])
  }
  out
}
#let leaders(n) = "." * calc.max(n, 1)
// A paragraph laid out by `wrap2`, justified; the last line may end in dot leaders and an amount.
//   first/cont: columns of the first and following lines; right: the right edge of the words;
//   tail: (amount string, end column) for a leader line, or none.
#let a-par(ws, first: 0, cont: 2, right: 44, tail: none, just: true) = {
  let lines = wrap2(ws, right - first, right - cont)
  if tail != none and lines.len() > 0 {
    // the last line must leave room for " . " and the amount before the end column
    let (amt, endc) = tail
    let lastcol = if lines.len() == 1 { first } else { cont }
    let room = endc - lastcol - amt.len() - 3
    let last = lines.last()
    if line-len(last) > room {
      let keepw = ()
      let n = 0
      for w in last { let need = word-len(w) + if keepw.len() > 0 { 1 } else { 0 }; if n + need <= room and keepw.len() < last.len() - 0 { keepw.push(w); n += need } else { break } }
      let moved = last.slice(keepw.len())
      lines = lines.slice(0, -1) + if keepw.len() > 0 { (keepw, moved) } else { (moved,) }
    }
  }
  let out = ()
  for (i, l) in lines.enumerate() {
    let col = if i == 0 { first } else { cont }
    let lastl = i == lines.len() - 1
    if lastl and tail != none {
      let (amt, endc) = tail
      let used = col + line-len(l)
      let dots = endc - used - 2 - amt.len()
      out.push(a-line(col, draw-line(l) + nb(1) + leaders(dots) + nb(1) + amt))
    } else if not lastl and just {
      out.push(a-line(col, draw-just(l, right - col, i)))
    } else {
      out.push(a-line(col, draw-line(l)))
    }
  }
  out
}
// Paragraph lines grouped so none is left alone at a page's foot or head.
#let no-widows(lines) = {
  let n = lines.len()
  if n <= 3 { return (keep(..lines),) }
  (keep(..lines.slice(0, 2)),) + lines.slice(2, n - 2) + (keep(..lines.slice(n - 2)),)
}
#let amount-of(p) = { let q = els(p).filter(c => c.tag == "quantity"); if q.len() > 0 { text-of(q.last()) } else { none } }
#let words-before-amount(p) = {
  let cs = p.children
  let k = cs.len() - 1
  while k >= 0 and (type(cs.at(k)) == str and cs.at(k).trim() == "") { k -= 1 }
  if k >= 0 and is-el(cs.at(k)) and cs.at(k).tag == "quantity" { cs = cs.slice(0, k) }
  nodes-words(cs)
}
#let rule-line(col, ch: "-", n: 14) = a-line(col, ch * n)
#let center-text(t) = a-line(calc.ceil((spec.chars - t.clusters().len()) / 2), t)

// The summary table: "For payment according to the following schedule:"
#let render-summary(n) = {
  let out = ()
  let intro = kid(n, "intro")
  // "For payment according to the following schedule:"; a longer intro runs to column 58, justified, continued at 2
  if intro != none { out.push(a-par(nodes-words(kid(intro, "p").children), first: 0, cont: 2, right: 58)) }
  let t = find(n, "table")
  let rows = kids(t, "tr")
  out.push((a-line(40, "APPROPRIATIONS" + nb(2) + "REAPPROPRIATIONS"),))
  let body = ()
  for r in rows.filter(r => attr(r, "class") != "headerRow") {
    let cs = els(r)
    let name = text-of(cs.at(0))
    let total = attr(r, "class") == "totalRow"
    let col = if total { 4 } else { 2 }
    let a = text-of(cs.at(1))
    let b = text-of(cs.at(2))
    if total {
      body.push(a-line(38, "-" * 16 + nb(2) + "-" * 16))
    }
    let dots = 38 - col - name.len() - 1
    body.push(a-line(col, name + nb(1) + leaders(dots) + nb(54 - 38 - a.len()) + a + nb(72 - 54 - b.len()) + b))
    if total { body.push(a-line(38, "=" * 16 + nb(2) + "=" * 16)) }
  }
  out.push(body)
  out
}

// An account heading: each part (fund type, fund, account and number) on its own line at column 2.
#let render-account-heading(h, right: 58) = {
  let parts = els(h).filter(c => c.tag == "inline")
  let out = ()
  for (i, p) in parts.enumerate() {
    let last = i == parts.len() - 1
    // the account's number is part of the account line
    if attr(p, "name") == "accountCode" { continue }
    let nodes = (p,)
    let nxt = parts.at(i + 1, default: none)
    if nxt != none and attr(nxt, "name") == "accountCode" {
      let between = h.children.slice(h.children.position(c => c == p) + 1, h.children.position(c => c == nxt))
      nodes = (p,) + between + (nxt,)
    }
    out += a-par(nodes-words(nodes), first: 2, cont: 4, right: right)
  }
  out
}

// Items, subtotals and totals of one group; "ruleAfter" / "doubleRuleAfter" draw the rule under an entry.
#let render-entry(c) = {
  let name = attr(c, "name")
  let p = find(c, "p")
  let amt = amount-of(p)
  // an offset prints in parentheses: "Less the amount appropriated ... (1,991,489,000)"
  let q = els(p).filter(x => x.tag == "quantity")
  if q.len() > 0 and attr(q.last(), "class") == "offset" { amt = "(" + amt + ")" }
  let cls = attr(c, "class")
  let lines = if name == "appropriation" {
    a-par(words-before-amount(p), first: 0, cont: 2, right: 44, tail: (amt, 58))
  } else if name == "subtotal" {
    a-par(words-before-amount(p), first: 4, cont: 6, right: 58, tail: (amt, 58), just: false)
  } else if (text-of(p).starts-with("Total") and not text-of(p).starts-with("Total amount available")) or text-of(p).starts-with("Less") {
    // a total over several groups ("Total general fund support", "Total gross operating - ...") at column 0
    a-par(words-before-amount(p), first: 0, cont: 2, right: 44, tail: (amt, 58), just: false)
  } else {
    a-par(words-before-amount(p), first: 2, cont: 4, right: 44, tail: (amt, 58), just: false)
  }
  // a project schedule under the item: its projects (allocations of the item) and the schedule's total
  let ps = find(c, "table")
  if name == "appropriation" and ps != none and attr(ps, "class") == "projectSchedule" {
    lines.push(a-blank)
    lines.push(a-line(14, "Project" + nb(1) + "Schedule"))
    lines.push(a-line(0, "PROJECT" + nb(31) + "AMOUNT"))
    lines.push(rule-line(0, n: 44))
    for r in kids(ps, "tr").filter(r => attr(r, "class") != "headerRow") {
      let cs = els(r)
      let a = text-of(cs.at(1))
      if attr(r, "class") == "totalRow" {
        lines.push(rule-line(30))
        lines += a-par(nodes-words(kid(cs.at(0), "p").children), first: 0, cont: 2, right: 44, tail: (a, 44), just: false)
        lines.push(rule-line(30))
      } else {
        lines += a-par(nodes-words(kid(cs.at(0), "p").children), first: 0, cont: 2, right: 30, tail: (a, 44))
      }
    }
  }
  if cls.contains("doubleRuleAfter") { lines.push(rule-line(44, ch: "=")) }
  else if cls.contains("ruleAfter") { lines.push(rule-line(44)) }
  lines
}

// A schedule's blocks for one account (or object group): purposes, then items, alternating.
#let account-blocks(kids-list) = {
  let blocks = ()
  let cur = ()
  let mode = none
  for c in kids-list {
    let name = attr(c, "name")
    if name == "objectGroup" {
      if cur.len() > 0 { blocks.push((mode, cur)); cur = () }
      // a group's own heading ("STUDENT GRANTS AND LOANS"), at column 0
      let gh = kid(c, "heading")
      if gh != none { blocks.push(("heading", (gh,))) }
      blocks += account-blocks(els(c).filter(x => x.tag == "hcontainer")); mode = none; continue
    }
    let m = if name == "purpose" { "purpose" } else { "items" }
    if m != mode and cur.len() > 0 { blocks.push((mode, cur)); cur = () }
    mode = m
    cur.push(c)
  }
  if cur.len() > 0 { blocks.push((mode, cur)) }
  blocks
}
#let render-block(mode, cs) = {
  if mode == "heading" {
    (keep(..a-par(nodes-words(cs.first().children), first: 0, cont: 2, right: 72, just: false)),)
  } else if mode == "purpose" {
    let out = ()
    for c in cs { for p in kids(kid(c, "content"), "p") { out += no-widows(a-par(nodes-words(p.children))) } }
    out
  } else {
    // items. As measured on S.3000-D: the last two items stay together with the rule under them, and each
    // subtotal or total stays with its rule (a page may end on the items' rule and begin with a subtotal); the
    // first two items of a group stay together, so a group never leaves a single item at the foot of a page.
    let entries = cs.map(render-entry)
    let tailstart = entries.len()
    while tailstart > 0 and attr(cs.at(tailstart - 1), "name") != "appropriation" { tailstart -= 1 }
    let H = 2
    let lastitems = calc.max(0, tailstart - 2)
    if lastitems < H { lastitems = 0 }
    let head = entries.slice(0, lastitems)
    let out = ()
    if head.len() >= H {
      out.push(keep(..head.slice(0, H).flatten()))
      for e in head.slice(H) { out += no-widows(e) }
    }
    // the last two lines of items stay with the rule under them (two items, or the end of a paragraph item)
    let tail = entries.slice(lastitems, tailstart)
    let flat = tail.flatten()
    if flat.len() <= 3 or tail.all(e => e.len() == 1 or e.len() == 2 and e.last() == tail.last().last()) {
      out.push(keep(..flat))
    } else {
      let n = flat.len() - 3
      let seen = 0
      for e in tail {
        let pre = e.slice(0, calc.min(e.len(), calc.max(0, n - seen)))
        if pre.len() > 0 { out += no-widows(pre) }
        seen += e.len()
      }
      out.push(keep(..flat.slice(n)))
    }
    for e in entries.slice(tailstart) { out.push(keep(..e)) }
    out
  }
}

#let render-schedule(n) = {
  let blocks = ()
  let summary = kids(n, "hcontainer").find(c => attr(c, "name") == "agencySummary")
  if summary != none {
    blocks += render-summary(summary)
    // a summary without its "For payment according to ..." line has no SCHEDULE heading either
    if kid(summary, "intro") != none { blocks.push((center-text("SCHEDULE"),)) }
  }
  for prog in kids(n, "hcontainer").filter(c => attr(c, "name") == "program") {
    let h = kid(prog, "heading")
    if h != none {
      let amt = amount-of(h)
      if amt != none {
        let lines = a-par(words-before-amount(h), first: 0, cont: 2, right: 58, tail: (amt, 72))
        lines.push(rule-line(58))
        blocks.push((keep(..lines),))
      } else if attr(prog, "class") == "fundGroup" {
        // a centred heading over the programs that follow ("SPECIAL REVENUE FUNDS - FEDERAL")
        blocks.push((center-text(text-of(h)),))
      } else {
        blocks.push(a-par(nodes-words(h.children), first: 0, cont: 2, right: 72, just: false))
      }
    }
    for acct in kids(prog, "hcontainer").filter(c => attr(c, "name") == "account") {
      let ah = kid(acct, "heading")
      if ah != none { blocks.push(render-account-heading(ah)) }
      for (mode, cs) in account-blocks(kids(acct, "hcontainer")) { blocks.push(render-block(mode, cs)) }
    }
  }
  blocks
}

// Reappropriations: an item is "text ... original .... (re. $amount)" across the full line.
#let render-reitem(c) = {
  let p = find(c, "p")
  let qs = els(p).filter(x => x.tag == "quantity")
  let orig = text-of(qs.find(q => attr(q, "class") == "originalAmount"))
  let re = text-of(qs.find(q => attr(q, "class") == "reappropriatedAmount"))
  let cs = p.children
  let k = cs.position(x => is-el(x) and x.tag == "quantity" and attr(x, "class") == "originalAmount")
  let head = cs.slice(0, k)
  // drop the " ... " (or plain space) before the original amount from the words; words after the leader (an
  // amended amount, "[3,900,000]") follow it: "Personal service (50000) ... [3,900,000] 3,867,000 ...."
  let all = nodes-words(head)
  let li = all.position(w => w.map(q => q.text).join() == "...")
  let ws = if li == none { all } else { all.slice(0, li) }
  let after = if li == none { () } else { all.slice(li + 1) }
  let ctoks = attr(c, "class").split(" ")
  let noLeader = "noLeader" in ctoks
  let aft = after.map(w => draw-line((w,)) + nb(1)).join()
  let aftlen = after.map(w => line-len((w,)) + 1).sum(default: 0)
  let mid = (if noLeader { nb(1) } else { nb(1) + "..." + nb(1) }) + if aft == none { "" } else { aft }
  let midlen = (if noLeader { 1 } else { 5 }) + aftlen
  let tail = "(re. $" + re + ")"
  let lines = wrap2(ws, 70, 68)
  let last = lines.last()
  let lastcol = if lines.len() == 1 { 2 } else { 4 }
  let out = ()
  for (i, l) in lines.slice(0, -1).enumerate() { out.push(a-line(if i == 0 { 2 } else { 4 }, draw-just(l, 72 - if i == 0 { 2 } else { 4 }, i))) }
  let used = lastcol + line-len(last) + midlen + orig.len() + 1 + 1 + 1 + tail.len()
  if used <= 72 {
    let dots = 72 - (lastcol + line-len(last) + midlen + orig.len() + 2 + tail.len())
    out.push(a-line(lastcol, draw-line(last) + mid + orig + nb(1) + leaders(dots) + nb(1) + tail))
  } else {
    // the amounts go on the next line, under a line of leaders; where fewer than three leaders would fit, the
    // words line is justified to the margin and the amounts line begins with the leader ("... 59,000,000 ....")
    let room = 72 - lastcol - line-len(last) - 1
    let lead = if room >= 3 { "" } else { "..." + nb(1) }
    if room >= 3 { out.push(a-line(lastcol, draw-line(last) + nb(1) + leaders(room))) }
    else { out.push(a-line(lastcol, draw-just(last, 72 - lastcol, lines.len() - 1))) }
    out.push(a-line(4, lead + (if aft == none { "" } else { aft }) + orig + nb(1) + leaders(72 - 4 - (if room >= 3 { 0 } else { 4 }) - aftlen - orig.len() - 2 - tail.len()) + nb(1) + tail))
  }
  out
}
#let render-reentries(cs) = {
  let out = ()
  for c in cs {
    let name = attr(c, "name")
    if name == "purpose" {
      for p in kids(kid(c, "content"), "p") { out += no-widows(a-par(nodes-words(p.children), first: 2, cont: 4, right: 72)) }
    } else if name == "reappropriation" {
      out += no-widows(render-reitem(c))
    }
  }
  out
}
#let render-reapprops(n) = {
  let blocks = ()
  // an agency with reappropriations only opens them with its summary
  let summary = kids(n, "hcontainer").find(c => attr(c, "name") == "agencySummary")
  if summary != none {
    blocks += render-summary(summary)
    if kid(summary, "intro") != none { blocks.push((center-text("SCHEDULE"),)) }
  }
  for prog in kids(n, "hcontainer").filter(c => attr(c, "name") == "program") {
    let h = kid(prog, "heading")
    if h != none { blocks.push(a-par(nodes-words(h.children), first: 0, cont: 2, right: 72, just: false)) }
    for acct in kids(prog, "hcontainer").filter(c => attr(c, "name") == "account") {
      let ah = kid(acct, "heading")
      if ah != none { blocks.push(render-account-heading(ah, right: 72)) }
      for src in kids(acct, "hcontainer").filter(c => attr(c, "name") == "reappropriationSource") {
        let lines = ()
        let intro = kid(src, "intro")
        if intro != none { lines += no-widows(a-par(nodes-words(kid(intro, "p").children), first: 0, cont: 4, right: 72)) }
        let content = kid(src, "content")
        if content != none {
          // an amended reappropriation: the lead-in, then the quoted text with its new and old matter
          let mod = find(content, "mod")
          let lead = mod.children.filter(c => not (is-el(c) and c.tag == "quotedStructure"))
          lines += no-widows(a-par(nodes-words(lead), first: 0, cont: 4, right: 72))
          lines += render-reentries(kids(find(mod, "quotedStructure"), "hcontainer"))
        }
        lines += render-reentries(kids(src, "hcontainer"))
        blocks.push(lines)
      }
    }
  }
  blocks
}

// An agency's schedule (or its reappropriations) on its own pages, under its running header.
#let render-agency(n) = {
  let misc = kid(n, "num")
  // the budget line has three spaces before the fiscal year ("STATE OPERATIONS   2025-26")
  let sub = squeeze(text-of(kid(n, "subheading"))).replace(regex(" (\d{4}-\d{2})$"), m => "   " + m.captures.at(0))
  let heads = (if misc != none { (text-of(misc),) } else { () }) + (text-of(kid(n, "heading")), sub)
  // A department over its agency ("DEPARTMENT OF FAMILY ASSISTANCE" / "OFFICE OF CHILDREN AND FAMILY SERVICES")
  // is set on consecutive lines, as for most of S.3000-D; the "MISCELLANEOUS -- ALL STATE DEPARTMENTS AND
  // AGENCIES" heading stands a line above its agency.
  let toks = attr(n, "class").split(" ")
  let tight = heads.len() == 3 and not heads.first().starts-with("MISCELLANEOUS")
  let slots = if tight { (0, 1, 3) } else { range(heads.len()).map(i => 2 * i) }
  let ntop = slots.last() + 2
  let blocks = if "reappropriations" in toks { render-reapprops(n) } else { render-schedule(n) }
  let fg = {
    for (i, t) in heads.enumerate() {
      let col = calc.ceil((spec.chars - t.clusters().len()) / 2)
      place(top + left, dx: spec.left + col * char, dy: spec.first-line - 0.8 * spec.size + slots.at(i) * spec.pitch, text(t.replace(" ", "\u{a0}")))
    }
  }
  let tm = spec.first-line - 0.8 * spec.size + ntop * spec.pitch
  page(margin: (left: spec.left, right: 8.5in - spec.left - measure, top: tm, bottom: 11in - (spec.first-line - 0.8 * spec.size) - body-height), header-ascent: tm - (spec.header + 0.2 * spec.size), foreground: fg, {
    // where the agency begins, for the table of contents
    [#metadata(attr(n, "eId")) <agency-start>]
    for (i, b) in blocks.enumerate() {
      if i > 0 { a-blank }
      b.join()
    }
  })
}

// ---------------------------------------------------------------------------
// Units of text: bill sections, and the quoted law inside them
// ---------------------------------------------------------------------------
#let structural = ("section", "subsection", "subdivision", "paragraph", "subparagraph", "clause",
                   "subclause", "point", "article", "title", "subtitle", "chapter", "subchapter",
                   "part", "subpart", "hcontainer")

// A unit's number and heading run in with its first words. Where a unit has
// no words of its own, they run in with its first sub-unit, as printed:
// "§ 327-a. Modification of restrictive covenants. 1. As used in this section"
#let structure(n, lead: []) = {
  let name = attr(n, "name")
  if n.tag == "hcontainer" and name == "agency" {
    render-agency(n)
  } else if n.tag == "hcontainer" and name == "table" {
    render-named-table(n)
  } else if n.tag == "hcontainer" and name == "tableGroup" {
    blank-line
    centered-line(inline(kid(n, "heading")), n: plain-len(kid(n, "heading")))
    blank-line
    for t in kids(kid(n, "content"), "table") { render-table(t) }
  } else if (n.tag == "part" or n.tag == "subpart") and kid(n, "num") != none and attr(n, "class") == "omitted" {
    centered-line(inline(kid(n, "num")), n: plain-len(kid(n, "num")))
    centered-line(inline(kid(kid(n, "content"), "p")), n: plain-len(kid(kid(n, "content"), "p")))
  } else {
    let mine = lead
    let num = kid(n, "num")
    let heading = kid(n, "heading")
    if n.tag == "part" or n.tag == "subpart" or name == "table" {
      // Parts and named tables carry their own centered heading lines
      let spaced = name == "table"
      if spaced and (num != none or heading != none) { blank-line }
      if num != none { centered-line(inline(num), n: plain-len(num)) }
      if heading != none { centered-line(inline(heading), n: plain-len(heading)) }
      if spaced and (num != none or heading != none) { blank-line }
    } else {
      if num != none { mine += inline(num) + [ ] }
      if heading != none { mine += inline(heading) + [ ] }
    }
    for holder in ("intro", "content", "wrapUp") {
      let h = kid(n, holder)
      if h == none { continue }
      for c in els(h) {
        if c.tag == "p" {
          body-par(mine + inline(c))
          mine = []
          // the law quoted by this sentence follows it
          let stack = (c,)
          while stack.len() > 0 {
            let x = stack.pop()
            for y in els(x).rev() {
              if y.tag == "quotedStructure" {
                for (i, q) in els(y).enumerate() {
                  if q.tag == "table" { render-table(q) } else { structure(q) }
                }
              } else { stack.push(y) }
            }
          }
        } else if c.tag == "table" {
          if mine != [] { body-par(mine); mine = [] }
          render-table(c)
        }
      }
    }
    let subs = els(n).filter(c => c.tag in structural)
    for c in subs {
      structure(c, lead: mine)
      mine = []
    }
    if mine != [] { body-par(mine) }
  }
}

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------
#let rule(n) = "_" * n

#set text(
  font: spec.font,
  size: spec.size,
  lang: "en",
  hyphenate: false,     // only at the points listed in hyphenation.json
  overhang: false,      // keep punctuation inside the measure
  // Make each line box exactly one em tall so line spacing is exact.
  top-edge: 0.8em,
  bottom-edge: -0.2em,
)
#set par(justify: true, leading: spec.pitch - spec.size, spacing: spec.pitch - spec.size)
#set block(spacing: spec.pitch - spec.size)

#set par.line(
  numbering: n => text(size: spec.size, str(n)),
  numbering-scope: "page",
  number-clearance: 2 * char,
)
// A paragraph's first line is not left alone at the foot of a page.
#set text(costs: (orphan: 100%, widow: 0%))

#let top-margin = spec.first-line - 0.8 * spec.size
#let foot-lines = 4    // blank line, two lines of explanation, LBD number

#set page(
  paper: "us-letter",
  margin: (left: spec.left, right: 8.5in - spec.left - measure, top: top-margin, bottom: 11in - top-margin - body-height),
  header-ascent: top-margin - (spec.header + 0.2 * spec.size),
  header: context {
    if here().page() > 1 and approp {
      // appropriation bills: the page number centred, the LBD number (without "LBD") ending at column 72
      let pg = str(here().page())
      let lbd = lbd-no.replace("LBD", "")
      par(justify: false, h((36 - calc.floor(pg.len() / 2)) * char) + pg + h((62 - (36 - calc.floor(pg.len() / 2)) - pg.len()) * char) + lbd)
    } else if here().page() > 1 {
      // bill number at the left, page number at the 37th character, as printed
      if joint {
        par(justify: false, box(width: 36 * char, numbers.at(0)) + box(width: 26 * char, str(here().page())) + numbers.at(1))
      } else {
        par(justify: false, box(width: 36 * char, [#prefix #bill-no]) + str(here().page()))
      }
    }
  },
)

// Page 1 ends higher than the other pages, and carries the explanation and the
// LBD number under the last line of text.
#let first-page-foot = {
  set par.line(numbering: none)
  set par(justify: false, first-line-indent: 0pt)
  blank-line
  par(h(char) + [EXPLANATION\-\-Matter in #under[italics] (underscored) is new; matter in brackets])
  par(h(22 * char) + [\[ \] is old law to be omitted.])
  par(h(1fr) + lbd-no)
  v(top-margin + body-height - (spec.first-page-end + 0.2 * spec.size), weak: false)
}
#place(bottom + left, float: true, clearance: 0pt, first-page-foot)

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

// Front matter: no line numbers. Each printed line is one <p> of the preface,
// told apart by its class, in the order the profile stores them.
#let big-line(t) = place(top + left, dx: (measure - t.clusters().len() * spec.big * 0.6) / 2 + 0.1 * char,
  text(size: spec.big, weight: "bold", t))
#{
  set par.line(numbering: none)
  set par(justify: false, first-line-indent: 0pt)
  let centered(t) = par(center-pad(t.clusters().len()) + t)
  let after-number = false
  // A draft (profile 0.3: no bill number or introduction date yet) keeps their lines blank, so the rest of the
  // cover sits where it will sit on the printed bill.
  let has-date = els(preface).any(p => attr(p, "class") == "date" or els(p).any(c => c.tag == "docDate"))
  for p in els(preface) {
    let class = attr(p, "class")
    // older files have no class: tell the line from what it holds
    if class == "" {
      let inner = els(p).map(c => c.tag)
      class = if "docAuthority" in inner { "authority" } else if "docNumber" in inner { "number" } else if "session" in inner { "session" } else if "docStage" in inner { "stage" } else if "docDate" in inner { "date" } else if "docType" in inner { "docType" } else { "" }
    }
    if after-number and class != "calendar" and class != "stage" { blank-line }
    after-number = false
    if class == "authority" {
      // large bold line above the text area, then the rule
      place(top + left, dy: spec.title-line - 0.8 * spec.big - top-margin, big-line(text-of(p)))
      v(spec.rule-line - 0.8 * spec.size - top-margin)
      par(rule(spec.chars))
      blank-line
    } else if class == "number" {
      centered(els(p).map(text-of).join("    "))
      after-number = true
    } else if class == "calendar" {
      par(h(4 * char) + text-of(p))
      after-number = true
    } else if class == "session" or class == "prefiled" {
      centered(text-of(p))
      after-number = class == "prefiled"
    } else if class == "stage" {
      // large bold line: sits 30.38pt below the line above, 25.12pt above the date
      block(height: 42.9pt, width: 100%, place(top + left, dy: 11.91pt, big-line(text-of(p))))
      if not has-date {
        blank-line
        centered(rule(11))
        blank-line
      }
    } else if class == "date" {
      centered(text-of(p))
      centered(rule(11))
      blank-line
    } else if class == "introduction" {
      par(justify: true, linebreaks: "simple", hanging-indent: spec.indent * char, inline(p))
      blank-line
    } else if class == "docType" {
      centered(text-of(p))
      blank-line
    } else if p.tag == "longTitle" {
      par(justify: true, linebreaks: "simple", hanging-indent: spec.indent * char, inline(kid(p, "p")))
      blank-line
    }
  }
  let preamble = kid(bill, "preamble")
  if preamble != none {
    let formula = find(preamble, "formula")
    // The enacting clause is underscored in print. It is not new matter: the underscore is its form, so the
    // XML holds it as plain text and nothing reads it as an amendment.
    par(justify: true, linebreaks: "simple", first-line-indent: (amount: spec.indent * char, all: true),
      under(inline(kid(formula, "p"))))
    blank-line
  }
}

// Body: numbered lines
#for s in els(kid(bill, "body")).filter(c => c.tag in structural) { structure(s) }

// The table of contents of an appropriation bill: the agencies by their index names ("AGING, OFFICE FOR THE"),
// each with the page its schedule begins on, worked out here, so it is right however the pages fall.
#let render-toc(toc) = {
  let fg = {
    place(top + left, dx: spec.left + 28 * char, dy: spec.first-line - 0.8 * spec.size, text("TABLE\u{a0}OF\u{a0}CONTENTS"))
    place(top + left, dx: spec.left + 68 * char, dy: spec.first-line - 0.8 * spec.size + spec.pitch, text("Page"))
  }
  let tm = spec.first-line - 0.8 * spec.size + 3 * spec.pitch
  page(margin: (left: spec.left, right: 8.5in - spec.left - measure, top: tm, bottom: 11in - (spec.first-line - 0.8 * spec.size) - body-height), header-ascent: tm - (spec.header + 0.2 * spec.size), foreground: fg, context {
    let pages = (:)
    for m in query(<agency-start>) { if m.value not in pages { pages.insert(m.value, str(m.location().page())) } }
    let blocks = ()
    for it in kids(toc, "tocItem") {
      let col = (int(attr(it, "level")) - 1) * 2
      let href = attr(it, "href").slice(1)
      let pg = if href == "sec_1" { "1" } else { pages.at(href, default: "") }
      let ws = nodes-words(it.children)
      if attr(it, "class") == "noPage" or pg == "" {
        blocks.push(a-par(ws, first: col, cont: col + 2, right: 72, just: false))
      } else {
        blocks.push(a-par(ws, first: col, cont: col + 2, right: 58, tail: (pg, 72), just: false))
      }
    }
    for (i, b) in blocks.enumerate() {
      if i > 0 { a-blank }
      keep(..b)
    }
  })
}
#if approp {
  let c = kid(bill, "conclusions")
  let toc = if c != none { kid(c, "toc") } else { none }
  if toc != none { render-toc(toc) }
}
