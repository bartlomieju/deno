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
echo "--- Spawning 5 detached containers ---"
$DENO container -d --eval "globalThis.name = 'agent-1'" --memory=32m 2>&1
$DENO container -d --eval "globalThis.name = 'agent-2'" --memory=64m 2>&1
$DENO container -d --eval "globalThis.name = 'agent-3'" --memory=16m 2>&1
$DENO container -d --eval "globalThis.name = 'worker-a'" 2>&1
$DENO container -d --eval "globalThis.name = 'worker-b'" 2>&1

echo ""
echo "--- Container listing (deno container ps) ---"
$DENO container ps 2>&1

# Show process tree
echo ""
echo "--- Process threads (all containers = threads in one process) ---"
PID_FILE=$(python3 -c "import tempfile; print(tempfile.gettempdir())")/deno-container-daemon.sock.pid
if [ -f "$PID_FILE" ]; then
  DAEMON_PID=$(cat "$PID_FILE")
  ps -M "$DAEMON_PID" 2>/dev/null | head -20
fi

# Non-detached eval — runs in daemon but cleans up automatically
echo ""
echo "--- Non-detached eval (auto-cleanup) ---"
echo -n "Result: "
$DENO container --eval "2 ** 16" 2>/dev/null

# Kill one
echo ""
echo "--- Kill a container ---"
$DENO container ps 2>/dev/null
FIRST_ID=$($DENO container ps 2>/dev/null | tail -n +3 | head -1 | awk '{print $1}')
if [ -n "$FIRST_ID" ]; then
  $DENO container kill "$FIRST_ID" 2>&1
fi

echo ""
echo "--- After kill ---"
$DENO container ps 2>&1

echo ""
echo "=== Done ==="
echo ""
echo "Try these yourself:"
echo "  $DENO container --eval 'Math.random()'        # quick eval"
echo "  $DENO container -d --eval 'setInterval(()=>{},1000)'  # detach"
echo "  $DENO container ps                             # list all"
echo "  $DENO container kill <id>                      # kill one"
