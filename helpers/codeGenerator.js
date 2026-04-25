function generateCode(db, table, groupCode, callback) {
  db.get(
    `SELECT code FROM ${table} WHERE code LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${groupCode}-%`],
    (err, row) => {
      if (err) {
        throw err;
      }

      if (!row) {
        return callback(`${groupCode}-001`);
      }

      const lastNumber = parseInt((row.code || '').split('-').pop() || 0, 10);
      const newNumber = String(lastNumber + 1).padStart(3, '0');

      callback(`${groupCode}-${newNumber}`);
    }
  );
}

function generateSequentialCode(db, table, columnName, prefix, callback) {
  db.get(
    `SELECT ${columnName} AS value FROM ${table} WHERE ${columnName} LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}-%`],
    (err, row) => {
      if (err) {
        throw err;
      }

      if (!row || !row.value) {
        return callback(`${prefix}-001`);
      }

      const lastNumber = parseInt((row.value || '').split('-').pop() || 0, 10);
      const newNumber = String(lastNumber + 1).padStart(3, '0');

      callback(`${prefix}-${newNumber}`);
    }
  );
}

function generateSequentialCodeAsync(db, table, columnName, prefix) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT ${columnName} AS value FROM ${table} WHERE ${columnName} LIKE ? ORDER BY id DESC LIMIT 1`,
      [`${prefix}-%`],
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (!row || !row.value) {
          resolve(`${prefix}-001`);
          return;
        }

        const lastNumber = parseInt((row.value || '').split('-').pop() || 0, 10);
        const newNumber = String(lastNumber + 1).padStart(3, '0');

        resolve(`${prefix}-${newNumber}`);
      }
    );
  });
}

module.exports = {
  generateCode,
  generateSequentialCode,
  generateSequentialCodeAsync
};
