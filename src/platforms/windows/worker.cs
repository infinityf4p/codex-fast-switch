using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class CodexFastWorker {
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetPackageFullName(IntPtr process, ref uint length, IntPtr name);
    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    public static void AssertIndependent(uint processId, uint parentId) {
        IntPtr handle = OpenProcess(0x1000, false, processId); // PROCESS_QUERY_LIMITED_INFORMATION
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            uint length = 0;
            int result = GetPackageFullName(handle, ref length, IntPtr.Zero);
            if (result == 0 || result == 122) {
                throw new InvalidOperationException("The update helper still belongs to an app package. Restart Explorer, then retry the update.");
            }
            if (result != 15700) throw new Win32Exception(result); // APPMODEL_ERROR_NO_PACKAGE
        } finally { CloseHandle(handle); }
        // An external binary can have no package identity yet remain in the
        // package's process job. Require the desktop broker as its actual parent.
        uint shellId;
        GetWindowThreadProcessId(GetShellWindow(), out shellId);
        if (shellId == 0 || shellId != parentId) {
            throw new InvalidOperationException("The update helper was not started by desktop Explorer. Restart Explorer, then retry the update.");
        }
    }
}
