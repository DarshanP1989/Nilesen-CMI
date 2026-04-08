// DQ: Deos — count=4, sheet index 1 starts '1-',
// headers: (Markets,Facts,SUBSEGMENT,BRAND) OR (Markets,Facts,FRAGRANCE - DEODORANT,BRAND)
// valid sections with 36+ months, similarity check
const { loadWorkbook, getSheet, countMonths, rowStrings, isEmptySheet, avgSimilarity } = require('./_shared');

module.exports = function validateDeos(filePath, allFiles) {
  const errors = [];
  try {
    const xlsx = allFiles.filter(f => f.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length !== 4) errors.push(`File count: expected 4, found ${xlsx.length}`);

    const wb = loadWorkbook(filePath);
    if (wb.SheetNames.length < 2) { errors.push('File does not contain a second sheet'); return errors; }
    const rows = getSheet(wb, 1);
    if (!rows) { errors.push('Cannot read sheet 2'); return errors; }
    if (isEmptySheet(rows)) { errors.push('File is completely empty'); return errors; }

    const sheetName = wb.SheetNames[1];
    if (!sheetName.startsWith('1-')) errors.push(`Sheet name must start with '1-' (found: ${sheetName})`);

    const EXPECTED1 = ['Markets', 'Facts', 'SUBSEGMENT', 'BRAND'];
    const EXPECTED2 = ['Markets', 'Facts', 'FRAGRANCE - DEODORANT', 'BRAND'];
    let validSections = 0, headerRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const rv = rowStrings(rows[i], 4);
      const s1 = avgSimilarity(rv, EXPECTED1);
      const s2 = avgSimilarity(rv, EXPECTED2);
      const score = Math.max(s1, s2);
      if (score >= 100) {
        headerRows++;
        const mc = countMonths(rows[i]);
        if (mc >= 36) validSections++;
      } else if (score >= 66) {
        errors.push(`Possible header typo in row ${i+1} (${Math.round(score)}% match)`);
      }
    }
    if (headerRows === 0) errors.push('Headers not found (Markets, Facts, SUBSEGMENT/FRAGRANCE, BRAND)');
    if (validSections === 0) errors.push('No sections found with 36+ month columns');
    else if (validSections !== headerRows) errors.push(`Valid sections (${validSections}) does not match header rows (${headerRows})`);
  } catch(e) { errors.push('DQ error: ' + e.message); }
  return errors;
};
