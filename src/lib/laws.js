/* Bill Drafter for Word (demo) - the laws the AKN-NY profile can address, from the profile's tools/laws.json
   (read from the Bank's public pages, 14 November 2026). A law is addressed by its Bank law ID alone, with no year:
   /akn/us-ny/act/consolidated/tax, /akn/us-ny/act/unconsolidated/fct, /akn/us-ny/act/constitution/cns.
   'subsections': sections of this law divide into subsections (a), paragraphs (1), subparagraphs (A), as real bills
   cite them; other laws use subdivisions 1., paragraphs (a), subparagraphs (i). */
(function (root) {
  'use strict';
  const BD = root.BD = root.BD || {};
  const LAWS = {
    "abc":{"kind":"consolidated","name":"alcoholic beverage control law"},
    "abp":{"kind":"consolidated","name":"abandoned property law"},
    "aca":{"kind":"consolidated","name":"arts and cultural affairs law"},
    "acg":{"kind":"consolidated","name":"alternative county government law"},
    "adc":{"kind":"unconsolidated","name":"administrative code of the city of new york"},
    "agm":{"kind":"consolidated","name":"agriculture and markets law"},
    "bnk":{"kind":"consolidated","name":"banking law"},
    "bsc":{"kind":"consolidated","name":"business corporation law"},
    "bvo":{"kind":"consolidated","name":"benevolent orders law"},
    "cal":{"kind":"consolidated","name":"canal law"},
    "can":{"kind":"consolidated","name":"cannabis law"},
    "cca":{"kind":"unconsolidated","name":"new york city civil court act"},
    "cco":{"kind":"consolidated","name":"cooperative corporations law"},
    "cnt":{"kind":"consolidated","name":"county law"},
    "com":{"kind":"consolidated","name":"economic development law"},
    "cor":{"kind":"consolidated","name":"correction law"},
    "cpl":{"kind":"consolidated","name":"criminal procedure law"},
    "crc":{"kind":"unconsolidated","name":"new york city criminal court act"},
    "ctc":{"kind":"unconsolidated","name":"court of claims act"},
    "cvp":{"kind":"consolidated","name":"civil practice law and rules"},
    "cvr":{"kind":"consolidated","name":"civil rights law"},
    "cvs":{"kind":"consolidated","name":"civil service law"},
    "dcd":{"kind":"consolidated","name":"debtor and creditor law"},
    "dom":{"kind":"consolidated","name":"domestic relations law"},
    "edn":{"kind":"consolidated","name":"education law"},
    "edp":{"kind":"consolidated","name":"eminent domain procedure law"},
    "eld":{"kind":"consolidated","name":"elder law"},
    "eln":{"kind":"consolidated","name":"election law"},
    "eml":{"kind":"consolidated","name":"employers' liability law"},
    "eng":{"kind":"consolidated","name":"energy law"},
    "env":{"kind":"consolidated","name":"environmental conservation law"},
    "ept":{"kind":"consolidated","name":"estates, powers and trusts law"},
    "exc":{"kind":"consolidated","name":"executive law"},
    "fct":{"kind":"unconsolidated","name":"family court act"},
    "fis":{"kind":"consolidated","name":"financial services law"},
    "gas":{"kind":"consolidated","name":"general associations law"},
    "gbs":{"kind":"consolidated","name":"general business law"},
    "gcn":{"kind":"consolidated","name":"general construction law"},
    "gct":{"kind":"consolidated","name":"general city law"},
    "gmu":{"kind":"consolidated","name":"general municipal law"},
    "gob":{"kind":"consolidated","name":"general obligations law"},
    "hay":{"kind":"consolidated","name":"highway law"},
    "ind":{"kind":"consolidated","name":"indian law"},
    "isc":{"kind":"consolidated","name":"insurance law","subsections":true},
    "jud":{"kind":"consolidated","name":"judiciary law"},
    "lab":{"kind":"consolidated","name":"labor law"},
    "leg":{"kind":"consolidated","name":"legislative law"},
    "lfn":{"kind":"consolidated","name":"local finance law"},
    "lie":{"kind":"consolidated","name":"lien law"},
    "llc":{"kind":"consolidated","name":"limited liability company law"},
    "mdw":{"kind":"consolidated","name":"multiple dwelling law"},
    "mha":{"kind":"consolidated","name":"municipal housing authorities law"},
    "mhr":{"kind":"consolidated","name":"municipal home rule law"},
    "mhy":{"kind":"consolidated","name":"mental hygiene law"},
    "mil":{"kind":"consolidated","name":"military law"},
    "mre":{"kind":"consolidated","name":"multiple residence law"},
    "nav":{"kind":"consolidated","name":"navigation law"},
    "npc":{"kind":"consolidated","name":"not-for-profit corporation law"},
    "nyc":{"kind":"unconsolidated","name":"new york city charter"},
    "par":{"kind":"consolidated","name":"parks, recreation and historic preservation law"},
    "pba":{"kind":"consolidated","name":"public authorities law"},
    "pbb":{"kind":"consolidated","name":"public buildings law"},
    "pbg":{"kind":"consolidated","name":"public housing law"},
    "pbh":{"kind":"consolidated","name":"public health law"},
    "pbl":{"kind":"consolidated","name":"public lands law"},
    "pbo":{"kind":"consolidated","name":"public officers law"},
    "pbs":{"kind":"consolidated","name":"public service law"},
    "pen":{"kind":"consolidated","name":"penal law"},
    "pep":{"kind":"consolidated","name":"personal property law"},
    "pml":{"kind":"consolidated","name":"racing, pari-mutuel wagering and breeding law"},
    "ppd":{"kind":"consolidated","name":"new york state printing and public documents law"},
    "ptr":{"kind":"consolidated","name":"partnership law"},
    "pvh":{"kind":"consolidated","name":"private housing finance law"},
    "rat":{"kind":"consolidated","name":"rapid transit law"},
    "rco":{"kind":"consolidated","name":"religious corporations law"},
    "rel":{"kind":"consolidated","name":"rural electric cooperative law"},
    "rpa":{"kind":"consolidated","name":"real property actions and proceedings law"},
    "rpp":{"kind":"consolidated","name":"real property law"},
    "rpt":{"kind":"consolidated","name":"real property tax law"},
    "rrd":{"kind":"consolidated","name":"railroad law"},
    "rss":{"kind":"consolidated","name":"retirement and social security law"},
    "sap":{"kind":"consolidated","name":"state administrative procedure act"},
    "scc":{"kind":"consolidated","name":"second class cities law"},
    "scp":{"kind":"unconsolidated","name":"surrogate's court procedure act"},
    "slg":{"kind":"consolidated","name":"statute of local governments"},
    "sos":{"kind":"consolidated","name":"social services law"},
    "stf":{"kind":"consolidated","name":"state finance law"},
    "stl":{"kind":"consolidated","name":"state law"},
    "stt":{"kind":"consolidated","name":"state technology law"},
    "swc":{"kind":"consolidated","name":"soil and water conservation districts law"},
    "tax":{"kind":"consolidated","name":"tax law","subsections":true},
    "tcp":{"kind":"consolidated","name":"transportation corporations law"},
    "tra":{"kind":"consolidated","name":"transportation law"},
    "twn":{"kind":"consolidated","name":"town law"},
    "ucc":{"kind":"consolidated","name":"uniform commercial code"},
    "uct":{"kind":"unconsolidated","name":"uniform city court act"},
    "udc":{"kind":"unconsolidated","name":"uniform district court act"},
    "ujc":{"kind":"unconsolidated","name":"uniform justice court act"},
    "vat":{"kind":"consolidated","name":"vehicle and traffic law"},
    "vaw":{"kind":"consolidated","name":"volunteer ambulance workers' benefit law"},
    "vet":{"kind":"consolidated","name":"veterans' services law"},
    "vil":{"kind":"consolidated","name":"village law"},
    "vol":{"kind":"consolidated","name":"volunteer firefighters' benefit law"},
    "wkc":{"kind":"consolidated","name":"workers' compensation law"}
  };
  // The law's address: by ID from the table; otherwise from the Bank's own law type.
  function lawBase(id, info) {
    const k = String(id || (info && info.lawId) || '').toLowerCase();
    if (k === 'cns') return '/akn/us-ny/act/constitution/cns';
    if (LAWS[k]) return '/akn/us-ny/act/' + LAWS[k].kind + '/' + k;
    const type = String(info && info.lawType || '').toUpperCase();
    if (type === 'UNCONSOLIDATED' && BD.unconsolidatedChapter) {
      const ch = BD.unconsolidatedChapter(info);
      if (ch) return '/akn/us-ny/act/' + ch.year + '/' + ch.chapter;
    }
    return '/akn/us-ny/act/' + (type === 'CONSOLIDATED' || !type ? 'consolidated' : 'unconsolidated') + '/' + k;
  }
  const usesSubsections = id => !!(LAWS[String(id || '').toLowerCase()] || {}).subsections;
  Object.assign(BD, { LAWS, lawBase, usesSubsections });
  if (typeof module !== 'undefined') module.exports = BD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
