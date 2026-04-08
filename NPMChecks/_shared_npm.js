// Shared NPM check utilities
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'node_modules', 'xlsx'));

const FOOTER_PATTERNS = [
  'Copyright', 'Dataset:', 'Exported:', 'Terms & Conditions',
  'NielsenIQ', 'GODREJ CONSUMER PRODUCTS LIMITED'
];

function loadSheet(filePath, sheetIdx) {
  // raw:true = skip cell formatting = 10x faster
  // dense:true = faster array access
  // cellDates:false, cellNF:false = skip date/number parsing
  const wb = XLSX.readFile(filePath, {
    raw: true,
    dense: true,
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    cellFormula: false,
    sheetStubs: false
  });
  if (sheetIdx >= wb.SheetNames.length) return null;
  const sheet = wb.Sheets[wb.SheetNames[sheetIdx]];
  if (!sheet) return null;
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,       // skip formatting
    blankrows: false // skip blank rows automatically
  });
}

function loadAllSheets(filePath) {
  const wb = XLSX.readFile(filePath, {
    raw: true, dense: true,
    cellDates: false, cellNF: false, cellStyles: false, cellFormula: false
  });
  return wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, defval:null, raw:true, blankrows:false })
  }));
}

function isFooter(val) {
  if (!val) return false;
  const s = String(val);
  return FOOTER_PATTERNS.some(p => s.includes(p));
}

function clean(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return (s === '' || s.toLowerCase() === 'nan' || s === 'undefined') ? null : s;
}

function extractMarketProduct(rows, headerCols, marketColIdx, productColIdx) {
  const markets  = new Map();
  const products = new Map();
  let headerFound = false;
  const hUpper = headerCols.map(h => h.toUpperCase());

  for (const row of rows) {
    if (!row || row.length === 0) continue;

    if (!headerFound) {
      const rv = row.slice(0, hUpper.length).map(c => c != null ? String(c).trim().toUpperCase() : '');
      if (rv.join('|') === hUpper.join('|')) { headerFound = true; continue; }
      continue;
    }

    const m = clean(row[marketColIdx]);
    const p = productColIdx !== null ? clean(row[productColIdx]) : null;

    if (m && !isFooter(m)) markets.set(m.replace(/\s/g, ''), m);
    if (p && !isFooter(p)) products.set(p.replace(/\s/g, ''), p);
  }
  return { markets, products };
}

module.exports = { loadSheet, loadAllSheets, extractMarketProduct, clean, isFooter };
