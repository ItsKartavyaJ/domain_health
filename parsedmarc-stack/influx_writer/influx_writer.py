#!/usr/bin/env python3
"""
influx_writer.py — watches parsedmarc's aggregate.json and writes to InfluxDB.

parsedmarc v8 appends aggregate report JSON objects to {output}/aggregate.json.
We tail this file, parse each new report, and POST line protocol to InfluxDB v2.
"""
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

INFLUX_URL = os.environ.get("INFLUX_URL", "http://influxdb:8086")
INFLUX_ORG = os.environ.get("INFLUX_ORG", "pintel")
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN", "")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "dmarc")
AGGREGATE_FILE = Path(os.environ.get("AGGREGATE_FILE", "/data/aggregate.json"))
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))


def escape_tag(value: str) -> str:
    return value.replace(" ", r"\ ").replace(",", r"\,").replace("=", r"\=")


def parse_timestamp_ns(dt_str: str) -> int:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(dt_str, fmt).replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1_000_000_000)
        except (ValueError, TypeError):
            continue
    return int(datetime.now(timezone.utc).timestamp() * 1_000_000_000)


def report_to_lines(report: dict) -> list:
    lines = []
    for record in report.get("records", []):
        identifiers = record.get("identifiers", {})
        alignment = record.get("alignment", {})

        header_from = (
            identifiers.get("header_from")
            or report.get("policy_published", {}).get("domain")
            or "unknown"
        )
        header_from = escape_tag(header_from)

        count = int(record.get("count", 0))
        passed = str(bool(alignment.get("dmarc", False))).lower()
        spf = str(bool(alignment.get("spf", False))).lower()
        dkim = str(bool(alignment.get("dkim", False))).lower()
        ts_ns = parse_timestamp_ns(record.get("interval_begin", ""))

        lines.append(
            f"dmarc_aggregate,header_from={header_from} "
            f"message_count={count}i,"
            f"passed_dmarc={passed},"
            f"spf_aligned={spf},"
            f"dkim_aligned={dkim} "
            f"{ts_ns}"
        )
    return lines


def write_to_influx(lines: list) -> None:
    url = (
        f"{INFLUX_URL.rstrip('/')}/api/v2/write"
        f"?org={INFLUX_ORG}&bucket={INFLUX_BUCKET}&precision=ns"
    )
    body = "\n".join(lines).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Token {INFLUX_TOKEN}",
            "Content-Type": "text/plain; charset=utf-8",
        },
        method="POST",
    )
    urllib.request.urlopen(req, timeout=30)


def parse_aggregate_json(text: str) -> list:
    """Parse parsedmarc's aggregate.json which may contain one or more JSON objects.
    parsedmarc appends JSON arrays of reports to the file."""
    reports = []
    # Try as a single JSON array first
    text = text.strip()
    if not text:
        return reports

    # parsedmarc appends complete JSON arrays, one per batch
    # Try to parse by finding top-level [ ] blocks
    decoder = json.JSONDecoder()
    pos = 0
    while pos < len(text):
        # Skip whitespace
        while pos < len(text) and text[pos] in " \t\n\r":
            pos += 1
        if pos >= len(text):
            break
        try:
            obj, end = decoder.raw_decode(text, pos)
            if isinstance(obj, list):
                reports.extend(obj)
            elif isinstance(obj, dict):
                reports.append(obj)
            pos = end
        except json.JSONDecodeError:
            # Skip past the problem character and try again
            pos += 1
    return reports


def main() -> None:
    print(f"[INFO] watching {AGGREGATE_FILE} every {POLL_INTERVAL}s", flush=True)
    print(f"[INFO] influx -> {INFLUX_URL} org={INFLUX_ORG} bucket={INFLUX_BUCKET}", flush=True)

    last_size = 0
    processed_ids = set()

    # Load existing processed IDs if file already exists
    if AGGREGATE_FILE.exists():
        try:
            text = AGGREGATE_FILE.read_text(encoding="utf-8")
            for report in parse_aggregate_json(text):
                rid = report.get("report_metadata", {}).get("report_id", "")
                if rid:
                    processed_ids.add(rid)
            last_size = AGGREGATE_FILE.stat().st_size
            print(f"[INFO] found {len(processed_ids)} existing reports, starting from {last_size} bytes", flush=True)
        except Exception as exc:
            print(f"[WARN] error reading existing file: {exc}", flush=True)

    while True:
        try:
            if AGGREGATE_FILE.exists():
                current_size = AGGREGATE_FILE.stat().st_size
                if current_size > last_size:
                    text = AGGREGATE_FILE.read_text(encoding="utf-8")
                    reports = parse_aggregate_json(text)

                    new_lines = []
                    new_count = 0
                    for report in reports:
                        rid = report.get("report_metadata", {}).get("report_id", "")
                        if rid and rid in processed_ids:
                            continue
                        lines = report_to_lines(report)
                        new_lines.extend(lines)
                        if rid:
                            processed_ids.add(rid)
                        new_count += 1

                    if new_lines:
                        write_to_influx(new_lines)
                        print(f"[OK] wrote {len(new_lines)} points from {new_count} new reports", flush=True)

                    last_size = current_size
        except urllib.error.HTTPError as exc:
            print(f"[ERROR] InfluxDB {exc.code}: {exc.read()}", flush=True)
        except Exception as exc:
            print(f"[ERROR] {exc}", flush=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
