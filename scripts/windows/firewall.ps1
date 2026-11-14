# ITop Med: let phones, tablets and other computers on THIS clinic network reach
# the server (TCP 3443 and 80, local subnet only). Run through `npm run app:firewall`,
# which asks Windows for administrator rights.
#
# Windows creates "Block" rules for Node.js when its "allow access" prompt is
# dismissed; Block rules win over Allow rules, so those inbound blocks for this
# node.exe are removed first. Nothing is opened to the internet: RemoteAddress
# is limited to the local subnet.
param([Parameter(Mandatory = $true)][string]$Node)
$ErrorActionPreference = 'Stop'

Get-NetFirewallApplicationFilter |
  Where-Object { $_.Program -ieq $Node } |
  Get-NetFirewallRule |
  Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' } |
  Remove-NetFirewallRule

Remove-NetFirewallRule -DisplayName 'ITop Med (clinic network)' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'ITop Med (clinic network)' -Description 'ITop Med server for devices on the local network' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3443, 80 -RemoteAddress LocalSubnet -Profile Any -Program $Node | Out-Null

Write-Host 'ITop Med: firewall rule added.'
