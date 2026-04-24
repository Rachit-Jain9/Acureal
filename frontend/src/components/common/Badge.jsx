import { clsx } from 'clsx';

// Pill / status label. `tone` maps to CSS-var-backed classes in index.css so
// both themes flip automatically. Leave `tone` unset for a muted neutral chip.
//   neutral (default) · success · warn · danger · info · premium
const TONE_CLASS = {
  neutral: 'badge-neutral',
  success: 'badge-success',
  warn: 'badge-warn',
  danger: 'badge-danger',
  info: 'badge-info',
  premium: 'badge-premium',
};

export default function Badge({ children, tone = 'neutral', className = '', ...rest }) {
  const toneClass = TONE_CLASS[tone] ?? TONE_CLASS.neutral;
  return (
    <span className={clsx('badge', toneClass, className)} {...rest}>
      {children}
    </span>
  );
}
