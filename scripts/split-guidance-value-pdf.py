#!/usr/bin/env python3
"""Split the BBMP Guidance Value PDF into one PDF file per page.

Output: tmp/pdf-pages/page-NNN.pdf (one per source page, 1..686).
"""
from __future__ import annotations
import sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter

PDF = Path(r"C:\Users\rachi\OneDrive - UW\Desktop\Masterplan\Guidance Value.pdf")
OUT = Path(__file__).resolve().parent.parent / "tmp" / "pdf-pages"


def main() -> int:
    if not PDF.exists():
        print(f"ERROR: missing input PDF at {PDF}", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(PDF))
    page_count = len(reader.pages)

    written = 0
    for i, page in enumerate(reader.pages, start=1):
        out_path = OUT / f"page-{i:03d}.pdf"
        # Skip pages we've already written so re-runs are idempotent + fast.
        if out_path.exists():
            written += 1
            continue
        writer = PdfWriter()
        writer.add_page(page)
        with open(out_path, "wb") as f:
            writer.write(f)
        written += 1

    print(f"Wrote {written}/{page_count} single-page PDFs to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
