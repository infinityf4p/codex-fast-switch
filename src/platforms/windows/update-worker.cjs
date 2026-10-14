async function main() {
  const [command, state, id, token] = process.argv.slice(2);
  if (!state || !id || !['check', 'official', 'start', 'install'].includes(command)) throw new Error('Invalid update helper arguments.');
  if (command === 'check') return require('./updates.cjs').checkForUpdates(state, id, { force: token === 'force' });
  if (command === 'official') return require('./official-update.cjs').update(state, id);
  return require('./update-handoff.cjs')[command](state, id, token);
}

if (require.main === module) main().then(result => {
  if (process.argv[2] !== 'install') console.log(JSON.stringify(result));
}).catch(error => {
  if (process.argv[2] !== 'install') console.log(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
