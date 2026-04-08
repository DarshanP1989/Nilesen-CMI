// NPM Check: Deos
// Special: extracts BRAND column (col 3), compares against product_master.Brand
// masterLookup.products should be the Brand values from product_master WHERE Category='Deos'
const path = require('path');
const { loadSheet, isFooter, clean } = require(path.join(__dirname, '_shared_npm'));

const CATEGORY = 'Deos';

module.exports = function checkNPM_Deos(filePaths, masterLookup) {
  const errors = [];
  const allMarkets = new Map();  // stripped -> original
  const allBrands  = new Map();  // stripped -> original

  const HEADERS1 = ['MARKETS','FACTS','SUBSEGMENT','BRAND'];
  const HEADERS2 = ['MARKETS','FACTS','FRAGRANCE - DEODORANT','BRAND'];

  for (const fp of filePaths) {
    try {
      const rows = loadSheet(fp, 1); // sheet index 1
      if (!rows) { errors.push(`Cannot read sheet 2 in ${path.basename(fp)}`); continue; }

      let headerFound = false;
      for (const row of rows) {
        if (!row || row.every(c => c === null || c === undefined)) { headerFound = false; continue; }
        if (!headerFound) {
          const rv = row.slice(0,4).map(c => c ? String(c).trim().toUpperCase() : '');
          if (rv.join('|') === HEADERS1.join('|') || rv.join('|') === HEADERS2.join('|')) {
            headerFound = true; continue;
          }
          continue;
        }
        const m = clean(row[0]);
        const b = clean(row[3]);
        if (m && !isFooter(m) && m.toLowerCase() !== 'markets') allMarkets.set(m.replace(/\s/g,''), m);
        if (b && !isFooter(b) && b.toLowerCase() !== 'brand')   allBrands.set(b.replace(/\s/g,''), b);
      }
    } catch(e) { errors.push(`Error reading ${path.basename(fp)}: ${e.message}`); }
  }

  const existingMarkets  = masterLookup.markets  || new Set();
  const existingProducts = masterLookup.products || new Set(); // for Deos this is Brand values

  const newMarketsOrig = [...allMarkets.entries()].filter(([k]) => !existingMarkets.has(k)).map(([,v]) => v);
  const newBrandsOrig  = [...allBrands.entries()].filter(([k]) => !existingProducts.has(k)).map(([,v]) => v);

  // Deos: new_products.csv has Products = brand, Brand = brand (same value in both)
  const newMarketRows = newMarketsOrig.map(m => ({
    Category: CATEGORY, Markets: m, State: '', U_R: '', Final_State_Mapping: ''
  }));
  const newProductRows = newBrandsOrig.map(b => ({
    Category: CATEGORY, Products: b, Nielsen_segment_name: '', Brand: b, Segment: '', Final_brand_name: ''
  }));

  return { category: CATEGORY, newMarkets: newMarketsOrig, newProducts: newBrandsOrig, newMarketRows, newProductRows, errors };
};
