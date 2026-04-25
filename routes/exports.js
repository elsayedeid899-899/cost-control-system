const express = require('express');
const router = express.Router();
const { exportTableAsXlsx } = require('../services/reportExportService');

function sanitizeFileName(value) {
  return String(value || 'report')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'report';
}

function normalizeRows(value) {
  return Array.isArray(value)
    ? value.map((row) => (Array.isArray(row) ? row : []))
    : [];
}

router.post('/table.xlsx', async (req, res) => {
  const title = String(req.body.title || 'Report').trim();
  const subtitle = String(req.body.subtitle || '').trim();
  const fileName = sanitizeFileName(req.body.fileName || title || 'report');
  const sheetName = String(req.body.sheetName || title || 'Report').trim();
  const columns = Array.isArray(req.body.columns) ? req.body.columns : [];
  const rows = normalizeRows(req.body.rows);
  const summaryLines = normalizeRows(req.body.summaryLines);

  if (!columns.length && !rows.length) {
    return res.status(400).json({ error: 'لا توجد بيانات صالحة للتصدير' });
  }

  try {
    const workbookBuffer = await exportTableAsXlsx({
      title,
      subtitle,
      sheetName,
      columns,
      rows,
      summaryLines
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
    res.send(workbookBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
