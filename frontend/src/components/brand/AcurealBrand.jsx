import { useId } from 'react';
import { clsx } from 'clsx';

/**
 * Acureal brand primitives, recreated from the ACUREAL identity handoff
 * (design_handoff_acureal_identity, 2026-07).
 *
 * The identity is wordmark-led with a single graphic device — the measure
 * rule: a matte rose-gold graduated scale with one signal-blue node on a
 * plumb drop. Constraints that must survive any future edit:
 *   - SVG geometry below is canonical. Copy it, never redraw it.
 *   - The node sits at 62.5% of the rule's span — never centred.
 *   - Wordmark: Jost, ALL CAPS, 0.2em tracking; weight 200 at display
 *     sizes (≥24px), 300 below (hairlines break at small sizes).
 *   - Rose gold (#C08D7C) is a hairline metal — never a fill, never a
 *     background, never more than ~4% of any surface.
 */

const SIGNAL = '#1E6FD0';
const SIGNAL_REV = '#7FC0F5';
const ROSE = '#C08D7C';
const ROSE_BRIGHT = '#DDB4A4';
const MIDNIGHT = '#0B2440';

const RULE_MINOR_TICKS =
  'M12 20V26M24 20V26M36 20V26M48 20V26M72 20V26M84 20V26M96 20V26M108 20V26' +
  'M132 20V26M144 20V26M156 20V26M168 20V26M192 20V26M204 20V26M216 20V26M228 20V26' +
  'M252 20V26M264 20V26M276 20V26M288 20V26M312 20V26M324 20V26M336 20V26M348 20V26' +
  'M372 20V26M384 20V26M396 20V26M408 20V26M432 20V26M444 20V26M456 20V26M468 20V26';
const RULE_MAJOR_TICKS =
  'M0 12V26M60 12V26M120 12V26M180 12V26M240 12V26M300 12V26M360 12V26M420 12V26M480 12V26';

/**
 * The wordmark, set as live text so it stays crisp and accessible.
 *
 * tone:
 *   'auto' — follows the app theme via --brand-wordmark-* tokens.
 *   'ink'  — fixed light-background colours (navy + signal blue), for
 *            single-mode light surfaces like the landing page.
 *   'mono' — currentColor, E not differentiated (foil / engraving usage).
 * display: true at ≥24px rendered size (weight 200); false below (300).
 */
export function AcurealWordmark({ tone = 'auto', display = false, className = '', style }) {
  const eStyle =
    tone === 'ink' ? { color: SIGNAL } : tone === 'mono' ? undefined : { color: 'var(--brand-wordmark-e)' };
  return (
    <span
      className={clsx('acureal-wordmark', display && 'acureal-wordmark--display', className)}
      style={{
        ...(tone === 'ink' ? { color: MIDNIGHT } : tone === 'mono' ? {} : { color: 'var(--brand-wordmark-ink)' }),
        ...style,
      }}
    >
      ACUR<span style={eStyle}>E</span>AL
    </span>
  );
}

/**
 * The measure rule (480×34) — sits beneath the wordmark or runs as a
 * divider. tone 'full' = rose-gold metal + signal-blue node; 'mono' =
 * everything currentColor.
 */
export function AcurealRule({ tone = 'full', className = '', style }) {
  const gradId = useId();
  const mono = tone === 'mono';
  const metal = mono ? 'currentColor' : ROSE;
  return (
    <svg
      viewBox="0 0 480 34"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {!mono && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#B9836F" stopOpacity="0.35" />
            <stop offset="0.28" stopColor="#C08D7C" />
            <stop offset="0.62" stopColor="#DDB4A4" />
            <stop offset="1" stopColor="#A6705F" stopOpacity="0.5" />
          </linearGradient>
        </defs>
      )}
      <g stroke={metal} strokeOpacity="0.5" strokeWidth="1">
        <path d={RULE_MINOR_TICKS} />
      </g>
      <g stroke={metal} strokeWidth="1.6">
        <path d={RULE_MAJOR_TICKS} />
      </g>
      <path d="M0 26H480" stroke={mono ? 'currentColor' : `url(#${gradId})`} strokeWidth="1.6" fill="none" />
      <path d="M300 26V4" stroke={mono ? 'currentColor' : SIGNAL} strokeWidth="1.4" fill="none" />
      <rect x="295" y="0" width="10" height="10" fill={mono ? 'currentColor' : SIGNAL} />
    </svg>
  );
}

/**
 * The reduced mark (32×32, four ticks) — favicons, tiny chrome, collapsed
 * nav. Single tone, currentColor.
 */
export function AcurealGlyph({ size = 20, className = '', style, title }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={className}
      style={style}
    >
      {title && <title>{title}</title>}
      <g stroke="currentColor" strokeWidth="2.4">
        <path d="M4 17V25M12 17V25M20 17V25M28 17V25" />
      </g>
      <path d="M3 25H29" stroke="currentColor" strokeWidth="2.4" fill="none" />
      <path d="M20 25V13" stroke="currentColor" strokeWidth="2.4" fill="none" />
      <rect x="16" y="5" width="8" height="8" fill="currentColor" />
    </svg>
  );
}

/**
 * The badge (120×120) — avatars and app-icon contexts. Always on a solid
 * midnight ground; mark at 74% of the tile.
 */
export function AcurealBadge({ size = 48, radius = 0, className = '', style }) {
  const gradId = useId();
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={ROSE_BRIGHT} />
          <stop offset="0.5" stopColor={ROSE} />
          <stop offset="1" stopColor="#9A6A5C" />
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx={radius} fill={MIDNIGHT} />
      <g stroke={ROSE} strokeOpacity="0.55" strokeWidth="1.6">
        <path d="M25 72V80M32 72V80M39 72V80M53 72V80M60 72V80M67 72V80M81 72V80M88 72V80M95 72V80" />
      </g>
      <g stroke={ROSE} strokeWidth="2.4">
        <path d="M18 62V80M46 62V80M74 62V80M102 62V80" />
      </g>
      <path d="M18 80H102" stroke={ROSE} strokeWidth="2.4" fill="none" />
      <path d="M74 80V44" stroke={SIGNAL} strokeWidth="2.2" fill="none" />
      <rect x="67" y="30" width="14" height="14" fill={`url(#${gradId})`} />
    </svg>
  );
}

export { SIGNAL as ACUREAL_SIGNAL, SIGNAL_REV as ACUREAL_SIGNAL_REV, ROSE as ACUREAL_ROSE, MIDNIGHT as ACUREAL_MIDNIGHT };
