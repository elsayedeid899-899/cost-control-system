(function attachEgyptCurrencyFormatter() {
  function normalizeAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  function formatPlainAmount(value) {
    return normalizeAmount(value).toFixed(2);
  }

  function formatCurrencyEGP(value, options = {}) {
    const amount = normalizeAmount(value);

    if (options && options.plain) {
      return formatPlainAmount(amount);
    }

    const absoluteAmount = Math.abs(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const sign = amount < 0 ? '-' : '';

    return `${sign}${absoluteAmount} ج.م`;
  }

  window.formatCurrencyEGP = formatCurrencyEGP;
  window.formatCurrencyPlain = formatPlainAmount;
})();
