import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ShieldCheck, FileText, Layers, TrendingUp, Activity, Scale, CornerDownRight } from 'lucide-react';

const SECTIONS = [
  {
    key: 'summary',
    label: 'Summary',
    icon: FileText,
    tick: 'src · deal sheet',
    lines: [
      'Sarjapur Rd · ~4.2 ac · JDA, 50:50 share',
      'Recommend advancing to IC, with conditions',
    ],
  },
  {
    key: 'diligence',
    label: 'Diligence',
    icon: Layers,
    tick: 'src · 7 layers scored',
    lines: [
      'Title · EC · Khata · Survey · RERA · Approvals · Tax',
      '5 of 7 layers complete · 2 carried as human-verify',
    ],
  },
  {
    key: 'underwriting',
    label: 'Underwriting',
    icon: TrendingUp,
    tick: 'src · kernel v3',
    lines: [
      'IRR ~22% · EM ~1.9× · DSCR ~1.34×',
      'Deterministic · Stress-test: −15% absorption holds',
    ],
  },
  {
    key: 'risk',
    label: 'Risk radar',
    icon: Activity,
    tick: 'src · 7 axes',
    lines: [
      'Legal · Approvals · Promoter · Market · Env · Model · Ops',
      'Consider: promoter delivery history, 2 prior delays',
    ],
  },
  {
    key: 'provenance',
    label: 'Provenance',
    icon: ShieldCheck,
    tick: 'src · every figure ticked',
    lines: [
      'Each number threaded to the page it came from',
      'Knowns, assumptions, open items — kept honest',
    ],
  },
  {
    key: 'open',
    label: 'Open items',
    icon: Scale,
    tick: 'src · legal four',
    lines: [
      'Title · Encumbrance · RERA · Approvals',
      'Carried in flagged — human-verify, not conclusions',
    ],
  },
];

export default function TheDecisionCommittee() {
  const sectionRef = useRef(null);
  const memoRef = useRef(null);
  const [assembled, setAssembled] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [parallax, setParallax] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (reduced) {
      setAssembled(true);
      return;
    }
    const el = memoRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setAssembled(true);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.28 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = sectionRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const p = 1 - (rect.top + rect.height / 2) / (vh + rect.height / 2);
        const clamped = Math.max(0, Math.min(1, p));
        setParallax(clamped);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const planeBack = reduced ? 0 : (parallax - 0.5) * 10;
  const planeMid = reduced ? 0 : (parallax - 0.5) * 6;

  const ease = 'cubic-bezier(0.16, 1, 0.3, 1)';

  return (
    <section
      ref={sectionRef}
      className="relative w-full overflow-hidden bg-[#F5F1E8] text-[#1C1A16]"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
      aria-label="The committee — walk in defensible"
    >
      {/* Docked cadastral corner-glyph — sealed brass state (scene 6) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-6 top-6 z-20 hidden sm:block"
        style={{ transform: `translateY(${planeMid}px)` }}
      >
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <rect x="6" y="6" width="52" height="52" rx="1.5" stroke="#CFC5B2" strokeWidth="1" fill="#FCFAF4" />
          <path
            d="M14 22 L30 14 L50 20 L48 44 L26 50 L14 40 Z"
            stroke="#8C8579"
            strokeWidth="1"
            fill="rgba(31,74,61,0.05)"
            strokeLinejoin="round"
            style={{
              strokeDasharray: 200,
              strokeDashoffset: assembled ? 0 : 200,
              transition: reduced ? 'none' : `stroke-dashoffset 1100ms ${ease}`,
            }}
          />
          {/* brass corner seal mark */}
          <path
            d="M44 12 L56 12 L56 24"
            stroke="#9C7A3C"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            style={{
              strokeDasharray: 30,
              strokeDashoffset: assembled ? 0 : 30,
              transition: reduced ? 'none' : `stroke-dashoffset 700ms ${ease} 1400ms`,
            }}
          />
          <circle
            cx="51"
            cy="19"
            r="3"
            fill="#9C7A3C"
            style={{
              opacity: assembled ? 1 : 0,
              transition: reduced ? 'none' : `opacity 400ms ease-out 1700ms`,
            }}
          />
        </svg>
      </div>

      {/* Fixed paper-grain back plane (0.94x feel) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          transform: `translateY(${planeBack}px)`,
          backgroundImage:
            'radial-gradient(rgba(140,133,121,0.06) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          opacity: 0.5,
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-28 md:py-40">
        {/* Eyebrow */}
        <div
          className="mb-6 flex items-center gap-3"
          style={{
            opacity: assembled ? 1 : 0,
            transform: assembled ? 'translateY(0)' : 'translateY(8px)',
            transition: reduced ? 'none' : `opacity 600ms ${ease}, transform 600ms ${ease}`,
          }}
        >
          <span
            className="text-[11px] uppercase tracking-[0.22em] text-[#8C8579]"
            style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
          >
            № 05 · The committee
          </span>
          <span className="h-px flex-1 max-w-[120px] bg-[#E2DACB]" />
        </div>

        {/* Headline + body */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-7">
            <h2
              className="text-[2rem] leading-[1.12] tracking-[-0.01em] text-[#1C1A16] md:text-[2.9rem]"
              style={{
                fontFamily: "'Source Serif 4', Georgia, serif",
                opacity: assembled ? 1 : 0,
                transform: assembled ? 'translateY(0)' : 'translateY(8px)',
                transition: reduced ? 'none' : `opacity 700ms ${ease} 80ms, transform 700ms ${ease} 80ms`,
              }}
            >
              Walk into the committee with a position you can defend,{' '}
              <em className="italic text-[#1F4A3D]">line by line.</em>
            </h2>

            <p
              className="mt-7 max-w-xl text-[1.0625rem] leading-[1.72] text-[#57514A]"
              style={{
                fontFamily: "'Source Serif 4', Georgia, serif",
                opacity: assembled ? 1 : 0,
                transform: assembled ? 'translateY(0)' : 'translateY(8px)',
                transition: reduced ? 'none' : `opacity 700ms ${ease} 200ms, transform 700ms ${ease} 200ms`,
              }}
            >
              The output is the point: an IC-ready memo and model that assemble from
              sourced components in one click — the diligence stack, the risk radar, the
              deterministic returns, each figure still threaded to its page. The legal
              lanes arrive flagged for human sign-off, exactly as they should. The land
              that opened this page, now fully annotated, sits behind the page you carry
              into the room. What you bring into IC is not a pitch; it's a position, with
              the receipts attached. <em className="italic">That is the difference between conviction and hope.</em>
            </p>

            {/* Microcopy ledger */}
            <ul className="mt-8 space-y-3">
              {[
                'One click → IC-ready memo + model export',
                'Every component sourced · legal four carried in as human-verify, not conclusions',
                'Knowns, assumptions, and open items, kept honest',
              ].map((m, i) => (
                <li
                  key={m}
                  className="flex items-start gap-3"
                  style={{
                    opacity: assembled ? 1 : 0,
                    transform: assembled ? 'translateY(0)' : 'translateY(6px)',
                    transition: reduced
                      ? 'none'
                      : `opacity 500ms ${ease} ${320 + i * 90}ms, transform 500ms ${ease} ${320 + i * 90}ms`,
                  }}
                >
                  <CornerDownRight size={15} className="mt-[3px] shrink-0 text-[#1F4A3D]" strokeWidth={1.6} />
                  <span
                    className="text-[13px] leading-[1.55] text-[#57514A]"
                    style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                  >
                    {m}
                  </span>
                </li>
              ))}
            </ul>

            {/* CTA pair */}
            <div
              className="mt-10 flex flex-wrap items-center gap-6"
              style={{
                opacity: assembled ? 1 : 0,
                transform: assembled ? 'translateY(0)' : 'translateY(8px)',
                transition: reduced ? 'none' : `opacity 600ms ${ease} 760ms, transform 600ms ${ease} 760ms`,
              }}
            >
              <a
                href="#request-access"
                className="group inline-flex items-center gap-2 border border-[#1F4A3D] px-7 py-3 text-[14px] tracking-[0.01em] text-[#1F4A3D] outline-none transition-colors duration-[120ms] ease-out hover:bg-[#1F4A3D] hover:text-[#FCFAF4] focus-visible:ring-2 focus-visible:ring-[#1F4A3D] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8] active:translate-y-px"
                style={{ fontFamily: "'Inter', sans-serif", borderRadius: 0 }}
              >
                <span>Request access</span>
                <ArrowUpRight
                  size={16}
                  strokeWidth={1.8}
                  className="transition-transform duration-[120ms] ease-out group-hover:translate-x-[1px] group-hover:-translate-y-[1px]"
                />
              </a>

              <a
                href="#sign-in"
                className="text-[14px] text-[#57514A] underline decoration-[#CFC5B2] decoration-1 underline-offset-[5px] outline-none transition-colors duration-[120ms] ease-out hover:text-[#1C1A16] hover:decoration-[#1F4A3D] focus-visible:rounded-[2px] focus-visible:ring-2 focus-visible:ring-[#1F4A3D] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F1E8]"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                Sign in
              </a>
            </div>
          </div>

          {/* The IC memo — assembling deliverable */}
          <div className="lg:col-span-5" style={{ transform: `translateY(${planeMid}px)` }}>
            <div
              ref={memoRef}
              className="relative mx-auto w-full max-w-[420px] bg-[#FCFAF4]"
              style={{
                border: '1px solid #E2DACB',
                boxShadow: '0 1px 0 rgba(140,133,121,0.12)',
              }}
            >
              {/* export-ready affordance outline (draws once, holds) */}
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
              >
                <rect
                  x="1"
                  y="1"
                  width="calc(100% - 2px)"
                  height="calc(100% - 2px)"
                  fill="none"
                  stroke="#1F4A3D"
                  strokeWidth="1"
                  pathLength="100"
                  style={{
                    strokeDasharray: 100,
                    strokeDashoffset: assembled ? 0 : 100,
                    opacity: 0.22,
                    transition: reduced ? 'none' : `stroke-dashoffset 1300ms ${ease} 200ms`,
                  }}
                />
              </svg>

              {/* Cover masthead — settles in last */}
              <div
                className="border-b border-[#E2DACB] px-6 pb-5 pt-6"
                style={{
                  opacity: assembled ? 1 : 0,
                  transform: assembled ? 'translateY(0)' : 'translateY(8px)',
                  transition: reduced
                    ? 'none'
                    : `opacity 600ms ${ease} ${SECTIONS.length * 80 + 360}ms, transform 600ms ${ease} ${SECTIONS.length * 80 + 360}ms`,
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p
                      className="text-[10px] uppercase tracking-[0.24em] text-[#8C8579]"
                      style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                    >
                      Investment committee
                    </p>
                    <h3
                      className="mt-1 text-[1.45rem] leading-tight text-[#1C1A16]"
                      style={{ fontFamily: "'Source Serif 4', Georgia, serif" }}
                    >
                      Memo &amp; model
                    </h3>
                  </div>

                  {/* parcel mini-glyph in header — fully annotated */}
                  <div className="relative shrink-0">
                    <svg width="76" height="58" viewBox="0 0 76 58" fill="none">
                      <path
                        d="M8 22 L30 10 L60 16 L57 44 L26 50 L8 40 Z"
                        stroke="#1F4A3D"
                        strokeWidth="1.1"
                        fill="rgba(31,74,61,0.06)"
                        strokeLinejoin="round"
                      />
                      {/* bearing ticks */}
                      <line x1="30" y1="10" x2="30" y2="6" stroke="#8C8579" strokeWidth="0.8" />
                      <line x1="60" y1="16" x2="64" y2="14" stroke="#8C8579" strokeWidth="0.8" />
                      {/* human-verify markers */}
                      <circle cx="22" cy="30" r="1.6" fill="#9C7A3C" />
                      <circle cx="44" cy="26" r="1.6" fill="#9C7A3C" />
                      {/* brass seal corner */}
                      <path d="M52 12 L66 12 L66 24" stroke="#9C7A3C" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                    </svg>
                    <span
                      className="absolute -bottom-[2px] left-0 text-[8px] tracking-wide text-[#8C8579]"
                      style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                    >
                      Sy. No. 142/3 · ~4.2 ac
                    </span>
                  </div>
                </div>

                {/* kernel headline figures pinned to margin */}
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
                  {[
                    ['IRR', '~22%'],
                    ['EM', '~1.9×'],
                    ['DSCR', '~1.34×'],
                  ].map(([k, v]) => (
                    <span
                      key={k}
                      className="text-[11px] text-[#57514A]"
                      style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' }}
                    >
                      <span className="text-[#8C8579]">{k} </span>
                      <span className="text-[#1F4A3D]">{v}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Section tiles — drop into reading order */}
              <div className="divide-y divide-[#EDE7D9]">
                {SECTIONS.map((s, i) => {
                  const Icon = s.icon;
                  const delay = 240 + i * 80;
                  const legal = s.key === 'open';
                  return (
                    <div
                      key={s.key}
                      className="flex items-start gap-3 px-6 py-[14px]"
                      style={{
                        opacity: assembled ? 1 : 0,
                        transform: assembled ? 'translateY(0)' : 'translateY(8px)',
                        transition: reduced
                          ? 'none'
                          : `opacity 240ms ease-out ${delay}ms, transform 240ms ease-out ${delay}ms`,
                      }}
                    >
                      <div
                        className="mt-[2px] flex h-7 w-7 shrink-0 items-center justify-center"
                        style={{
                          border: `1px solid ${legal ? '#9C7A3C' : '#E2DACB'}`,
                          background: legal ? 'rgba(156,122,60,0.06)' : 'rgba(31,74,61,0.04)',
                        }}
                      >
                        <Icon size={14} strokeWidth={1.6} color={legal ? '#9C7A3C' : '#1F4A3D'} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="text-[12px] font-medium tracking-[0.02em] text-[#1C1A16]"
                            style={{ fontFamily: "'Inter', sans-serif" }}
                          >
                            {s.label}
                          </span>
                          {/* mono source tick — lights as the tile lands */}
                          <span
                            className="flex items-center gap-1 text-[9px] text-[#8C8579]"
                            style={{
                              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                              opacity: assembled ? 1 : 0,
                              transition: reduced ? 'none' : `opacity 300ms ease-out ${delay + 160}ms`,
                            }}
                          >
                            <Check size={9} strokeWidth={2.4} color={legal ? '#9C7A3C' : '#2F6B4F'} />
                            {s.tick}
                          </span>
                        </div>
                        {s.lines.map((ln, j) => (
                          <p
                            key={j}
                            className="mt-[3px] text-[10.5px] leading-[1.5] text-[#57514A]"
                            style={{
                              fontFamily:
                                j === 0
                                  ? "'JetBrains Mono', ui-monospace, monospace"
                                  : "'Inter', sans-serif",
                              fontVariantNumeric: 'tabular-nums',
                              color: legal && j === 1 ? '#9C7A3C' : undefined,
                            }}
                          >
                            {ln}
                          </p>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Quiet first-page disclaimer + colophon */}
              <div className="border-t border-[#E2DACB] px-6 py-4">
                <p
                  className="text-[7.5px] italic leading-[1.5] text-[#8C8579]"
                  style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                >
                  All figures computed by the deterministic kernel; model-assisted synthesis
                  used only for interpretive prose. Legal four extracted for human verification,
                  not concluded. Figures illustrative.
                </p>
                <p
                  className="mt-2 text-[9px] tracking-[0.04em] text-[#8C8579]"
                  style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                >
                  Bengaluru · India · figures illustrative
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
