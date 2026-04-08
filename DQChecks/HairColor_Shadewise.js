// DQ: HairColor_Shadewise — count=1, sheet index 1 starts '1-',
// headers: (Markets,Facts,HAIR DYES (1/76),SEG_GCPL,MANUFACTURER,BRAND,SUBBRAND,COLOR_GCPL_2)
// valid sections with 36+ months, similarity check
const { loadWorkbook, getSheet, countMonths, rowStrings, isEmptySheet, avgSimilarity } = require('./_shared');

module.exports = function validateHairColor_Shadewise(filePath, allFiles) {
  const errors = [];
  try {
    const xlsx = allFiles.filter(f => f.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length !== 1) errors.push(`File count: expected 1, found ${xlsx.length}`);

    const wb = loadWorkbook(filePath);
    if (wb.SheetNames.length < 2) { errors.push('File does not contain a second sheet'); return errors; }
    const rows = getSheet(wb, 1);
    if (!rows) { errors.push('Cannot read sheet 2'); return errors; }
    if (isEmptySheet(rows)) { errors.push('File is completely empty'); return errors; }

    const sheetName = wb.SheetNames[1];
    if (!sheetName.startsWith('1-')) errors.push(`Sheet name must start with '1-' (found: ${sheetName})`);

    const EXPECTED = ['Markets', 'Facts', 'HAIR DYES (1/76)', 'SEG_GCPL', 'MANUFACTURER', 'BRAND', 'SUBBRAND', 'COLOR_GCPL_2'];
    let validSections = 0, headerRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const rv = rowStrings(rows[i], EXPECTED.length);
      const score = avgSimilarity(rv, EXPECTED);
      if (score >= 100) {
        headerRows++;
        const mc = countMonths(rows[i]);
        if (mc >= 36) validSections++;
      } else if (score >= 66) {
        errors.push(`Possible header typo in row ${i+1} (${Math.round(score)}% match)`);
      }
    }
    if (headerRows === 0) errors.push('Headers not found (Markets, Facts, HAIR DYES (1/76), SEG_GCPL...)');
    if (validSections === 0) errors.push('No sections found with 36+ month columns');
    else if (validSections !== headerRows) errors.push(`Valid sections (${validSections}) does not match header rows (${headerRows})`);
  } catch(e) { errors.push('DQ error: ' + e.message); }
  return errors;
};
