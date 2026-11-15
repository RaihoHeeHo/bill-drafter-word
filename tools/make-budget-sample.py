#!/usr/bin/env python3
"""Make the budget demo's sample files from the converted prints, and what the Python tools find in them.

    python3 tools/make-budget-sample.py PROFILE_DIR APPROP_DIR

PROFILE_DIR is lbdc-clean-copy/profile (its real/ folder holds S.3003-D, last year's S.8303-D, S.3000-C and -D
and the 2025 line vetoes, its tools/ the Python checks); APPROP_DIR holds the D print's line records (s3003d.pkl).

samples/budget/ gets two demo bills:
  S.3003-D (Aid to Localities, 2025), Department of Labor and State University of New York:
    S3003D.akn.xml     the amended print, as converted from the print
    S8303D.akn.xml     S.8303-D, which became chapter 53 of the laws of 2024 (last year's chapter)
    vetoes-2025.json   the Governor's 2025 line vetoes in these agencies, as the Division of the Budget lists them
    S3003D.lines.json  where each element of S.3003-D is printed (page, line), from the print: a veto cites lines
  S.3000-D (State Operations, 2025), Department of Public Service and City University of New York:
    S3000D.akn.xml, S3000C.akn.xml   the D print and the C print before it
(The original print S.3003 is not used: its conversion's text is garbled, so no item can be matched to it.)
tests/budget-expected.json gets what the Python tools find in the same files, which the add-in's checks must match.
"""
import copy, json, pathlib, pickle, re, sys
from lxml import etree

A = "http://docs.oasis-open.org/legaldocml/ns/akn/3.0"
NS = {"a": A}
KEEP = ("#department-of-labor", "#state-university-of-new-york")
KEEP_3000 = ("#department-of-public-service", "#city-university-of-new-york")
AGENCY_NAMES = ("DEPARTMENT OF LABOR", "STATE UNIVERSITY OF NEW YORK")

profile, approp = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
repo = pathlib.Path(__file__).resolve().parent.parent
out = repo / "samples" / "budget"
out.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(profile / "tools"))


def excerpt(src, dst, note, keep=KEEP):
    """The bill with only the kept agencies (section 1's opening paragraphs stay), and the meta that refers to them."""
    doc = etree.parse(str(src))
    body = doc.find(".//a:body", NS)
    kept = set()
    for ag in doc.xpath("//a:hcontainer[@name='agency']", namespaces=NS):
        if ag.get("refersTo") in keep:
            kept.update(e.get("eId") for e in ag.iter() if e.get("eId"))
        else:
            ag.getparent().remove(ag)
    # sections after section 1 (and any other body parts) are not part of the demo
    for sec in body.findall("a:section", NS)[1:]:
        body.remove(sec)
    for tm in doc.xpath("//a:analysis//a:textualMod", namespaces=NS):
        s = tm.find("a:source", NS)
        if s is None or s.get("href", "").lstrip("#") not in kept:
            tm.getparent().remove(tm)
    for am in doc.xpath("//a:analysis/a:activeModifications[not(*)]", namespaces=NS):
        am.getparent().remove(am)
    for an in doc.xpath("//a:analysis[not(*)]", namespaces=NS):
        an.getparent().remove(an)
    root = doc.getroot()
    for c in list(root.itersiblings(preceding=True)):
        if isinstance(c, etree._Comment):
            root.getparent().remove(c) if root.getparent() is not None else None
    s = etree.tostring(doc, encoding="unicode")
    s = re.sub(r"^<!--.*?-->\s*", "", s, flags=re.S)
    dst.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<!-- ' + note + ' Not an official file. -->\n' + s)
    return dst


d = excerpt(profile / "real" / "S3003D.xml", out / "S3003D.akn.xml",
            "S.3003-D (2025), Department of Labor and State University of New York only, converted from the print by approp2akn.py.")
sd = excerpt(profile / "real" / "S3000D.xml", out / "S3000D.akn.xml",
             "S.3000-D (2025), Department of Public Service and City University of New York only, converted from the print by approp2akn.py.", KEEP_3000)
sc = excerpt(profile / "real" / "S3000C.xml", out / "S3000C.akn.xml",
             "S.3000-C (2025), the print before S.3000-D: Department of Public Service and City University of New York only.", KEEP_3000)
old = out / "S3003.akn.xml"
if old.exists():
    old.unlink()
p = excerpt(profile / "real" / "prior-2024" / "S8303D.xml", out / "S8303D.akn.xml",
            "S.8303-D (2024), which became chapter 53 of the laws of 2024: Department of Labor and State University of New York only.")

# The print's lines for the D print: from the whole bill's records, for the elements kept.
import print_lines  # noqa: E402
lines = print_lines.lines_of(str(profile / "real" / "S3003D.xml"), pickle.load(open(approp / "s3003d.pkl", "rb")))
kept = {e.get("eId") for e in etree.parse(str(d)).iter() if e.get("eId")}
lines = {k: v for k, v in lines.items() if k in kept}
(out / "S3003D.lines.json").write_text(json.dumps(lines, separators=(",", ":")))

# The vetoes as the Division of the Budget lists them (without the Python tool's placement).
vetoes = [v for v in json.load(open(profile / "real" / "vetoes" / "vetoes-2025.json")) if v["agency"] in AGENCY_NAMES]
FIELDS = ("number", "chapter", "year", "bill", "page", "from", "page_to", "to", "agency", "text", "reason")
(out / "vetoes-2025.json").write_text(json.dumps([{k: v.get(k) for k in FIELDS} for v in vetoes], indent=1))

# What the Python tools find, for the tests.
import budget_items as BI, prior_check as PC, compare_prints as CP  # noqa: E402
exp = {}
its = BI.numbered(list(BI.items(str(d))))
exp["items"] = [{"eId": i["eId"], "kind": i["kind"], "key": list(BI.key(i)), "n": i["n"], "source": i["source"], "amount": i["amount"], "reappropriated": i["reappropriated"]} for i in its]
res, lapsed, lapsed_amt, *_ = PC.check(str(d), str(p), 53, 2024)
exp["prior"] = {k: sorted([it["eId"], q["eId"] if q else None] for it, q in v) for k, v in res.items() if v}
exp["prior_not_continued"] = sorted([g, k, n, lapsed_amt[(g, k)]] for (g, k), n in lapsed.items())
changes, totals, na, nb = CP.compare_budgets(str(sc), str(sd))
exp["compare"] = {"changes": [{k: (list(v) if isinstance(v, tuple) else v) for k, v in c.items() if k in ("change", "agency", "was", "now")} for c in changes],
                  "totals": [{k: (list(v) if isinstance(v, tuple) else v) for k, v in t.items()} for t in totals], "items": [na, nb]}
exp["vetoes"] = {str(v["number"]): v["items"] for v in vetoes}
F = json.load(open(pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else profile.parent.parent / "report" / "out" / "S3003D.json"))
exp["findings"] = {k: [x for x in F[k] if any(n.lower() in x["agency"].lower() for n in ("department of labor", "state university of new york"))]
                   for k in ("headings", "summaries", "totals", "schedules", "schedule_items", "reapprop_over", "no_original")}
# The whole of S.3003-D, for the working set and the clean copy in parts: the bill, last year's whole chapter, all
# the 2025 vetoes and the print's lines for every element.
full = out / "full"
full.mkdir(exist_ok=True)
import shutil  # noqa: E402
shutil.copy(profile / "real" / "S3003D.xml", full / "S3003D.akn.xml")
shutil.copy(profile / "real" / "prior-2024" / "S8303D.xml", full / "S8303D.akn.xml")
all_lines = print_lines.lines_of(str(profile / "real" / "S3003D.xml"), pickle.load(open(approp / "s3003d.pkl", "rb")))
(full / "S3003D.lines.json").write_text(json.dumps(all_lines, separators=(",", ":")))
all_vetoes = json.load(open(profile / "real" / "vetoes" / "vetoes-2025.json"))
(full / "vetoes-2025.json").write_text(json.dumps([{k: v.get(k) for k in FIELDS} for v in all_vetoes], indent=1))
fres, flapsed, *_ = PC.check(str(full / "S3003D.akn.xml"), str(full / "S8303D.akn.xml"), 53, 2024)
exp["full"] = {"prior": {k: len(v) for k, v in fres.items() if v}, "items": len(list(BI.items(str(full / "S3003D.akn.xml")))),
               "findings": {k: len(F[k]) for k in ("headings", "summaries", "totals", "schedules", "schedule_items", "reapprop_over", "no_original")},
               "vetoes": {str(v["number"]): v["items"] for v in all_vetoes}}
(repo / "tests" / "budget-expected.json").write_text(json.dumps(exp, indent=1))
print("full:", exp["full"]["items"], "items;", exp["full"]["prior"], exp["full"]["findings"])

for f in (d, p, sd, sc):
    print(f.name, f.stat().st_size, "bytes")
print("lines for", len(lines), "elements;", len(vetoes), "vetoes")
print("prior:", {k: len(v) for k, v in exp["prior"].items()})
print("compare:", len(changes), "changes,", len(totals), "totals")
print("findings:", {k: len(v) for k, v in exp["findings"].items()})
