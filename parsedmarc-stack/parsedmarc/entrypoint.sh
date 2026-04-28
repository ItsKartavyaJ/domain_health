#!/bin/sh
# Generate parsedmarc.ini from environment variables, then run parsedmarc once
# per interval. This avoids a permanent IMAP watch loop when the mailbox is idle.
set -u

RUN_INTERVAL_SECONDS="${PARSEDMARC_RUN_INTERVAL_SECONDS:-3600}"
LOCK_DIR="${AGGREGATE_LOCK_DIR:-/data/aggregate.lock}"
HEARTBEAT_FILE="${PARSEDMARC_HEARTBEAT_FILE:-/tmp/parsedmarc.heartbeat}"
STALE_LOCK_SECONDS="${AGGREGATE_LOCK_STALE_SECONDS:-1800}"

cat > /tmp/parsedmarc.ini << EOF
[general]
save_aggregate = True
save_forensic = False
output = /data

[imap]
host = ${PARSEDMARC_IMAP_HOST}
port = ${PARSEDMARC_IMAP_PORT}
ssl = True
user = ${PARSEDMARC_IMAP_USER}
password = ${PARSEDMARC_IMAP_PASSWORD}

[mailbox]
watch = False
delete = False
batch_size = ${PARSEDMARC_MAILBOX_BATCH_SIZE:-10}
reports_folder = ${PARSEDMARC_MAILBOX_REPORTS_FOLDER:-INBOX}
archive_folder = ${PARSEDMARC_MAILBOX_ARCHIVE_FOLDER:-Archive}
EOF

child_pid=""
lock_held="false"

touch "$HEARTBEAT_FILE"

acquire_lock() {
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    now="$(date +%s)"
    lock_mtime="$(date -r "$LOCK_DIR" +%s 2>/dev/null || echo "$now")"
    if [ $((now - lock_mtime)) -gt "$STALE_LOCK_SECONDS" ]; then
      echo "[WARN] removing stale aggregate lock at $LOCK_DIR"
      rmdir "$LOCK_DIR" 2>/dev/null || true
      continue
    fi
    echo "[INFO] waiting for aggregate lock at $LOCK_DIR"
    sleep 5
  done
  lock_held="true"
}

release_lock() {
  if [ "$lock_held" = "true" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
    lock_held="false"
  fi
}

stop() {
  if [ -n "$child_pid" ]; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  release_lock
  exit 0
}

trap stop INT TERM

echo "[INFO] parsedmarc scheduled mode enabled; interval=${RUN_INTERVAL_SECONDS}s"

while true; do
  echo "[INFO] starting parsedmarc one-shot run"
  touch "$HEARTBEAT_FILE"
  acquire_lock
  parsedmarc -c /tmp/parsedmarc.ini --debug &
  child_pid="$!"
  wait "$child_pid"
  status="$?"
  child_pid=""
  release_lock
  touch "$HEARTBEAT_FILE"

  if [ "$status" -eq 0 ]; then
    echo "[INFO] parsedmarc run complete; sleeping ${RUN_INTERVAL_SECONDS}s"
  else
    echo "[WARN] parsedmarc exited with status ${status}; sleeping ${RUN_INTERVAL_SECONDS}s"
  fi

  sleep "$RUN_INTERVAL_SECONDS" &
  child_pid="$!"
  wait "$child_pid"
  child_pid=""
done
