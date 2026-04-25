const fs = require('fs/promises');
const path = require('path');
const { Workbook, SpreadsheetFile } = require('@oai/artifact-tool');
const {
  TEMPLATE_FILE_PATH,
  TEMPLATE_HEADERS,
  TEMPLATE_SHEET_NAME
} = require('../services/salesImportService');

const OUTPUT_DIR = path.dirname(TEMPLATE_FILE_PATH);

async function buildTemplateWorkbook() {
  const workbook = Workbook.create();
  const instructions = workbook.worksheets.add('Instructions');
  const template = workbook.worksheets.add(TEMPLATE_SHEET_NAME);

  instructions.getRange('A1:D1').merge();
  instructions.getRange('A1').values = [['Sales Import Template']];
  instructions.getRange('A1').format = {
    fill: '#243b53',
    font: { bold: true, color: '#FFFFFF', size: 14 },
    horizontalAlignment: 'center',
    verticalAlignment: 'center'
  };

  instructions.getRange('A3:B13').values = [
    ['Column', 'Description'],
    ['invoice_ref', 'Reference that groups rows into one invoice'],
    ['branch_code', 'Existing branch code مثل BR-001'],
    ['invoice_type', 'sale / hospitality / void'],
    ['invoice_date', 'YYYY-MM-DD'],
    ['payment_method', 'cash / bank / card / wallet / credit / other'],
    ['beneficiary_name', 'Required only for hospitality'],
    ['product_code', 'Existing product code مثل COF-001'],
    ['quantity', 'Sold quantity'],
    ['unit_price', 'Sale price per unit'],
    ['notes', 'Optional invoice note']
  ];
  instructions.getRange('A3:B3').format = {
    fill: '#4f46e5',
    font: { bold: true, color: '#FFFFFF' }
  };
  instructions.getRange('A3:B13').format.wrapText = true;
  instructions.getRange('A3:B13').format.autofitColumns();
  instructions.freezePanes.freezeRows(3);

  template.getRange('A1:J4').values = [
    TEMPLATE_HEADERS,
    ['INV-20260423-001', 'BR-001', 'sale', '2026-04-23', 'cash', '', 'COF-001', 2, 25, 'مثال بيع'],
    ['INV-20260423-001', 'BR-001', 'sale', '2026-04-23', 'cash', '', 'COF-002', 1, 35, 'مثال بيع'],
    ['INV-20260423-002', 'BR-002', 'hospitality', '2026-04-23', 'cash', 'ضيف الفرع', 'COF-001', 1, 0, 'مثال ضيافة']
  ];
  template.getRange('A1:J1').format = {
    fill: '#0f766e',
    font: { bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center'
  };
  template.getRange('A2:J4').format.wrapText = true;
  template.getRange('D2:D200').format.numberFormat = 'yyyy-mm-dd';
  template.getRange('H2:I200').format.numberFormat = '0.00';
  template.getRange('A1:J200').format.autofitColumns();
  template.freezePanes.freezeRows(1);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(TEMPLATE_FILE_PATH);
}

buildTemplateWorkbook().catch((error) => {
  console.error(error);
  process.exit(1);
});
