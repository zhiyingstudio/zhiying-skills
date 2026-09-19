# node-recyclerd.ps1 - resident self-healing supervisor for an AI inference node
#
# ONE PROCESS, TWO JOBS
#   1. RECOVERY - if the service port stops listening, bring the node back
#      immediately. A 1-minute scheduled watchdog leaves up to 60s of dead
#      air; this daemon polls every POLL_SEC, so recovery is near-instant.
#   2. PREVENTION - inference runtimes that accumulate in-process state die
#      natively after roughly N consecutive jobs (e.g. 0xc0000005 in a native
#      module). After every MAX_TASKS completed jobs we recycle the node
#      BEFORE it reaches the crash zone.
#
# TRAPS ALREADY PAID FOR (do not re-introduce)
#   * Sample the counter often. A once-a-minute poll under-counts when jobs
#     are short; each missed tick is a missed recycle that lets the node
#     walk into the crash zone.
#   * Use a SHORT idle window. Right after a job ends the node is still
#     writing, so a long "quiet dir" window never opens and the recycler
#     silently does nothing. IDLE_SEC only confirms the job really ended.
#   * Re-baseline the marker AFTER a restart instead of zeroing it, or the
#     next loop re-counts an already-counted job and kills a fresh client job.
#   * Kill the whole process tree (workers AND the launcher wrapper). With a
#     scheduled task registered as MultipleInstancesPolicy=IgnoreNew, any
#     survivor makes the next "schtasks /run" a silent no-op.
#   * Start the service via its scheduled task (it carries the right account
#     and environment). Do not spawn the app directly.
#
# MUST be pure ASCII - PowerShell 5.1 misreads BOM-less UTF-8 as GBK and a
# non-ASCII comment silently breaks the whole script. Check with:
#   LC_ALL=C grep -n '[^ -~]' node-recyclerd.ps1   (expect no output)

# --------------------------- configuration --------------------------------
$Port            = 7860                          # service listen port
$ChangeDir       = 'D:\ai-service\workspace'     # dir the service writes per job
$MarkerName      = 'output-final.bin'            # file rewritten on EVERY job done
$ProcessMatch    = '*ai-service*'                # CommandLine match for workers
$WrapperMatch    = '*start-service*'             # CommandLine match for launcher
$ServiceTaskName = 'aisvc'                       # scheduled task that starts it
$LogFile         = 'C:\ops\recycler.log'
$LockFile        = 'C:\ops\recycler.lock'
$MAX_TASKS       = 2                             # crash threshold minus one
$IDLE_SEC        = 8                             # quiet-window to confirm job end
$POLL_SEC        = 4                             # counter sample period
# ---------------------------------------------------------------------------

function Log($m) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $LogFile -Value "$ts recyclerd: $m"
}

function Test-Listening {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-MarkerTicks {
  $m = Join-Path $ChangeDir $MarkerName
  if (Test-Path $m) { return (Get-Item $m).LastWriteTime.Ticks }
  return 0
}

function Stop-ServiceTree {
  # kill workers AND the launcher wrapper - see note above
  $py = 0; $cm = 0
  foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $cl = $p.CommandLine
    if (-not $cl) { continue }
    if ($p.Name -eq 'python.exe' -and $cl -like $ProcessMatch) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $py++
    }
  }
  foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    if ($p.Name -ne 'cmd.exe') { continue }
    $cl = $p.CommandLine
    if ($cl -and $cl -like $WrapperMatch) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $cm++
    }
  }
  return "$py workers + $cm wrappers"
}

function Start-ServiceAndWait($timeoutSec) {
  schtasks /run /tn $ServiceTaskName 2>$null | Out-Null
  $waited = 0
  while ($waited -lt $timeoutSec) {
    Start-Sleep -Seconds 4
    $waited += 4
    if (Test-Listening) { return $waited }
  }
  return -1
}

function Invoke-Recycle($reason) {
  if (Test-Path $LockFile) {
    $age = ((Get-Date) - (Get-Item $LockFile).LastWriteTime).TotalMinutes
    if ($age -lt 5) { return $false }
  }
  Log "$reason - recycling"
  New-Item $LockFile -Force | Out-Null

  $killed = Stop-ServiceTree
  Log "killed $killed"
  Start-Sleep -Seconds 3
  Get-ChildItem -Path $ChangeDir -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

  $t = Start-ServiceAndWait 40
  if ($t -gt 0) {
    Log "node up in ${t}s"
  } else {
    Log "node down after 40s - second attempt"
    Stop-ServiceTree | Out-Null
    Start-Sleep -Seconds 3
    $t = Start-ServiceAndWait 40
    if ($t -gt 0) { Log "second attempt OK (${t}s)" } else { Log "second attempt FAILED" }
  }

  Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
  return $true
}

Log "supervisor started (port=$Port max_tasks=$MAX_TASKS idle=$IDLE_SEC poll=$POLL_SEC)"

# baseline the marker immediately so jobs finished before this start are not counted
$prevTicks = Get-MarkerTicks
$count = 0
$downSince = $null
if ($prevTicks -eq 0) { $prevTicks = -1 }   # -1 = "marker not seen yet"

while ($true) {
  Start-Sleep -Seconds $POLL_SEC

  # --- job 1: recovery -----------------------------------------------------
  if (-not (Test-Listening)) {
    if (-not $downSince) { $downSince = Get-Date }
    $down = [int]((Get-Date) - $downSince).TotalSeconds
    if ($down -ge 15) {
      Invoke-Recycle "node not listening for ${down}s" | Out-Null
      $downSince = $null
      # re-baseline instead of zeroing - see note above
      $prevTicks = Get-MarkerTicks
      if ($prevTicks -eq 0) { $prevTicks = -1 }
      $count = 0
    }
    continue
  }
  $downSince = $null

  # --- job 2: task counting ------------------------------------------------
  $ticks = Get-MarkerTicks
  if ($ticks -eq 0) { continue }
  if ($prevTicks -eq -1) { $prevTicks = $ticks; continue }
  if ($ticks -gt $prevTicks) {
    $count++
    $prevTicks = $ticks
    Log "task done, count=$count / $MAX_TASKS"
  }

  if ($count -lt $MAX_TASKS) { continue }

  $newest = Get-ChildItem -Path $ChangeDir -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $quiet = 0
  if ($newest) { $quiet = [int]((Get-Date) - $newest.LastWriteTime).TotalSeconds }
  if ($quiet -lt $IDLE_SEC) { continue }

  if (Invoke-Recycle "count $count >= $MAX_TASKS, idle ${quiet}s") {
    $prevTicks = Get-MarkerTicks
    if ($prevTicks -eq 0) { $prevTicks = -1 }
    $count = 0
  }
}
