// DQ: HairColor_Segmentwise — count=7, sheet '1-', headers row 10 (Facts,Markets,Products), 36+ months
const { loadWorkbook, getSheet, countMonths, rowStrings, isEmptySheet } = require('./_shared');

module.exports = function validateHairColor_Segmentwise(filePath, allFiles) {
  const errors = [];
  try {
    const xlsx = allFiles.filter(f => f.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length !== 7) errors.push(`File count: expected 7, found ${xlsx.length}`);

    const wb = loadWorkbook(filePath);
    const rows = getSheet(wb, 0);
    if (!rows) { errors.push('Cannot read sheet 1'); return errors; }
    if (isEmptySheet(rows)) { errors.push('File is completely empty'); return errors; }

    const sheetName = wb.SheetNames[0];
    if (!sheetName.startsWith('1-')) errors.push(`Sheet name must start with '1-' (found: ${sheetName})`);

    let headersRow = -1, monthCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const rv = rowStrings(rows[i], 3);
      if (rv[0] === 'Facts' && rv[1] === 'Markets' && rv[2] === 'Products') {
        headersRow = i + 1;
        monthCount = countMonths(rows[i]);
        break;
      }
    }
    if (headersRow === -1) errors.push('Headers not found (Facts, Markets, Products)');
    else if (headersRow !== 10) errors.push(`Headers must be on row 10 (found row ${headersRow})`);
    if (monthCount < 36) errors.push(`Month columns insufficient: ${monthCount} found, need 36+`);
  } catch(e) { errors.push('DQ error: ' + e.message); }
  return errors;
};
