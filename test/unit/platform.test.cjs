const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSparkleUpdater } = require('../../src/platforms/macos/platform.cjs');

test('Sparkle detection matches the selected app and its cached progress helper', () => {
  const app = '/Applications/Codex Desktop.app';
  const framework = `${app}/Contents/Frameworks/Sparkle.framework/Versions/B`;
  const cached = '/Users/example/Library/Caches/com.openai.codex/org.sparkle-project.Sparkle/Launcher/abc/Updater.app/Contents/MacOS/Updater';
  for (const command of [
    `${framework}/Autoupdate com.openai.codex /Users/example example`,
    `${framework}/Updater.app/Contents/MacOS/Updater ${app} 0`,
    `${cached} ${app} 0`,
    `  ${cached} ${app} 1  `,
  ]) assert.equal(isSparkleUpdater(app, command), true, command);
  for (const command of [
    '/Applications/Other.app/Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate com.example.other /Users/example example',
    '/Applications/Other Codex.app/Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate com.openai.codex /Users/example example',
    `${cached} /Applications/Other.app 0`,
    `${cached} ${app}.backup 0`,
    `${cached} /Applications/Other.app ${app}`,
    `/bin/echo ${framework}/Autoupdate com.openai.codex`,
    `${framework}/Autoupdate-other`,
    `${app}/Contents/MacOS/Codex`,
    '',
  ]) assert.equal(isSparkleUpdater(app, command), false, command);
});
