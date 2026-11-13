"""Wraps a WordprocessingML document.xml (e.g. from the test flow) into a .docx with the add-in's styles,
so it can be opened in Word or LibreOffice and run through tools/docx2akn.cjs.
   python3 tests/make-docx.py document.xml out.docx [LBD] [year]"""
import sys, zipfile, re, subprocess, json, os
src, out = sys.argv[1], sys.argv[2]
lbd = sys.argv[3] if len(sys.argv) > 3 else ''
year = sys.argv[4] if len(sys.argv) > 4 else ''
doc = open(src, encoding='utf8').read()
doc = re.sub(r'^<\?xml[^>]*\?>', '', doc)
doc = doc.replace('</w:body>', '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>')
here = os.path.dirname(os.path.abspath(__file__))
styles = subprocess.check_output(['node', '-e', "require(process.argv[1]+'/../src/lib/drafting.js');require(process.argv[1]+'/../src/lib/ooxml.js');process.stdout.write(BD.stylesXml())", here]).decode()
styles = styles.replace('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>')
ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'
rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>'
drels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
custom = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' + \
  ''.join('<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="%d" name="%s"><vt:lpwstr>%s</vt:lpwstr></property>' % (i + 2, k, v) for i, (k, v) in enumerate([('LBD', lbd), ('SessionYear', year)]) if v) + '</Properties>'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', rels); z.writestr('word/_rels/document.xml.rels', drels)
    z.writestr('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + doc); z.writestr('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + styles)
    z.writestr('docProps/custom.xml', custom)
print(out)
