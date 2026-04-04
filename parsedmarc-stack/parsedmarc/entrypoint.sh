#!/bin/sh
# Generate parsedmarc.ini from environment variables, then run parsedmarc
mkdir -p /data/aggregate /data/forensic /data/processed
cat > /tmp/parsedmarc.ini << EOF
[general]
save_aggregate = True
save_forensic = True
output = /data

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
EOF

exec parsedmarc -c /tmp/parsedmarc.ini --debug
