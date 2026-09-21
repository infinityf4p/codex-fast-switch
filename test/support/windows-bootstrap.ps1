param([string]$Implementation, [string]$Spec)
$ErrorActionPreference = 'Stop'
$fastCase = Get-Content -LiteralPath $Spec -Raw | ConvertFrom-Json
$script:fastMetadataCount = 0
$script:fastArchiveCount = 0
$env:TEMP = $fastCase.temporary
$env:TMP = $fastCase.temporary
$env:LOCALAPPDATA = $fastCase.local
$env:CODEX_FAST_SETUP_HELP = '0'
function Read-Host { param($Prompt) return '' }
function Invoke-WebRequest {
    param($Uri, $OutFile, [switch]$UseBasicParsing, $TimeoutSec, $Headers)
    Add-Content -LiteralPath $fastCase.trace -Value $Uri
    if ($Uri -like '*latest.json?check=*') {
        $script:fastMetadataCount++
        $metadata = $fastCase.metadata | ConvertTo-Json -Depth 8 | ConvertFrom-Json
        if ($fastCase.mode -eq 'rollover' -and $script:fastMetadataCount -eq 1) {
            $metadata.commit = 'a' * 40
            $metadata.assets.win32.url = $metadata.assets.win32.url.Replace(('b' * 40), ('a' * 40))
        }
        return [pscustomobject]@{Content=($metadata | ConvertTo-Json -Depth 8)}
    }
    $script:fastArchiveCount++
    if ($fastCase.mode -eq 'rollover' -and $script:fastArchiveCount -eq 1) { throw '404: deployment changed' }
    if ($fastCase.mode -eq 'corrupt') { [IO.File]::WriteAllText($OutFile, 'corrupt') }
    else { [IO.File]::Copy($fastCase.archive, $OutFile, $true) }
}
$fastScript = [IO.File]::ReadAllText($Implementation).Replace('__CODEX_FAST_COMMAND__', $fastCase.command)
& ([scriptblock]::Create($fastScript))
