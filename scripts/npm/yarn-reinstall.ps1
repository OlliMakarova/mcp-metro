# Set English language for errors
[System.Threading.Thread]::CurrentThread.CurrentUICulture = 'en-US'
[System.Threading.Thread]::CurrentThread.CurrentCulture = 'en-US'
$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8
chcp 65001 > $null

# Get processes that use node_modules
$processes = Get-Process | Where-Object {$_.Path -like "*node_modules*"}

# Check if there are such processes
if ($processes.Count -gt 0) {
    Write-Host "Found the following processes holding files in node_modules folder:" -ForegroundColor Yellow

    # Display information about each process
    $processes | ForEach-Object {
        Write-Host "- $($_.ProcessName) (ID: $($_.Id))" -ForegroundColor Cyan
    }

    Write-Host "`nTerminating processes..." -ForegroundColor Yellow

    # Terminate processes
    $processes | ForEach-Object {
        Stop-Process -Id $_.Id -Force
        Write-Host "Process $($_.ProcessName) (ID: $($_.Id)) terminated" -ForegroundColor Green
    }
}

Write-Host "Removing node_modules. It may take a while..."

# Ignore errors, equivalent to set +e
#$ErrorActionPreference = "Continue"

# Remove node_modules directory
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue node_modules


# Check if directory still exists
if (Test-Path -Path "node_modules") {
    Write-Host "ERROR: Failed to completely remove node_modules folder!" -ForegroundColor Red
}

# Remove yarn.lock file if it exists
if (Test-Path -Path "yarn.lock") {
    Remove-Item -Path "yarn.lock" -Force
}

Write-Host "Do yarn install..."

yarn install

# If argument is passed, wait for key press
if ($args.Count -gt 0) {
    Read-Host "Press Enter to resume ..."
}
