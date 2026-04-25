const path = require('path');
const XLSX = require('xlsx');

const TEMPLATE_SHEET_NAME = 'SalesImportTemplate';
const TEMPLATE_HEADERS = [
  'invoice_ref',
  'branch_code',
  'invoice_type',
  'invoice_date',
  'payment_method',
  'beneficiary_name',
  'product_code',
  'quantity',
  'unit_price',
  'notes'
];

const TEMPLATE_FILE_PATH = path.join(
  __dirname,
  '../public/templates/sales-import-template.xlsx'
);

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function cleanCellValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).trim();
}

function isRowEmpty(values = []) {
  return values.every((value) => cleanCellValue(value) === '');
}

async function parseSalesImportWorkbook({ fileName, base64Content }) {
  try {
    const buffer = Buffer.from(String(base64Content || ''), 'base64');

    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true
    });

    const sheetName = workbook.SheetNames.includes(TEMPLATE_SHEET_NAME)
      ? TEMPLATE_SHEET_NAME
      : workbook.SheetNames[0];

    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      const error = new Error('ملف الاستيراد فارغ.');
      error.status = 400;
      throw error;
    }

    const values = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: ''
    });

    if (!values.length) {
      const error = new Error('ملف الاستيراد فارغ.');
      error.status = 400;
      throw error;
    }

    const headerRow = (values[0] || []).map(normalizeHeader);
    const missingHeaders = TEMPLATE_HEADERS.filter((header) => !headerRow.includes(header));

    if (missingHeaders.length) {
      const error = new Error(`القالب غير صحيح. الأعمدة الناقصة: ${missingHeaders.join(', ')}`);
      error.status = 400;
      throw error;
    }

    const headerMap = new Map();
    headerRow.forEach((header, index) => {
      headerMap.set(header, index);
    });

    const rows = values
      .slice(1)
      .map((rowValues, index) => ({
        row_number: index + 2,
        invoice_ref: cleanCellValue(rowValues[headerMap.get('invoice_ref')]),
        branch_code: cleanCellValue(rowValues[headerMap.get('branch_code')]),
        invoice_type: cleanCellValue(rowValues[headerMap.get('invoice_type')]),
        invoice_date: cleanCellValue(rowValues[headerMap.get('invoice_date')]),
        payment_method: cleanCellValue(rowValues[headerMap.get('payment_method')]),
        beneficiary_name: cleanCellValue(rowValues[headerMap.get('beneficiary_name')]),
        product_code: cleanCellValue(rowValues[headerMap.get('product_code')]),
        quantity: cleanCellValue(rowValues[headerMap.get('quantity')]),
        unit_price: cleanCellValue(rowValues[headerMap.get('unit_price')]),
        notes: cleanCellValue(rowValues[headerMap.get('notes')])
      }))
      .filter((row) => !isRowEmpty(Object.values(row).slice(1)));

    if (!rows.length) {
      const error = new Error('لا توجد صفوف بيانات داخل ملف الاستيراد.');
      error.status = 400;
      throw error;
    }

    return rows;
  } catch (err) {
    if (err.status) {
      throw err;
    }

    const parseError = new Error('تعذر قراءة ملف Excel. استخدم القالب المعتمد ثم أعد المحاولة.');
    parseError.status = 400;
    throw parseError;
  }
}

module.exports = {
  TEMPLATE_SHEET_NAME,
  TEMPLATE_HEADERS,
  TEMPLATE_FILE_PATH,
  parseSalesImportWorkbook
};
