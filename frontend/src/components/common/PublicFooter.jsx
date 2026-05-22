// Slim footer for public pages (Landing, Login, Legal). Carries the legal-link
// row REDIP needs for compliance + trust. Routes through semantic tokens so it
// stays correct in light mode (public pages force the light theme).

import { Link } from 'react-router-dom';

const LINK_CLASS =
  'transition-colors duration-150 ease-out hover:text-content-primary rounded ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

const LEGAL_LINKS = [
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/cookies', label: 'Cookies' },
  { to: '/grievance', label: 'Grievance' },
  { to: '/subprocessors', label: 'Sub-processors' },
];

export default function PublicFooter({ className = '' }) {
  const year = new Date().getFullYear();
  return (
    <footer
      className={`border-t border-hairline bg-bg-elevated ${className}`.trim()}
      aria-label="Footer"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-content-muted">
        <p>© {year} REDIP · Bengaluru, India</p>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.to} to={link.to} className={LINK_CLASS}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
