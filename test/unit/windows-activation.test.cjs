const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('package activation preserves the exact profile argument and rejects unsafe inputs without launching an app',
  { skip: process.platform !== 'win32' }, t => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fast-activation-')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const implementation = path.join(__dirname, '../../src/platforms/windows/activate.cs');
    const fixture = String.raw`
public static class ActivationFixture {
    [System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern System.IntPtr CommandLineToArgvW(string commandLine, out int count);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern System.IntPtr LocalFree(System.IntPtr memory);
    public static int Run() {
        const string id = "CodexFast.Switch_abcdefghijklm!App";
        int calls = 0;
        string[] profiles = { null, "", @"C:\Profiles\A & B", @"C:\Profiles\tail\", @"\\server\share\User Profile\", @"C:\profile\$(not-a-command);x", @"C:\profile\模型" };
        foreach (string profile in profiles) {
            uint pid = CodexFastActivation.Activate(id, profile, delegate(string actualId, string arguments, uint options) {
                calls++;
                if (actualId != id || options != 2) throw new System.Exception("Activation metadata changed.");
                int count;
                System.IntPtr parsed = CommandLineToArgvW("app.exe " + arguments, out count);
                if (parsed == System.IntPtr.Zero) throw new System.Exception("Could not parse activation arguments.");
                try {
                    if (string.IsNullOrEmpty(profile)) {
                        if (arguments != "" || count != 1) throw new System.Exception("Default profile gained an argument.");
                    } else {
                        if (count != 2) throw new System.Exception("Profile was split into multiple arguments.");
                        string value = System.Runtime.InteropServices.Marshal.PtrToStringUni(System.Runtime.InteropServices.Marshal.ReadIntPtr(parsed, System.IntPtr.Size));
                        if (value != "--user-data-dir=" + profile) throw new System.Exception("The profile argument changed.");
                    }
                } finally { LocalFree(parsed); }
                return 1234;
            });
            if (pid != 1234) throw new System.Exception("Activation process ID changed.");
        }
        CodexFastActivation.ActivationInvoker forbidden = delegate { throw new System.Exception("Invalid input reached activation."); };
        foreach (string profile in new string[] { "relative", @"C:relative", @"\relative", "C:\\bad\" --extra", "C:\\bad\npath" }) {
            bool rejected = false;
            try { CodexFastActivation.Activate(id, profile, forbidden); }
            catch (System.ArgumentException) { rejected = true; }
            if (!rejected) throw new System.Exception("Invalid profile was accepted.");
        }
        foreach (string invalidId in new string[] { null, "", "family!App", "family_publisher!App --extra", "family_publisher!App\n" }) {
            bool rejected = false;
            try { CodexFastActivation.Activate(invalidId, null, forbidden); }
            catch (System.ArgumentException) { rejected = true; }
            if (!rejected) throw new System.Exception("Invalid AppUserModelID was accepted.");
        }
        bool propagated = false;
        try { CodexFastActivation.Activate(id, null, delegate { throw new System.InvalidOperationException("simulated launch failure"); }); }
        catch (System.InvalidOperationException error) { propagated = error.Message == "simulated launch failure"; }
        if (!propagated) throw new System.Exception("Activation failure was hidden.");
        return calls;
    }
}`;
    const combined = path.join(root, 'activation.cs');
    fs.writeFileSync(combined, fs.readFileSync(implementation, 'utf8') + fixture);
    const script = path.join(root, 'test.ps1');
    fs.writeFileSync(script, `$ErrorActionPreference = 'Stop'\nAdd-Type -Path '${combined.replaceAll("'", "''")}'\n[ActivationFixture]::Run()\n`);
    const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(Number(result.stdout.trim()), 7);
  });
