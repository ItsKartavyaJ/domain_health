#!/bin/bash
# Wipe the dmarc InfluxDB bucket and reprocess all archived DMARC reports.
# Run this ON THE VM inside parsedmarc-stack/:
#   cd /opt/domain_health/parsedmarc-stack
#   bash ../scripts/reprocess-dmarc.sh
set -euo pipefail

STACK_DIR="$(cd "$(dirname "$0")/../parsedmarc-stack" && pwd)"
ENV_FILE="$STACK_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

# Load env vars so we can call InfluxDB API
set -a; source "$ENV_FILE"; set +a

INFLUX_BUCKET="${INFLUXDB_DMARC_BUCKET:-dmarc}"
INFLUX_ORG="${INFLUXDB_ORG:-pintel}"
INFLUX_TOKEN="${INFLUXDB_TOKEN}"
INFLUX_URL="http://localhost:8086"

echo "=== Step 1: Stop parsedmarc ==="
docker compose -f "$STACK_DIR/docker-compose.yml" stop parsedmarc influx_writer
echo "parsedmarc stopped."

echo ""
echo "=== Step 2: Wipe '$INFLUX_BUCKET' bucket ==="
# Delete all data in the bucket (epoch start → now)
curl -sf \
  -X POST "$INFLUX_URL/api/v2/delete?org=${INFLUX_ORG}&bucket=${INFLUX_BUCKET}" \
  -H "Authorization: Token ${INFLUX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"start":"1970-01-01T00:00:00Z","stop":"2099-01-01T00:00:00Z"}' \
  && echo "Bucket wiped." \
  || { echo "ERROR: bucket wipe failed"; exit 1; }

echo ""
echo "=== Step 3: Reprocess Archive folder (one-shot, no watch) ==="
# Run parsedmarc directly — same config but:
#   reports_folder = Archive   (read from Archive)
#   archive_folder = Archive   (write back to Archive so nothing moves)
#   watch = False              (exit after draining, don't wait for new mail)
docker run --rm \
  --network parsedmarc-stack_dmarc_net \
  --env-file "$STACK_DIR/.env" \
  -e PARSEDMARC_MAILBOX_REPORTS_FOLDER=Archive \
  -e PARSEDMARC_MAILBOX_ARCHIVE_FOLDER=Archive \
  "$(docker inspect --format='{{.Config.Image}}' parsedmarc 2>/dev/null || \
     docker compose -f "$STACK_DIR/docker-compose.yml" images -q parsedmarc | head -1)" \
  sh -c '
    cat > /tmp/reprocess.ini << EOINI
[general]
save_aggregate = True
save_forensic = True

[imap]
host = '"${PARSEDMARC_IMAP_HOST}"'
port = '"${PARSEDMARC_IMAP_PORT}"'
ssl = True
user = '"${PARSEDMARC_IMAP_USER}"'
password = '"${PARSEDMARC_IMAP_PASSWORD}"'

[mailbox]
watch = False
delete = False
batch_size = 50
reports_folder = Archive
archive_folder = Archive

[influxdb2]
url = http://'"${PARSEDMARC_INFLUXDB_HOST}"':'"${PARSEDMARC_INFLUXDB_PORT}"'
org = '"${PARSEDMARC_INFLUXDB_ORG}"'
bucket = '"${PARSEDMARC_INFLUXDB_BUCKET}"'
token = '"${PARSEDMARC_INFLUXDB_TOKEN}"'
EOINI
    exec parsedmarc -c /tmp/reprocess.ini --debug
  '

echo ""
echo "=== Step 4: Restart parsedmarc in normal watch mode ==="
docker compose -f "$STACK_DIR/docker-compose.yml" start parsedmarc
echo "Done. parsedmarc is watching INBOX again."
echo ""
echo "Check progress:"
echo "  docker logs -f parsedmarc"
