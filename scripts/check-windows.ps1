param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
foreach ($directory in @('windows', 'bin', 'scripts')) {
    foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $Root $directory) -Filter '*.ps1' -File)) {
        $tokens = $null
        $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    }
}
Add-Type -Path (Join-Path $Root 'windows\quit.cs')
Write-Host 'Windows PowerShell syntax checks passed.'
