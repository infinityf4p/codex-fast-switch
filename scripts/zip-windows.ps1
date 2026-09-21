param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination }
$sourceDirectory = Get-Item -LiteralPath $Source
$sourcePrefix = $sourceDirectory.FullName.TrimEnd('\') + '\'
# Windows PowerShell's .NET Framework CreateFromDirectory writes backslashes.
# ZIP entry names must use '/' so Linux publishing can read the same package.
$archive = [IO.Compression.ZipFile]::Open($Destination, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $Source -File -Recurse -Force) {
        $entryName = $sourceDirectory.Name + '/' + $file.FullName.Substring($sourcePrefix.Length).Replace('\', '/')
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $archive.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($Destination)
try {
    if (-not ($archive.Entries | Where-Object { $_.FullName -match '(^|[\\/])Apply and Restart.cmd$' })) {
        throw 'The Windows package is missing its launcher.'
    }
    foreach ($entry in $archive.Entries) {
        $stream = $entry.Open()
        try { $stream.CopyTo([IO.Stream]::Null) } finally { $stream.Dispose() }
    }
} finally { $archive.Dispose() }
Write-Host 'Windows ZIP contents verified.'
