<?xml version="1.0" encoding="UTF-8"?>
<!--
  AKN-NY profile, version 0.3 (draft): profile rules.

  The Akoma Ntoso 3.0 schema says what is well formed for any jurisdiction.
  These rules say what is correct for New York legislation. Each assertion
  is an error unless it carries role="warning".

  ISO Schematron with XSLT 1.0 query binding. Regular expressions use the
  EXSLT regular-expressions functions (re:test, re:replace), which lxml
  provides. Run with validate.py.
-->
<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt">
  <title>AKN-NY profile rules (0.3)</title>
  <ns prefix="a" uri="http://docs.oasis-open.org/legaldocml/ns/akn/3.0"/>
  <ns prefix="l" uri="urn:x-lbdc:akn:1.0"/>
  <ns prefix="re" uri="http://exslt.org/regular-expressions"/>
  <!-- Index of eIds, so that the uniqueness and cross-reference checks stay fast on an 880-page budget bill -->
  <xsl:key xmlns:xsl="http://www.w3.org/1999/XSL/Transform" name="eid" match="*[@eId]" use="@eId"/>
  <xsl:key xmlns:xsl="http://www.w3.org/1999/XSL/Transform" name="tm" match="a:textualMod" use="a:source/@href"/>
  <xsl:key xmlns:xsl="http://www.w3.org/1999/XSL/Transform" name="agency" match="a:hcontainer[@name = 'agency']" use="@refersTo"/>

  <let name="type" value="local-name(/a:akomaNtoso/*[1])"/>
  <let name="dname" value="string(/a:akomaNtoso/*[1]/@name)"/>
  <let name="id" value="/a:akomaNtoso/*[1]/a:meta/a:identification"/>
  <let name="work" value="string($id/a:FRBRWork/a:FRBRuri/@value)"/>
  <let name="expr" value="string($id/a:FRBRExpression/a:FRBRuri/@value)"/>
  <let name="info" value="/a:akomaNtoso/*[1]/a:meta/a:proprietary[@source='#lbdc']/l:documentInfo"/>
  <!-- A draft: a bill before it is introduced, addressed by its LBD route number (/akn/us-ny/bill/2025/lbd12345),
       each LBD version an Expression (eng@01, eng@02 ...). It has no print number until a house gives it one. -->
  <let name="draft" value="$type = 'bill' and re:test($work, '^/akn/us-ny/bill/[0-9]{4}/lbd[0-9]{5}$')"/>
  <let name="UP" value="'ABCDEFGHIJKLMNOPQRSTUVWXYZ'"/>
  <let name="BR" value="'&#123;&#125;'"/>
  <let name="LOW" value="'abcdefghijklmnopqrstuvwxyz'"/>

  <!-- ================================================================ -->
  <pattern id="document-types">
    <title>Document types</title>
    <rule context="/a:akomaNtoso">
      <assert test="count(*) = 1 and (a:bill or a:act or a:statement or a:doc or a:amendment or a:documentCollection)">The document must be a bill, act, statement, doc, amendment or documentCollection.</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:bill">
      <assert test="@name = 'bill' or @name = 'budgetBill' or @name = 'appropriationBill' or @name = 'concurrentResolution'">A bill's name must be bill, budgetBill (Article VII), appropriationBill or concurrentResolution, not "<value-of select="@name"/>".</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:act">
      <assert test="@name = 'chapter' or @name = 'consolidatedLaw' or @name = 'unconsolidatedLaw' or @name = 'constitution'">An act's name must be chapter, consolidatedLaw, unconsolidatedLaw or constitution, not "<value-of select="@name"/>".</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:statement">
      <assert test="@name = 'legislativeResolution' or @name = 'concurrentResolution' or @name = 'senateResolution' or @name = 'assemblyResolution'">A statement's name must be legislativeResolution, concurrentResolution (one not amending a constitution), senateResolution or assemblyResolution.</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:doc">
      <assert test="@name = 'vetoMessage' or @name = 'approvalMemorandum' or @name = 'lineVetoMemo' or @name = 'fiscalNote' or @name = 'explanatoryNote' or @name = 'introducersMemo' or @name = 'messageOfNecessity'">A doc's name must be vetoMessage, approvalMemorandum, lineVetoMemo, fiscalNote, explanatoryNote, introducersMemo or messageOfNecessity.</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:amendment">
      <assert test="@name = 'detailSheet' or @name = 'governorsAmendment'">An amendment's name must be detailSheet or governorsAmendment.</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:documentCollection">
      <assert test="@name = 'sessionLaws'">A documentCollection's name must be sessionLaws.</assert>
    </rule>
  </pattern>

  <pattern id="vocabulary">
    <title>Akoma Ntoso elements New York does not use</title>
    <rule context="a:book | a:tome | a:division | a:alinea | a:rule | a:subrule | a:proviso | a:indent | a:transitional | a:list | a:sublist | a:level">
      <assert test="false()">&lt;<value-of select="local-name()"/>&gt; is not part of the AKN-NY vocabulary. New York units map to section, subdivision, subsection, paragraph, subparagraph, clause, subclause, point (item), and hcontainer for anything else.</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="identification">
    <title>Work, Expression and Manifestation IRIs</title>
    <rule context="/a:akomaNtoso/*/a:meta/a:identification">
      <let name="last" value="re:replace($work, '^.*/', '', '')"/>
      <let name="ver" value="substring-after($expr, '/eng@')"/>
      <assert test="a:FRBRWork/a:FRBRcountry/@value = 'us-ny'">FRBRcountry must be us-ny.</assert>
      <assert test="($type = 'bill' and re:test($work, '^/akn/us-ny/bill/[0-9]{4}/[sa][0-9]+$'))
                 or $draft
                 or ($type = 'act' and ($dname = 'chapter' or $dname = 'unconsolidatedLaw') and re:test($work, '^/akn/us-ny/act/[0-9]{4}/[0-9]+$'))
                 or ($type = 'act' and $dname = 'consolidatedLaw' and re:test($work, '^/akn/us-ny/act/consolidated/[a-z]{3}$'))
                 or ($type = 'act' and $dname = 'unconsolidatedLaw' and re:test($work, '^/akn/us-ny/act/unconsolidated/[a-z]{3}$'))
                 or ($type = 'act' and $dname = 'constitution' and re:test($work, '^/akn/us-ny/act/constitution/cns$'))
                 or ($type = 'statement' and re:test($work, concat('^/akn/us-ny/statement/', $dname, '/[0-9]{4}/[jkbcelr][0-9]+$')))
                 or ($type = 'doc' and re:test($work, concat('^/akn/us-ny/doc/', $dname, '/[0-9]{4}/[0-9a-z-]+$')))
                 or ($type = 'amendment' and re:test($work, concat('^/akn/us-ny/amendment/', $dname, '/[0-9]{4}/[0-9a-z-]+$')))
                 or ($type = 'documentCollection' and re:test($work, '^/akn/us-ny/documentCollection/sessionLaws/[0-9]{4}$'))">The Work IRI "<value-of select="$work"/>" doesn't follow the profile's pattern for a <value-of select="$type"/> named <value-of select="$dname"/> (see the specification's naming table).</assert>
      <assert test="starts-with(a:FRBRWork/a:FRBRthis/@value, $work)">FRBRWork/FRBRthis must start with the Work IRI.</assert>
      <assert test="starts-with($expr, concat($work, '/eng@'))">The Expression IRI must be the Work IRI followed by /eng@ and the version.</assert>
      <assert test="starts-with(a:FRBRExpression/a:FRBRthis/@value, $expr)">FRBRExpression/FRBRthis must start with the Expression IRI.</assert>
      <assert test="a:FRBRExpression/a:FRBRlanguage/@language = 'eng'">FRBRlanguage must be eng.</assert>
      <assert test="starts-with(a:FRBRManifestation/a:FRBRuri/@value, concat($expr, '.'))">The Manifestation IRI must be the Expression IRI followed by a format extension (.akn, .xml, .pdf).</assert>
      <assert test="not($draft) or (re:test($ver, '^[0-9]{2}$') and a:FRBRExpression/a:FRBRversionNumber/@value = $ver)">A draft's versions are its LBD versions: eng@01 for LBD 12345-01-6, eng@02 for 12345-02-6, matching FRBRversionNumber.</assert>
      <assert test="not($draft) or not(a:FRBRWork/a:FRBRnumber)">A draft has no bill number yet, so no FRBRnumber; the house gives the number at introduction, and the printed bill is a new Work (/akn/us-ny/bill/2025/s1234).</assert>
      <assert test="$type != 'bill' or $draft or ($ver = '' and not(a:FRBRExpression/a:FRBRversionNumber)) or (re:test($ver, '^[a-z]$') and translate(a:FRBRExpression/a:FRBRversionNumber/@value, $UP, $LOW) = $ver)">A bill print is identified by its amendment letter: eng@ for the original print, eng@a for the A print, and so on, matching FRBRversionNumber.</assert>
      <assert test="$type != 'act' or re:test($ver, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')">An act's Expression is dated: eng@YYYY-MM-DD (the date it became law, or the point-in-time date of a consolidated law).</assert>
      <assert test="$draft or not($type = 'bill' or $type = 'statement' or $dname = 'chapter') or translate(a:FRBRWork/a:FRBRnumber/@value, $UP, $LOW) = $last">FRBRnumber "<value-of select="a:FRBRWork/a:FRBRnumber/@value"/>" must match the last part of the Work IRI ("<value-of select="$last"/>").</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="lbdc-metadata">
    <title>LBDC metadata</title>
    <rule context="/a:akomaNtoso/*/a:meta">
      <assert test="count(a:proprietary[@source='#lbdc']/l:documentInfo) = 1">The document needs exactly one lbdc:documentInfo in &lt;proprietary source="#lbdc"&gt;.</assert>
    </rule>
    <rule context="/a:akomaNtoso/*/a:meta/a:proprietary/l:documentInfo">
      <let name="pn" value="string(l:printNumber)"/>
      <let name="fnum" value="string($id/a:FRBRWork/a:FRBRnumber/@value)"/>
      <let name="fver" value="string($id/a:FRBRExpression/a:FRBRversionNumber/@value)"/>
      <let name="year" value="substring-before(substring-after($work, '/bill/'), '/')"/>
      <assert test="l:profile/@version">lbdc:profile must state the profile version.</assert>
      <assert test="not($type = 'bill' or $type = 'statement') or (l:house and l:session and (l:printNumber or $draft))">Bills and resolutions need lbdc:house, lbdc:session and lbdc:printNumber.</assert>
      <assert test="not($draft) or not(l:printNumber or l:uniBill)">A draft has no print number (and is not yet a uni-bill print); those come at introduction.</assert>
      <assert test="not($draft) or (substring(l:lbdNumber, string-length(l:lbdNumber) - 9, 5) = substring-after(re:replace($work, '^.*/', '', ''), 'lbd') and substring(l:lbdNumber, string-length(l:lbdNumber) - 3, 2) = substring-after($expr, '/eng@'))">A draft is addressed by its LBD number: the route number (the first five digits) in the Work IRI, the version (the next two) in the Expression IRI. lbdc:lbdNumber "<value-of select="l:lbdNumber"/>" doesn't match <value-of select="$expr"/>.</assert>
      <!-- The Governor's budget bills are drafted by the Division of the Budget: the original print has no LBD
           number (S.3001, S.3002 of 2025); the Commission numbers the amended prints. -->
      <assert test="$type != 'bill' or l:lbdNumber or (l:budget and not(contains($expr, '/eng@') and string-length(substring-after($expr, '/eng@')) > 0))">Bills need their LBD number (lbdc:lbdNumber).</assert>
      <assert test="$draft or not($type = 'bill' or $type = 'statement') or $pn = concat($fnum, $fver)">lbdc:printNumber "<value-of select="$pn"/>" must equal the Work number plus the amendment letter ("<value-of select="concat($fnum, $fver)"/>").</assert>
      <assert test="$type != 'bill' or substring(l:session, 1, 4) = $year">The session (<value-of select="l:session"/>) must start in the year of the Work IRI (<value-of select="$year"/>).</assert>
      <assert test="$draft or not($type = 'bill' or $type = 'statement') or l:house = 'both' or (l:house = 'senate' and contains('SJBR', substring($pn, 1, 1))) or (l:house = 'assembly' and contains('AEKCL', substring($pn, 1, 1)))">lbdc:house doesn't match the print number prefix (S, J, B and R are Senate; A, E, K, C and L are Assembly).</assert>
      <assert test="$type != 'amendment' or l:lbdNumber">A detail sheet or amendment needs its own LBD number (lbdc:lbdNumber).</assert>
      <assert test="($dname = 'concurrentResolution') = boolean(l:resolution)">lbdc:resolution (what the resolution does) is required for concurrent resolutions and not used otherwise.</assert>
      <assert test="not($type = 'bill' and l:resolution/@kind = 'other') and not($type = 'statement' and starts-with(l:resolution/@kind, 'stateConstitution'))">Concurrent resolutions amending the state constitution are numbered as bills (bill name="concurrentResolution"). Those in the resolution series (statement name="concurrentResolution") are kind "other" or one of the federal kinds.</assert>
      <assert test="($dname = 'budgetBill' and l:budget/@kind = 'articleSeven') or ($dname = 'appropriationBill' and l:budget/@kind = 'appropriation') or (not($dname = 'budgetBill' or $dname = 'appropriationBill') and not(l:budget))">lbdc:budget must be present for budget bills (kind articleSeven for budgetBill, appropriation for appropriationBill) and absent otherwise.</assert>
      <assert test="(l:budget/@kind = 'articleSeven' and (l:budget/@type = 'ppgg' or l:budget/@type = 'elfa' or l:budget/@type = 'hmh' or l:budget/@type = 'ted' or l:budget/@type = 'revenue' or l:budget/@type = 'other')) or (l:budget/@kind = 'appropriation' and not(l:budget/@type = 'ppgg' or l:budget/@type = 'elfa' or l:budget/@type = 'hmh' or l:budget/@type = 'ted' or l:budget/@type = 'revenue' or l:budget/@type = 'other')) or not(l:budget)">The budget bill type doesn't match its kind.</assert>
      <assert test="not($id/a:FRBRWork/a:FRBRalias[@name = 'assemblyBill' or @name = 'senateBill'])">Each house's bill is its own Work. A uni-bill is not an alias: mark the joint print with lbdc:uniBill and give the other house's bill its own document.</assert>
      <assert test="not($type = 'bill') or l:house != 'both'">lbdc:house is the house whose bill this is (senate or assembly), also on a uni-bill print.</assert>
      <assert test="not(l:uniBill) or (l:house = 'senate' and l:uniBill/@senate = $pn) or (l:house = 'assembly' and l:uniBill/@assembly = $pn)">lbdc:uniBill marks a print made jointly for both houses; the number for this document's own house must equal its print number "<value-of select="$pn"/>".</assert>
      <assert test="not(l:uniBill) or (starts-with(l:uniBill/@senate, 'S') and starts-with(l:uniBill/@assembly, 'A'))">lbdc:uniBill names the Senate print (S...) and the Assembly print (A...).</assert>
      <assert test="$dname != 'chapter' or ($work = concat('/akn/us-ny/act/', l:chapter/@year, '/', l:chapter/@number) and l:passage)">A chapter needs lbdc:chapter matching its Work IRI, and lbdc:passage.</assert>
      <assert test="$dname != 'consolidatedLaw' or translate(l:law/@lawId, $UP, $LOW) = re:replace($work, '^.*/', '', '')">A consolidated law needs lbdc:law whose lawId matches the Work IRI.</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="references">
    <title>References resolve</title>
    <rule context="*[@refersTo or @source or @by or @as][not(self::a:textualMod)]">
      <!-- Attachments share their parent document's identifiers (the AKN schema
           makes eIds unique across the whole document), so look in both. -->
      <let name="refs" value="ancestor-or-self::*[a:meta][1]/a:meta/a:references | /a:akomaNtoso/*[1]/a:meta/a:references"/>
      <assert test="not(@refersTo) or (starts-with(@refersTo, '#') and not(contains(normalize-space(@refersTo), ' ')) and key('eid', substring-after(@refersTo, '#'))[parent::a:references]) or (@name = 'agencySummary' and contains(normalize-space(@refersTo), ' '))">refersTo="<value-of select="@refersTo"/>" must name one entry in &lt;references&gt; (only an agency summary that covers several agencies lists them).</assert>
      <assert test="not(@source) or key('eid', substring-after(@source, '#'))[parent::a:references]">source="<value-of select="@source"/>" must name an entry in &lt;references&gt;.</assert>
      <assert test="not(@by) or key('eid', substring-after(@by, '#'))[parent::a:references]">by="<value-of select="@by"/>" must name an entry in &lt;references&gt;.</assert>
      <assert test="not(@as) or $refs/*[@eId = substring-after(current()/@as, '#')]">as="<value-of select="@as"/>" must name an entry in &lt;references&gt;.</assert>
    </rule>
    <rule context="a:ref | a:source | a:destination">
      <assert test="re:test(@href, '^(#|/akn/us-ny/|/akn/us/)')">href="<value-of select="@href"/>" must be a local #eId or an Akoma Ntoso IRI (/akn/us-ny/... for New York, /akn/us/... for federal law).</assert>
      <assert test="not(starts-with(@href, '/akn/') and contains(@href, '#'))">Point into another document with "~" (…/~sec_606__subsec_c), not "#".</assert>
      <assert test="not(starts-with(@href, '#')) or key('eid', substring-after(@href, '#'))">href="<value-of select="@href"/>" doesn't match any eId in this document.</assert>
    </rule>
    <rule context="a:textualMod">
      <assert test="@type = 'substitution' or @type = 'insertion' or @type = 'repeal' or @type = 'renumbering'">textualMod type must be substitution (amended to read), insertion (adding), repeal, or renumbering (renumbered or relettered).</assert>
      <assert test="//a:mod[@eId = substring-after(current()/a:source/@href, '#')]">textualMod source must point to a &lt;mod&gt; in this document.</assert>
      <assert test="not(re:test(a:destination/@href, '^/akn/us-ny/act/(consolidated|unconsolidated|constitution)/[0-9]{4}/')) and not(re:test(a:new/@href, '^/akn/us-ny/act/(consolidated|unconsolidated|constitution)/[0-9]{4}/'))">A consolidated law, court act or the Constitution is addressed by its law ID alone (/akn/us-ny/act/consolidated/tax), with no year. The year a law was enacted is not reliably known and adds nothing the ID does not give.</assert>
      <assert test="re:test(a:destination/@href, '^/akn/us-ny/(act/|bill/[0-9]{4}/[sa][0-9]+/eng@[a-z]?/~)')">textualMod destination must be the New York law being changed (/akn/us-ny/act/...), or, for text that is not yet law, a provision of a bill print (/akn/us-ny/bill/2025/s1234/eng@a/~sec_2).</assert>
      <assert test="not(starts-with(a:destination/@href, '/akn/us-ny/bill/')) or $type = 'amendment' or //a:mod[@eId = substring-after(current()/a:source/@href, '#')]/a:ref[contains(concat(' ', @class, ' '), ' asProposedIn ')]">An amendment of text proposed in another bill must cite that bill ("as proposed in legislative bills numbers S. ... and A. ...") with ref class="asProposedIn".</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="eids-required">
    <title>Identifiers are required</title>
    <rule context="a:section | a:subsection | a:subdivision | a:paragraph | a:subparagraph | a:clause | a:subclause | a:point | a:part | a:subpart | a:title | a:subtitle | a:article | a:chapter | a:subchapter | a:hcontainer | a:mod | a:quotedStructure | a:intro | a:wrapUp | a:recitals | a:recital | a:attachment | a:blockList | a:table">
      <assert test="@eId">&lt;<value-of select="local-name()"/>&gt; needs an eId.</assert>
    </rule>
  </pattern>

  <pattern id="eids">
    <title>Identifier syntax, context and numbering</title>
    <rule context="*[@eId][not(ancestor::a:meta)][not(ancestor::a:attachment)]">
      <let name="map" value="' section:sec subsection:subsec subdivision:subdvs paragraph:para subparagraph:subpara clause:cl subclause:subcl article:art chapter:chp subchapter:subchp part:part subpart:subpart title:title subtitle:subtitle point:point mod:mod quotedStructure:qstr intro:intro wrapUp:wrapup recital:rec recitals:recs blockList:list item:item table:table attachment:att '"/>
      <let name="abbr" value="concat(substring-before(substring-after($map, concat(' ', local-name(), ':')), ' '), self::a:hcontainer/@name)"/>
      <let name="lastseg" value="re:replace(@eId, '^.*__', '', '')"/>
      <let name="p" value="string(ancestor::*[@eId][1]/@eId)"/>
      <!-- Sections are not prefixed by law containers (article, title ...),
           except where numbering restarts: the Constitution's articles, and the
           Parts and Subparts of a bill or chapter. -->
      <let name="cont" value="ancestor::*[@eId][1][self::a:article or self::a:title or self::a:subtitle or self::a:chapter or self::a:subchapter or self::a:part or self::a:subpart or self::a:hcontainer[@name = 'subarticle']]"/>
      <let name="inQuote" value="ancestor::a:quotedStructure[1]"/>
      <let name="dest" value="string(key('tm', concat('#', ancestor::a:mod[1]/@eId))/a:destination/@href)"/>
      <let name="constitutional" value="($inQuote and starts-with($dest, '/akn/us-ny/act/constitution/')) or (not($inQuote) and $dname = 'constitution')"/>
      <let name="partsRestart" value="not($inQuote) and ($type = 'bill' or $dname = 'chapter') and ($cont/self::a:part or $cont/self::a:subpart)"/>
      <let name="secException" value="self::a:section and $cont and not($constitutional or $partsRestart)"/>
      <let name="base" value="string(ancestor::*[@eId][not(self::a:article or self::a:title or self::a:subtitle or self::a:chapter or self::a:subchapter or self::a:part or self::a:subpart or self::a:hcontainer[@name = 'subarticle'])][1]/@eId)"/>
      <assert test="re:test(@eId, '^[A-Za-z][A-Za-z0-9]*(_[^_\s]+)?(__[A-Za-z][A-Za-z0-9]*(_[^_\s]+)?)*$')">eId "<value-of select="@eId"/>" isn't a valid identifier: element names and numbers joined by "_", levels joined by "__".</assert>
      <assert test="$abbr = '' or re:test($lastseg, concat('^', $abbr, '(_|$)'))">eId "<value-of select="@eId"/>" should end with "<value-of select="$abbr"/>" for a &lt;<value-of select="local-name()"/>&gt;.</assert>
      <assert test="$p = '' or $secException or starts-with(@eId, concat($p, '__'))">eId "<value-of select="@eId"/>" must start with its parent's eId "<value-of select="$p"/>__".</assert>
      <assert test="not($secException) or ($base = '' and @eId = $lastseg) or @eId = concat($base, '__', $lastseg)">Section eId "<value-of select="@eId"/>" must not include its article, title or part: New York section numbers are unique within a law. Expected "<value-of select="concat($base, substring('__', 1, 2 * number($base != '')), $lastseg)"/>".</assert>
      <assert test="count(key('eid', @eId)[not(ancestor::a:attachment)]) = 1">eId "<value-of select="@eId"/>" is used more than once.</assert>
    </rule>
  </pattern>

  <pattern id="eid-numbers">
    <title>Identifier numbers match printed numbers</title>
    <rule context="*[a:num][@eId][self::a:section or self::a:subsection or self::a:subdivision or self::a:paragraph or self::a:subparagraph or self::a:clause or self::a:subclause or self::a:point or self::a:hcontainer[@name = 'subitem'] or ((self::a:part or self::a:subpart) and not(ancestor::a:quotedStructure))]">
      <let name="applies" value="not((self::a:part or self::a:subpart) and not($type = 'bill' or $dname = 'chapter'))"/>
      <let name="struck" value="boolean(a:num/a:del) and not(a:num/a:ins) and normalize-space(a:num/text()) = ''"/>
      <let name="shown" value="concat(substring(normalize-space(string(a:num/a:ins[last()])), 1, 100 * number(boolean(a:num/a:ins))), substring(normalize-space(string(a:num)), 1, 100 * number(not(a:num/a:ins))))"/>
      <let name="n1" value="re:replace($shown, '^(Section|§|PART|Part|SUBPART|Subpart)\s*', '', '')"/>
      <let name="n2" value="translate($n1, '()[] ', '')"/>
      <let name="n3" value="re:replace($n2, '[.:;,]+$', '', '')"/>
      <let name="n" value="translate($n3, '.', '-')"/>
      <let name="id" value="re:replace(@eId, '\*[0-9]+$', '', '')"/>
      <assert test="not(contains(@eId, '*')) or re:test(@eId, '[^*]\*([2-9]|[1-9][0-9]+)$')">When two provisions carry the same number, the first keeps the plain identifier and later ones add the Bank's marker: 34, then 34*2, 34*3. The marker is never printed.</assert>
      <assert test="not($struck) or substring($id, string-length($id) - string-length($n) - 4) = concat('_', $n, '-old')">A unit that is struck out whole keeps its old number in its eId followed by "-old" (here "_<value-of select="$n"/>-old"), so it cannot collide with the unit that takes its number.</assert>
      <assert test="not($applies) or $struck or $n = '' or substring($id, string-length($id) - string-length($n)) = concat('_', $n)">eId "<value-of select="@eId"/>" should end with "_<value-of select="$n"/>", the printed number "<value-of select="normalize-space(a:num)"/>" without its punctuation.</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="bill-front-matter">
    <title>Front matter of bills</title>
    <rule context="/a:akomaNtoso/a:bill/a:preface">
      <let name="pn" value="string($info/l:printNumber)"/>
      <let name="digits" value="translate($pn, $UP, '')"/>
      <let name="ver" value="string($id/a:FRBRExpression/a:FRBRversionNumber/@value)"/>
      <let name="suffix" value="substring(concat('--', $ver), 1, 3 * number(string-length($ver) &gt; 0))"/>
      <let name="uni" value="boolean($info/l:uniBill)"/>
      <let name="amended" value="$id/a:FRBRExpression/a:FRBRdate[@name = 'amended']/@date"/>
      <let name="introduced" value="number(translate($id/a:FRBRWork/a:FRBRdate/@date, '-', ''))"/>
      <assert test="normalize-space(a:p/a:docAuthority) = 'STATE OF NEW YORK'">The front matter must begin "STATE OF NEW YORK" (docAuthority).</assert>
      <assert test="$uni or $pn = '' or normalize-space(a:p/a:docNumber) = concat($digits, $suffix)">The printed bill number should be "<value-of select="concat($digits, $suffix)"/>", not "<value-of select="normalize-space(a:p/a:docNumber)"/>".</assert>
      <assert test="not($uni) or (normalize-space(a:p/a:docNumber[1]) = concat('S. ', translate($info/l:uniBill/@senate, $UP, ''), $suffix) and normalize-space(a:p/a:docNumber[2]) = concat('A. ', translate($info/l:uniBill/@assembly, $UP, ''), $suffix))">A uni-bill print shows both numbers, Senate first: "S. …" then "A. …", as recorded in lbdc:uniBill.</assert>
      <assert test="not(a:p/a:session) or a:p/a:session/@value = $info/l:session">The session line, when printed, must name the bill's session (<value-of select="$info/l:session"/>).</assert>
      <assert test="($uni and normalize-space(a:p/a:docStage) = 'SENATE - ASSEMBLY') or (not($uni) and (normalize-space(a:p/a:docStage) = 'IN SENATE' or normalize-space(a:p/a:docStage) = 'IN ASSEMBLY'))">The house line must be "IN SENATE" or "IN ASSEMBLY" ("SENATE - ASSEMBLY" for a uni-bill).</assert>
      <assert test="$draft or a:p/a:docDate[@date]">The introduction date (docDate with a date attribute) is missing.</assert>
      <assert test="not($draft) or normalize-space(a:p/a:docNumber) = ''">A draft has no bill number yet; leave docNumber empty (the clean copy leaves the line blank).</assert>
      <assert test="not($draft) or not(a:p/a:docDate)">A draft has no introduction date yet; leave docDate out until the bill is introduced.</assert>
      <assert test="not(a:p/a:docDate/@date) or a:p/a:docDate/@date = $id/a:FRBRWork/a:FRBRdate/@date">The printed date is the date of original introduction (<value-of select="$id/a:FRBRWork/a:FRBRdate/@date"/>), on every print; it is not the date the bill was amended.</assert>
      <assert test="$draft or not($amended) or number(translate($amended, '-', '')) &gt;= $introduced">An amended print cannot be dated before the bill was introduced (<value-of select="$id/a:FRBRWork/a:FRBRdate/@date"/>).</assert>
      <assert role="warning" test="$draft or not($amended) or number(translate($amended, '-', '')) != $introduced">This amended print is dated the day the bill was introduced. That is the printed date, which every print keeps; the print itself was made the day of the action that names it ("print number 3006c"). See tools/print_dates.py.</assert>
      <assert test="$draft or a:p[@class = 'introduction']//a:docProponent">The "Introduced by" line must mark the sponsor (docProponent).</assert>
      <assert role="warning" test="not($draft) or a:p[@class = 'introduction']//a:docProponent or $info/l:requestedBy">This draft names no sponsor (docProponent) and no requester (lbdc:requestedBy).</assert>
      <assert test="$dname != 'concurrentResolution' or normalize-space(a:p/a:docType) = 'CONCURRENT RESOLUTION OF THE SENATE AND ASSEMBLY'">A concurrent resolution must carry the line "CONCURRENT RESOLUTION OF THE SENATE AND ASSEMBLY" (docType).</assert>
      <assert test="($dname = 'concurrentResolution' and not(starts-with(normalize-space(a:longTitle), 'AN ACT'))) or ($dname != 'concurrentResolution' and starts-with(normalize-space(a:longTitle), 'AN ACT'))">The title of a bill begins "AN ACT"; the title of a concurrent resolution does not.</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:bill">
      <assert test="$dname = 'concurrentResolution' or starts-with(normalize-space(a:preamble/a:formula[@name = 'enactingFormula']), 'The People of the State of New York, represented in Senate and Assembly, do enact as follows:')">A bill needs the enacting clause (preamble/formula name="enactingFormula").</assert>
      <assert test="$dname != 'concurrentResolution' or not(a:preamble/a:formula[@name = 'enactingFormula'])">A concurrent resolution has no enacting clause.</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="bill-sections">
    <title>Bill sections</title>
    <rule context="a:section[parent::a:body or parent::a:part or parent::a:subpart or parent::a:hcontainer[@name = 'item']][not(ancestor::a:quotedStructure)]">
      <let name="applies" value="$type = 'bill' or $dname = 'chapter'"/>
      <let name="num" value="normalize-space(a:num)"/>
      <let name="inserted" value="re:test($num, '^§ [0-9]+-[a-z]+\.$')"/>
      <let name="k" value="count(preceding-sibling::a:section[not(re:test(normalize-space(a:num), '^§ [0-9]+-[a-z]+\.$'))])"/>
      <assert test="not($applies) or ($inserted and re:test($num, concat('^§ ', $k, '-[a-z]+\.$'))) or (not($inserted) and (($k = 0 and $num = 'Section 1.') or ($k &gt; 0 and $num = concat('§ ', $k + 1, '.'))))">Bill section "<value-of select="$num"/>" is out of sequence: expected "<value-of select="substring(concat('Section 1.', '§ ', $k + 1, '.'), 1 + 10 * number($k &gt; 0))"/>" (an inserted section such as "§ <value-of select="$k"/>-a." is also allowed).</assert>
    </rule>
    <rule context="a:bill[@name != 'concurrentResolution']/a:body">
      <assert test="$dname = 'appropriationBill' or (count(a:section[@refersTo = '#effectiveDate']) = 1 and a:section[last()]/@refersTo = '#effectiveDate')">The last section of the bill must be its effective-date section, marked refersTo="#effectiveDate" (and only that one). No bill should be submitted without an express effective date.</assert>
      <assert test="not(a:part) or a:section[1]/@refersTo = '#componentsClause'">Section 1 of a Parts bill is the components clause ("This act enacts into law major components of legislation ..."), marked refersTo="#componentsClause".</assert>
      <assert test="$dname != 'budgetBill' or a:part">An Article VII bill contains its components as Parts.</assert>
    </rule>
    <rule context="a:act[@name = 'chapter']/a:body">
      <assert role="warning" test="a:section[last()]/@refersTo = '#effectiveDate'">This chapter has no effective-date section; under Legislative Law sec. 43 it takes effect on the twentieth day after it became a law.</assert>
    </rule>
    <rule context="a:quotedStructure//*[@refersTo = '#effectiveDate']">
      <assert test="false()">An effective-date provision inside quoted text is part of the law being amended, not this bill's effective date; don't mark it refersTo="#effectiveDate".</assert>
    </rule>
  </pattern>

  <pattern id="components">
    <title>Parts, Subparts and Items of a bill</title>
    <rule context="a:part[parent::a:body][not(ancestor::a:quotedStructure)] | a:subpart[parent::a:part][not(ancestor::a:quotedStructure)] | a:hcontainer[@name = 'item'][parent::a:subpart or parent::a:part][not(ancestor::a:quotedStructure)]">
      <let name="applies" value="$type = 'bill' or $dname = 'chapter'"/>
      <let name="label" value="normalize-space(a:num)"/>
      <assert test="not($applies) or @class = 'omitted' or a:section[last()]/@refersTo = '#effectiveDate'">The last section of <value-of select="$label"/> must be its effective-date section (refersTo="#effectiveDate").</assert>
      <assert test="not($applies) or not(a:subpart or a:hcontainer[@name = 'item']) or a:section[1]/@refersTo = '#componentsClause'"><value-of select="$label"/> is divided into smaller components, so its Section 1 is a components clause ("This Part enacts into law major components of legislation ..."), marked refersTo="#componentsClause".</assert>
      <assert test="not($applies) or not(self::a:subpart) or re:test($label, '^SUBPART [A-Z]+$')">A Subpart is numbered "SUBPART A", "SUBPART B" ...</assert>
      <assert test="not($applies) or not(self::a:hcontainer) or re:test($label, '^ITEM [A-Z]+$')">An Item is numbered "ITEM A", "ITEM B" ...</assert>
    </rule>
  </pattern>

  <pattern id="article-seven">
    <title>Article VII budget bills</title>
    <rule context="/a:akomaNtoso/a:bill/a:body/a:part">
      <let name="letter" value="substring-after(normalize-space(a:num), 'PART ')"/>
      <assert test="re:test(normalize-space(a:num), '^PART [A-Z]+(-[0-9]+)?$')">A Part is numbered "PART A", "PART AA", "PART II-1" ...</assert>
      <assert test="$dname != 'budgetBill' or @class = 'omitted' or //a:longTitle//a:inline[@name = 'partTag'][not(@class = 'omitted')][normalize-space(.) = concat('(Part ', $letter, ')')]">PART <value-of select="$letter"/> has no "(Part <value-of select="$letter"/>)" tag in the long title.</assert>
      <assert test="$dname != 'budgetBill' or not(@class = 'omitted') or //a:longTitle//a:inline[@name = 'partTag'][@class = 'omitted'][normalize-space(.) = concat('(Part ', $letter, ')')]">PART <value-of select="$letter"/> is intentionally omitted, so the title should read "intentionally omitted (Part <value-of select="$letter"/>)" with the tag marked class="omitted".</assert>
      <assert test="not(@class = 'omitted') or (not(a:section or a:subpart) and re:test(normalize-space(a:content), '^Intentionally [Oo]mitted\.?$'))">An omitted Part keeps its heading and contains only the words "Intentionally Omitted".</assert>
      <assert test="@class = 'omitted' or a:section">PART <value-of select="$letter"/> has no sections. If it was dropped from this print, mark it class="omitted" with the text "Intentionally Omitted".</assert>
    </rule>
    <rule context="a:longTitle//a:inline[@name = 'partTag']">
      <let name="letter" value="substring-before(substring-after(normalize-space(.), '(Part '), ')')"/>
      <assert test="@class = 'omitted' or /a:akomaNtoso/a:bill/a:body/a:part[not(@class = 'omitted')][normalize-space(a:num) = concat('PART ', $letter)]">The title lists Part <value-of select="$letter"/>, but the body has no PART <value-of select="$letter"/>. If it was dropped, mark the tag class="omitted" ("intentionally omitted").</assert>
      <assert test="not(@class = 'omitted') or not(/a:akomaNtoso/a:bill/a:body/a:part[not(@class = 'omitted')][normalize-space(a:num) = concat('PART ', $letter)])">Part <value-of select="$letter"/> is marked omitted in the title but has sections in the body.</assert>
    </rule>
  </pattern>

  <pattern id="effective-dates">
    <title>Kinds of effective date</title>
    <rule context="a:section[@refersTo = '#effectiveDate'][not(ancestor::a:quotedStructure)]">
      <assert role="warning" test="@class">Say what kind of effective date this is (class="immediate", "dateCertain", "daysAfter", "nextSucceeding", "contingent", "sameAsParent", "retroactive", "sunset", "preservesExpiration", "regulations", "applicability", "perComponent"; several may apply).</assert>
      <assert test="not(@class) or re:test(normalize-space(@class), '^((immediate|dateCertain|daysAfter|nextSucceeding|contingent|sameAsParent|retroactive|sunset|preservesExpiration|regulations|applicability|perComponent)( |$))+$')">Unknown kind of effective date in class="<value-of select="@class"/>".</assert>
      <assert test="not(contains(concat(' ', @class, ' '), ' dateCertain ')) or .//a:date[@date]">An effective date on a date certain must mark the date (&lt;date date="2026-04-01"&gt;).</assert>
      <assert role="warning" test="not(contains(concat(' ', @class, ' '), ' contingent ')) or contains(translate(., $UP, $LOW), 'notify the legislative bill drafting commission')">A contingent effective date should direct that the Legislative Bill Drafting Commission be notified when the event occurs (Public Officers Law sec. 70-b).</assert>
      <assert role="warning" test="not(contains(concat(' ', @class, ' '), ' sameAsParent ')) or contains(., 'on the same date and in the same manner as')">A chapter amendment usually takes effect "on the same date and in the same manner as" the chapter it amends.</assert>
    </rule>
  </pattern>

  <pattern id="boilerplate">
    <title>Boilerplate sections</title>
    <rule context="a:section[@refersTo = '#shortTitle'][not(ancestor::a:quotedStructure)]">
      <assert test="not(preceding-sibling::a:section)">A short title is always the first section.</assert>
      <assert test="contains(., 'shall be known and may be cited as')">A short title reads "This act shall be known and may be cited as ...".</assert>
    </rule>
    <rule context="a:section[@refersTo = '#severability'][not(ancestor::a:quotedStructure)]">
      <assert role="warning" test="following-sibling::a:section[1]/@refersTo = '#effectiveDate'">A severability clause normally comes immediately before the effective date.</assert>
    </rule>
    <rule context="a:section[@refersTo = '#appropriation'][not(ancestor::a:quotedStructure)]">
      <assert role="warning" test="following-sibling::a:section[1][@refersTo = '#severability' or @refersTo = '#effectiveDate']">An appropriation section comes directly before the severability clause or, if there is none, the effective date.</assert>
      <assert test=".//a:quantity[@class = 'amount'][@normalized]">An appropriation section must mark the sum appropriated (quantity class="amount").</assert>
    </rule>
  </pattern>

  <pattern id="titles">
    <title>Titles</title>
    <rule context="/a:akomaNtoso/a:bill[@name = 'bill']/a:preface/a:longTitle">
      <assert test="not(//a:textualMod[@type = 'repeal']) or contains(., 'to repeal')">A proposed repeal must be stated in the title ("to repeal section ... of the ... law, relating to ...").</assert>
      <assert role="warning" test="not(//a:section[@refersTo = '#appropriation']) or contains(., 'making an appropriation')">A bill that makes an appropriation should say so in its title ("; and making an appropriation therefor"), so it is referred to Finance or Ways and Means.</assert>
      <assert role="warning" test="not(/a:akomaNtoso/a:bill/a:body/a:section[@refersTo = '#effectiveDate'][contains(concat(' ', @class, ' '), ' sunset ')]) or contains(., 'providing for the repeal of')">A bill that expires should say so in its title ("; and providing for the repeal of such provisions upon expiration thereof").</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="amendments">
    <title>Amendments</title>
    <rule context="a:ins | a:del">
      <assert test="ancestor::a:quotedStructure or ancestor::a:quotedText or ancestor::a:hcontainer[@name = 'agency' or @name = 'fundSchedule']">New matter (ins) and old matter (del) appear only in quoted text (the law as amended) or in an appropriation schedule.</assert>
      <assert test="not(@class) or @class = 'spanStart' or @class = 'spanMiddle' or @class = 'spanEnd'">One printed pair of brackets that crosses from one unit into the next is split into pieces marked class="spanStart", "spanMiddle" and "spanEnd"; no other class is used on ins or del.</assert>
      <assert test="not(@class) or self::a:del">Only old matter (del) is split with span classes; underscoring needs no brackets.</assert>
      <assert test="not(ancestor::a:ins or ancestor::a:del)">ins and del cannot be nested.</assert>
      <assert test="normalize-space(.) != ''">Empty &lt;<value-of select="local-name()"/>&gt;.</assert>
      <assert test="not(re:test(string(preceding-sibling::node()[1][self::text()]), '([A-Za-z0-9]|(^|[^-])-)$') and re:test(string(.), '^[A-Za-z0-9]')) and not(re:test(string(.), '[A-Za-z0-9]$') and re:test(string(following-sibling::node()[1][self::text()]), '^([A-Za-z0-9]|-([^-]|$))'))">Only whole words are changed: bracket the entire word or hyphenated word and underscore its replacement ([conditions] condition, not condition[s]).</assert>
      <assert role="warning" test="not(self::a:ins and (following-sibling::node()[1][self::a:del] or (following-sibling::node()[1][self::text()][normalize-space(.) = ''] and following-sibling::node()[2][self::a:del])))">New matter replacing old matter is inserted after the bracketed text, not before it ([ten] twenty, not twenty [ten]).</assert>
    </rule>
    <rule context="a:mod">
      <let name="tm" value="//a:textualMod[a:source/@href = concat('#', current()/@eId)]"/>
      <assert test="$tm">Every &lt;mod&gt; needs a textualMod in the metadata (analysis/activeModifications) describing what it changes.</assert>
      <assert test="a:quotedStructure or a:quotedText or $tm/@type = 'repeal' or $tm/@type = 'renumbering'">A modification that amends or adds text must contain the text (quotedStructure).</assert>
      <assert test="not($tm/@type = 'repeal') or re:test(string(.), '(is|are) REPEALED')">A repeal by reference writes REPEALED in capitals ("Section 33 of the executive law is REPEALED."); the printed bill shows it in boldface.</assert>
      <assert test="not($tm) or a:ref[@href = $tm/a:destination/@href or starts-with($tm/a:destination/@href, concat(@href, '/')) or starts-with($tm/a:destination/@href, concat(@href, '__'))] or ($type = 'amendment' and not(ancestor::a:quotedStructure) and //a:affectedDocument[starts-with($tm/a:destination/@href, concat(@href, '/'))])">The citation in the lead-in (ref) should point to the same provision as the textualMod destination (<value-of select="$tm/a:destination/@href"/>).</assert>
    </rule>
    <rule context="a:quotedStructure">
      <assert test="parent::a:mod">Quoted text belongs inside the &lt;mod&gt; whose lead-in introduces it.</assert>
      <assert test="@eId = concat(../@eId, '__qstr') or starts-with(@eId, concat(../@eId, '__qstr_'))">The quotedStructure eId must be its mod's eId followed by __qstr.</assert>
    </rule>
    <rule context="a:omissis">
      <assert test="ancestor::a:quotedStructure">Abbreviated text ("...") marks omitted existing law, so it belongs inside quoted text.</assert>
    </rule>
  </pattern>

  <pattern id="hierarchy">
    <title>Nesting of units</title>
    <rule context="a:article | a:title | a:subtitle | a:chapter | a:subchapter | a:part | a:subpart | a:section">
      <assert test="not(ancestor::*[self::a:section or self::a:quotedStructure][1][self::a:section])">&lt;<value-of select="local-name()"/>&gt; cannot appear inside a section, except inside quoted text.</assert>
    </rule>
    <rule context="a:subdivision | a:subsection | a:paragraph | a:subparagraph | a:clause | a:subclause | a:point">
      <assert test="not(parent::*[local-name() = local-name(current())])">A <value-of select="local-name()"/> cannot be directly inside another <value-of select="local-name()"/>.</assert>
    </rule>
    <rule context="a:hcontainer">
      <assert test="@name = 'agency' or @name = 'fundSchedule' or @name = 'department' or @name = 'schedule' or @name = 'agencySummary' or @name = 'program' or @name = 'account' or @name = 'purpose' or @name = 'appropriation' or @name = 'objectGroup' or @name = 'subtotal' or @name = 'adjustment' or @name = 'table' or @name = 'tableGroup' or @name = 'tableNote' or @name = 'reappropriationSource' or @name = 'reappropriation' or @name = 'resolution' or @name = 'item' or @name = 'subitem' or @name = 'subarticle' or @name = 'text' or @name = 'group' or @name = 'toc'">hcontainer name "<value-of select="@name"/>" isn't in the AKN-NY vocabulary.</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="tables">
    <title>Tables in statute text</title>
    <!-- A table the law names or cites ("table one", "Group A of table one",
         "Note 3 of table three") is wrapped so each citable part has an address. -->
    <rule context="a:ref[starts-with(@href, '/akn/us-ny/act/')]">
      <assert test="not(re:test(@href, '^/akn/us-ny/act/(consolidated|unconsolidated|constitution)/[0-9]{4}/'))">A consolidated law, court act or the Constitution is addressed by its law ID alone (/akn/us-ny/act/consolidated/tax), with no year.</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'table']">
      <assert test="a:content/a:table or a:hcontainer[@name = 'tableGroup']">A table holds its rows (content/table) or its groups (hcontainer name="tableGroup").</assert>
      <assert test="re:test(@eId, '__table_[0-9]+$') or re:test(@eId, '^table_[0-9]+$')">A table is identified by its position as the law cites it: "table one" is table_1.</assert>
      <assert test="not(ancestor::a:table)">A table cannot be placed inside a table cell.</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'tableGroup']">
      <assert test="parent::a:hcontainer[@name = 'table'] or parent::a:quotedStructure">A table group belongs in its table (or stands alone as the quoted text of an amendment).</assert>
      <assert test="re:test(normalize-space(a:heading), '^Group [A-Z]+:?$')">A table group is headed "Group A:", "Group B:" ...</assert>
      <assert test="substring-after(@eId, 'tableGroup_') = translate(substring-after(normalize-space(a:heading), 'Group '), ':', '')">The group's eId should end with "tableGroup_<value-of select="translate(substring-after(normalize-space(a:heading), 'Group '), ':', '')"/>", its printed letter.</assert>
      <assert test="a:content/a:table">A table group holds its rows (content/table).</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'tableNote']">
      <assert test="parent::a:hcontainer[@name = 'table'] or parent::a:quotedStructure">A table note belongs in its table (or stands alone as the quoted text of an amendment).</assert>
      <assert test="translate(normalize-space(a:num), '0123456789', '') = $BR and string-length(normalize-space(a:num)) &gt; 2">A table note is numbered in braces as printed, like the notes under the Insurance Law's capital tables.</assert>
      <assert test="substring-after(@eId, 'tableNote_') = translate(normalize-space(a:num), $BR, '')">The note's eId should end with "tableNote_<value-of select="translate(normalize-space(a:num), $BR, '')"/>", its printed number.</assert>
    </rule>
    <rule context="a:inline[@name = 'tableNoteRef']">
      <assert test="ancestor::a:table and translate(normalize-space(.), '0123456789', '') = $BR">A reference to a table note appears in a table cell and is written in braces, as printed.</assert>
    </rule>
    <rule context="a:table[not(@class = 'agencySummary')]">
      <let name="cols" value="count(a:tr[1]/*) + sum(a:tr[1]/*/@colspan) - count(a:tr[1]/*[@colspan])"/>
      <assert test="not(a:tr[count(*) + sum(*/@colspan) - count(*[@colspan]) != $cols])">Every row of a table must span the same number of columns (the first row has <value-of select="$cols"/>). Use an empty cell, or colspan, where the print leaves a column blank.</assert>
      <assert test="not(.//a:table)">Tables are not nested.</assert>
      <assert test="ancestor::a:content or ancestor::a:intro or ancestor::a:quotedStructure">A table sits in the content of the unit it belongs to (or, for the column headings of a named table, in its opening).</assert>
    </rule>
    <rule context="a:eol">
      <assert test="ancestor::a:td or ancestor::a:th">A line-end marker (eol) is used only inside a table cell, to keep the line breaks that were typed there. Running text is never given fixed line breaks.</assert>
      <assert test="not(@breakWith) and not(node())">A line-end marker in a table cell falls between words and is empty.</assert>
    </rule>
    <rule context="a:td | a:th">
      <assert role="warning" test="not(re:test(string(.), '\$\s+[0-9]'))">Write amounts without padding ("$50,000", not "$ 50,000"). Spaces after the dollar sign only line up the typed column; the printed copy aligns columns itself.</assert>
      <assert test="not(ancestor::a:hcontainer[@name = 'table' or @name = 'tableGroup']) or count(a:p) = 1">A cell of a statute table is one paragraph: text the print wraps over several lines is still one cell.</assert>
      <assert test="not(@rowspan)">Cells do not span rows; repeat or leave blank as the law prints it.</assert>
    </rule>
  </pattern>

  <pattern id="appropriations">
    <title>Appropriation schedules</title>
    <rule context="a:hcontainer[@name = 'agency']">
      <assert test="(parent::a:section or parent::a:hcontainer[@name = 'fundSchedule' or @name = 'department']) and (ancestor::a:bill[@name = 'appropriationBill'] or ancestor::a:act[@name = 'chapter'])">An agency schedule belongs directly in a section of an appropriation bill or chapter (or under a fund or department heading there).</assert>
      <assert test="@refersTo and a:heading">An agency schedule needs its heading and a refersTo naming the agency.</assert>
    </rule>
    <!-- The Debt Service bill is set out by fund, not by agency (S.3002 of 2025): "DEBT SERVICE FUND, GENERAL
         DEBT SERVICE FUND" (printed with a double hyphen) heads a fund schedule, and an item may carry its own schedule ("in accordance with the
         following schedule" / SCHEDULE), which holds accounts, items (each of which may have a schedule) and totals. -->
    <rule context="a:hcontainer[@name = 'fundSchedule']">
      <assert test="(parent::a:section or parent::a:hcontainer[@name = 'department']) and ancestor::a:bill[@name = 'appropriationBill'] and a:heading">A fund schedule belongs directly in a section of an appropriation bill (or under a department heading), under its heading (the fund).</assert>
    </rule>
    <!-- The Legislature and Judiciary bill (S.3001 of 2025) sets fund, department and agency headings in the
         order of each section: fund over department over agency in section 1, department over fund in section 4. -->
    <rule context="a:hcontainer[@name = 'department']">
      <assert test="(parent::a:section or parent::a:hcontainer[@name = 'fundSchedule']) and a:heading">A department heading belongs in a section of an appropriation bill (or under a fund heading), over its agencies.</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'schedule']">
      <let name="own" value="sum(.//a:hcontainer[@name = 'appropriation'][generate-id(ancestor::a:hcontainer[@name = 'schedule'][1]) = generate-id(current())]/*[not(self::a:hcontainer)]//a:quantity[@class = 'amount']/@normalized)"/>
      <let name="item" value="number(../a:intro//a:quantity[@class = 'amount']/@normalized)"/>
      <assert test="parent::a:hcontainer[@name = 'appropriation'] and ../a:intro">An item's schedule belongs in the item, after its words and amount (intro).</assert>
      <assert test="not(a:hcontainer[@name = 'subtotal'][contains(concat(' ', @class, ' '), ' scheduleTotal ')][following-sibling::*])">A schedule's total ("Total of schedule", class="scheduleTotal") is the last thing in it.</assert>
      <!-- its items (directly, in accounts or object groups, not in the schedules of its items) add up to its item -->
      <assert test="$own = $item">The items of the schedule add up to <value-of select="format-number($own, '#,##0')"/>, not the item's <value-of select="format-number($item, '#,##0')"/>.</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'subtotal'][contains(concat(' ', @class, ' '), ' scheduleTotal ')]">
      <let name="item" value="number(../../a:intro//a:quantity[@class = 'amount']/@normalized)"/>
      <assert test="number(.//a:quantity[@class = 'subtotal']/@normalized) = $item">The schedule's total <value-of select="normalize-space(.//a:quantity)"/> isn't the amount of its item (<value-of select="format-number($item, '#,##0')"/>).</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'program']">
      <assert test="parent::a:hcontainer[@name = 'agency' or @name = 'fundSchedule' or @name = 'department']">A program belongs in an agency schedule (or a fund schedule).</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'account']">
      <assert test="parent::a:hcontainer[@name = 'program' or @name = 'agency' or @name = 'fundSchedule' or @name = 'schedule']">An account belongs in a program (or directly in an agency schedule, a fund schedule or an item's schedule).</assert>
      <assert test="not(a:heading) or a:heading/a:inline[@name = 'accountCode'] or normalize-space(a:heading) = 'All Funds' or (contains(concat(' ', @class, ' '), ' noNumber ') and ancestor::a:bill/a:meta//l:budget[@type = 'legislatureJudiciary'])">An account heading must mark its account number (inline name="accountCode"); only the Legislature and Judiciary bill prints its accounts with none (class="noNumber").</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'appropriation']">
      <assert test="ancestor::a:hcontainer[@name = 'agency' or @name = 'fundSchedule']">An item of appropriation belongs in an agency schedule (or a fund schedule).</assert>
      <assert test="count(a:*[not(self::a:hcontainer)]//a:quantity[@class = 'amount']) = 1">An item of appropriation has exactly one amount (quantity class="amount"); the items of its schedule have their own.</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'reappropriationSource']">
      <assert test=".//a:ref[re:test(@href, '^/akn/us-ny/act/[0-9]{4}/[0-9]+(/~.+)?$')]">A reappropriation must cite the chapter and section that made the original appropriation (State Finance Law sec. 25).</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'reappropriation']">
      <assert test="ancestor::a:hcontainer[@name = 'reappropriationSource']">A reappropriation belongs under its source ("By chapter 50, section 1, of the laws of ...").</assert>
      <assert test="(count(.//a:quantity[@class = 'originalAmount']) = 1 or contains(concat(' ', @class, ' '), ' noOriginal ')) and count(.//a:quantity[@class = 'reappropriatedAmount']) = 1">A reappropriation has the original amount and the reappropriated amount ("(re. $...)").</assert>
      <!-- Old bond act reappropriations print no original amount (S.3004-D: "... (01347607) (80920) ......
           (re. $7,294,000)"); class "noOriginal" records that, and is flagged so the source can be checked. -->
      <assert role="warning" test="not(contains(concat(' ', @class, ' '), ' noOriginal '))">This reappropriation prints no original amount, only the amount reappropriated.</assert>
      <assert role="warning" test="not(.//a:quantity[@class = 'reappropriatedAmount'] and .//a:quantity[@class = 'originalAmount']) or number(.//a:quantity[@class = 'reappropriatedAmount']/@normalized) &lt;= number(.//a:quantity[@class = 'originalAmount']/@normalized) or ancestor::a:hcontainer[@name = 'reappropriationSource']//a:ref[contains(concat(' ', @class, ' '), ' supplemented ')]">The reappropriated amount is more than the original appropriation (and the source line names no supplement by transfer).</assert>
    </rule>
    <rule context="*[@refersTo = '#legislativeAddition']">
      <assert test="self::a:hcontainer[@name = 'appropriation' or @name = 'program' or @name = 'agency']">Only items, programs or agency schedules can be marked as legislative additions.</assert>
    </rule>
  </pattern>

  <pattern id="amounts">
    <title>Amounts and totals</title>
    <rule context="a:quantity[@class]">
      <assert test="@class = 'amount' or @class = 'allocation' or @class = 'offset' or @class = 'grossTotal' or @class = 'netTotal' or @class = 'totalAvailable' or @class = 'subtotal' or @class = 'programTotal' or @class = 'originalAmount' or @class = 'reappropriatedAmount' or @class = 'summaryAppropriations' or @class = 'summaryReappropriations'">Unknown amount class "<value-of select="@class"/>".</assert>
      <assert test="re:test(@normalized, '^[0-9]+$') and translate(normalize-space(.), ',$', '') = @normalized">The printed amount "<value-of select="normalize-space(.)"/>" doesn't match its value (normalized="<value-of select="@normalized"/>").</assert>
      <assert test="@refersTo = '#usd'">Dollar amounts refer to the currency (refersTo="#usd").</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'subtotal'][parent::a:hcontainer[@name = 'schedule']]">
      <!-- In an item's schedule a total counts the items of that schedule above it, directly or in its accounts
           (not the items of their own schedules): "Total of debt service schedule", then "Total of schedules". -->
      <let name="sum" value="sum((preceding-sibling::a:hcontainer[@name = 'appropriation'] | preceding-sibling::a:hcontainer[@name = 'account']/a:hcontainer[@name = 'appropriation'])/*[not(self::a:hcontainer)]//a:quantity[@class = 'amount']/@normalized)"/>
      <let name="before" value="sum(preceding-sibling::a:hcontainer[@name = 'subtotal']//a:quantity[@class = 'subtotal']/@normalized)"/>
      <let name="tot" value="number(.//a:quantity[@class = 'subtotal']/@normalized)"/>
      <assert test="$tot = $sum or $tot = $sum - $before">The total <value-of select="normalize-space(.//a:quantity[@class = 'subtotal'])"/> doesn't equal the items above it in the schedule (<value-of select="format-number($sum, '#,##0')"/>).</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'subtotal']">
      <!-- the items above it: in its group, or in the object groups of its account ("Program account subtotal") -->
      <let name="sum" value="sum((../a:hcontainer[@name = 'appropriation'] | ../a:hcontainer[@name = 'objectGroup']/a:hcontainer[@name = 'appropriation'])//a:quantity[@class = 'amount']/@normalized)"/>
      <!-- A subtotal is the items above it, or the items less the offsets above it ("Less the amount appropriated
           to ..." in General State Charges, where the offsets keep a sum from being counted twice). -->
      <let name="off" value="sum(preceding-sibling::a:hcontainer[@name = 'adjustment']//a:quantity[@class = 'offset']/@normalized)"/>
      <assert test="number(.//a:quantity[@class = 'subtotal']/@normalized) = $sum or number(.//a:quantity[@class = 'subtotal']/@normalized) = $sum - $off">The subtotal <value-of select="normalize-space(.//a:quantity[@class = 'subtotal'])"/> doesn't equal the items above it (<value-of select="format-number($sum, '#,##0')"/>).</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'program'][a:heading/a:quantity[@class = 'programTotal']]">
      <let name="sum" value="sum(.//a:hcontainer[@name = 'appropriation']//a:quantity[@class = 'amount']/@normalized)"/>
      <let name="off" value="sum(.//a:hcontainer[@name = 'adjustment']//a:quantity[@class = 'offset']/@normalized)"/>
      <assert test="number(a:heading/a:quantity[@class = 'programTotal']/@normalized) = $sum or number(a:heading/a:quantity[@class = 'programTotal']/@normalized) = $sum - $off">The program total <value-of select="normalize-space(a:heading/a:quantity)"/> doesn't equal its items (<value-of select="format-number($sum, '#,##0')"/>).</assert>
    </rule>
    <rule context="a:table[contains(@class, 'projectSchedule')][a:tr[contains(concat(' ', @class, ' '), ' totalRow ')]//a:quantity]">
      <!-- A project schedule allocates its item: its total (the last column, the state share, where there are
           two) is the item's amount, in thousands of dollars where the caption says so. -->
      <let name="item" value="number((ancestor::a:hcontainer[@name = 'appropriation' or @name = 'reappropriation'][1]/a:content/a:p//a:quantity[@class = 'amount' or @class = 'originalAmount'][not(ancestor::a:del)])[1]/@normalized)"/>
      <let name="tot" value="number((a:tr[contains(concat(' ', @class, ' '), ' totalRow ')][last()]/*[a:p/a:quantity][last()]/a:p/a:quantity)[last()]/@normalized)"/>
      <let name="mult" value="1 + 999 * number(contains(a:caption, 'thousands'))"/>
      <assert test="string($item) = 'NaN' or $tot * $mult = $item">The project schedule's total (<value-of select="format-number($tot, '#,##0')"/><value-of select="substring(' thousand', 1, 9 * number($mult = 1000))"/>) isn't the amount of the item it allocates (<value-of select="format-number($item, '#,##0')"/>).</assert>
    </rule>
    <rule context="a:tr[contains(concat(' ', @class, ' '), ' totalRow ')]/*[a:p/a:quantity]">
      <let name="k" value="count(preceding-sibling::*) + 1"/>
      <let name="sum" value="sum(../../a:tr[contains(concat(' ', @class, ' '), ' summaryRow ')]/*[position() = $k]/a:p/a:quantity[not(@class = 'offset')]/@normalized) - sum(../../a:tr[contains(concat(' ', @class, ' '), ' summaryRow ')]/*[position() = $k]/a:p/a:quantity[@class = 'offset']/@normalized)"/>
      <assert test="number(a:p/a:quantity/@normalized) = $sum">The summary total <value-of select="normalize-space(.)"/> doesn't equal the rows above it (<value-of select="format-number($sum, '#,##0')"/>).</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'agencySummary']">
      <let name="ag" value="string(../@refersTo)"/>
      <!-- A summary that covers more than its own agency (CUNY's Senior Colleges summary also counts the Community
           Colleges) refers to each agency it covers. -->
      <let name="refs" value="concat(' ', normalize-space(@refersTo), ' ')"/>
      <let name="many" value="contains(normalize-space(@refersTo), ' ')"/>
      <let name="scope" value="//a:hcontainer[@name = 'agency'][$many and contains($refs, concat(' ', @refersTo, ' '))]"/>
      <let name="appr" value="sum(..//a:hcontainer[@name = 'appropriation']//a:quantity[@class = 'amount']/@normalized) * number(not($many)) + sum($scope//a:hcontainer[@name = 'appropriation']//a:quantity[@class = 'amount']/@normalized)"/>
      <let name="off" value="sum(..//a:hcontainer[@name = 'adjustment']//a:quantity[@class = 'offset']/@normalized) * number(not($many)) + sum($scope//a:hcontainer[@name = 'adjustment']//a:quantity[@class = 'offset']/@normalized)"/>
      <!-- the reappropriations of the same kind of budget: one bill can hold several (the Judiciary's "STATE
           OPERATIONS", "AID TO LOCALITIES", "CAPITAL PROJECTS" schedules in S.3001); its reappropriation schedules
           are named by kind ("AID TO LOCALITIES REAPPROPRIATIONS 2025-26") -->
      <let name="kind" value="substring-before(concat(normalize-space(../a:subheading), ' 20'), ' 20')"/>
      <let name="mixed" value="count(//a:hcontainer[@name = 'agency'][@refersTo = $ag][not(contains(a:subheading, 'REAPPROPRIATIONS'))]) > 1"/>
      <let name="reappr" value="sum(key('agency', $ag)[not($mixed) or starts-with(normalize-space(a:subheading), $kind)]//a:quantity[@class = 'reappropriatedAmount']/@normalized) * number(not($many)) + sum($scope//a:quantity[@class = 'reappropriatedAmount']/@normalized)"/>
      <assert test="not(.//a:tr[@class = 'totalRow']//a:quantity[@class = 'summaryAppropriations']) or (number(.//a:tr[@class = 'totalRow']//a:quantity[@class = 'summaryAppropriations']/@normalized) = $appr or number(.//a:tr[@class = 'totalRow']//a:quantity[@class = 'summaryAppropriations']/@normalized) = $appr - $off)">The agency summary's appropriations total doesn't equal the agency's items (<value-of select="format-number($appr, '#,##0')"/>).</assert>
      <assert test="not(.//a:tr[@class = 'totalRow']//a:quantity[@class = 'summaryReappropriations']) or number(.//a:tr[@class = 'totalRow']//a:quantity[@class = 'summaryReappropriations']/@normalized) = $reappr">The agency summary's reappropriations total doesn't equal the agency's reappropriations (<value-of select="format-number($reappr, '#,##0')"/>).</assert>
    </rule>
  </pattern>

  <!-- ================================================================ -->
  <pattern id="resolutions">
    <title>Resolutions</title>
    <rule context="/a:akomaNtoso/a:bill[@name = 'concurrentResolution']/a:body/a:section">
      <let name="formula" value="normalize-space(a:content/a:p[1]/a:inline[@name = 'resolvedFormula'])"/>
      <assert test="re:test($formula, '^Resolved \(if the (Assembly|Senate) concurs?\)$')">Each section of a concurrent resolution amending the state constitution begins "Resolved (if the Assembly concur)" or "(if the Senate concur)", marked inline name="resolvedFormula".</assert>
      <assert test="not($info/l:house = 'senate' and contains($formula, 'Senate')) and not($info/l:house = 'assembly' and contains($formula, 'Assembly'))">The formula names the other house: "(if the Assembly concur)" in a Senate resolution, "(if the Senate concur)" in an Assembly resolution.</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:bill[@name = 'concurrentResolution']">
      <let name="kind" value="string($info/l:resolution/@kind)"/>
      <let name="state" value="starts-with($kind, 'stateConstitution')"/>
      <assert test="not($state) or starts-with(normalize-space(a:preface/a:longTitle), 'proposing an amendment to')">A resolution amending the state constitution identifies the provision in its title ("proposing an amendment to section 2 of article 2 of the constitution, in relation to ...").</assert>
      <assert test="$kind != 'stateConstitutionFirstPassage' or a:body/a:section[last()]/@refersTo = '#referralClause'">On first passage the last section refers the amendment to the next elected Legislature (refersTo="#referralClause").</assert>
      <assert test="$kind != 'stateConstitutionSecondPassage' or a:body/a:section[last()]/@refersTo = '#submissionClause'">On second passage the last section submits the amendment to the people at a general election (refersTo="#submissionClause").</assert>
      <assert test="$state or $kind = '' or (a:body/a:hcontainer[@name = 'resolution'] and not(a:body/a:section))">A resolution on the federal constitution is written as WHEREAS recitals and RESOLVED clauses (hcontainer name="resolution"), not numbered sections.</assert>
      <assert test="not(.//a:section[@refersTo = '#effectiveDate'])">A concurrent resolution has no effective-date section.</assert>
      <assert test="not(.//a:ref[contains(concat(' ', @class, ' '), ' amendmentHistory ')])">A concurrent resolution does not recite amendment history ("as amended by ...").</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:statement">
      <let name="dt" value="normalize-space(a:preface//a:docType)"/>
      <assert test="a:mainBody/a:hcontainer[@name = 'resolution']">A resolution has RESOLVED clauses (hcontainer name="resolution").</assert>
      <assert test="re:test(normalize-space(a:preface/a:p[@class = 'number']), '^(Senate|Assembly) Resolution No\. [0-9]+$')">A resolution in the resolution series is headed "Senate Resolution No. N" or "Assembly Resolution No. N".</assert>
      <assert test="not($info/l:house = 'senate' and starts-with(normalize-space(a:preface/a:p[@class = 'number']), 'Assembly')) and not($info/l:house = 'assembly' and starts-with(normalize-space(a:preface/a:p[@class = 'number']), 'Senate'))">The resolution's heading names the wrong house.</assert>
      <assert test="a:preface/a:p[@class = 'introduction']//a:docProponent">The "BY:" line must mark the sponsor (docProponent).</assert>
      <assert test="(@name != 'concurrentResolution' and $dt = '') or (@name = 'legislativeResolution' and $dt = 'LEGISLATIVE RESOLUTION') or (@name = 'senateResolution' and $dt = 'SENATE RESOLUTION') or (@name = 'assemblyResolution' and $dt = 'ASSEMBLY RESOLUTION') or (@name = 'concurrentResolution' and starts-with($dt, 'CONCURRENT RESOLUTION OF THE SENATE AND'))">The caption (docType) must match the kind of resolution: "<value-of select="$dt"/>" on a <value-of select="@name"/>.</assert>
    </rule>
    <rule context="a:recital">
      <let name="t" value="normalize-space(.)"/>
      <let name="strict" value="boolean(ancestor::a:statement)"/>
      <assert test="starts-with($t, 'WHEREAS')">A recital begins "WHEREAS".</assert>
      <assert role="warning" test="not($strict) or (following-sibling::a:recital and re:test($t, '; and$')) or (not(following-sibling::a:recital) and re:test($t, '; now, therefore, be it$'))">WHEREAS paragraphs end "; and", except the last, which ends "; now, therefore, be it".</assert>
    </rule>
    <rule context="a:hcontainer[@name = 'resolution']">
      <let name="t" value="normalize-space(.)"/>
      <let name="concurrent" value="$dname = 'concurrentResolution'"/>
      <let name="last" value="not(following-sibling::a:hcontainer[@name = 'resolution'])"/>
      <assert test="starts-with($t, 'RESOLVED')">A resolution clause begins "RESOLVED".</assert>
      <assert test="not($concurrent) or re:test($t, '^RESOLVED,? \([Ii]f the (Senate|Assembly) concur\)')">In a concurrent resolution every RESOLVED is followed by "(if the Assembly concur)" or "(if the Senate concur)".</assert>
      <assert test="not($concurrent) or not($info/l:house = 'senate' and re:test($t, '^RESOLVED,? \([Ii]f the Senate')) and not($info/l:house = 'assembly' and re:test($t, '^RESOLVED,? \([Ii]f the Assembly'))">The formula names the other house: "(if the Assembly concur)" in a Senate resolution, "(if the Senate concur)" in an Assembly resolution.</assert>
      <assert role="warning" test="($last and re:test($t, '\.$')) or (not($last) and re:test($t, '; and be it further$'))">RESOLVED paragraphs end "; and be it further", except the last, which ends with a period.</assert>
    </rule>
  </pattern>

  <pattern id="history">
    <title>Legislative history in lead-ins</title>
    <rule context="a:ref[contains(concat(' ', @class, ' '), ' amendmentHistory ')]">
      <assert test="re:test(normalize-space(@class), '(^| )(added|amended|renumbered|transferred|supplemented)( |$)')">A history citation says what the cited act did: class="amendmentHistory added", "amended" or "renumbered" (and, in appropriation bills, "transferred" or "supplemented").</assert>
      <assert test="not(re:test(normalize-space(@class), '(^| )(transferred|supplemented)( |$)')) or ancestor::a:hcontainer[@name = 'agency']">"As transferred by" and "as supplemented by" are used only in appropriation schedules.</assert>
      <assert test="re:test(@href, '^/akn/us-ny/(act/[0-9]{4}/[0-9]+|act/localLaw/[a-z-]+/[0-9]{4}/[0-9]+|bill/)')">A history citation points to a chapter (/akn/us-ny/act/2023/59), a local law (/akn/us-ny/act/localLaw/new-york-city/2013/34) or, for a chapter not yet numbered, a bill.</assert>
      <assert test="parent::a:mod or ancestor::a:hcontainer[@name = 'reappropriationSource']">A history citation belongs in the lead-in of the amendment it describes, or in the source line of a reappropriation ("By chapter 50, section 1, of the laws of 2021, as amended by ...").</assert>
    </rule>
  </pattern>

  <pattern id="detail-sheets">
    <title>Detail sheets</title>
    <rule context="/a:akomaNtoso/a:amendment[@name = 'detailSheet']">
      <assert test=".//a:affectedDocument[re:test(@href, '^/akn/us-ny/bill/[0-9]{4}/[sa][0-9]+/eng@[a-z]?$')]">A detail sheet names the exact print it amends ("Amend SENATE BILL NO. 1234 as follows:", affectedDocument href="/akn/us-ny/bill/2025/s1234/eng@").</assert>
      <assert test="a:amendmentBody/a:amendmentContent//a:mod[not(ancestor::a:quotedStructure)][@class = 'replaceAfterEnactingClause' or @class = 'replaceAfterAnAct' or @class = 'pageLine']">Each instruction is a mod whose class says what kind it is: replaceAfterEnactingClause ("Strike out all after the enacting clause and insert"), replaceAfterAnAct ("Strike out all after AN ACT and insert") or pageLine.</assert>
    </rule>
  </pattern>

  <pattern id="drafting-advice">
    <title>Drafting advice for new matter (warnings only)</title>
    <rule context="a:ins">
      <assert role="warning" test="not(re:test(string(.), '\b(almshouse|asylum|chairman|crippled|deformity|feeble-minded|idiot|illegal immigrant|insane|mental retardation|mentally ill|senile)\b', 'i'))">The drafting manual lists a term in this new matter as derogatory or outdated; avoid it unless the statute's own style requires it.</assert>
      <assert role="warning" test="not(re:test(string(.), '\b(presently|currently|heretofore|hereafter)\b', 'i'))">Avoid "presently", "currently", "heretofore" and "hereafter" in new matter; refer to "the effective date of this section" instead.</assert>
    </rule>
  </pattern>

  <pattern id="acts">
    <title>Chapters and consolidated laws</title>
    <rule context="/a:akomaNtoso/a:act[@name = 'chapter']/a:preface">
      <assert test="re:test(normalize-space(a:p/a:docAuthority), '^LAWS OF NEW YORK, [0-9]{4}$')">A chapter begins "LAWS OF NEW YORK, YYYY".</assert>
      <assert test="normalize-space(a:p/a:docNumber) = concat('CHAPTER ', $info/l:chapter/@number)">The chapter line should read "CHAPTER <value-of select="$info/l:chapter/@number"/>".</assert>
      <assert test="a:p[@class = 'approval'][starts-with(normalize-space(.), 'Became a law')]/a:docDate/@date = $info/l:passage/@date">The "Became a law ..." statement (Legislative Law sec. 44) must be present and dated as in lbdc:passage.</assert>
      <assert role="warning" test="re:test(normalize-space(a:p[@class = 'approval']), 'Passed (by a majority vote|by a two-thirds vote|by a majority vote, three-fifths being present)')">The approval statement should state the vote ("Passed by a majority vote, three-fifths being present", etc.).</assert>
    </rule>
    <rule context="/a:akomaNtoso/a:act[@name = 'consolidatedLaw']/a:preface">
      <assert test="normalize-space(a:p/a:docNumber) = concat('CHAPTER ', $info/l:law/@consolidatedChapter, ' OF THE CONSOLIDATED LAWS')">A consolidated law's chapter line should read "CHAPTER <value-of select="$info/l:law/@consolidatedChapter"/> OF THE CONSOLIDATED LAWS".</assert>
    </rule>
  </pattern>

  <pattern id="line-vetoes">
    <title>Line veto memoranda</title>
    <rule context="/a:akomaNtoso/a:doc[@name = 'lineVetoMemo']">
      <assert test=".//a:ref[@class = 'vetoedItem']">A line veto memo must cite the vetoed items (ref class="vetoedItem").</assert>
    </rule>
    <rule context="a:ref[@class = 'vetoedItem']">
      <assert test="re:test(@href, '^/akn/us-ny/bill/[0-9]{4}/[sa][0-9]+/eng@[a-z]?/~.*__(appropriation|reappropriation)_[0-9]+$')">A vetoed item is cited by the bill print and the item's eId (…/eng@d/~…__appropriation_1, or __reappropriation_1: most vetoes are of reappropriations).</assert>
    </rule>
  </pattern>
</schema>
