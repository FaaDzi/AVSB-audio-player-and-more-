# Keeps Windows from idle-sleeping while a given process runs, then lets normal power settings apply again.
# Does not stop sleep from closing the lid or choosing Sleep by hand.
# Usage: powershell -File scripts/keep_awake.ps1 -ProcessId <pid>
param([Parameter(Mandatory)][int]$ProcessId)
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$ES_CONTINUOUS = [uint32]'0x80000000'; $ES_SYSTEM_REQUIRED = [uint32]1
[Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 30 }
[Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
