Write-Host "Removing node_modules. It may take a while..."

# Ignore errors, equivalent to set +e
$ErrorActionPreference = "Continue"

# Remove node_modules directory
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue node_modules

Write-Host "Do yarn ci..."

yarn install --frozen-lockfile

# If argument is passed, wait for key press
if ($args.Count -gt 0) {
  Read-Host "Press Enter to resume ..."
}
