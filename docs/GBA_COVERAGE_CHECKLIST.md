# GBA Coverage Checklist — planning authorities & master plans to gather

**Purpose:** a practical "what to gather" list so REDIP can extend operative master-plan / zoning
coverage from the BDA core out to the **other planning authorities now around / under the
Greater Bengaluru Authority (GBA)**. Built 2026-06-26 from primary/official sources (BMRDA's own
Local-Planning-Areas register + each authority's `*.tpa.gov.in` portal). Pairs with
`docs/REGULATORY_INTELLIGENCE_ARCHITECTURE.md` and the regulatory-intelligence memory.

> **Hard rule reminder:** ingest only the **operative** plan for each area. The Bengaluru
> **RMP 2031 is WITHDRAWN (July 2020) — never ingest it as authoritative** (PR #889 enforces this).
> The PDF folders the operator sent (`Desktop\Masterplan`, `Desktop\RMP`) are all RMP-2031-DRAFT
> *existing-land-use* sheets for **BDA Planning Districts already inside RMP 2015** — they do NOT
> fill the gap and must not be used as zoning.

---

## How the jurisdiction actually fits together (2025 transition)

- **GBA — Greater Bengaluru Authority** (Greater Bengaluru Governance Act 2024 / Karnataka Act 36 of
  2025; constituted 15 May 2025, operational 2 Sep 2025). The statutory **Planning Authority for the
  ~712 km² Bengaluru city core** (replaced BBMP). It is *expected* to notify its own master plan; until
  then **RMP 2015 remains the operative plan** for that core. **Watch for a new GBA master plan.**
- **BDA — Bangalore Development Authority.** Now the area planning authority for the **peripheral BMA
  zones outside GBA** (~582 km²). Operative plan = **RMP 2015**. ✅ *Already in REDIP.*
- **BMRDA — Bengaluru Metropolitan Region Development Authority.** Oversees the wider region and
  **coordinates the 12 Local Planning Authorities (LPAs) below**; publishes a regional **Structure /
  Land-Utilisation Plan 2031** (context only, not parcel zoning).
- The **gap** = the BMRDA LPAs *other than* BDA + Anekal. Each is a separate authority with its **own
  operative master plan + zonal regulations**, downloadable from its `*.tpa.gov.in` portal.

---

## ✅ Already in REDIP (do not re-gather)

| Authority | Area | Operative plan | Status |
|---|---|---|---|
| **BDA** | Bengaluru city core + BMA periphery | **RMP 2015** (operative; still being amended) | ✅ ingested (51 far_rules, 13 zones) |
| **Anekal PA** | Jigani, Attibele, Anekal | **Anekal LPA Master Plan 2031** (G.O. UDD 151 BMR 2013, 03-09-2014) | ✅ ingested (41 far_rules, 10 zones) |
| **BIAAPA** | Airport belt / Devanahalli | **BIAAPA Master Plan 2021** (gazette 29-01-2009) | ✅ **ingested + LIVE 2026-07-05** (37 far_rules, 10 zones, 5 facts; PR #934, migrations 20260721/22 applied to prod; 5-agent verified) |
| **Hoskote PA** | Hoskote (east belt) | **Hoskote LPA Master Plan 2031 (Provisional)** | ✅ **ingested 2026-07-05** (40 far_rules, 9 zones, 6 facts; PR #937, migrations 20260723/24; 5-agent verified — pending operator apply) |

---

## ⬇️ To gather (the real gap) — operative plans we do NOT yet have

Download each from the authority's **own portal** in *your* browser (these govt sites block
server-side fetches, so they must be downloaded by hand, then dropped to me to ingest the proven way).
**Each portal has an `…/en/master-plan` page** with the Proposed Land Use map + the Zoning/Zonal
Regulations PDF.

| # | Priority | Authority | Area / key localities | Plan to download | Official source |
|---|---|---|---|---|---|
| 1 | 🔴 High | **BIAAPA** — Bengaluru International Airport Area PA | Devanahalli / airport belt, ~228 villages, N Bengaluru | **BIAAPA Master Plan 2021** + Zoning of Land Use & Regulations | `biaapa.tpa.gov.in/en/planning` · zoning PDF: `kum.karnataka.gov.in/KUM/Brochure/Acts/pdf/BIAAPAZONINGOFLANDUSEANDREGULATIONS.pdf` |
| 2 | 🔴 High | **Hoskote PA (HPA)** | Hoskote, E Bengaluru (industrial/logistics) | Hoskote LPA master plan + zonal regs (confirm year on portal) | `hoskote.tpa.gov.in/en/master-plan` |
| 3 | 🟠 Med | **Nelamangala PA (NPA)** | Nelamangala, NW (industrial) | Nelamangala LPA master plan + zonal regs | `npa.karnataka.gov.in` |
| 4 | 🟠 Med | **Doddaballapura PA** | Doddaballapura, N (aerospace/industrial) | Doddaballapura LPA master plan + zonal regs | `doddaballapur.tpa.gov.in/en/master-plan` |
| 5 | 🟡 Low | **Ramanagara UDA** | Ramanagara, SW | Ramanagara master plan + zonal regs | `ramanagara.uda.gov.in` |
| 6 | 🟡 Low | **Kanakapura PA (KPA)** | Kanakapura, S (Ramanagara dist.) | Kanakapura LPA master plan + zonal regs | `kanakapura.tpa.gov.in/en/master-plan` |
| 7 | 🟡 Low | **Magadi PA (MPA)** | Magadi, W | Magadi LPA master plan + zonal regs | `magadi.tpa.gov.in/en/master-plan` |
| 8 | 🟡 Low | **Channapatna PA** | Channapatna, SW | Channapatna LPA master plan + zonal regs | `channapatna.tpa.gov.in/en/master-plan` |
| 9 | ⚪ Specialised | **STRR Planning Authority** | Satellite Town Ring Road corridor | STRR corridor plan | `strr.tpa.gov.in` |

**Regional context (not parcel zoning, optional):** BMRDA **Structure / Land-Utilisation Plan 2031**
— `bmrda.karnataka.gov.in/7/structure-plan/en` (a regional land-use frame, useful as context only).

> **Confirm-on-download:** for #2–#9 I verified the *authority + official portal* (from BMRDA's own
> register), but NOT each plan's exact year/notification — read that off the portal's master-plan page
> when you download, and send it with the file so I record the correct citation.

---

## ✅ Retrieval findings (2026-07-05) — rulebooks FOUND & retrieved (BIAAPA + Hoskote)

Live retrieval of BIAAPA + Hoskote. **The FAR/zoning rulebooks ARE published on these sites** (under
non-obvious filenames the broken tiles never exposed) and are **clean, extractable text — ingestible
like Anekal.** Files retrieved to the session scratchpad (`…/scratchpad/gba_plans/`).

- **The `*.tpa.gov.in` "Planning" tiles are broken buttons** (no handler/link in DOM). Ignore them; use
  the direct file URLs. Discovery is by web-search / crawling doc sections, NOT `HEAD` (`HEAD` returns a
  2516-byte soft-404 for **everything** → probe with `GET`).
- **BIAAPA — Zoning Regulations 2021** ✅ `http://biaapa.tpa.gov.in/sites/biaapa.tpa.gov.in/files/ZR-BIAAPA-2021.pdf`
  (0.54 MB, **59 pp, ~85k chars real text**; Table 9 = Coverage/FAR/Setbacks for Industrial, plus
  residential/commercial/etc. — plot-area bands → coverage% → FAR → setbacks → road width). **This is the
  ingestible rulebook.** Land-use MAP atlas (overlay-only, scanned) is separate: `…/files/MASTER-PLAN-2021.pdf` (90.8 MB, 42 sheets).
- **Hoskote — Zonal Regulations 2031** ✅ `http://hoskote.tpa.gov.in/sites/hoskote.tpa.gov.in/files/Zonal%20Regulations-2031.pdf`
  (2.03 MB, **75 pp, ~137k chars real text**; "Chapter 10 – Zonal Regulations", full FAR/setback/coverage
  tables). Map atlas (overlay-only) separate: `…/files/Master_Plans.pdf` (166 MB, 87 sheets, "MAPS Vol").
- **Pattern for the other LPAs:** the map site publishes BOTH a scanned MAP atlas (overlay-only) AND a
  text ZONING-REGULATIONS PDF (the ingestible rulebook, often named `ZR-*.pdf` or `Zonal Regulations-*.pdf`).
  Find the ZR file via web-search (`<LPA> zoning regulations pdf tpa.gov.in`) — the on-site tile is broken.
- **Nelamangala** (`npa.karnataka.gov.in`) was **down** (timeout) on 2026-07-05 — retry later.
  `kum.karnataka.gov.in` is **dead DNS** (NXDOMAIN) — ignore that host.
- **Retrieval method** (this session runs on the operator's Windows box): direct `Invoke-WebRequest` with
  the sandbox disabled reaches `*.tpa.gov.in` (the sandboxed shell + Anthropic-side WebFetch cannot).
  Large map files exceed the 2-min foreground cap → download in the background.

**Net:** ✅ BIAAPA + Hoskote FAR rulebooks retrieved + verified ingestible → **Option B (add real
build-rules) is viable**; ingest via the Anekal pipeline (deterministic parse → adversarial verify →
operator-applied migration). Map overlays also feasible later (atlases in hand). See `TODO_DATA.md`.

---

## What to send me, and what I'll do

For each area you want next: download the **Proposed Land Use map** + the **Zonal Regulations PDF**
from its portal above, drop them in chat, and I'll ingest them the **same proven way as Anekal**:
deterministic parse of the FAR/zoning tables → adversarial 3-agent verification → operator-applied
migration → live on the deal's Parcel/Regulatory panel, scoped to that authority's plan.

**Suggested order:** BIAAPA (airport belt) → Hoskote → Nelamangala → Doddaballapura → the rest, as
your deal flow reaches them.

---

### Sources
- Greater Bengaluru Authority — https://en.wikipedia.org/wiki/Greater_Bengaluru_Authority · https://www.gba.karnataka.gov.in/
- BMRDA Local Planning Areas register — https://bmrda.karnataka.gov.in/page/Local+Planning+Areas/en
- BMRDA master plans / structure plan — http://bmrda.karnataka.gov.in/en/Pages/master-plans.aspx · https://bmrda.karnataka.gov.in/7/structure-plan/en
- BIAAPA — http://www.biaapa.tpa.gov.in/en/planning · zoning regs PDF https://kum.karnataka.gov.in/KUM/Brochure/Acts/pdf/BIAAPAZONINGOFLANDUSEANDREGULATIONS.pdf
- Hoskote PA — http://www.hoskote.tpa.gov.in/en/master-plan
- Anekal PA — http://anekal.tpa.gov.in/en/master-plan
