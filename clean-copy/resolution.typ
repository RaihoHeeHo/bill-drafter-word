// LBDC clean-copy template for resolutions in the resolution series (Senate J, B and R; Assembly K, C, E and L),
// for documents that follow the AKN-NY profile (statement name="legislativeResolution", "concurrentResolution",
// "senateResolution" or "assemblyResolution"). Bills print with bill.typ.
//
// Laid out as Open Legislation sets resolutions (legislation.nysenate.gov): Courier, 72 characters a line, no line
// numbers, words never divided. The number, then "BY:" and the sponsor, then the caption set 8 in and 52 wide, then
// each WHEREAS and RESOLVED paragraph with its first line 2 in (at the margin when marked class="flush"), a blank
// line between parts. A report after the RESOLVED clauses (the budget resolutions) has centred headings, headings
// and paragraphs at the margin, and items marked "*", "o", "-" and "*" (set 2, 6, 10 and 14 in, continued 2
// further in); a part marked "tight" follows the one above it with no blank line.
//
// The lines are set here rather than by Typst's paragraph builder, the way the text Open Legislation prints was set:
// each line takes as many words as fit; the spaces left over go into the gaps one at a time, from the left on one
// line and from the right on the next (the side changes only after a line that needed them); a line with a bold
// word ("WHEREAS,") is 2 characters shorter for each.
//
// Build:
//   typst compile --font-path fonts --input xml=J123.xml resolution.typ J123.pdf

#let spec = (
  font: sys.inputs.at("font", default: "FreeMono"),
  // Measured from Open Legislation's PDFs of resolutions:
  size: 12pt,         // each character 7.2pt wide
  pitch: 13.2pt,      // baseline to baseline
  chars: 72,
  left: 43.5pt,
  top: 51pt,          // baseline of the first line
  lines: 54,
)
#let char = spec.size * 0.6

#let source = xml(sys.inputs.at("xml", default: "J123.xml"))
#let root = source.filter(n => type(n) == dictionary and n.tag != "").first()
#let is-el(n, tag: none) = type(n) == dictionary and (tag == none or n.tag == tag)
#let kids(n, tag) = n.children.filter(c => is-el(c, tag: tag))
#let kid(n, tag) = kids(n, tag).at(0, default: none)
#let attr(n, name) = if is-el(n) { n.attrs.at(name, default: "") } else { "" }
#let has-class(n, c) = attr(n, "class").split(" ").contains(c)
#let doc = root.children.find(c => is-el(c))

#set document(title: "Resolution")
// Signed packages: the bill's fingerprint at the foot of every page, and VOID on a copy that failed its checks (as bill.typ).
#let fingerprint = sys.inputs.at("fingerprint", default: "")
#let void-copy = sys.inputs.at("void", default: "no") == "yes"
#let stamp = {
  if void-copy {
    place(center + horizon, rotate(-40deg, text(size: 150pt, weight: "bold", fill: rgb(180, 35, 24, 90), tracking: 6pt, "VOID")))
  }
  if fingerprint != "" {
    place(bottom + left, dx: spec.left, dy: -0.32in, text(size: 6.5pt, fill: luma(110), "Signed package fingerprint " + fingerprint + if void-copy { " · VOID: this copy failed its checks" } else { "" }))
  }
}
#set page(paper: "us-letter", foreground: stamp,
  margin: (left: spec.left, right: 8.5in - spec.left - spec.chars * char - 2pt, top: spec.top - 0.8 * spec.size,
    bottom: 11in - spec.top - (spec.lines - 1) * spec.pitch - 0.2 * spec.size))
#set text(font: spec.font, size: spec.size, hyphenate: false, top-edge: 0.8em, bottom-edge: -0.2em)
#set par(leading: spec.pitch - spec.size, spacing: spec.pitch - spec.size, justify: false)

// The words of an element: each word a list of pieces (text, bold, start), start marking the first piece of a bold
// run, which costs the line 2 characters.
#let pieces(n) = {
  if type(n) == str { return ((t: n, bold: false, start: false),) }
  if not is-el(n) { return () }
  if n.tag == "num" or n.tag == "blockList" { return () }
  if n.tag == "b" {
    let ps = n.children.map(pieces).flatten().map(p => (t: p.t, bold: true, start: false))
    if ps.len() > 0 { ps.at(0).start = true }
    return ps
  }
  n.children.map(pieces).flatten()
}
#let words-of(n) = {
  let words = ()
  let cur = ()
  for p in pieces(n) {
    let segs = p.t.split(regex("\s+"))
    let first = true
    for (i, s) in segs.enumerate() {
      if i > 0 and cur.len() > 0 { words.push(cur); cur = () }
      if s != "" {
        cur.push((t: s, bold: p.bold, start: p.start and first))
        first = false
      }
    }
  }
  if cur.len() > 0 { words.push(cur) }
  words
}
#let wlen(w) = w.map(p => p.t.clusters().len()).sum()
#let runs(ws) = ws.map(w => w.filter(p => p.start).len()).sum(default: 0)
#let show-word(w) = w.map(p => if p.bold { text(weight: "bold", p.t) } else { [#p.t] }).join()

// One line: `col` characters in, the marker, then the words with the given gaps.
#let line(col, mark, ws, gaps) = {
  let body = if ws.len() == 0 { [] } else {
    let x = show-word(ws.at(0))
    for (g, w) in gaps.zip(ws.slice(1)) { x += h(g * char) + show-word(w) }
    x
  }
  par(box(width: col * char) + [#mark] + body)
}

// Sets a paragraph: first line at `first` (then the marker), the others at `cont`; lines end by column `w1` (the
// first) and `w` (the rest). Returns (lines, side) so the side the spare spaces go to carries on to the next.
#let lay(ws, first: 0, cont: 0, w1: 72, w: 72, mark: "", justify: true, side: 0) = {
  let mlen = mark.clusters().len()
  let lines = ()
  let cur = ()
  let col = first + mlen
  let len = 0
  for wd in ws {
    let lim = (if lines.len() == 0 { w1 } else { w }) - 2 * runs(cur + (wd,))
    let n = col + len + (if cur.len() > 0 { 1 } else { 0 }) + wlen(wd)
    if cur.len() > 0 and n > lim {
      lines.push((col, cur))
      cur = (wd,)
      col = cont
      len = wlen(wd)
    } else {
      len += (if cur.len() > 0 { 1 } else { 0 }) + wlen(wd)
      cur.push(wd)
    }
  }
  lines.push((col, cur))
  let out = ()
  for (j, (c, l)) in lines.enumerate() {
    let g = l.len() - 1
    let gaps = range(calc.max(g, 0)).map(_ => 1)
    if justify and j < lines.len() - 1 and g > 0 {
      let tgt = (if j == 0 { w1 } else { w }) - 2 * runs(l)
      let extra = calc.max(tgt - c - l.map(wlen).sum() - g, 0)
      let q = calc.div-euclid(extra, g)
      let r = calc.rem-euclid(extra, g)
      gaps = gaps.map(x => x + q)
      for k in range(r) {
        let at = if calc.odd(side) { g - 1 - k } else { k }
        gaps.at(at) += 1
      }
      if extra > 0 { side += 1 }
    }
    out.push(line(if j == 0 { first } else { c }, if j == 0 { mark } else { "" }, l, gaps))
  }
  (out, side)
}

#let blank = par(box(height: spec.size, width: 1pt))
#let squeeze(s) = s.replace(regex("\s+"), " ").trim()
#let plain(n) = if type(n) == str { n } else if is-el(n) { n.children.map(plain).join() } else { "" }

// an item of a report and the items under it: (parts, side)
#let item-parts(it, level, side) = {
  let out = ()
  let mark = squeeze(plain(kid(it, "num")))
  let first = (level - 1) * 4 + 2
  let (ls, s) = lay(words-of(kid(it, "p")), first: first, cont: first + 2,
    mark: if mark == "-" { "-" } else { mark + " " }, side: side)
  out.push((ls, not has-class(it, "tight")))
  let sub = kid(it, "blockList")
  if sub != none {
    for si in kids(sub, "item") {
      let (o, s2) = item-parts(si, level + 1, s)
      out += o
      s = s2
    }
  }
  (out, s)
}

#{
  let side = 0
  let parts = ()   // (lines, a blank line before)
  let preface = kid(doc, "preface")
  for p in preface.children.filter(c => is-el(c)) {
    if attr(p, "class") == "number" or attr(p, "class") == "introduction" {
      let (ls, _) = lay(words-of(p), w1: 1000, w: 1000, justify: false)
      parts.push((ls, true))
    } else if p.tag == "longTitle" {
      let (ls, s) = lay(words-of(kid(p, "p")), first: 8, cont: 8, w1: 60, w: 60, side: side)
      side = s
      parts.push((ls, true))
    }
  }
  let preamble = kid(doc, "preamble")
  let paragraphs = ()
  if preamble != none { paragraphs += kids(kid(preamble, "recitals"), "recital").map(r => (r, kid(r, "p"))) }
  let body = kid(doc, "mainBody")
  for hc in kids(body, "hcontainer") {
    if attr(hc, "name") == "resolution" { paragraphs.push((hc, kid(kid(hc, "content"), "p"))) }
  }
  for (el, p) in paragraphs {
    let (ls, s) = lay(words-of(p), first: if has-class(el, "flush") { 0 } else { 2 }, cont: 0, side: side)
    side = s
    parts.push((ls, true))
  }
  // a report: headings, paragraphs and lists
  for hc in kids(body, "hcontainer").filter(h => attr(h, "name") == "text") {
    for c in kid(hc, "content").children.filter(x => is-el(x)) {
      let spaced = not has-class(c, "tight")
      if c.tag == "p" and has-class(c, "centered") {
        let t = squeeze(plain(c))
        let (ls, _) = lay(words-of(c), first: calc.ceil((spec.chars - t.clusters().len()) / 2), w1: 1000, w: 1000, justify: false)
        parts.push((ls, spaced))
      } else if c.tag == "p" {
        let (ls, s) = lay(words-of(c), side: side)
        side = s
        parts.push((ls, spaced))
      } else if c.tag == "blockList" {
        for it in kids(c, "item") {
          let (o, s) = item-parts(it, 1, side)
          parts += o
          side = s
        }
      }
    }
  }
  for (i, (ls, spaced)) in parts.enumerate() {
    if i > 0 and spaced { blank }
    for l in ls { l }
  }
}
