import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowRight, FileCheck2, BookOpen, Stamp } from 'lucide-react';
import { AcurealWordmark, AcurealRule } from '../components/brand/AcurealBrand';
import ParcelEvidenceExplorer from '../components/parcel/ParcelEvidenceExplorer';
import { usePublicStreetLookup } from '../hooks/usePublicParcel';
import usePublicLightTheme from '../hooks/usePublicLightTheme';

/**
 * /parcel — the PUBLIC address-first front door to the Bengaluru evidence
 * base. No login: any street inside BBMP limits resolves to its cited chain
 * (ward → gazette register → UAV zone → guidance band → exact gazette page).
 *
 * The shell speaks the landing page's warm institutional register (single-mode
 * light, the locked palette from LandingPage.jsx); the explorer inside is the
 * REAL product surface, shared verbatim with /dashboard/parcel-evidence and
 * forced to the light theme — a genuine product window, not a mockup.
 *
 * The chain stops at statutory zoning ON PURPOSE. Zone-from-a-point needs
 * point-in-polygon against a georeferenced RMP 2015 that exists only as a
 * raster; asserting it would fabricate a statutory fact. The gap is the
 * conversion: upload the zoning certificate or sanctioned plan inside a deal
 * and the zone resolves through extraction + human review.
 */

// Locked warm palette (see LandingPage.jsx — keep in lockstep, do not theme).
const INK = '#1C1A16';
const SECONDARY = '#57514A';
const MUTED = '#8C8579';
const CANVAS = '#F5F1E8';
const IVORY = '#FCFAF4';
const RECESSED = '#EDE7D9';
const HAIRLINE = '#E2DACB';
const EVERGREEN = '#1F4A3D';
const EVERGREEN_DEEP = '#1A3E33';
const BRASS = '#9C7A3C';

function WarmMasthead() {
  const navigate = useNavigate();
  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        backgroundColor: 'rgba(252,250,244,0.9)',
        borderBottom: `1px solid ${HAIRLINE}`,
        backdropFilter: 'saturate(140%) blur(8px)',
        WebkitBackdropFilter: 'saturate(140%) blur(8px)',
      }}
    >
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 sm:px-8">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ '--tw-ring-color': EVERGREEN, '--tw-ring-offset-color': CANVAS }}
          aria-label="Acureal home"
        >
          <AcurealWordmark tone="ink" className="text-[17px]" />
        </button>
        <nav className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px"
            style={{ color: SECONDARY, '--tw-ring-color': EVERGREEN, '--tw-ring-offset-color': CANVAS }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = INK;
              e.currentTarget.style.backgroundColor = 'rgba(31,74,61,0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = SECONDARY;
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => navigate('/login?mode=register')}
            className="rounded-md px-4 py-2 text-[13.5px] font-semibold text-white shadow-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px"
            style={{ backgroundColor: EVERGREEN, '--tw-ring-color': EVERGREEN, '--tw-ring-offset-color': CANVAS }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = EVERGREEN_DEEP; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = EVERGREEN; }}
            onFocus={(e) => { e.currentTarget.style.backgroundColor = EVERGREEN_DEEP; }}
            onBlur={(e) => { e.currentTarget.style.backgroundColor = EVERGREEN; }}
          >
            Get started
          </button>
        </nav>
      </div>
    </header>
  );
}

// The three-beat chain-of-custody strip: where these numbers come from.
const CUSTODY = [
  {
    icon: BookOpen,
    title: 'One gazette, 686 pages',
    body: 'BBMP Guidance-Value Notification No. 384 (09-Mar-2016) — the statutory street register for every road inside BBMP limits, in two registers: residential and non-residential.',
  },
  {
    icon: Stamp,
    title: 'Deterministically indexed',
    body: '19,830 street rows across 199 wards, parsed from the gazette’s three font encodings — never paraphrased by a model, never averaged, never estimated.',
  },
  {
    icon: FileCheck2,
    title: 'Cited to the page',
    body: 'Every lookup ends at the exact gazette PDF page it was read from, so anything you quote in a memo can be checked against the source in seconds.',
  },
];

export default function PublicParcelPage() {
  usePublicLightTheme();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Bengaluru Parcel Evidence — free gazette-cited street lookup · Acureal';
    return () => { document.title = prevTitle; };
  }, []);

  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen w-full font-sans antialiased" style={{ backgroundColor: CANVAS, color: INK }}>
      <WarmMasthead />

      {/* ── Hero band ────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 pt-12 pb-8 sm:px-8 sm:pt-16">
        <p
          className="font-mono text-[11px] uppercase tracking-[0.18em]"
          style={{ color: BRASS }}
        >
          Bengaluru · Free · No login
        </p>
        <h1
          className="mt-3 max-w-[26ch] font-display text-[clamp(1.9rem,4.2vw,3rem)] font-bold leading-[1.08] tracking-[-0.01em]"
          style={{ color: INK }}
        >
          Every BBMP street, resolved to its evidence — and cited to the gazette page.
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15.5px] leading-relaxed" style={{ color: SECONDARY }}>
          Type a street. Get its ward, gazette register, BBMP-UAV zone, and IGR guidance-value band —
          each read from the 686-page BBMP Guidance-Value gazette and traced to the exact page,
          so a Whitefield land price or a Koramangala asking rate can be checked against the
          government&apos;s own register before anyone gets on a call.
        </p>
      </section>

      {/* ── The product window ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 pb-10 sm:px-8">
        <div
          className="rounded-xl p-4 sm:p-6"
          style={{ backgroundColor: IVORY, border: `1px solid ${HAIRLINE}`, boxShadow: '0 1px 2px rgba(28,26,22,0.04), 0 12px 32px -18px rgba(28,26,22,0.18)' }}
        >
          <ParcelEvidenceExplorer
            useLookup={usePublicStreetLookup}
            limit={12}
            terminalCta={(
              <>
                <p className="mt-1 text-sm text-content-secondary leading-relaxed max-w-[52ch]">
                  Deliberately not shown here. The statutory zone for a specific parcel cannot be honestly
                  read off a street name — it takes the parcel&apos;s zoning certificate or sanctioned plan.
                  Upload either inside a free Acureal workspace and the zone resolves through document
                  extraction with human review; FAR and buildable potential then compute deterministically,
                  with full provenance.
                </p>
                <Link
                  to="/login?mode=register"
                  className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  Resolve this parcel&apos;s zoning — create a free workspace
                  <ArrowRight size={13} />
                </Link>
              </>
            )}
          />
        </div>
      </section>

      {/* ── Chain of custody ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 pb-14 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {CUSTODY.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-lg p-5"
              style={{ backgroundColor: RECESSED, border: `1px solid ${HAIRLINE}` }}
            >
              <Icon size={18} style={{ color: EVERGREEN }} aria-hidden="true" />
              <h2 className="mt-3 text-[15px] font-semibold" style={{ color: INK }}>{title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: SECONDARY }}>{body}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 max-w-[70ch] text-[12.5px] leading-relaxed" style={{ color: MUTED }}>
          This page serves statutory reference data only. It never states title, encumbrance, RERA, or
          approval status — those are verified by humans, per document, inside a diligence workspace.
        </p>
      </section>

      {/* ── Quiet footer ─────────────────────────────────────────────────── */}
      <footer className="w-full" style={{ backgroundColor: RECESSED, borderTop: `1px solid ${HAIRLINE}` }}>
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <AcurealWordmark tone="ink" className="text-[16px]" />
            <AcurealRule className="mt-3 h-[22px] w-full max-w-[300px]" />
            <p className="mt-3 text-[13px] leading-relaxed" style={{ color: SECONDARY }}>
              India-first deal intelligence. Every number traced to its source; no fabricated facts.
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]" style={{ color: SECONDARY }}>
            <Link to="/" className="hover:underline" style={{ color: SECONDARY }}>Home</Link>
            <Link to="/terms" className="hover:underline" style={{ color: SECONDARY }}>Terms</Link>
            <Link to="/privacy" className="hover:underline" style={{ color: SECONDARY }}>Privacy</Link>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] tabular-nums" style={{ color: MUTED }}>
              © {year} Acureal
            </span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
