"""Validate documents against the AKN-NY profile.

Three layers, in order:
  1. the official Akoma Ntoso 3.0 schema (schema/akn/akomantoso30.xsd)
  2. the LBDC metadata extension (schema/lbdc-akn.xsd), applied to lbdc:documentInfo
  3. the New York profile rules (rules/ny-akn-profile.sch)

    python3 validate.py examples/*.xml
    python3 validate.py --quiet bill.xml      # only print problems

Exit status is 0 when every file is valid (warnings allowed), 1 otherwise.
Needs lxml (pip install lxml).
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree, isoschematron

HERE = Path(__file__).resolve().parent
AKN_XSD = HERE / "schema" / "akn" / "akomantoso30.xsd"
LBDC_XSD = HERE / "schema" / "lbdc-akn.xsd"
RULES = HERE / "rules" / "ny-akn-profile.sch"
LBDC_NS = "urn:x-lbdc:akn:1.0"
SVRL = "http://purl.oclc.org/dsdl/svrl"


@dataclass
class Problem:
    layer: str      # "schema", "lbdc", "profile"
    severity: str   # "error" or "warning"
    where: str
    message: str


@dataclass
class Result:
    path: Path
    problems: list[Problem] = field(default_factory=list)

    @property
    def errors(self):
        return [p for p in self.problems if p.severity == "error"]

    @property
    def warnings(self):
        return [p for p in self.problems if p.severity == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors


AKN_NS = "http://docs.oasis-open.org/legaldocml/ns/akn/3.0"


def section_hash(section) -> str:
    """SHA-256 of a bill section as a sign-off records it: the section's exclusive canonical XML, with comment
    anchors left out (a comment does not change what was signed off; a suggested change does)."""
    import copy, hashlib
    el = copy.deepcopy(section)
    for span in list(el.iter(f"{{{AKN_NS}}}span")):
        if span.get(f"{{{LBDC_NS}}}comment") is None:
            continue
        del span.attrib[f"{{{LBDC_NS}}}comment"]
        if span.get(f"{{{LBDC_NS}}}suggest") is None and not span.attrib:   # a bare anchor: keep its words only
            parent, i = span.getparent(), span.getparent().index(span)
            prev = span.getprevious()
            text, tail = span.text or "", span.tail or ""
            kids = list(span)
            if prev is not None:
                prev.tail = (prev.tail or "") + text
            else:
                parent.text = (parent.text or "") + text
            for k, kid in enumerate(kids):
                parent.insert(i + k, kid)
            last = kids[-1] if kids else prev
            if last is not None:
                last.tail = (last.tail or "") + tail
            else:
                parent.text = (parent.text or "") + tail
            parent.remove(span)
    el.tail = None
    return hashlib.sha256(etree.tostring(el, method="c14n", exclusive=True)).hexdigest()


def stale_signoffs(doc) -> list:
    """A sign-off still standing whose section has changed since: a warning, so the examiner looks again."""
    out = []
    ns = {"a": AKN_NS, "l": LBDC_NS}
    standing = {}
    for st in doc.xpath("//a:meta/a:workflow[@source='#lbdc-review']/a:step[@l:section]", namespaces=ns):
        sec = st.get(f"{{{LBDC_NS}}}section")
        if st.get("refersTo") == "#signedOff":
            standing[sec] = st
        elif st.get("refersTo") == "#signoffWithdrawn":
            standing.pop(sec, None)
    for sec, st in standing.items():
        found = doc.xpath("//a:body//a:section[@eId=$e][not(ancestor::a:quotedStructure)]", e=sec, namespaces=ns)
        if found and st.get(f"{{{LBDC_NS}}}hash") and section_hash(found[0]) != st.get(f"{{{LBDC_NS}}}hash"):
            who = st.get("by", "").lstrip("#")
            out.append(Problem("profile", "warning", f"line {st.sourceline}",
                               f"The sign-off on {sec} by {who} ({st.get('date')}) is stale: the section has changed since. "
                               "It needs to be looked at and signed off again."))
    return out


class Validator:
    def __init__(self):
        self.akn = etree.XMLSchema(etree.parse(str(AKN_XSD)))
        self.lbdc = etree.XMLSchema(etree.parse(str(LBDC_XSD)))
        self.rules = isoschematron.Schematron(etree.parse(str(RULES)), store_report=True)

    def validate(self, path: Path) -> Result:
        result = Result(path)
        try:
            doc = etree.parse(str(path))
        except etree.XMLSyntaxError as err:
            result.problems.append(Problem("xml", "error", f"line {err.lineno}", str(err)))
            return result

        if not self.akn.validate(doc):
            for e in self.akn.error_log:
                result.problems.append(Problem("schema", "error", f"line {e.line}", e.message))

        infos = doc.findall(f".//{{{LBDC_NS}}}documentInfo")
        if not infos:
            result.problems.append(Problem("lbdc", "error", "meta",
                                           "No lbdc:documentInfo in <proprietary source=\"#lbdc\">."))
        for info in infos:
            if not self.lbdc.validate(etree.ElementTree(info)):
                for e in self.lbdc.error_log:
                    result.problems.append(Problem("lbdc", "error", f"line {info.sourceline}", e.message))

        self.rules.validate(doc)
        report = self.rules.validation_report
        for fa in report.iter(f"{{{SVRL}}}failed-assert", f"{{{SVRL}}}successful-report"):
            role = (fa.get("role") or "error").lower()
            text = " ".join("".join(fa.find(f"{{{SVRL}}}text").itertext()).split())
            result.problems.append(Problem("profile", "warning" if role == "warning" else "error",
                                           self._where(doc, fa.get("location", "")), text))
        result.problems.extend(stale_signoffs(doc))
        return result

    @staticmethod
    def _where(doc, location: str) -> str:
        """Turn the SVRL location (an XPath) into a line number and eId where possible."""
        try:
            nodes = doc.xpath(location, namespaces={"a": "http://docs.oasis-open.org/legaldocml/ns/akn/3.0"})
        except etree.XPathError:
            nodes = []
        if nodes and hasattr(nodes[0], "sourceline"):
            node = nodes[0]
            eid = node.get("eId") if hasattr(node, "get") else None
            return f"line {node.sourceline}" + (f" ({eid})" if eid else "")
        return location


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Validate Akoma Ntoso documents against the AKN-NY profile.")
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("-q", "--quiet", action="store_true", help="only print files with problems")
    ap.add_argument("--section-hash", metavar="EID", help="print the sign-off hash of this bill section and stop")
    args = ap.parse_args(argv)
    if args.section_hash:
        for path in args.files:
            sec = etree.parse(str(path)).xpath("//a:body//a:section[@eId=$e][not(ancestor::a:quotedStructure)]",
                                               e=args.section_hash, namespaces={"a": AKN_NS})
            print(section_hash(sec[0]) if sec else f"{path}: no section {args.section_hash}")
        return 0

    v = Validator()
    failed = 0
    for path in args.files:
        r = v.validate(path)
        if r.ok and not r.warnings:
            if not args.quiet:
                print(f"✓ {path}")
            continue
        status = "✓" if r.ok else "✗"
        print(f"{status} {path}: {len(r.errors)} error(s), {len(r.warnings)} warning(s)")
        for p in r.problems:
            print(f"    [{p.layer} {p.severity}] {p.where}: {p.message}")
        failed += not r.ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
