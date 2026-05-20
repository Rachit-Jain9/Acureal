// Slim footer for public pages (Landing, Login, Legal). Adds the legal-link
// row REDIP needs for compliance + trust. Uses raw light-theme classes so
// the rendering is independent of the app theme switch — public pages are
// always editorial-light.

import { Link } from 'react-router-dom';

export default function PublicFooter({ className = '' }) {
  const year = new Date().getFullYear();
  return (
    <footer
      className={`border-t border-stone-200 bg-white/60 ${className}`.trim()}
      aria-label="Footer"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
        <p>© {year} REDIP · Bengaluru, India</p>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            to="/terms"
            className="hover:text-stone-900 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded"
          >
            Terms
          </Link>
          <Link
            to="/privacy"
            className="hover:text-stone-900 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded"
          >
            Privacy
          </Link>
          <Link
            to="/cookies"
            className="hover:text-stone-900 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded"
          >
            Cookies
          </Link>
          <Link
            to="/grievance"
            className="hover:text-stone-900 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded"
          >
            Grievance
          </Link>
          <Link
            to="/subprocessors"
            className="hover:text-stone-900 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c2410c]/40 rounded"
          >
            Sub-processors
          </Link>
        </nav>
      </div>
    </footer>
  );
}
