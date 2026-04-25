const path = require('path');
const { pathToFileURL } = require('url');

const ARTIFACT_TOOL_ENTRY = path.join(
  'C:',
  'Users',
  'MTM',
  '.cache',
  'codex-runtimes',
  'codex-primary-runtime',
  'dependencies',
  'node',
  'node_modules',
  '@oai',
  'artifact-tool',
  'dist',
  'artifact_tool.mjs'
);

const EXCEL_THEME = {
  primary: '#1F2A1F',
  primarySoft: '#EEF4EA',
  accent: '#C7A55B',
  accentSoft: '#F7EBCF',
  border: '#B5C3A8',
  text: '#1F2937',
  textMuted: '#4B5563',
  white: '#FFFFFF',
  zebra: '#F8FBF6'
};

function sanitizeWorksheetName(value) {
  return (
    String(value || 'Report')
      .replace(/[\\/*?:[\]]/g, ' ')
      .trim()
      .slice(0, 31) || 'Report'
  );
}

function excelColumnName(columnIndex) {
  let index = Number(columnIndex) + 1;
  let result = '';

  while (index > 0) {
    const remainder = (index - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    index = Math.floor((index - 1) / 26);
  }

  return result;
}

function normalizeScalar(value) {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return String(value);
}

function formatGeneratedAt() {
  return new Intl.DateTimeFormat('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date());
}

function buildLayout({ title, subtitle, columns, rows, summaryLines }) {
  const normalizedColumns = Array.isArray(columns) ? columns.map((value) => String(value || '')) : [];
  const normalizedRows = Array.isArray(rows)
    ? rows.map((row) => (Array.isArray(row) ? row.map(normalizeScalar) : []))
    : [];
  const normalizedSummaryLines = Array.isArray(summaryLines)
    ? summaryLines
        .map((line) => (Array.isArray(line) ? line : [line]))
        .map((line) => line.map(normalizeScalar))
    : [];

  const maxColumns = Math.max(
    normalizedColumns.length,
    ...normalizedRows.map((row) => row.length),
    ...normalizedSummaryLines.map((row) => row.length),
    2
  );

  const fillRow = (row) => [...row, ...Array.from({ length: maxColumns - row.length }, () => '')];
  const matrix = [];
  const rowsMeta = {};

  rowsMeta.title = matrix.length + 1;
  matrix.push(fillRow([normalizeScalar(title || 'تقرير النظام')]));

  rowsMeta.subtitle = matrix.length + 1;
  matrix.push(fillRow([normalizeScalar(subtitle || '')]));

  rowsMeta.meta = matrix.length + 1;
  matrix.push(fillRow(['تاريخ التصدير', formatGeneratedAt()]));

  matrix.push(fillRow([]));

  rowsMeta.header = matrix.length + 1;
  matrix.push(fillRow(normalizedColumns.length ? normalizedColumns : ['البيان']));

  rowsMeta.dataStart = matrix.length + 1;
  if (normalizedRows.length) {
    normalizedRows.forEach((row) => matrix.push(fillRow(row)));
  } else {
    matrix.push(fillRow(['لا توجد بيانات متاحة']));
  }
  rowsMeta.dataEnd = matrix.length;

  if (normalizedSummaryLines.length) {
    matrix.push(fillRow([]));
    rowsMeta.summaryTitle = matrix.length + 1;
    matrix.push(fillRow(['ملخص التقرير']));
    rowsMeta.summaryStart = matrix.length + 1;
    normalizedSummaryLines.forEach((row) => matrix.push(fillRow(row)));
    rowsMeta.summaryEnd = matrix.length;
  } else {
    rowsMeta.summaryTitle = null;
    rowsMeta.summaryStart = null;
    rowsMeta.summaryEnd = null;
  }

  matrix.push(fillRow([]));
  rowsMeta.footer = matrix.length + 1;
  matrix.push(fillRow(['إعداد وتطوير النظام', 'Elsayed Eid', '01025454555']));

  return {
    matrix,
    maxColumns,
    rowsMeta
  };
}

async function loadArtifactTool() {
  return import(pathToFileURL(ARTIFACT_TOOL_ENTRY).href);
}

function setRangeBorder(range, color = EXCEL_THEME.border) {
  range.format.borders.setPreset('All');
  ['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].forEach((edge) => {
    if (range.format.borders[edge]) {
      range.format.borders[edge].style = 'Continuous';
      range.format.borders[edge].color = color;
    }
  });
}

function styleMergedBanner(range, options) {
  range.merge();
  range.format.fill.color = options.fill;
  range.format.font.color = options.fontColor || EXCEL_THEME.white;
  range.format.font.bold = true;
  range.format.font.size = options.fontSize || 16;
  range.format.horizontalAlignment = 'Center';
  range.format.verticalAlignment = 'Center';
  range.format.wrapText = true;
  if (options.rowHeight) {
    range.format.rowHeight = options.rowHeight;
  }
}

async function exportTableAsXlsx({ title, subtitle, sheetName, columns, rows, summaryLines }) {
  const { Workbook, SpreadsheetFile } = await loadArtifactTool();
  const workbook = Workbook.create();
  const worksheet = workbook.worksheets.add(sanitizeWorksheetName(sheetName || title || 'Report'));
  const { matrix, maxColumns, rowsMeta } = buildLayout({
    title,
    subtitle,
    columns,
    rows,
    summaryLines
  });
  const lastColumn = excelColumnName(maxColumns - 1);
  const lastCell = `${lastColumn}${matrix.length}`;
  const usedRangeAddress = `A1:${lastCell}`;

  worksheet.showGridLines = false;
  worksheet.defaultRowHeight = 22;
  worksheet.tabColor = EXCEL_THEME.accent;
  worksheet.getRange(usedRangeAddress).values = matrix;

  styleMergedBanner(worksheet.getRange(`A${rowsMeta.title}:${lastColumn}${rowsMeta.title}`), {
    fill: EXCEL_THEME.primary,
    fontColor: EXCEL_THEME.white,
    fontSize: 18,
    rowHeight: 30
  });

  styleMergedBanner(worksheet.getRange(`A${rowsMeta.subtitle}:${lastColumn}${rowsMeta.subtitle}`), {
    fill: EXCEL_THEME.primarySoft,
    fontColor: EXCEL_THEME.text,
    fontSize: 12,
    rowHeight: 24
  });

  const metaRange = worksheet.getRange(`A${rowsMeta.meta}:B${rowsMeta.meta}`);
  metaRange.format.fill.color = EXCEL_THEME.accentSoft;
  metaRange.format.font.bold = true;
  metaRange.format.font.color = EXCEL_THEME.text;
  metaRange.format.horizontalAlignment = 'Center';
  metaRange.format.verticalAlignment = 'Center';
  setRangeBorder(metaRange);

  const headerRange = worksheet.getRange(`A${rowsMeta.header}:${lastColumn}${rowsMeta.header}`);
  headerRange.format.fill.color = EXCEL_THEME.accent;
  headerRange.format.font.bold = true;
  headerRange.format.font.color = EXCEL_THEME.text;
  headerRange.format.horizontalAlignment = 'Center';
  headerRange.format.verticalAlignment = 'Center';
  headerRange.format.wrapText = true;
  headerRange.format.rowHeight = 24;
  setRangeBorder(headerRange);

  for (let rowIndex = rowsMeta.dataStart; rowIndex <= rowsMeta.dataEnd; rowIndex += 1) {
    const rowRange = worksheet.getRange(`A${rowIndex}:${lastColumn}${rowIndex}`);
    rowRange.format.fill.color =
      rowIndex % 2 === rowsMeta.dataStart % 2 ? EXCEL_THEME.white : EXCEL_THEME.zebra;
    rowRange.format.font.color = EXCEL_THEME.text;
    rowRange.format.horizontalAlignment = 'Center';
    rowRange.format.verticalAlignment = 'Center';
    rowRange.format.wrapText = true;
    setRangeBorder(rowRange);
  }

  if (rowsMeta.summaryTitle) {
    styleMergedBanner(
      worksheet.getRange(`A${rowsMeta.summaryTitle}:${lastColumn}${rowsMeta.summaryTitle}`),
      {
        fill: EXCEL_THEME.primary,
        fontColor: EXCEL_THEME.white,
        fontSize: 13,
        rowHeight: 24
      }
    );

    for (let rowIndex = rowsMeta.summaryStart; rowIndex <= rowsMeta.summaryEnd; rowIndex += 1) {
      const rowRange = worksheet.getRange(`A${rowIndex}:${lastColumn}${rowIndex}`);
      rowRange.format.fill.color = EXCEL_THEME.primarySoft;
      rowRange.format.font.color = EXCEL_THEME.textMuted;
      rowRange.format.font.bold = true;
      rowRange.format.horizontalAlignment = 'Center';
      rowRange.format.verticalAlignment = 'Center';
      rowRange.format.wrapText = true;
      setRangeBorder(rowRange);
    }
  }

  const footerRange = worksheet.getRange(`A${rowsMeta.footer}:${lastColumn}${rowsMeta.footer}`);
  footerRange.format.fill.color = EXCEL_THEME.accentSoft;
  footerRange.format.font.color = EXCEL_THEME.textMuted;
  footerRange.format.font.bold = true;
  footerRange.format.horizontalAlignment = 'Center';
  footerRange.format.verticalAlignment = 'Center';
  footerRange.format.wrapText = true;
  setRangeBorder(footerRange);

  worksheet.getRange(usedRangeAddress).format.autofitColumns();
  worksheet.getRange(`A1:${lastColumn}${matrix.length}`).format.autofitRows();

  const output = await SpreadsheetFile.exportXlsx(workbook);
  return Buffer.from(output.data);
}

module.exports = {
  exportTableAsXlsx
};
