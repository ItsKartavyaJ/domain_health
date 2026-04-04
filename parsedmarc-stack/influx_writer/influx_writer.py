#!/usr/bin/env python3
"""
influx_writer.py — watches parsedmarc aggregate output and writes to InfluxDB.

parsedmarc v8 with save_aggregate=True writes one JSON per report to
{output}/aggregate/. We convert each record to InfluxDB line protocol
and POST to InfluxDB v2. Processed files are moved to {processed_dir}.
"""
import json
import os
import shutil
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

INFLUX_URL = os.environ.get("INFLUX_URL", "http://influxdb:8086")
INFLUX_ORG = os.environ.get("INFLUX_ORG", "pintel")
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN", "")
INFLUX_BUCKET = os.environ.get("INFLUX_BUCKET", "dmarc")
WATCH_DIR = Path(os.environ.get("WATCH_DIR", "/data/aggregate"))
PROCESSED_DIR = Path(os.environ.get("PROCESSED_DIR", "/data/processed"))
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))


def escape_tag(value: str) -> str:
    return value.replace(" ", r"\ ").replace(",", r"\,").replace("=", r"\=")


def parse_timestamp_ns(dt_str: str) -> int:
    """'YYYY-MM-DD HH:MM:SS' → Unix nanoseconds (UTC)."""
    try:
        dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1_000_000_000)
    except (ValueError, TypeError):
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


def process_file(path: Path) -> bool:
    try:
        with open(path) as f:
            data = json.load(f)

        # handle both individual report objects and batch wrappers
        if "aggregate_reports" in data:
            reports = data["aggregate_reports"]
        elif "records" in data:
            reports = [data]
        else:
            print(f"[WARN] unrecognised format in {path.name}, skipping", flush=True)
            return True

        all_lines = []
        for report in reports:
            all_lines.extend(report_to_lines(report))

        if not all_lines:
            print(f"[INFO] no records in {path.name}", flush=True)
            return True

        write_to_influx(all_lines)
        print(f"[OK] wrote {len(all_lines)} points from {path.name}", flush=True)
        return True

    except urllib.error.HTTPError as exc:
        print(f"[ERROR] InfluxDB {exc.code} for {path.name}: {exc.read()}", flush=True)
        return False
    except Exception as exc:
        print(f"[ERROR] {path.name}: {exc}", flush=True)
        return False


def main() -> None:
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[INFO] watching {WATCH_DIR} every {POLL_INTERVAL}s", flush=True)
    print(f"[INFO] influx → {INFLUX_URL} org={INFLUX_ORG} bucket={INFLUX_BUCKET}", flush=True)

    while True:
        for json_file in sorted(WATCH_DIR.glob("*.json")):
            if process_file(json_file):
                dest = PROCESSED_DIR / json_file.name
                if dest.exists():
                    dest = PROCESSED_DIR / f"{json_file.stem}_{int(time.time())}.json"
                shutil.move(str(json_file), str(dest))
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
