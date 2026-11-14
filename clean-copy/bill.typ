// LBDC clean-copy template (demo), for documents that follow the AKN-NY profile.
// Reads a bill or a concurrent resolution numbered as a bill and lays it out as
// a clean copy: front matter, numbered lines, new matter underscored, old matter
// in brackets, quoted law with its units, and tables.
// Not yet handled: resolutions in the resolution series and appropriation schedules.
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

#let words(cell) = {
  let ps = pieces(kid(cell, "p"), "", ())
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
  if n.tag == "hcontainer" and name == "table" {
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
    if here().page() > 1 {
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
