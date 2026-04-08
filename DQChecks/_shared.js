// Shared DQ utilities used by all category validators
const XLSX = require('xlsx');

function loadWorkbook(filePath) {
  return XLSX.readFile(filePath, { cellDates: false, sheetStubs: false });
}

function getSheet(wb, idx) {
  const sheet = wb.Sheets[wb.SheetNames[idx]];
  if (!sheet) return null;
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

function getSheetByName(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return null;
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

const MONTH_PATTERN = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2}\s*-\s*w\/e\s+\d{2}\/\d{2}\/\d{2}$/i;

function countMonths(row) {
  return row.filter(cell => cell && MONTH_PATTERN.test(String(cell).trim())).length;
}

function similarity(a, b) {
  a = String(a || '').toLowerCase().trim();
  b = String(b || '').toLowerCase().trim();
  if (a === b) return 100;
  if (!a || !b) return 0;
  let matches = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) matches++;
  }
  return Math.round((matches / len) * 100);
}

function avgSimilarity(rowVals, expected) {
  let total = 0;
  const n = Math.min(rowVals.length, expected.length);
  for (let i = 0; i < n; i++) total += similarity(rowVals[i], expected[i]);
  return n > 0 ? total / n : 0;
}

function rowStrings(row, n) {
  return row.slice(0, n).map(c => String(c || '').trim());
}

function isEmptySheet(rows) {
  return !rows.some(row => row.some(c => c !== null && String(c).trim() !== ''));
}

module.exports = { loadWorkbook, getSheet, getSheetByName, countMonths, similarity, avgSimilarity, rowStrings, isEmptySheet, MONTH_PATTERN };
