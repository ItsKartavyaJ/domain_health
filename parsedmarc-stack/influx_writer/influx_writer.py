#!/usr/bin/env python3
"""
influx_writer.py — watches parsedmarc's aggregate.json and writes to InfluxDB.

parsedmarc v8 appends aggregate report JSON objects to {output}/aggregate.json.
We tail this file, parse each new report, and POST line protocol to InfluxDB v2.
"""
import collections
import hashlib
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
AGGREGATE_LOCK_DIR = Path(os.environ.get("AGGREGATE_LOCK_DIR", "/data/aggregate.lock"))
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))
MAX_PROCESSED_IDS = 10_000
MAX_READ_BYTES = 50 * 1024 * 1024  # 50 MB per poll — prevents OOM on large backlogs
COMPACT_CHUNK_BYTES = 1024 * 1024
COMPACT_STABILITY_SECONDS = 0.2


class BoundedIdSet:
    """A set that evicts the oldest entries when it exceeds max_size."""

    def __init__(self, max_size: int = MAX_PROCESSED_IDS) -> None:
        self._max_size = max_size
        self._set: set[str] = set()
        self._order: collections.deque[str] = collections.deque()

    def __contains__(self, item: str) -> bool:
        return item in self._set

    def __len__(self) -> int:
        return len(self._set)

    def add(self, item: str) -> None:
        if item in self._set:
            return
        self._set.add(item)
        self._order.append(item)
        while len(self._set) > self._max_size:
            oldest = self._order.popleft()
            self._set.discard(oldest)


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


def _report_key(report: dict) -> str:
    """Stable dedup key: report_id if present, content hash otherwise."""
    rid = report.get("report_metadata", {}).get("report_id", "")
    if rid:
        return rid
    return "hash:" + hashlib.sha256(json.dumps(report, sort_keys=True).encode()).hexdigest()


def parse_aggregate_json(text: str) -> tuple[list, int]:
    """Parse parsedmarc's aggregate.json which may contain one or more JSON objects.
    parsedmarc appends JSON arrays of reports to the file.

    Returns (reports, consumed_bytes) where consumed_bytes is the number of bytes
    from the original UTF-8 input that were fully parsed or confirmed garbage.
    The caller must advance last_size by consumed_bytes only — not by the full
    read length — so a partial array at the tail (parsedmarc mid-write) is
    retried on the next poll.

    last_good_pos: char pos after the last successfully parsed object.
    last_safe_pos: char pos up to which bytes are confirmed consumed (parsed or
                   confirmed garbage). Advances when corrupt bytes are skipped
                   to a boundary, even if the array at that boundary is still a
                   partial write. This prevents the read pointer from getting
                   stuck re-reading the same garbage bytes every poll.
    """
    reports = []
    if not text:
        return reports, 0

    decoder = json.JSONDecoder()
    pos = 0
    last_good_pos = 0
    last_safe_pos = 0
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
            last_good_pos = end
            last_safe_pos = end
            pos = end
        except json.JSONDecodeError:
            # Skip past corrupt data to the next top-level object boundary.
            next_boundary = text.find("\n[", pos + 1)
            if next_boundary == -1:
                # Possibly a partial write at the tail — don't advance past it.
                remaining = len(text) - pos
                if remaining > 0:
                    print(f"[WARN] {remaining} unparsed bytes at tail — will retry next poll", flush=True)
                break
            skipped = next_boundary - pos
            print(f"[WARN] skipped {skipped} corrupt bytes at offset {pos}", flush=True)
            # Advance last_safe_pos to the boundary so confirmed-garbage bytes
            # are not re-read next poll, even if the array at next_boundary is
            # still a partial write.
            last_safe_pos = next_boundary
            pos = next_boundary

    consumed_bytes = len(text[:last_safe_pos].encode("utf-8", errors="replace"))
    return reports, consumed_bytes


def compact_processed_prefix(consumed_bytes: int, original_size: int) -> None:
    """Remove the safely consumed prefix from aggregate.json."""
    if consumed_bytes <= 0 or not AGGREGATE_FILE.exists():
        return

    try:
        AGGREGATE_LOCK_DIR.mkdir()
    except FileExistsError:
        print("[INFO] aggregate lock is held; deferring cleanup", flush=True)
        return

    try:
        first_stat = AGGREGATE_FILE.stat()
        time.sleep(COMPACT_STABILITY_SECONDS)
        second_stat = AGGREGATE_FILE.stat()
        if (
            first_stat.st_size != second_stat.st_size
            or first_stat.st_mtime_ns != second_stat.st_mtime_ns
        ):
            print("[INFO] aggregate file changed during compaction check; deferring cleanup", flush=True)
            return

        current_size = second_stat.st_size
        if current_size < consumed_bytes:
            print("[WARN] aggregate file shrank before compaction; skipping cleanup", flush=True)
            return

        if current_size != original_size:
            print("[INFO] aggregate file size changed since read; deferring cleanup", flush=True)
            return

        with open(AGGREGATE_FILE, "rb+") as f:
            read_pos = consumed_bytes
            write_pos = 0
            while True:
                f.seek(read_pos)
                chunk = f.read(COMPACT_CHUNK_BYTES)
                if not chunk:
                    break
                read_pos += len(chunk)
                f.seek(write_pos)
                f.write(chunk)
                write_pos += len(chunk)
            f.truncate(write_pos)

        remaining = current_size - consumed_bytes
        print(
            f"[INFO] compacted aggregate file; removed {consumed_bytes} bytes, kept {remaining} tail bytes",
            flush=True,
        )
    finally:
        try:
            AGGREGATE_LOCK_DIR.rmdir()
        except OSError:
            pass


def main() -> None:
    print(f"[INFO] watching {AGGREGATE_FILE} every {POLL_INTERVAL}s", flush=True)
    print(f"[INFO] influx -> {INFLUX_URL} org={INFLUX_ORG} bucket={INFLUX_BUCKET}", flush=True)

    processed_ids = BoundedIdSet()
    print("[INFO] queue compaction enabled; report IDs are deduped in memory", flush=True)

    while True:
        try:
            if AGGREGATE_FILE.exists():
                current_size = AGGREGATE_FILE.stat().st_size
                if current_size > MAX_READ_BYTES:
                    print(
                        f"[WARN] aggregate file is {current_size} bytes; "
                        f"reading first {MAX_READ_BYTES} bytes this poll",
                        flush=True,
                    )
                with open(AGGREGATE_FILE, "rb") as f:
                    new_bytes = f.read(MAX_READ_BYTES)
                reports, consumed = parse_aggregate_json(new_bytes.decode("utf-8", errors="replace"))

                pending_keys = []
                new_lines = []
                new_count = 0
                for report in reports:
                    key = _report_key(report)
                    if key in processed_ids:
                        continue
                    lines = report_to_lines(report)
                    new_lines.extend(lines)
                    pending_keys.append(key)
                    new_count += 1

                if new_lines:
                    write_to_influx(new_lines)
                    for key in pending_keys:
                        processed_ids.add(key)
                    print(f"[OK] wrote {len(new_lines)} points from {new_count} new reports", flush=True)
                    compact_processed_prefix(consumed, current_size)
                elif new_count:
                    # Reports parsed OK but had no records; mark them so they are
                    # not rechecked on every subsequent poll.
                    for key in pending_keys:
                        processed_ids.add(key)
                    print(f"[INFO] {new_count} empty reports marked as processed", flush=True)
                    compact_processed_prefix(consumed, current_size)
                elif reports:
                    print(f"[INFO] {len(reports)} reports already processed", flush=True)
                    compact_processed_prefix(consumed, current_size)
                elif consumed == 0 and current_size:
                    print("[WARN] aggregate file has no complete JSON object yet", flush=True)
        except urllib.error.HTTPError as exc:
            print(f"[ERROR] InfluxDB {exc.code}: {exc.read()}", flush=True)
        except Exception as exc:
            print(f"[ERROR] {exc}", flush=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
