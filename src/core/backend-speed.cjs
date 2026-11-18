// Serialized into the native local-backend launch function. Read credentials
// only to select API-key mode; never copy, log or send their contents anywhere.
function withApiSpeedCatalog(plan, options, source) {
  if (!plan || options.hostConfig.kind !== 'local' || source === 'override' || options.startupCommand ||
      typeof options.resourcesPath !== 'string' || typeof process.getBuiltinModule !== 'function' ||
      !plan.args.includes('app-server') || plan.args.some(arg => arg.includes('model_catalog_json'))) return plan;
  const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'), os = process.getBuiltinModule('os');
  const env = plan.env ?? process.env;
  const home = env.CODEX_HOME || path.join(env.HOME || env.USERPROFILE || os.homedir(), '.codex');
  const file = path.join(options.resourcesPath, 'codex-fast-service-tiers.json');
  try {
    let auth = {};
    const authFile = path.join(home, 'auth.json');
    if (fs.existsSync(authFile)) auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    if (auth.tokens || (auth.auth_mode && auth.auth_mode !== 'apikey') ||
        ![auth.OPENAI_API_KEY, env.OPENAI_API_KEY].some(key => typeof key === 'string' && key.trim())) return plan;
    // Respect an explicit catalog, including one defined in a profile. Unknown
    // or unreadable local configuration uses the original backend unchanged.
    for (const config of [path.join(home, 'config.toml'),
      ...(plan.cwd ? [path.join(plan.cwd, '.codex/config.toml')] : [])]) {
      if (fs.existsSync(config) && /^\s*(?:model_catalog_json\s*=|force_login_method\s*=\s*["']chatgpt["'])/m
        .test(fs.readFileSync(config, 'utf8'))) return plan;
    }
    if (!fs.existsSync(file)) return plan;
    return { ...plan, args: [...plan.args, '-c', `model_catalog_json=${JSON.stringify(file)}`] };
  } catch { return plan; }
}

function inject(source, fn) {
  const statement = fn.body.body.at(-1);
  if (statement.type !== 'ReturnStatement' || statement.argument?.type !== 'ObjectExpression' ||
      fn.params[0]?.type !== 'Identifier') throw new Error('Unknown backend launch result.');
  const result = statement.argument;
  const executable = result.properties.find(p => p.key.name === 'executablePath')?.value;
  if (executable?.type !== 'MemberExpression' || executable.object.type !== 'Identifier') throw new Error('Unknown backend executable binding.');
  return source.slice(fn.start, result.start) + `(${withApiSpeedCatalog.toString()})(${source.slice(result.start, result.end)},` +
    `${fn.params[0].name},${executable.object.name}.source)` + source.slice(result.end, fn.end);
}

module.exports = { withApiSpeedCatalog, inject };
