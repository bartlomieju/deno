#!/bin/bash
# Daemon demo — all containers are isolate threads inside ONE daemon process.
#
# Usage: bash examples/container/09_daemon_demo.sh

DENO="./target/debug/deno"

echo "=== Deno Container Daemon Demo ==="
echo ""
echo "All containers share a single daemon process (~3MB incremental per container)."
echo ""

# 1. Spawn several detached containers
echo "--- Spawning 3 detached containers ---"
$DENO container -d --eval "globalThis.name = 'agent-1'" --memory=32m 2>&1
$DENO container -d --eval "globalThis.name = 'agent-2'" --memory=64m 2>&1
$DENO container -d --eval "globalThis.name = 'agent-3'" --memory=16m 2>&1

# 2. Spawn cron containers
echo ""
echo "--- Spawning 2 cron containers ---"
$DENO container --cron="@every_3s" --eval "globalThis.tick = (globalThis.tick || 0) + 1" 2>&1
$DENO container --cron="@every_5s" --eval "globalThis.ping = Date.now()" 2>&1

echo ""
echo "--- Container listing ---"
$DENO container ps 2>&1

# Show process tree
echo ""
echo "--- Process threads (all containers = threads in one process) ---"
PID_FILE=$(python3 -c "import tempfile; print(tempfile.gettempdir())")/deno-container-daemon.sock.pid
if [ -f "$PID_FILE" ]; then
  DAEMON_PID=$(cat "$PID_FILE")
  ps -M "$DAEMON_PID" 2>/dev/null | head -20
fi

# Wait for cron ticks
echo ""
echo "--- Waiting 10s for cron ticks... ---"
sleep 10

echo ""
echo "--- After 10s (notice REQS increasing for cron containers) ---"
$DENO container ps 2>&1

# Non-detached eval — runs in daemon but cleans up automatically
echo ""
echo "--- Non-detached eval (auto-cleanup, won't appear in ps) ---"
echo -n "Result: "
$DENO container --eval "2 ** 16" 2>/dev/null

# Kill a cron container
echo ""
echo "--- Kill a cron container ---"
# Find a cron container ID
CRON_ID=$($DENO container ps 2>/dev/null | grep "cron" | head -1 | awk '{print $1}')
if [ -n "$CRON_ID" ]; then
  echo "Killing cron container $CRON_ID"
  $DENO container kill "$CRON_ID" 2>&1
fi

echo ""
echo "--- After kill ---"
$DENO container ps 2>&1

# Cleanup all
echo ""
echo "--- Cleaning up ---"
for ID in $($DENO container ps 2>/dev/null | tail -n +3 | awk '{print $1}'); do
  $DENO container kill "$ID" 2>/dev/null
done
echo "All containers stopped."

echo ""
echo "=== Done ==="
echo ""
echo "Try these yourself:"
echo "  $DENO container --eval 'Math.random()'                     # quick eval"
echo "  $DENO container -d --eval 'setInterval(()=>{},1000)'       # detach"
echo "  $DENO container --cron='@every_5s' --eval 'Date.now()'     # cron"
echo "  $DENO container --cron='@hourly' --eval 'cleanup()'        # hourly"
echo "  $DENO container --cron='*/15 * * * *' --eval 'report()'    # every 15m"
echo "  $DENO container ps                                         # list all"
echo "  $DENO container kill <id>                                   # kill one"
