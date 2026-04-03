#!/bin/sh
# Generate parsedmarc.ini from environment variables, then run parsedmarc
cat > /tmp/parsedmarc.ini << EOF
[general]
save_aggregate = True
save_forensic = True
output = /dev/null

[imap]
host = ${PARSEDMARC_IMAP_HOST}
port = ${PARSEDMARC_IMAP_PORT}
ssl = True
user = ${PARSEDMARC_IMAP_USER}
password = ${PARSEDMARC_IMAP_PASSWORD}
watch = True
delete = False
batch_size = ${PARSEDMARC_MAILBOX_BATCH_SIZE:-10}
reports_folder = ${PARSEDMARC_MAILBOX_REPORTS_FOLDER:-INBOX}
archive_folder = ${PARSEDMARC_MAILBOX_ARCHIVE_FOLDER:-Archive}

[influxdb]
host = ${PARSEDMARC_INFLUXDB_HOST}
port = ${PARSEDMARC_INFLUXDB_PORT}
ssl = False
org = ${PARSEDMARC_INFLUXDB_ORG}
token = ${PARSEDMARC_INFLUXDB_TOKEN}
bucket = ${PARSEDMARC_INFLUXDB_BUCKET}
EOF

exec parsedmarc -c /tmp/parsedmarc.ini --debug
