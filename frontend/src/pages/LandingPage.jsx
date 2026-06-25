import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import HeroParcelResolve from './landing/HeroParcelResolve';
import InboundBecomesStructure from './landing/InboundBecomesStructure';
import DiligenceSevenLayers from './landing/DiligenceSevenLayers';
import TheKernel from './landing/TheKernel';
import ProvenanceThread from './landing/ProvenanceThread';
import TheDecisionCommittee from './landing/TheDecisionCommittee';

/**
 * LandingPage — REDIP public marketing surface.
 *
 * This is an art-directed, SINGLE-MODE (warm light) page. It deliberately does
 * NOT consume the app's cool-themed semantic tokens and has NO dark-mode toggle.
 * Every colour comes from the locked warm-institutional palette, applied via
 * Tailwind arbitrary classes and inline styles so the surface reads like a
 * printed private research note, not a generic AI-SaaS landing page.
 *
 * Locked warm-institutional palette
 *   Canvas / page bg      #F5F1E8   warm bone
 *   Raised surface / card #FCFAF4   warm ivory
 *   Recessed panel        #EDE7D9
 *   Deep contrast panel   #20201C ink (text #F2EEE4)
 *   Ink (primary text)    #1C1A16
 *   Secondary text        #57514A
 *   Muted text / captions #8C8579
 *   Hairline              #E2DACB
 *   Hairline strong       #CFC5B2
 *   Primary accent        #1F4A3D   deep evergreen   (soft fill rgba(31,74,61,0.08))
 *   Brass                 #9C7A3C
 *   Money / positive      #2F6B4F
 *   Risk / negative       #9E3B2E
 *
 * The scenes own their own composition; this file is the frame: masthead,
 * scroll-progress bar, the ordered <main>, and a quiet colophon footer.
 */
export default function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const handleScroll = () => {
      const scrollTop =
        window.scrollY ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;

      // Masthead gains its ivory background + hairline after ~24px of scroll.
      setScrolled(scrollTop > 24);

      // Thin progress bar: scrolled distance over total scrollable height.
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const ratio =
        docHeight > 0 ? Math.min(1, Math.max(0, scrollTop / docHeight)) : 0;
      setProgress(ratio);
    };

    handleScroll();

    // The progress bar is calm enough to keep even under reduced-motion; we
    // reference the flag so the intent is explicit and easy to extend later.
    void reduceMotion;

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, []);

  const year = new Date().getFullYear();

  return (
    <div
      className="min-h-screen w-full font-sans antialiased"
      style={{ backgroundColor: '#F5F1E8', color: '#1C1A16' }}
    >
      {/* ── Thin scroll-progress bar ─────────────────────────────────────── */}
      <div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-[60] h-[2px]"
        style={{ backgroundColor: 'rgba(31,74,61,0.08)' }}
      >
        <div
          className="h-full w-full origin-left"
          style={{
            backgroundColor: '#1F4A3D',
            transform: `scaleX(${progress})`,
            transformOrigin: 'left',
            transition: 'transform 90ms linear',
            willChange: 'transform',
          }}
        />
      </div>

      {/* ── Sticky masthead ──────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-50 w-full"
        style={{
          backgroundColor: scrolled
            ? 'rgba(252,250,244,0.88)'
            : 'rgba(252,250,244,0)',
          borderBottom: `1px solid ${scrolled ? '#E2DACB' : 'transparent'}`,
          backdropFilter: scrolled ? 'saturate(140%) blur(8px)' : 'none',
          WebkitBackdropFilter: scrolled ? 'saturate(140%) blur(8px)' : 'none',
          transition:
            'background-color 220ms ease, border-color 220ms ease, backdrop-filter 220ms ease',
        }}
      >
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 sm:px-8">
          {/* Wordmark — serif with a brass period */}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-baseline rounded-sm font-serif text-[22px] font-semibold tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              color: '#1C1A16',
              '--tw-ring-color': '#1F4A3D',
              '--tw-ring-offset-color': '#F5F1E8',
            }}
            aria-label="REDIP home"
          >
            <span>REDIP</span>
            <span aria-hidden="true" style={{ color: '#9C7A3C' }}>
              .
            </span>
          </button>

          {/* Actions */}
          <nav className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px"
              style={{
                color: '#57514A',
                '--tw-ring-color': '#1F4A3D',
                '--tw-ring-offset-color': '#F5F1E8',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#1C1A16';
                e.currentTarget.style.backgroundColor = 'rgba(31,74,61,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#57514A';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              Sign in
            </button>

            <button
              type="button"
              onClick={() => navigate('/login?mode=register')}
              className="rounded-md px-4 py-2 text-[13.5px] font-semibold text-white shadow-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px"
              style={{
                backgroundColor: '#1F4A3D',
                '--tw-ring-color': '#1F4A3D',
                '--tw-ring-offset-color': '#F5F1E8',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#1A3E33';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#1F4A3D';
              }}
              onFocus={(e) => {
                e.currentTarget.style.backgroundColor = '#1A3E33';
              }}
              onBlur={(e) => {
                e.currentTarget.style.backgroundColor = '#1F4A3D';
              }}
            >
              Request access
            </button>
          </nav>
        </div>
      </header>

      {/* ── Scenes, in order ─────────────────────────────────────────────── */}
      <main>
        <HeroParcelResolve />
        <InboundBecomesStructure />
        <DiligenceSevenLayers />
        <TheKernel />
        <ProvenanceThread />
        <TheDecisionCommittee />
      </main>

      {/* ── Quiet colophon footer ────────────────────────────────────────── */}
      <footer
        className="w-full"
        style={{ backgroundColor: '#EDE7D9', borderTop: '1px solid #E2DACB' }}
      >
        <div className="mx-auto max-w-[1180px] px-5 py-14 sm:px-8">
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <div className="flex items-baseline font-serif text-[20px] font-semibold tracking-tight">
                <span style={{ color: '#1C1A16' }}>REDIP</span>
                <span aria-hidden="true" style={{ color: '#9C7A3C' }}>
                  .
                </span>
              </div>
              <p
                className="mt-3 text-[13.5px] leading-relaxed"
                style={{ color: '#57514A' }}
              >
                India-first. Every number is traced to its source. No fabricated
                facts. The legal four — title chain, encumbrance, RERA status, and
                statutory approvals — are human-verified, never auto-concluded.
              </p>
            </div>

            <div className="md:text-right">
              <p
                className="font-mono text-[11px] uppercase tracking-[0.16em] tabular-nums"
                style={{ color: '#8C8579' }}
              >
                Bengaluru first · India second
              </p>
              <p
                className="mt-2 font-mono text-[11px] tabular-nums"
                style={{ color: '#8C8579' }}
              >
                © {year} REDIP. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
