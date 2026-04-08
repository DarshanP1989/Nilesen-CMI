// DQ: Soaps_Statewise — converted from Soaps_Statewise.py
// Checks: count=1, sheet index 1 starts '1-',
// headers (similarity>=66%), valid sections with 36+ months
const { loadWorkbook, getSheet, countMonths, rowStrings, isEmptySheet, avgSimilarity } = require('./_shared');

module.exports = function validateSoaps_Statewise(filePath, allFiles) {
  const errors = [];
  try {
    const xlsx = allFiles.filter(f => f.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length !== 1) errors.push(`File count: expected 1, found ${xlsx.length}`);

    const wb = loadWorkbook(filePath);
    if (wb.SheetNames.length < 2) {
      errors.push('File does not contain a second sheet');
      return errors;
    }
    const rows = getSheet(wb, 1);
    if (!rows) { errors.push('Cannot read sheet 2'); return errors; }
    if (isEmptySheet(rows)) { errors.push('File is completely empty'); return errors; }

    const sheetName = wb.SheetNames[1];
    if (!sheetName.startsWith('1-')) errors.push(`Sheet name must start with '1-' (found: ${sheetName})`);

    const EXPECTED = ['Markets', 'Facts', 'Products'];
    let validSections = 0;
    let headerRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const rv = rowStrings(rows[i], EXPECTED.length);
      const score = avgSimilarity(rv, EXPECTED);
      if (score >= 100) {
        // Exact match
        headerRows++;
        const mc = countMonths(rows[i]);
        if (mc >= 36) validSections++;
      } else if (score >= 66) {
        // Possible typo in header
        errors.push(`Possible header typo in row ${i+1} (${Math.round(score)}% match) — check sheet`);
      }
    }

    if (headerRows === 0) errors.push('Headers not found (Markets, Facts, Products)');
    if (validSections === 0) errors.push('No sections found with 36+ month columns');
    else if (validSections !== headerRows) errors.push(`Valid sections (${validSections}) does not match header rows (${headerRows})`);
  } catch(e) { errors.push('DQ error: ' + e.message); }
  return errors;
};
