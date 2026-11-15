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
    args = ap.parse_args(argv)

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
