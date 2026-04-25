(() => {
  const SETTINGS_STORAGE_KEY = 'costControlAppSettings';
  const CONTENT_SELECTOR = '.page-content';
  const TOOLBAR_HOST_SELECTOR = '#pageHeaderReportActions';
  const ACTION_HEADER_PATTERNS = [
    'إجراء',
    'إجراءات',
    'action',
    'actions',
    'operation',
    'operations'
  ];
  const SYSTEM_BRAND = 'COST CONTROL SYSTEM';
  const SYSTEM_NAME = 'منصة رقابة تشغيلية ومالية للفروع';
  const DEVELOPER_NAME = 'Elsayed Eid';
  const DEVELOPER_PHONE = '01025454555';

  let toolbarState = {
    tableEntries: [],
    selectedTableId: null
  };
  let toolbarObserver = null;
  let refreshQueued = false;
  let lastRenderSignature = '';

  function sanitizeFileName(value) {
    return String(value || 'report')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };

      return map[char] || char;
    });
  }

  function formatPrintTimestamp() {
    try {
      return new Intl.DateTimeFormat('ar-EG', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date());
    } catch (err) {
      return new Date().toLocaleString();
    }
  }

  function getPageTitle() {
    return document.querySelector('.page-title')?.textContent?.trim() || document.title || 'Report';
  }

  function getPdfOrientation() {
    try {
      const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const parsed = rawValue ? JSON.parse(rawValue) : null;
      return parsed?.reports?.pdfOrientation === 'portrait' ? 'portrait' : 'landscape';
    } catch (err) {
      return 'landscape';
    }
  }

  function isActionHeader(text) {
    const normalized = normalizeText(text);
    return ACTION_HEADER_PATTERNS.some((pattern) => normalized.includes(pattern));
  }

  function getTableCells(row) {
    return Array.from(row.children || []).filter((cell) => {
      return cell.tagName === 'TH' || cell.tagName === 'TD';
    });
  }

  function stripActionColumns(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');

    if (!headerRow) {
      return;
    }

    const actionIndexes = getTableCells(headerRow)
      .map((cell, index) => ({ index, text: cell.textContent.trim() }))
      .filter((entry) => isActionHeader(entry.text))
      .map((entry) => entry.index);

    if (!actionIndexes.length) {
      return;
    }

    table.querySelectorAll('tr').forEach((row) => {
      const cells = getTableCells(row);

      actionIndexes
        .slice()
        .sort((left, right) => right - left)
        .forEach((index) => {
          if (cells[index]) {
            cells[index].remove();
          }
        });
    });
  }

  function stripInteractiveElements(root) {
    root
      .querySelectorAll(
        '.list-table-actions, .report-toolbar, .modal-print-button, [data-print-ignore="true"]'
      )
      .forEach((node) => node.remove());

    root.querySelectorAll('button').forEach((button) => button.remove());
    root.querySelectorAll('input, select, textarea').forEach((field) => field.remove());
    root.querySelectorAll('[onclick]').forEach((node) => node.removeAttribute('onclick'));
  }

  function cloneTableForPrint(table) {
    const clonedTable = table.cloneNode(true);
    stripActionColumns(clonedTable);
    stripInteractiveElements(clonedTable);
    return clonedTable;
  }

  function getVisibleTables() {
    const tables = Array.from(document.querySelectorAll('.page-content table')).filter((table) => {
      if (!table.tHead && !table.tBodies?.length) {
        return false;
      }

      if (table.closest('.modal') && !table.closest('.modal.open')) {
        return false;
      }

      const tableRows = table.querySelectorAll('tbody tr').length;
      const headers = table.querySelectorAll('thead th').length;

      return tableRows > 0 || headers > 0;
    });

    return tables.map((table, index) => {
      const card = table.closest('.card, .modal-card') || document.body;
      const heading = card.querySelector('h1, h2, h3');
      const summaryNodes = Array.from(card.querySelectorAll('.summary, .total'));
      const tableId = table.dataset.exportId || `table-${index + 1}`;

      table.dataset.exportId = tableId;

      return {
        id: tableId,
        table,
        title: heading?.textContent?.trim() || `جدول ${index + 1}`,
        summaryLines: summaryNodes
          .map((node) => node.textContent.trim())
          .filter(Boolean)
          .map((line) => [line])
      };
    });
  }

  function extractTablePayload(tableEntry) {
    const printableTable = cloneTableForPrint(tableEntry.table);
    const headerCells = Array.from(printableTable.querySelectorAll('thead th')).map((cell) =>
      cell.textContent.trim()
    );
    const bodyRows = Array.from(printableTable.querySelectorAll('tbody tr')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent.trim())
    );

    return {
      title: tableEntry.title,
      subtitle: getPageTitle(),
      fileName: sanitizeFileName(`${getPageTitle()} - ${tableEntry.title}`),
      sheetName: sanitizeFileName(tableEntry.title).slice(0, 31) || 'Report',
      columns: headerCells,
      rows: bodyRows,
      summaryLines: tableEntry.summaryLines
    };
  }

  async function exportExcel() {
    const selectedEntry = toolbarState.tableEntries.find(
      (entry) => entry.id === toolbarState.selectedTableId
    );

    if (!selectedEntry) {
      window.alert('لا توجد بيانات جاهزة للتصدير الآن.');
      return;
    }

    const response = await fetch('/api/exports/table.xlsx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(extractTablePayload(selectedEntry))
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      window.alert(result.error || 'تعذر تصدير التقرير إلى Excel');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFileName(selectedEntry.title) || 'report'}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function buildSummaryCardsHtml(summaryLines) {
    if (!summaryLines.length) {
      return '';
    }

    return `
      <div class="summary-grid">
        ${summaryLines
          .map(
            (line) => `
              <div class="summary-item">
                <strong>ملخص</strong>
                <span>${escapeHtml(line.map((value) => String(value)).join(' '))}</span>
              </div>
            `
          )
          .join('')}
      </div>
    `;
  }

  function openPrintWindow({ title, subtitle, bodyHtml, pageOrientation }) {
    const printWindow = window.open('', '_blank', 'width=1280,height=900');

    if (!printWindow) {
      window.alert('تعذر فتح نافذة الطباعة. تأكد من السماح بالنوافذ المنبثقة.');
      return;
    }

    const safeTitle = escapeHtml(title);
    const safeSubtitle = escapeHtml(subtitle);
    const safePrintedAt = escapeHtml(formatPrintTimestamp());
    const safeSystemBrand = escapeHtml(SYSTEM_BRAND);
    const safeSystemName = escapeHtml(SYSTEM_NAME);

    printWindow.document.write(`
      <!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8" />
          <title>${safeSystemBrand}</title>
          <style>
            :root {
              color-scheme: light;
              --print-primary: #1f2a1f;
              --print-primary-soft: #eef4ea;
              --print-accent: #c7a55b;
              --print-accent-soft: #f6ecd4;
              --print-border: #b7c3aa;
              --print-text: #1f2937;
              --print-text-muted: #4b5563;
              --print-white: #ffffff;
            }
            html,
            body {
              margin: 0;
              padding: 0;
              font-family: 'Segoe UI', Tahoma, sans-serif;
              color: var(--print-text);
              background: #f5f6f2;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            body {
              padding: 2px;
            }
            .print-page {
              background: var(--print-white);
              border: 1px solid rgba(31, 42, 31, 0.12);
              border-radius: 6px;
              overflow: hidden;
              width: 100%;
              box-shadow: 0 2px 10px rgba(15, 23, 42, 0.06);
            }
            .print-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 6px;
              padding: 4px 6px;
              background: linear-gradient(135deg, var(--print-primary) 0%, #2d4130 100%);
              color: var(--print-white);
            }
            .print-brand {
              display: flex;
              align-items: center;
              justify-content: flex-start;
              gap: 8px;
              min-width: 0;
              flex: 1;
            }
            .print-brand-copy {
              min-width: 0;
              display: grid;
              gap: 1px;
              text-align: right;
            }
            .print-brand-tag {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 1px 5px;
              margin-bottom: 0;
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.12);
              border: 1px solid rgba(255, 255, 255, 0.18);
              font-size: 7px;
              letter-spacing: 0.3px;
              font-weight: 700;
              white-space: nowrap;
            }
            .print-brand h1 {
              margin: 0;
              font-size: 11px;
              line-height: 1.05;
            }
            .print-brand .subtitle {
              margin: 0;
              font-size: 7px;
              color: rgba(255, 255, 255, 0.85);
            }
            .print-meta {
              display: flex;
              align-items: center;
              gap: 3px;
              padding: 0;
              flex-wrap: wrap;
              justify-content: flex-end;
              min-width: 0;
            }
            .print-meta-item strong {
              display: inline;
              margin-bottom: 0;
              color: var(--print-accent);
              font-size: 7px;
            }
            .print-meta-item span {
              display: inline;
              font-size: 7px;
              color: var(--print-white);
            }
            .print-meta-item {
              display: inline-flex;
              align-items: center;
              gap: 3px;
              white-space: nowrap;
              padding: 2px 4px;
              border-radius: 6px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.12);
            }
            .print-content {
              padding: 4px 4px 3px;
            }
            .summary-grid,
            .detail-strip,
            .modal-grid,
            .details-grid,
            .invoice-summary-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
              gap: 4px;
              margin-bottom: 4px;
            }
            .summary-item,
            .detail-chip,
            .modal-card,
            .card,
            .detail-card,
            .stat-card,
            .summary-card {
              border: 1px solid var(--print-border);
              border-radius: 6px;
              padding: 4px 5px;
              background: var(--print-primary-soft);
            }
            .summary-item strong,
            .detail-chip strong {
              display: block;
              margin-bottom: 3px;
              color: var(--print-primary);
              font-size: 8px;
            }
            .summary-item span,
            .detail-chip span {
              color: var(--print-text-muted);
              font-size: 8px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 3px;
              overflow: hidden;
              border-radius: 6px;
              table-layout: auto;
            }
            th,
            td {
              border: 1px solid var(--print-border);
              padding: 3px 4px;
              text-align: center;
              font-size: 8px;
              vertical-align: middle;
              word-break: break-word;
            }
            th {
              background: var(--print-accent);
              color: #1a1a1a;
              font-weight: 800;
              font-size: 7.5px;
            }
            tbody tr:nth-child(even) {
              background: var(--print-primary-soft);
            }
            .print-footer {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 10px;
              padding: 4px 6px;
              border-top: 1px solid rgba(31, 42, 31, 0.12);
              background: var(--print-accent-soft);
              color: var(--print-text-muted);
              font-size: 7px;
            }
            .print-footer strong {
              color: var(--print-primary);
            }
            thead {
              display: table-header-group;
            }
            tr,
            img {
              page-break-inside: avoid;
            }
            @page {
              size: ${pageOrientation};
              margin: 4mm;
            }
            @media print {
              body {
                padding: 0;
                background: #ffffff;
              }
              .print-page {
                box-shadow: none;
                border: none;
                border-radius: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-page">
            <header class="print-header">
              <div class="print-brand">
                <div class="print-brand-tag">${safeSystemBrand}</div>
                <div class="print-brand-copy">
                  <h1>${safeTitle}</h1>
                  <p class="subtitle">${safeSubtitle || safeSystemName}</p>
                </div>
              </div>
              <div class="print-meta">
                <div class="print-meta-item">
                  <strong>وقت الطباعة</strong>
                  <span>${safePrintedAt}</span>
                </div>
                <div class="print-meta-item">
                  <strong>تطوير النظام</strong>
                  <span>${DEVELOPER_NAME}</span>
                </div>
                <div class="print-meta-item">
                  <strong>رقم التواصل</strong>
                  <span>${DEVELOPER_PHONE}</span>
                </div>
              </div>
            </header>
            <main class="print-content">
              ${bodyHtml}
            </main>
            <footer class="print-footer">
              <span><strong>${safeSystemName}</strong></span>
              <span>إعداد وتطوير النظام: <strong>${DEVELOPER_NAME}</strong> - ${DEVELOPER_PHONE}</span>
            </footer>
          </div>
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => window.close(), 200);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  function exportPdf() {
    const selectedEntry = toolbarState.tableEntries.find(
      (entry) => entry.id === toolbarState.selectedTableId
    );

    if (!selectedEntry) {
      window.alert('لا توجد بيانات جاهزة للطباعة الآن.');
      return;
    }

    openPrintWindow({
      title: selectedEntry.title,
      subtitle: getPageTitle(),
      pageOrientation: getPdfOrientation(),
      bodyHtml: `
        ${buildSummaryCardsHtml(selectedEntry.summaryLines)}
        ${cloneTableForPrint(selectedEntry.table).outerHTML}
      `
    });
  }

  function printModal(modalElement) {
    const modalCard = modalElement?.querySelector('.modal-card');

    if (!modalCard) {
      window.alert('تعذر تجهيز نافذة التفاصيل للطباعة.');
      return;
    }

    const modalClone = modalCard.cloneNode(true);
    modalClone.querySelectorAll('.modal-print-button').forEach((node) => node.remove());

    const modalHeader = modalClone.querySelector('.modal-header');
    if (modalHeader) {
      modalHeader.querySelectorAll('button').forEach((button) => button.remove());
    }

    Array.from(modalClone.querySelectorAll('table')).forEach((table) => {
      table.replaceWith(cloneTableForPrint(table));
    });

    stripInteractiveElements(modalClone);

    const modalTitle = modalClone.querySelector('h1, h2, h3')?.textContent?.trim() || 'تفاصيل';

    openPrintWindow({
      title: modalTitle,
      subtitle: getPageTitle(),
      pageOrientation: getPdfOrientation(),
      bodyHtml: modalClone.innerHTML
    });
  }

  function ensureModalPrintButtons() {
    document.querySelectorAll('.modal .modal-header').forEach((header) => {
      let controls = header.querySelector('.modal-header-controls');

      if (!controls) {
        controls = document.createElement('div');
        controls.className = 'modal-header-controls';
        controls.style.display = 'flex';
        controls.style.alignItems = 'center';
        controls.style.gap = '10px';
        controls.style.flexWrap = 'wrap';

        Array.from(header.children)
          .filter((child) => {
            return !/^H[1-6]$/.test(child.tagName) && !child.classList.contains('modal-header-controls');
          })
          .forEach((child) => controls.appendChild(child));

        header.appendChild(controls);
      }

      if (!controls.querySelector('.modal-print-button')) {
        const printButton = document.createElement('button');
        printButton.type = 'button';
        printButton.className = 'secondary modal-print-button';
        printButton.dataset.printIgnore = 'true';
        printButton.textContent = 'طباعة';
        printButton.addEventListener('click', () => {
          const modal = header.closest('.modal');

          if (modal) {
            printModal(modal);
          }
        });

        controls.prepend(printButton);
      }
    });
  }

  function renderToolbar() {
    const host = document.querySelector(TOOLBAR_HOST_SELECTOR);

    if (!host) {
      return;
    }

    const nextSignature = JSON.stringify({
      tables: toolbarState.tableEntries.map((entry) => ({
        id: entry.id,
        title: entry.title
      })),
      selectedTableId: toolbarState.selectedTableId || null
    });

    if (!toolbarState.tableEntries.length) {
      if (host.childElementCount) {
        host.innerHTML = '';
      }

      lastRenderSignature = 'empty';
      return;
    }

    if (nextSignature === lastRenderSignature) {
      const currentSelect = host.querySelector('select');

      if (currentSelect && currentSelect.value !== toolbarState.selectedTableId) {
        currentSelect.value = toolbarState.selectedTableId;
      }

      return;
    }

    host.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'report-toolbar';

    const select = document.createElement('select');
    toolbarState.tableEntries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.title;
      select.appendChild(option);
    });

    select.value =
      toolbarState.selectedTableId &&
      toolbarState.tableEntries.some((entry) => entry.id === toolbarState.selectedTableId)
        ? toolbarState.selectedTableId
        : toolbarState.tableEntries[0].id;

    toolbarState.selectedTableId = select.value;

    select.addEventListener('change', () => {
      toolbarState.selectedTableId = select.value;
    });

    const excelButton = document.createElement('button');
    excelButton.type = 'button';
    excelButton.textContent = 'Excel';
    excelButton.addEventListener('click', exportExcel);

    const pdfButton = document.createElement('button');
    pdfButton.type = 'button';
    pdfButton.className = 'secondary';
    pdfButton.textContent = 'PDF';
    pdfButton.addEventListener('click', exportPdf);

    wrapper.appendChild(select);
    wrapper.appendChild(excelButton);
    wrapper.appendChild(pdfButton);
    host.appendChild(wrapper);
    lastRenderSignature = nextSignature;
  }

  function refreshToolbar() {
    toolbarState.tableEntries = getVisibleTables();

    if (
      toolbarState.selectedTableId &&
      !toolbarState.tableEntries.some((entry) => entry.id === toolbarState.selectedTableId)
    ) {
      toolbarState.selectedTableId = toolbarState.tableEntries[0]?.id || null;
    }

    renderToolbar();
    ensureModalPrintButtons();
  }

  function scheduleRefreshToolbar() {
    if (refreshQueued) {
      return;
    }

    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      refreshToolbar();
    });
  }

  function shouldIgnoreMutations(records) {
    return records.every((record) => {
      const target = record.target instanceof HTMLElement ? record.target : record.target?.parentElement;

      if (target?.closest?.(TOOLBAR_HOST_SELECTOR)) {
        return true;
      }

      if (target?.closest?.('.modal-header-controls')) {
        return true;
      }

      return Array.from(record.addedNodes || []).every((node) => {
        if (!(node instanceof HTMLElement)) {
          return true;
        }

        return Boolean(
          node.closest?.(TOOLBAR_HOST_SELECTOR) ||
            node.matches?.(TOOLBAR_HOST_SELECTOR) ||
            node.closest?.('.modal-header-controls') ||
            node.classList.contains('modal-print-button')
        );
      });
    });
  }

  function attachObserver() {
    const contentRoot = document.querySelector(CONTENT_SELECTOR);

    if (!contentRoot) {
      window.requestAnimationFrame(attachObserver);
      return;
    }

    toolbarObserver?.disconnect();
    toolbarObserver = new MutationObserver((records) => {
      if (shouldIgnoreMutations(records)) {
        return;
      }

      scheduleRefreshToolbar();
    });

    toolbarObserver.observe(contentRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });

    scheduleRefreshToolbar();
  }

  function boot() {
    scheduleRefreshToolbar();
    attachObserver();
    window.addEventListener('load', scheduleRefreshToolbar, { once: true });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        scheduleRefreshToolbar();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
