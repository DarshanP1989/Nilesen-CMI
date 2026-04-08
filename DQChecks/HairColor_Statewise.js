// DQ: HairColor_Statewise — count=6, finds sheet named exactly '1-HC_RMS 1',
// headers: (Markets,Facts,Products), valid sections with 36+ months, similarity check
const { loadWorkbook, getSheetByName, countMonths, rowStrings, isEmptySheet, avgSimilarity } = require('./_shared');

module.exports = function validateHairColor_Statewise(filePath, allFiles) {
  const errors = [];
  try {
    const xlsx = allFiles.filter(f => f.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length !== 6) errors.push(`File count: expected 6, found ${xlsx.length}`);

    const wb = loadWorkbook(filePath);
    const TARGET_SHEET = '1-HC_RMS 1';
    const rows = getSheetByName(wb, TARGET_SHEET);
    if (!rows) {
      errors.push(`Sheet named '${TARGET_SHEET}' not found — check sheet names`);
      return errors;
    }
    if (isEmptySheet(rows)) { errors.push('File is completely empty'); return errors; }

    const EXPECTED = ['Markets', 'Facts', 'Products'];
    let validSections = 0, headerRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const rv = rowStrings(rows[i], 3);
      const score = avgSimilarity(rv, EXPECTED);
      if (score >= 100) {
        headerRows++;
        const mc = countMonths(rows[i]);
        if (mc >= 36) validSections++;
      } else if (score >= 66) {
        errors.push(`Possible header typo in row ${i+1} (${Math.round(score)}% match)`);
      }
    }
    if (headerRows === 0) errors.push('Headers not found (Markets, Facts, Products)');
    if (validSections === 0) errors.push('No sections found with 36+ month columns');
    else if (validSections !== headerRows) errors.push(`Valid sections (${validSections}) does not match header rows (${headerRows})`);
  } catch(e) { errors.push('DQ error: ' + e.message); }
  return errors;
};
