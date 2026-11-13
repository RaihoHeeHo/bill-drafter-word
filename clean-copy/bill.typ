// LBDC clean-copy template (demo)
// Copied from LBDC's clean-copy demo with two small changes for Bill Drafter for Word XML,
// marked "Bill Drafter for Word" below: <intro> text and bill-section headings are printed.
// Reads a bill in Akoma Ntoso XML and lays it out as a clean copy.
//
// Build:
//   typst compile --font-path fonts --input xml=sample-bill.xml bill.typ clean-copy.pdf

// ---------------------------------------------------------------------------
// Layout settings. These are the numbers to settle against LBDC's spec.
// ---------------------------------------------------------------------------
#let spec = (
  font: sys.inputs.at("font", default: "FreeMono"),  // chosen in the app, or --input font=...
  size: 10pt,         // type size
  pitch: 12pt,        // baseline to baseline (6 lines per inch)
  chars: 72,          // characters per line
  lines: 56,          // numbered text lines on a full page
  indent: 2,          // first-line indent, in characters
)

// Courier is monospaced: every character is 0.6 em wide.
#let char = spec.size * 0.6
#let measure = spec.chars * char
#let body-height = spec.lines * spec.pitch

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

#let bill = kid(root, "bill")
#let meta = kid(bill, "meta")
#let preface = kid(bill, "preface")

#let text-of(n, default: "") = if n == none { default } else { squeeze(plain(n)) }
#let house = text-of(find(meta, "house"), default: "senate")
#let bill-no = text-of(find(preface, "docNumber"))
#let prefix = if house == "assembly" { "A." } else { "S." }
#let lbd-no = text-of(find(meta, "lbdNumber"))

// ---------------------------------------------------------------------------
// Inline text: new matter underscored, old matter in brackets
// ---------------------------------------------------------------------------
#let inline(n) = {
  if type(n) == str { return [#n.replace(regex("\s+"), " ")] }
  if not is-el(n) { return [] }
  let inner = n.children.map(inline).sum(default: [])
  if n.tag == "del" { [\[#inner\]] }
  else if n.tag == "ins" { underline(evade: false, offset: 1.5pt, stroke: 0.6pt, inner) }
  else { inner }
}

// Text of an element, skipping any nested <mod> (amended text is laid out separately)
#let inline-text(n) = n.children.filter(c => not is-el(c, tag: "mod")).map(inline).sum(default: [])

// One body paragraph: first line indented, continuation lines flush left
#let body-par(it) = par(first-line-indent: (amount: spec.indent * char, all: true), it)

// ---------------------------------------------------------------------------
// Amended (quoted) structure: subsection, paragraph, section, etc.
// ---------------------------------------------------------------------------
#let structural = ("section", "subsection", "paragraph", "subparagraph", "clause",
                   "subclause", "item", "subitem", "subdivision", "article", "part", "title",
                   "hcontainer")

#let structure(n) = {
  let num = kid(n, "num")
  let heading = kid(n, "heading")
  // Bill Drafter for Word: a unit with sub-units keeps its opening words in <intro> (valid Akoma Ntoso).
  let content = kid(n, "content")
  if content == none { content = kid(n, "intro") }
  let lead = []
  if num != none { lead += inline(num) + [ ] }
  if heading != none { lead += inline(heading) + [ ] }

  if content != none {
    let ps = kids(content, "p")
    for (i, p) in ps.enumerate() {
      body-par(if i == 0 { lead } + inline(p))
    }
  } else if lead != [] {
    body-par(lead)
  }
  for c in n.children.filter(c => is-el(c) and c.tag in structural) {
    structure(c)
  }
}

#let mod-block(m) = {
  let qs = find(m, "quotedStructure")
  if qs != none {
    for c in qs.children.filter(c => is-el(c) and c.tag in structural) { structure(c) }
  }
}

// A bill section: "Section 1." / "§ 2." plus its text and any amended matter
#let section(s) = {
  let num = kid(s, "num")
  let content = kid(s, "content")
  let ps = kids(content, "p")
  for (i, p) in ps.enumerate() {
    // Bill Drafter for Word: a bill section's heading ("Short title.") follows its number.
    let heading = kid(s, "heading")
    let lead = if i == 0 { inline(num) + [ ] + if heading != none { inline(heading) + [ ] } } else { [] }
    body-par(lead + inline-text(p))
    for m in kids(p, "mod") { mod-block(m) }
  }
}

// ---------------------------------------------------------------------------
// Page setup
// ---------------------------------------------------------------------------
#let rule(n) = "_" * n
#let blank-line = block(height: spec.size, width: 100%)

#set text(
  font: spec.font,
  size: spec.size,
  lang: "en",
  hyphenate: true,
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
  number-clearance: 3 * char,
)

#let side = (8.5in - measure) / 2
#let top = 0.75in

#set page(
  paper: "us-letter",
  margin: (left: side, right: side, top: top, bottom: 11in - top - body-height),
  header-ascent: spec.pitch,
  header: context {
    if here().page() > 1 {
      grid(columns: (1fr, auto), [#prefix #bill-no], str(here().page()))
    }
  },
  footer-descent: spec.pitch,
  footer: context {
    if here().page() == 1 {
      set par(justify: false)
      align(center)[
        EXPLANATION\-\-Matter in #underline(evade: false, offset: 1.5pt)[italics] (underscored) is new; matter in brackets \
        \[ \] is old law to be omitted.
      ]
      align(right, lbd-no)
    }
  },
)

// ---------------------------------------------------------------------------
// The bill
// ---------------------------------------------------------------------------

// Front matter: no line numbers
#{
  set par.line(numbering: none)
  set par(justify: false)
  let centered(it) = align(center, par(it))

  centered(squeeze(plain(find(preface, "docAuthority"))))
  par(rule(spec.chars))
  blank-line
  centered(bill-no)
  blank-line
  centered(squeeze(plain(find(preface, "session"))))
  blank-line
  centered(squeeze(plain(find(preface, "docStage"))))
  blank-line
  centered(squeeze(plain(find(preface, "docDate"))))
  centered(rule(11))
  blank-line

  let intro = kids(preface, "p").find(p => p.attrs.at("class", default: "") == "introduction")
  set par(justify: true, hanging-indent: spec.indent * char)
  if intro != none {
    par(inline(intro))
    blank-line
  }
  let long-title = kid(preface, "longTitle")
  if long-title != none {
    par(inline(kid(long-title, "p")))
    blank-line
  }

  let formula = find(kid(bill, "preamble"), "formula")
  set par(hanging-indent: 0pt, first-line-indent: (amount: spec.indent * char, all: true))
  par(inline(kid(formula, "p")))
  blank-line
}

// Body: numbered lines
#for s in kids(kid(bill, "body"), "section") { section(s) }
