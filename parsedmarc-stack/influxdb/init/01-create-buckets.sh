#!/bin/bash
# Runs once on first InfluxDB startup to create additional buckets.
# The primary 'dmarc' bucket is created by DOCKER_INFLUXDB_INIT_BUCKET.
# This creates the 'deliverability' bucket used by deliverability_monitor.

set -e

echo "Creating deliverability bucket..."
influx bucket create \
  --name deliverability \
  --org "${DOCKER_INFLUXDB_INIT_ORG}" \
  --retention 365d \
  --token "${DOCKER_INFLUXDB_INIT_ADMIN_TOKEN}" \
  --host http://localhost:8086 \
  || echo "Bucket 'deliverability' already exists — skipping"

echo "InfluxDB init complete."
