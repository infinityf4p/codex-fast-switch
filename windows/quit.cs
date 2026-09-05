using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class CodexFastQuit {
    private delegate bool EnumCallback(IntPtr window, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Message {
        public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam;
        public uint Time; public int X, Y; public uint Private;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput {
        public ushort Key, Scan; public uint Flags, Time; public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput {
        public int X, Y; public uint Data, Flags, Time; public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)] private struct InputData {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputData Data; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CommandLineToArgvW(string commandLine, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint minimum, uint maximum, uint remove);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);

    private static IntPtr FindWindow(uint processId) {
        IntPtr selected = IntPtr.Zero;
        long bestArea = -1;
        EnumWindows((window, parameter) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if (owner != processId || !IsWindowEnabled(window)) return true;
            if (GetWindow(window, 4) != IntPtr.Zero || (GetWindowLong(window, -20) & 0x08000080) != 0) return true;
            var name = new StringBuilder(128);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != "Chrome_WidgetWin_1") return true;
            Rect rect;
            if (!GetWindowRect(window, out rect)) return true;
            long area = (long)Math.Max(0, rect.Right - rect.Left) * Math.Max(0, rect.Bottom - rect.Top);
            if (IsWindowVisible(window)) area += 1L << 62;
            if (area > bestArea) { selected = window; bestArea = area; }
            return true;
        }, IntPtr.Zero);
        return selected;
    }

    public static bool HasVisibleWindow(uint processId) {
        IntPtr window = FindWindow(processId);
        return window != IntPtr.Zero && IsWindowVisible(window);
    }

    public static string ActivationArguments(string commandLine) {
        if (String.IsNullOrWhiteSpace(commandLine)) throw new InvalidOperationException("Cannot inspect the Codex launch arguments. Open Codex and press Ctrl+Q, then retry.");
        int count;
        IntPtr arguments = CommandLineToArgvW(commandLine, out count);
        if (arguments == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            string profile = null;
            for (int i = 1; i < count; i++) {
                string argument = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, i * IntPtr.Size));
                if (argument.StartsWith("--user-data-dir=", StringComparison.OrdinalIgnoreCase)) profile = argument.Substring(16);
                else if (argument.Equals("--user-data-dir", StringComparison.OrdinalIgnoreCase) && i + 1 < count)
                    profile = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, ++i * IntPtr.Size));
            }
            if (profile == null) return "";
            if (!Path.IsPathRooted(profile) || profile.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
                throw new InvalidOperationException("Cannot safely restore this Codex profile. Open Codex and press Ctrl+Q, then retry.");
            string value = "--user-data-dir=" + profile;
            int trailing = value.Length - value.TrimEnd('\\').Length;
            return "\"" + value + new string('\\', trailing) + "\"";
        } finally { LocalFree(arguments); }
    }

    private static Input Key(ushort key, bool up) {
        return new Input { Type = 1, Data = new InputData { Keyboard = new KeyboardInput { Key = key, Flags = up ? 2U : 0U } } };
    }

    private static void Activate(IntPtr window) {
        if (SetForegroundWindow(window)) return;
        Message message; PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
        uint unused, current = GetCurrentThreadId();
        uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out unused);
        uint target = GetWindowThreadProcessId(window, out unused);
        bool attachedForeground = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
        bool attachedTarget = target != 0 && target != current && target != foreground && AttachThreadInput(current, target, true);
        try { SetForegroundWindow(window); }
        finally {
            if (attachedTarget) AttachThreadInput(current, target, false);
            if (attachedForeground) AttachThreadInput(current, foreground, false);
        }
    }

    public static void Request(uint processId) {
        IntPtr window = FindWindow(processId);
        if (window == IntPtr.Zero) throw new InvalidOperationException("Codex has no available main window. Open Codex and press Ctrl+Q, then retry.");
        if (IsIconic(window)) ShowWindowAsync(window, 9);
        else if (!IsWindowVisible(window)) ShowWindowAsync(window, 5);
        var deadline = Stopwatch.StartNew();
        while (GetForegroundWindow() != window && deadline.ElapsedMilliseconds < 3000) {
            Activate(window);
            Thread.Sleep(100);
        }
        uint owner; GetWindowThreadProcessId(window, out owner);
        if (owner != processId || GetForegroundWindow() != window || !IsWindowEnabled(window)) {
            throw new InvalidOperationException("Could not focus the verified Codex window. Open Codex and press Ctrl+Q, then retry.");
        }
        foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C }) {
            if ((GetAsyncKeyState(key) & 0x8000) != 0) throw new InvalidOperationException("Release the modifier keys and retry, or quit Codex with Ctrl+Q.");
        }
        // Queue the complete shortcut together, only while the verified window owns focus.
        var inputs = new Input[] { Key(0x11, false), Key(0x51, false), Key(0x51, true), Key(0x11, true) };
        if (GetForegroundWindow() != window) throw new InvalidOperationException("Window focus changed. Quit Codex with Ctrl+Q, then retry.");
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != inputs.Length) {
            int error = Marshal.GetLastWin32Error();
            var release = new Input[] { Key(0x51, true), Key(0x11, true) };
            SendInput((uint)release.Length, release, Marshal.SizeOf(typeof(Input)));
            throw new Win32Exception(error, "Windows did not accept the Codex quit shortcut. Quit Codex manually with Ctrl+Q.");
        }
    }
}
