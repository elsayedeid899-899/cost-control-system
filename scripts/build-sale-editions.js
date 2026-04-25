const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const scriptPath = path.join(__dirname, 'package-edition.js');
const editions = ['clean', 'demo'];

for (const edition of editions) {
  const result = spawnSync(process.execPath, [scriptPath, edition], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('Built sale editions successfully.');
