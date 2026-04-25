const expenseAllocationRuleState = {
  branches: [],
  expenseAccounts: [],
  rows: []
};

function formatMoney(value, options = {}) {
  if (window.formatCurrencyEGP) {
    return window.formatCurrencyEGP(value, options);
  }

  const amount = Number(value || 0);
  return options && options.plain ? amount.toFixed(2) : `${amount.toFixed(2)} ج.م`;
}

function formatPercent(value) {
  return Number(value || 0).toFixed(2);
}

function readQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}

function fillSelect(selectId, rows, getLabel, blankLabel) {
  const select = document.getElementById(selectId);
  select.innerHTML = `<option value="">${blankLabel}</option>`;

  rows.forEach((row) => {
    const option = document.createElement('option');
    option.value = row.id;
    option.textContent = getLabel(row);
    select.appendChild(option);
  });
}

function getCurrentWeightRows() {
  return Array.from(document.querySelectorAll('.allocation-weight-input')).map((node) => ({
    product_id: Number(node.dataset.productId || 0),
    allocation_weight: Number(node.value || 0)
  }));
}

function renderAllocationSummary(rows = []) {
  const totalWeight = rows.reduce((sum, row) => sum + Number(row.allocation_weight || 0), 0);
  const configuredRows = rows.filter((row) => Number(row.allocation_weight || 0) > 0);
  const configuredCount = configuredRows.length;
  const unconfiguredCount = Math.max(0, rows.length - configuredCount);

  document.getElementById('allocationRulesSummary').innerHTML = [
    ['إجمالي المنتجات', rows.length],
    ['منتجات مخصصة', configuredCount],
    ['منتجات بدون وزن', unconfiguredCount],
    ['إجمالي الوزن', formatPercent(totalWeight)]
  ]
    .map(
      ([label, value]) => `
        <div class="metric-card">
          <span class="metric-label">${label}</span>
          <div class="metric-value">${value}</div>
        </div>
      `
    )
    .join('');
}

function renderAllocationRulesTable(rows = []) {
  const host = document.getElementById('allocationRulesTable');

  if (!rows.length) {
    host.innerHTML =
      '<p class="card-section-note">حدد حساب مصروف يدوي وفرعًا لعرض المنتجات وأوزان التحميل.</p>';
    return;
  }

  const totalWeight = rows.reduce((sum, row) => sum + Number(row.allocation_weight || 0), 0);

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الصنف</th>
          <th>التصنيف</th>
          <th>النوع</th>
          <th>سعر البيع</th>
          <th>متوسط التكلفة</th>
          <th>وزن التوزيع</th>
          <th>حصة التوزيع %</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const sharePct = totalWeight
              ? (Number(row.allocation_weight || 0) / totalWeight) * 100
              : 0;

            return `
              <tr>
                <td>${row.product_code || ''} - ${row.product_name || ''}</td>
                <td>${row.group_name || '-'}</td>
                <td>${row.product_type === 'semi_finished_product' ? 'نصف مصنع' : 'منتج تام'}</td>
                <td>${formatMoney(row.standard_sale_price)}</td>
                <td>${formatMoney(row.average_current_cost)}</td>
                <td>
                  <input
                    class="allocation-weight-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value="${Number(row.allocation_weight || 0).toFixed(2)}"
                    data-product-id="${row.product_id}"
                    oninput="refreshAllocationSummaryFromInputs()"
                  />
                </td>
                <td>${formatPercent(sharePct)}%</td>
              </tr>
            `;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function refreshAllocationSummaryFromInputs() {
  const rows = expenseAllocationRuleState.rows.map((row) => {
    const input = document.querySelector(`.allocation-weight-input[data-product-id="${row.product_id}"]`);

    return {
      ...row,
      allocation_weight: Number(input?.value || 0)
    };
  });

  renderAllocationSummary(rows);
}

async function loadAllocationReferences() {
  const response = await fetch('/api/expense-allocation-rules/reference-data');
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || 'تعذر تحميل بيانات التوزيع اليدوي');
  }

  expenseAllocationRuleState.branches = payload.branches || [];
  expenseAllocationRuleState.expenseAccounts = (payload.expense_accounts || []).filter(
    (row) => Number(row.is_active) === 1 || Number(row.rule_count || 0) > 0
  );

  fillSelect(
    'rule_expense_account_id',
    expenseAllocationRuleState.expenseAccounts,
    (row) => `${row.code || ''} - ${row.name || ''}`,
    'اختر حسابًا يدويًا'
  );
  fillSelect(
    'rule_branch_id',
    expenseAllocationRuleState.branches,
    (row) => `${row.code || ''} - ${row.name || ''}`,
    'اختر الفرع'
  );

  const queryExpenseAccountId = readQueryParam('expense_account_id');
  const queryBranchId = readQueryParam('branch_id');

  if (queryExpenseAccountId) {
    document.getElementById('rule_expense_account_id').value = queryExpenseAccountId;
  }

  if (queryBranchId) {
    document.getElementById('rule_branch_id').value = queryBranchId;
  }
}

async function loadAllocationRules() {
  const expenseAccountId = Number(document.getElementById('rule_expense_account_id').value || 0);
  const branchId = Number(document.getElementById('rule_branch_id').value || 0);
  const params = new URLSearchParams();

  if (expenseAccountId) {
    params.set('expense_account_id', String(expenseAccountId));
  }

  if (branchId) {
    params.set('branch_id', String(branchId));
  }

  const response = await fetch(`/api/expense-allocation-rules?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر تحميل قواعد التوزيع');
    return;
  }

  expenseAllocationRuleState.rows = payload.rows || [];
  renderAllocationSummary(expenseAllocationRuleState.rows);
  renderAllocationRulesTable(expenseAllocationRuleState.rows);
}

function fillEqualWeights() {
  if (!expenseAllocationRuleState.rows.length) {
    return;
  }

  document.querySelectorAll('.allocation-weight-input').forEach((node) => {
    node.value = '1.00';
  });

  refreshAllocationSummaryFromInputs();
}

async function saveAllocationRules() {
  const expenseAccountId = Number(document.getElementById('rule_expense_account_id').value || 0);
  const branchId = Number(document.getElementById('rule_branch_id').value || 0);

  if (!expenseAccountId || !branchId) {
    alert('حدد حساب المصروف والفرع أولًا.');
    return;
  }

  const rows = getCurrentWeightRows();
  const response = await fetch('/api/expense-allocation-rules', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      expense_account_id: expenseAccountId,
      branch_id: branchId,
      rows
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    alert(payload.error || 'تعذر حفظ قواعد التوزيع اليدوي');
    return;
  }

  await loadAllocationRules();
  alert(`تم حفظ ${Number(payload.saved_rule_count || 0)} قاعدة توزيع يدوي.`);
}

window.loadAllocationRules = loadAllocationRules;
window.fillEqualWeights = fillEqualWeights;
window.refreshAllocationSummaryFromInputs = refreshAllocationSummaryFromInputs;
window.saveAllocationRules = saveAllocationRules;

loadAllocationReferences()
  .then(() => {
    if (document.getElementById('rule_expense_account_id').value && document.getElementById('rule_branch_id').value) {
      return loadAllocationRules();
    }

    renderAllocationSummary([]);
    renderAllocationRulesTable([]);
    return null;
  })
  .catch((err) => {
    alert(err.message || 'تعذر تهيئة شاشة التوزيع اليدوي');
  });
