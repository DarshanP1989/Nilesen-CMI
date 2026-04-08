// DQ: Bodywash — count=1, sheet '1-', headers row 10 (Markets,Facts,BODY WASH,MANUFACTURER,BRAND,Products), 36+ months
const { loadWorkbook, getSheet, countMonths, rowStrings, isEmptySheet } = require('./_shared');

module.exports = function validateBodywash(filePath, allFiles) {
  const errors = [];
  try {
    const xlsx = allFiles.filter(f => f.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length !== 1) errors.push(`File count: expected 1, found ${xlsx.length}`);

    const wb = loadWorkbook(filePath);
    const rows = getSheet(wb, 0);
    if (!rows) { errors.push('Cannot read sheet 1'); return errors; }
    if (isEmptySheet(rows)) { errors.push('File is completely empty'); return errors; }

    const sheetName = wb.SheetNames[0];
    if (!sheetName.startsWith('1-')) errors.push(`Sheet name must start with '1-' (found: ${sheetName})`);

    const EXPECTED = ['Markets', 'Facts', 'BODY WASH', 'MANUFACTURER', 'BRAND', 'Products'];
    let headersRow = -1, monthCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const rv = rowStrings(rows[i], 6);
      if (rv.join('|') === EXPECTED.join('|')) {
        headersRow = i + 1;
        monthCount = countMonths(rows[i]);
        break;
      }
    }
    if (headersRow === -1) errors.push('Headers not found (Markets, Facts, BODY WASH, MANUFACTURER, BRAND, Products)');
    else if (headersRow !== 10) errors.push(`Headers must be on row 10 (found row ${headersRow})`);
    if (monthCount < 36) errors.push(`Month columns insufficient: ${monthCount} found, need 36+`);
  } catch(e) { errors.push('DQ error: ' + e.message); }
  return errors;
};
