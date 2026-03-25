param(
  [Parameter(Mandatory=$true)][string]$phone,
  [Parameter(Mandatory=$true)][string]$message,
  [Parameter(Mandatory=$true)][string]$id,
  [string]$uri = "http://127.0.0.1:3001/simulator",
  [string]$tenant = "1"
)

$h = @{ "x-tenant-id" = $tenant }

# Força envio UTF-8 real (bytes) + charset=utf-8
$json = (@{ phone=$phone; message=$message; id=$id } | ConvertTo-Json -Depth 10)
Invoke-RestMethod -Method POST -Uri $uri -Headers $h -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) | ConvertTo-Json -Depth 10
