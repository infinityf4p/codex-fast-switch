param(
    [Parameter(Mandatory = $true)][string]$Payload,
    [ValidateSet('Run', 'InstallElevated')][string]$Action = 'Run'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
$publisher = 'CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B'
$family = 'OpenAI.Codex_2p2nqsd0c76g0'

function Send-Progress($value) { [Console]::WriteLine(($value | ConvertTo-Json -Depth 5 -Compress)) }

function Write-ElevationResult($value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Compress))
    $stream = [IO.File]::Open($elevationFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Assert-Directory([string]$directory) {
    $current = [IO.Path]::GetFullPath($directory)
    while ($current) {
        $entry = Get-Item -LiteralPath $current -Force
        if (-not $entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The official update directory is redirected.' }
        if ($current -eq [IO.Path]::GetPathRoot($current)) { break }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Get-OfficialPackage {
    $packages = @(Get-AppxPackage -Name OpenAI.Codex | Where-Object {
        $_.PackageFamilyName -ceq $family -and $_.Publisher -ceq $publisher -and -not $_.IsDevelopmentMode -and $_.Status -eq 'Ok'
    })
    if ($packages.Count -ne 1) { throw 'The registered official package could not be identified uniquely.' }
    return $packages[0]
}

function Assert-Package([string]$file) {
    $entry = Get-Item -LiteralPath $file -Force
    if ($entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'The downloaded package is redirected.' }
    if ($null -ne $data.length -and $entry.Length -ne [long]$data.length) { throw 'The official package download is incomplete.' }
    if ($data.sha256 -and (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $data.sha256) { throw 'The official package checksum does not match.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($file)
    try {
        $manifests = @($archive.Entries | Where-Object FullName -ceq 'AppxManifest.xml')
        if ($manifests.Count -ne 1 -or $manifests[0].Length -gt 1048576 -or -not $archive.GetEntry('AppxSignature.p7x')) { throw 'The official MSIX manifest or signature is missing.' }
        $settings = New-Object Xml.XmlReaderSettings
        $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
        $settings.XmlResolver = $null
        $reader = [Xml.XmlReader]::Create($manifests[0].Open(), $settings)
        try { $xml = New-Object Xml.XmlDocument; $xml.XmlResolver = $null; $xml.Load($reader) } finally { $reader.Dispose() }
        $identities = $xml.SelectNodes("/*[local-name()='Package']/*[local-name()='Identity']")
        if ($identities.Count -ne 1) { throw 'The official package identity is ambiguous.' }
        $identity = $identities[0]
        if ($identity.Name -cne 'OpenAI.Codex' -or $identity.Publisher -cne $publisher -or
            $identity.Version -cne $data.version -or $identity.ProcessorArchitecture -cne $data.arch) {
            throw 'The downloaded package does not match the official release identity, version or architecture.'
        }
    } finally { $archive.Dispose() }
}

function Assert-OfficialWindowStopped {
    if (-not ('CodexFastOfficialIdentity' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CodexFastOfficialIdentity {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr process);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder name);
    public static string Family(uint pid) {
        var process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {
            uint length = 0; int error = GetPackageFamilyName(process, ref length, null);
            if (error == 15700) return "";
            if (error != 122) throw new System.ComponentModel.Win32Exception(error);
            var name = new StringBuilder((int)length);
            error = GetPackageFamilyName(process, ref length, name);
            if (error != 0) throw new System.ComponentModel.Win32Exception(error);
            return name.ToString();
        } finally { CloseHandle(process); }
    }
}
'@
    }
    foreach ($process in @(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue)) {
        if ($process.HasExited) { continue }
        try { $processFamily = [CodexFastOfficialIdentity]::Family($process.Id) }
        catch { if ($process.HasExited) { continue }; throw }
        if ($processFamily -ceq $family) { throw 'Close the official app window, then retry from Codex Fast. The current Fast copy can remain open.' }
    }
}

function Install-OfficialPackage {
    $registered = Get-OfficialPackage
    if ([version]$registered.Version -ge [version]$data.version) { return }
    Assert-Package $packageFile
    Assert-OfficialWindowStopped
    # Windows validates the complete MSIX signature. Only the official target
    # package may be shut down; the running Fast copy has a separate identity.
    Add-AppxPackage -Path $packageFile -ForceTargetApplicationShutdown -ErrorAction Stop
    $registered = Get-OfficialPackage
    if ([version]$registered.Version -lt [version]$data.version) { throw 'Windows did not activate the official update.' }
}

$packageFile = $null
$partialFile = $null
$elevationFile = $null
$elevated = $null
try {
    if ($data.version -cnotmatch '^\d+(?:\.\d+){3}$' -or $data.arch -cnotmatch '^(x64|arm64)$' -or
        @($data.version.Split('.') | Where-Object { [int]$_ -gt 65535 }).Count) { throw 'Invalid official package version or architecture.' }
    $uri = [uri]$data.url
    if ($uri.Scheme -cne 'https' -or $uri.Host -cne 'persistent.oaistatic.com' -or -not $uri.IsDefaultPort -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        -not $uri.AbsolutePath.StartsWith('/codex-app-prod/releases/') -or -not $uri.AbsolutePath.EndsWith('.msix')) { throw 'Invalid official release URL.' }
    if ($data.sha256 -and $data.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid package checksum.' }
    if ($null -ne $data.length -and ([long]$data.length -le 0 -or [long]$data.length -gt 8GB)) { throw 'Invalid package length.' }
    if (-not [IO.Path]::IsPathRooted($data.state)) { throw 'The update state must be absolute.' }
    $state = [IO.Path]::GetFullPath($data.state)
    Assert-Directory $state
    $agentDirectory = Join-Path $state 'agent'
    Assert-Directory $agentDirectory
    $cache = Join-Path $agentDirectory 'official-update'
    [IO.Directory]::CreateDirectory($cache) | Out-Null
    Assert-Directory $cache
    $packageFile = Join-Path $cache ($data.version + '-' + $data.arch + '.msix')
    $partialFile = $packageFile + '.download'
    if ($Action -eq 'InstallElevated') {
        if ($data.userSid -cne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -or
            $data.elevationToken -cnotmatch '^[a-f0-9-]{36}$') { throw 'Elevation must use the same Windows account.' }
        $elevationFile = Join-Path $cache ($data.elevationToken + '.json')
        Install-OfficialPackage
        Write-ElevationResult @{ installed = $true }
        exit 0
    }
    $registered = Get-OfficialPackage
    if ($registered.Architecture.ToString().ToLowerInvariant() -cne $data.arch) { throw 'The official architecture changed.' }
    if ([version]$registered.Version -lt [version]$data.version) {
        Assert-OfficialWindowStopped
        # Remove only these exact owned cache files; never follow a redirected file.
        foreach ($file in @($packageFile, $partialFile)) {
            if (Test-Path -LiteralPath $file) {
                if ((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The update cache is redirected.' }
                Remove-Item -LiteralPath $file -Force
            }
        }
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Add-Type -AssemblyName System.Net.Http
        $handler = New-Object Net.Http.HttpClientHandler
        $handler.AllowAutoRedirect = $false
        $handler.Proxy = [Net.WebRequest]::GetSystemWebProxy()
        $client = New-Object Net.Http.HttpClient($handler)
        $client.Timeout = [TimeSpan]::FromMinutes(30)
        $response = $null; $inputStream = $null; $outputStream = $null
        try {
            Send-Progress @{ phase = 'downloading'; percent = 0 }
            $response = $client.GetAsync($uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            $response.EnsureSuccessStatusCode() | Out-Null
            $total = $response.Content.Headers.ContentLength
            if ($null -ne $total -and ($total -le 0 -or $total -gt 8GB)) { throw 'The official package is oversized.' }
            $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $outputStream = [IO.File]::Open($partialFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            $buffer = New-Object byte[] 1048576
            [long]$received = 0
            $lastReport = [DateTime]::MinValue
            while ($true) {
                $timeout = New-Object Threading.CancellationTokenSource(120000)
                try { $count = $inputStream.ReadAsync($buffer, 0, $buffer.Length, $timeout.Token).GetAwaiter().GetResult() }
                finally { $timeout.Dispose() }
                if ($count -eq 0) { break }
                $received += $count
                if ($received -gt 8GB) { throw 'The official package is oversized.' }
                $outputStream.Write($buffer, 0, $count)
                if (([DateTime]::UtcNow - $lastReport).TotalMilliseconds -ge 500) {
                    $percent = if ($total -gt 0) { [Math]::Min(100, [Math]::Floor(100 * $received / $total)) } else { $null }
                    Send-Progress @{ phase = 'downloading'; percent = $percent; received = $received; total = $total }
                    $lastReport = [DateTime]::UtcNow
                }
            }
            if ($null -ne $total -and $received -ne $total) { throw 'The official package download is incomplete.' }
            $outputStream.Flush($true)
        } finally {
            if ($outputStream) { $outputStream.Dispose() }
            if ($inputStream) { $inputStream.Dispose() }
            if ($response) { $response.Dispose() }
            $client.Dispose(); $handler.Dispose()
        }
        Move-Item -LiteralPath $partialFile -Destination $packageFile
        Assert-Package $packageFile
        Send-Progress @{ phase = 'installing-official'; percent = 100 }
        try { Install-OfficialPackage }
        catch {
            # A package containing services can require Windows administrator consent.
            # Retry once through UAC, with the exact same validated package and user.
            if ($_.ToString() -notmatch '80073D28|80070005|[Aa]ccess.*denied|拒绝访问') { throw }
            Send-Progress @{ phase = 'awaiting-elevation' }
            $token = [Guid]::NewGuid().ToString()
            $data | Add-Member userSid ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
            $data | Add-Member elevationToken $token
            $elevationFile = Join-Path $cache ($token + '.json')
            $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Compress)))
            $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Action InstallElevated -Payload ' + $encoded
            $elevated = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -PassThru
            if (-not $elevated.WaitForExit(600000)) { throw 'Windows is still installing the official update. Wait for installation to finish before retrying.' }
            if ((Get-Item -LiteralPath $elevationFile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The installation result is redirected.' }
            $elevatedResult = Get-Content -LiteralPath $elevationFile -Raw | ConvertFrom-Json
            if (-not $elevatedResult.installed) { throw $elevatedResult.error }
        }
    }
    $registered = Get-OfficialPackage
    if ([version]$registered.Version -lt [version]$data.version) { throw 'Windows has not registered the new official package.' }
    Send-Progress @{ result = @{ status = 'installed'; version = $registered.Version.ToString() } }
} catch {
    if ($Action -eq 'InstallElevated' -and $elevationFile) {
        Write-ElevationResult @{ installed = $false; error = $_.Exception.Message }
    } else { Send-Progress @{ error = $_.Exception.Message } }
    exit 1
} finally {
    if ($Action -eq 'Run' -and (-not $elevated -or $elevated.HasExited)) {
        foreach ($file in @($packageFile, $partialFile, $elevationFile)) {
            if ($file -and (Test-Path -LiteralPath $file) -and -not ((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
