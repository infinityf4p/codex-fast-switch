#!/usr/bin/env node
async function main(args = process.argv.slice(2)) {
  if (process.platform === 'win32') return require('./src/platforms/windows/cli.cjs').main(args);
  if (process.platform === 'darwin') return require('./src/platforms/macos/cli.cjs').main(args);
  throw new Error('Codex Fast Switch supports macOS and Windows only.');
}

if (require.main === module) main().then(result => {
  if (result) console.log(JSON.stringify(result, null, 2));
  if (process.platform === 'win32' && result?.status === 'busy') process.exitCode = 1;
}).catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
