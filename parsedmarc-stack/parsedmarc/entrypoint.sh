#!/bin/sh
# Generate parsedmarc.ini from environment variables, then run parsedmarc
cat > /tmp/parsedmarc.ini << EOF
[general]
save_aggregate = False
save_forensic = False

[imap]
host = ${PARSEDMARC_IMAP_HOST}
port = ${PARSEDMARC_IMAP_PORT}
ssl = True
user = ${PARSEDMARC_IMAP_USER}
password = ${PARSEDMARC_IMAP_PASSWORD}

[mailbox]
watch = True
delete = False
batch_size = ${PARSEDMARC_MAILBOX_BATCH_SIZE:-10}
reports_folder = ${PARSEDMARC_MAILBOX_REPORTS_FOLDER:-INBOX}
archive_folder = ${PARSEDMARC_MAILBOX_ARCHIVE_FOLDER:-Archive}

[influxdb2]
url = ${INFLUXDB_URL}
org = ${INFLUXDB_ORG}
token = ${INFLUXDB_TOKEN}
bucket = ${INFLUXDB_DMARC_BUCKET}
EOF

exec parsedmarc -c /tmp/parsedmarc.ini --debug
