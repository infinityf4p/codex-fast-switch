using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

public static class CodexFastActivation {
    public delegate uint ActivationInvoker(string appUserModelId, string arguments, uint options);

    [ComImport, Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IApplicationActivationManager {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
        [PreserveSig] int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);
        [PreserveSig] int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            IntPtr items, out uint processId);
    }

    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint apartment);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();
    [DllImport("ole32.dll")] private static extern int CoCreateInstance(ref Guid classId, IntPtr outer, uint context,
        ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out IApplicationActivationManager manager);

    public static string ProfileArguments(string userData) {
        if (String.IsNullOrEmpty(userData)) return "";
        // Avoid drive-relative/root-relative paths and extra command-line switches.
        bool drive = Regex.IsMatch(userData, @"^[A-Za-z]:[\\/]");
        bool unc = Regex.IsMatch(userData, @"^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)");
        if ((!drive && !unc) || userData.IndexOfAny(Path.GetInvalidPathChars()) >= 0 ||
            Regex.IsMatch(userData, "[\\x00-\\x1f\\\"]")) {
            throw new ArgumentException("The Codex profile directory must be an absolute path without quotes or control characters.", "userData");
        }
        string argument = "--user-data-dir=" + userData;
        // CommandLineToArgvW requires trailing backslashes to be doubled before
        // the closing quote. Other characters are passed literally, never to a shell.
        int trailing = argument.Length - argument.TrimEnd('\\').Length;
        return "\"" + argument + new string('\\', trailing) + "\"";
    }

    public static uint Activate(string appUserModelId, string userData) {
        return Activate(appUserModelId, userData, ActivateNative);
    }

    // Injectable transport lets tests prove argument preservation without
    // activating any installed app or borrowing its real profile.
    public static uint Activate(string appUserModelId, string userData, ActivationInvoker invoke) {
        if (appUserModelId == null || appUserModelId.Length > 128 ||
            !Regex.IsMatch(appUserModelId, @"\A[A-Za-z0-9][A-Za-z0-9._-]*_[A-Za-z0-9]+![A-Za-z0-9][A-Za-z0-9._-]*\z")) {
            throw new ArgumentException("Invalid package application user model ID.", "appUserModelId");
        }
        if (invoke == null) throw new ArgumentNullException("invoke");
        // AO_NOERRORUI: the calling installer reports activation errors itself.
        return invoke(appUserModelId, ProfileArguments(userData), 2);
    }

    private static uint ActivateNative(string appUserModelId, string arguments, uint options) {
        int initialized = CoInitializeEx(IntPtr.Zero, 2); // COINIT_APARTMENTTHREADED
        const int ChangedMode = unchecked((int)0x80010106);
        if (initialized < 0 && initialized != ChangedMode) Marshal.ThrowExceptionForHR(initialized);
        IApplicationActivationManager manager = null;
        try {
            Guid classId = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
            Guid interfaceId = typeof(IApplicationActivationManager).GUID;
            // This PowerShell helper exits after activation. Microsoft's documented
            // CLSCTX_LOCAL_SERVER mode keeps launch arguments alive in Dllhost.
            // https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-iapplicationactivationmanager
            Marshal.ThrowExceptionForHR(CoCreateInstance(ref classId, IntPtr.Zero, 4, ref interfaceId, out manager));
            uint processId;
            Marshal.ThrowExceptionForHR(manager.ActivateApplication(appUserModelId, arguments, options, out processId));
            return processId;
        } finally {
            if (manager != null) Marshal.ReleaseComObject(manager);
            if (initialized >= 0) CoUninitialize();
        }
    }
}
