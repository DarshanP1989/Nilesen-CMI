// NPM Check: AirFreshener
const path = require('path');
const { loadSheet, extractMarketProduct } = require(path.join(__dirname, '_shared_npm'));

const CATEGORY    = 'AirFreshener';
const SHEET_IDX   = 0;
const HEADER_COLS = ['Facts', 'Markets', 'Products'];
const MARKET_COL  = 1;
const PRODUCT_COL = 2;  // null = markets only

module.exports = function checkNPM_AirFreshener(filePaths, masterLookup) {
  const errors = [];
  // Maps: stripped_key -> original_value (preserves original spacing for CSV output)
  const allMarkets  = new Map();
  const allProducts = new Map();

  for (const fp of filePaths) {
    try {
      const rows = loadSheet(fp, SHEET_IDX);
      if (!rows) { errors.push(`Cannot read sheet ${SHEET_IDX+1} in ${require('path').basename(fp)}`); continue; }
      const { markets, products } = extractMarketProduct(rows, HEADER_COLS, MARKET_COL, PRODUCT_COL);
      markets.forEach((orig, key) => allMarkets.set(key, orig));
      products.forEach((orig, key) => allProducts.set(key, orig));
    } catch(e) { errors.push(`Error reading ${require('path').basename(fp)}: ${e.message}`); }
  }

  const existingMarkets  = masterLookup.markets  || new Set();
  const existingProducts = masterLookup.products || new Set();

  // Filter new: key not in existing master (both space-stripped for comparison)
  const newMarketsOrig  = [...allMarkets.entries()]
    .filter(([key]) => !existingMarkets.has(key))
    .map(([, orig]) => orig);

  const newProductsOrig = PRODUCT_COL !== null
    ? [...allProducts.entries()].filter(([key]) => !existingProducts.has(key)).map(([, orig]) => orig)
    : [];

  // Format as rows ready for CSV download — matches state_master / product_master schema
  const newMarketRows = newMarketsOrig.map(m => ({
    Category: CATEGORY, Markets: m, State: '', U_R: '', Final_State_Mapping: ''
  }));

  const newProductRows = newProductsOrig.map(p => ({
    Category: CATEGORY, Products: p, Nielsen_segment_name: '', Brand: '', Segment: '', Final_brand_name: ''
  }));

  return {
    category: CATEGORY,
    newMarkets:  newMarketsOrig,   // plain strings for display
    newProducts: newProductsOrig,  // plain strings for display
    newMarketRows,                 // formatted rows for CSV download
    newProductRows,                // formatted rows for CSV download
    errors
  };
};
