$ErrorActionPreference = "Stop"

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkg = Get-Content -Raw -LiteralPath (Join-Path $source "package.json") | ConvertFrom-Json
$extensionName = "local.claude-limit-meter-$($pkg.version)"
$targetRoot = Join-Path $env:USERPROFILE ".vscode\extensions"
$target = Join-Path $targetRoot $extensionName

if (-not (Test-Path -LiteralPath $targetRoot)) {
    New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
}

# Remove any previously installed versions of this extension to avoid duplicates.
Get-ChildItem -LiteralPath $targetRoot -Directory -Filter "local.claude-limit-meter-*" -ErrorAction SilentlyContinue |
    ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
        Write-Output "REMOVED=$($_.FullName)"
    }

New-Item -ItemType Directory -Force -Path $target | Out-Null

Copy-Item -LiteralPath (Join-Path $source "package.json") -Destination $target
Copy-Item -LiteralPath (Join-Path $source "extension.js") -Destination $target
Copy-Item -LiteralPath (Join-Path $source "README.md") -Destination $target
Copy-Item -LiteralPath (Join-Path $source "README_ru.md") -Destination $target -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $source "claude-limit-web.png") -Destination $target -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $source "status-bar.png") -Destination $target -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $source "resources") -Destination $target -Recurse

Write-Output "INSTALLED=$target"

# Sync VS Code's extensions registry so it doesn't complain "invalid extension"
# when the old version it remembers no longer exists on disk.
$registryPath = Join-Path $targetRoot "extensions.json"
if (Test-Path -LiteralPath $registryPath) {
    try {
        $registry = Get-Content -Raw -LiteralPath $registryPath | ConvertFrom-Json
        $newFolder = "local.claude-limit-meter-$($pkg.version)"
        $newFsPath = "c:\Users\Admin\.vscode\extensions\$newFolder"
        $newExternal = "file:///c%3A/Users/Admin/.vscode/extensions/$newFolder"
        $newPath = "/c:/Users/Admin/.vscode/extensions/$newFolder"
        $updated = $false
        foreach ($entry in $registry) {
            if ($entry.identifier.id -eq "local.claude-limit-meter") {
                $entry.version = $pkg.version
                $entry.location.fsPath = $newFsPath
                $entry.location.external = $newExternal
                $entry.location.path = $newPath
                $entry.relativeLocation = $newFolder
                $updated = $true
            }
        }
        if ($updated) {
            ($registry | ConvertTo-Json -Depth 32 -Compress) | Set-Content -LiteralPath $registryPath -Encoding UTF8 -NoNewline
            Write-Output "REGISTRY_UPDATED=$($pkg.version)"
        }
    } catch {
        Write-Output "REGISTRY_UPDATE_SKIPPED=$($_.Exception.Message)"
    }
}

Write-Output "Reload VS Code: Developer: Reload Window"
