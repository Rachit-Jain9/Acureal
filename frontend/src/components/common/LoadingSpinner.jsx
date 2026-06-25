export default function LoadingSpinner({ size = 'md', className = '', label = 'Loading' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };
  return (
    <div
      className={`flex items-center justify-center ${className}`}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div
        aria-hidden="true"
        className={`${sizes[size]} rounded-full animate-spin`}
        style={{
          border: '2px solid var(--color-border-primary)',
          borderTopColor: 'var(--color-brand-accent)',
        }}
      />
      <span className="sr-only">{label}…</span>
    </div>
  );
}
