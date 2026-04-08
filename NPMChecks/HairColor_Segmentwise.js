// NPM Check: HairColor_Segmentwise
// Special: iterates ALL sheets, derives Segment from sheet name
// New products compared as Products+Segment combo, Segment auto-filled in CSV
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'node_modules', 'xlsx'));
const { isFooter, clean } = require(path.join(__dirname, '_shared_npm'));

const CATEGORY = 'HairColor_Segmentwise';

function normalizeSegment(sheetName) {
  let s = sheetName.trim().replace(/^\d+-/, '');   // strip leading "1-"
  s = s.replace(/\s*-\s*\d+\s*/g, '');             // strip " - 1"
  s = s.replace(/\s*\d+\s*$/, '').trim();          // strip trailing digits
  if (s.toUpperCase() === 'POWDERS') s = 'Powders';
  return s;
}

module.exports = function checkNPM_HairColor_Segmentwise(filePaths, masterLookup) {
  const errors = [];
  const allMarkets = new Map();             // stripped -> original
  const allProductSegments = new Map();     // "product|||segment" -> { product, segment }

  for (const fp of filePaths) {
    try {
      const wb = XLSX.readFile(fp, { cellDates: false, sheetStubs: false });
      for (const sheetName of wb.SheetNames) {
        const segment = normalizeSegment(sheetName);
        const sheet   = wb.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });

        let headerFound = false;
        for (const row of rows) {
          if (!row || row.every(c => c === null || c === undefined)) continue;
          if (!headerFound) {
            const rv = row.slice(0,3).map(c => c ? String(c).trim().toUpperCase() : '');
            if (rv.join('|') === 'FACTS|MARKETS|PRODUCTS') { headerFound = true; continue; }
            continue;
          }
          const m = clean(row[1]);
          const p = clean(row[2]);
          if (m && !isFooter(m)) allMarkets.set(m.replace(/\s/g,''), m);
          if (p && !isFooter(p)) {
            const key = `${p.replace(/\s/g,'')}|||${segment.replace(/\s/g,'')}`;
            allProductSegments.set(key, { product: p, segment });
          }
        }
      }
    } catch(e) { errors.push(`Error reading ${path.basename(fp)}: ${e.message}`); }
  }

  const existingMarkets  = masterLookup.markets  || new Set();
  // For HairColor_Segmentwise, masterLookup.productSegments = Set of "product|||segment" keys
  const existingCombos   = masterLookup.productSegments || new Set();

  const newMarketsOrig = [...allMarkets.entries()].filter(([k]) => !existingMarkets.has(k)).map(([,v]) => v);
  const newProdSegs    = [...allProductSegments.entries()]
    .filter(([k]) => !existingCombos.has(k))
    .map(([,v]) => v);

  const newMarketRows  = newMarketsOrig.map(m => ({
    Category: CATEGORY, Markets: m, State: '', U_R: '', Final_State_Mapping: ''
  }));
  const newProductRows = newProdSegs.map(({ product, segment }) => ({
    Category: CATEGORY, Products: product, Nielsen_segment_name: '', Brand: '', Segment: segment, Final_brand_name: ''
  }));

  return {
    category: CATEGORY,
    newMarkets:  newMarketsOrig,
    newProducts: newProdSegs.map(x => `${x.product} [${x.segment}]`), // display string
    newMarketRows, newProductRows, errors
  };
};
