#!/usr/bin/env python3
"""Convert tmp/bbmp-street-index.json into a sequence of batched INSERT SQL
files the agent can apply via the Supabase MCP execute_sql tool.

Why batched files vs one big migration:
    - 9,913 rows in one INSERT exceeds Supabase SQL editor and MCP payload
      limits in practice.
    - 500 rows per batch ≈ ~80 KB SQL per file, well under any limit.
    - File names sort lexicographically so the agent can apply them in order.

Output: tmp/bbmp-street-seed/batch-NNN.sql (20 files for 9,913 rows).
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

TMP = Path(__file__).resolve().parent.parent / "tmp"
IN_FILE = TMP / "bbmp-street-index.json"
OUT_DIR = TMP / "bbmp-street-seed"
BATCH_SIZE = 500


def sql_quote(value) -> str:
    """Single-quote-safe SQL literal for text values."""
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def main() -> int:
    if not IN_FILE.exists():
        print(f"ERROR: missing {IN_FILE} — run build-bbmp-street-index.py first", file=sys.stderr)
        return 1

    data = json.loads(IN_FILE.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Wipe stale batches so re-runs are clean.
    for old in OUT_DIR.glob("batch-*.sql"):
        old.unlink()

    total_batches = (len(data) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(total_batches):
        start = batch_idx * BATCH_SIZE
        end = min(start + BATCH_SIZE, len(data))
        chunk = data[start:end]

        rows_sql = []
        for r in chunk:
            # Normalise ARO section (drop \xa0 non-breaking spaces).
            aro = (r.get("aro_section") or "").replace("\xa0", " ").strip() or None
            cols = [
                sql_quote(r["street_name_en"]),
                sql_quote(r.get("ward_no")),
                sql_quote(r["page_number"]),
                sql_quote(aro),
                sql_quote(r.get("row_excerpt")),
            ]
            rows_sql.append(f"  ({', '.join(cols)})")

        sql = (
            "INSERT INTO regulatory_data.bbmp_street_index\n"
            "  (street_name_en, ward_no, page_number, aro_section, row_excerpt)\n"
            "VALUES\n"
            + ",\n".join(rows_sql)
            + "\nON CONFLICT (lower(street_name_en), ward_no, page_number) DO NOTHING;\n"
        )

        out_path = OUT_DIR / f"batch-{batch_idx + 1:03d}.sql"
        out_path.write_text(sql, encoding="utf-8")

    print(f"Wrote {total_batches} batches ({len(data)} rows) to {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
