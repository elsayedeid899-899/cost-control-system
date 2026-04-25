const TREASURY_TYPES = new Set(['cash', 'bank', 'wallet', 'other']);

function normalizeTreasuryType(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return TREASURY_TYPES.has(normalizedValue) ? normalizedValue : 'cash';
}

function getDefaultTreasuryAccountCode(treasuryType) {
  switch (normalizeTreasuryType(treasuryType)) {
    case 'bank':
      return '1020';
    case 'wallet':
      return '1040';
    case 'other':
      return '1090';
    default:
      return '1010';
  }
}

function normalizeLinkedAccountCode(linkedAccountCode, treasuryType) {
  const normalizedCode = String(linkedAccountCode || '').trim();
  return normalizedCode || getDefaultTreasuryAccountCode(treasuryType);
}

module.exports = {
  TREASURY_TYPES,
  normalizeTreasuryType,
  getDefaultTreasuryAccountCode,
  normalizeLinkedAccountCode
};
