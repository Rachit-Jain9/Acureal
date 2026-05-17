#!/usr/bin/env python3
"""One-shot extractor: dump the BBMP Guidance Value PDF to per-page UTF-8 text files.

Writes one file per page under tmp/guidance-value/page-NNN.txt so the agent can
read individual pages without blowing the Read-tool size budget. Also writes a
top-level manifest.txt with page-count + per-page byte sizes so the agent can
plan which pages to read first.
"""
from __future__ import annotations
import sys
from pathlib import Path
from pypdf import PdfReader

PDF = Path(r"C:\Users\rachi\OneDrive - UW\Desktop\Masterplan\Guidance Value.pdf")
OUT = Path(__file__).resolve().parent.parent / "tmp" / "guidance-value"


def main() -> int:
    if not PDF.exists():
        print(f"ERROR: missing input PDF at {PDF}", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(PDF))
    page_count = len(reader.pages)
    manifest_lines = [
        f"PDF: {PDF.name}",
        f"Page count: {page_count}",
        "",
        "Per-page byte sizes (extracted text):",
    ]

    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # pylint: disable=broad-except
            text = f"[extraction failed: {exc}]"
        out_path = OUT / f"page-{i:03d}.txt"
        out_path.write_text(text, encoding="utf-8", errors="replace")
        manifest_lines.append(f"  page-{i:03d}.txt  {len(text):>7}  bytes")

    (OUT / "manifest.txt").write_text("\n".join(manifest_lines), encoding="utf-8")
    print(f"Wrote {page_count} pages to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
