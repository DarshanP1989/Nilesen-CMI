// DQ: HI — count=29, sheet index 1 starts '1-',
// headers: (Facts,Markets,Products), similarity check 66-100%,
// valid sections with 36+ months, validSections must equal headerRows
const { loadWorkbook, getSheet, countMonths, rowStrings, isEmptySheet, avgSimilarity } = require('./_shared');

module.exports = function validateHI(filePath, allFiles) {
  const errors = [];
  try {
    const xlsx = allFiles.filter(f => f.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length !== 29) errors.push(`File count: expected 29, found ${xlsx.length}`);

    const wb = loadWorkbook(filePath);
    if (wb.SheetNames.length < 2) { errors.push('File does not contain a second sheet'); return errors; }
    const rows = getSheet(wb, 1);
    if (!rows) { errors.push('Cannot read sheet 2'); return errors; }
    if (isEmptySheet(rows)) { errors.push('File is completely empty'); return errors; }

    const sheetName = wb.SheetNames[1];
    if (!sheetName.startsWith('1-')) errors.push(`Sheet name must start with '1-' (found: ${sheetName})`);

    const EXPECTED = ['Facts', 'Markets', 'Products'];
    let validSections = 0, headerRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const rv = rowStrings(rows[i], 3);
      const score = avgSimilarity(rv, EXPECTED);
      if (score >= 100) {
        headerRows++;
        const mc = countMonths(rows[i]);
        if (mc >= 36) validSections++;
      } else if (score >= 66) {
        errors.push(`Possible header typo in row ${i+1} (${Math.round(score)}% match) — check sheet`);
      }
    }
    if (headerRows === 0) errors.push('Headers not found (Facts, Markets, Products)');
    if (validSections === 0) errors.push('No sections found with 36+ month columns');
    else if (validSections !== headerRows) errors.push(`Valid sections (${validSections}) does not match header rows (${headerRows})`);
  } catch(e) { errors.push('DQ error: ' + e.message); }
  return errors;
};
