import { useState } from 'react';
import { ExternalLink, Copy, Check, AlertCircle, Shield } from 'lucide-react';
import Badge from '../common/Badge';

/**
 * VerifyLinksSection — renders the `verifyLinks` array returned by the
 * auto-derive endpoint as a tight section of authority-verification
 * cards. Each entry exposes:
 *   - Authority + purpose
 *   - Status pill (ready / inputs_missing)
 *   - "Copy search payload" button (clipboard write of the targeted
 *     copy_text — for Kaveri, just SRO + Survey No, not the full
 *     context dump)
 *   - "Open portal" button (target=_blank to the authority homepage)
 *   - One-click "Copy + Open" affordance: clipboard write then open,
 *     so the operator lands on the portal with the search payload
 *     already on their clipboard ready to paste
 *
 * Why this exists (Phase C-4, 2026-05-18):
 *   The backend has been emitting verifyLinks since PR #354 but
 *   nothing rendered them on the AutoFillParcelContextCard surface.
 *   IC reviewers were copy-pasting context manually. This section
 *   closes that loop.
 *
 * Honesty (CLAUDE.md):
 *   Kaveri / Bhoomi / BBMP e-Aasthi are auth-walled aspx forms;
 *   they do NOT accept deep-link query params (verified 2026-04-28
 *   and again 2026-05-18). The "Copy + Open" pattern is the
 *   honest workaround — never fake a deep link that doesn't work.
 *   Google Maps satellite IS a true deep link (renders directly).
 */
export default function VerifyLinksSection({ verifyLinks, className = '' }) {
  if (!Array.isArray(verifyLinks) || verifyLinks.length === 0) return null;

  return (
    <div className={`mt-5 pt-4 border-t border-hairline ${className}`} data-testid="verify-links-section">
      <div className="flex items-center gap-2 mb-2">
        <Shield size={12} className="text-content-muted" aria-hidden="true" />
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-content-muted">
          Verify against authority portals
        </h3>
      </div>
      <p className="text-[11px] text-content-muted mb-3 leading-relaxed">
        Each link opens the authority portal in a new tab. Click <em>Copy + Open</em> to put the
        search payload on your clipboard first, then paste it into the portal's first form field.
      </p>
      <ul className="space-y-2" data-testid="verify-links-list">
        {verifyLinks.map((link) => (
          <VerifyLinkRow key={link.key} link={link} />
        ))}
      </ul>
    </div>
  );
}

function VerifyLinkRow({ link }) {
  const [copied, setCopied] = useState(false);
  const ready = link.status === 'ready';
  const canCopy = !!link.copy_text;

  const handleCopy = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(link.copy_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can fail in iframes or permission-denied contexts.
      // Fall back silently — the operator can still click Open and copy
      // from the on-card text below.
    }
  };

  const handleCopyAndOpen = async () => {
    await handleCopy();
    window.open(link.href, '_blank', 'noopener,noreferrer');
  };

  return (
    <li
      className="rounded-md border border-hairline bg-bg-secondary/40 px-3 py-2"
      data-testid={`verify-link-${link.key}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-medium text-content-primary">{link.label}</span>
            <Badge tone={ready ? 'success' : 'warn'} className="!text-[9px]">
              {ready ? 'ready' : 'inputs missing'}
            </Badge>
            {link.deep_link && (
              <Badge tone="info" className="!text-[9px]">
                deep-link
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-content-secondary leading-snug">{link.purpose}</p>
          {link.hint && (
            <p className="text-[10px] text-content-muted leading-snug mt-1 italic">{link.hint}</p>
          )}
          {!ready && (
            <p className="text-[10px] text-premium leading-snug mt-1 flex items-center gap-1">
              <AlertCircle size={10} /> Missing inputs — add to property to enable.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canCopy && (
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-hairline text-content-secondary hover:bg-bg-elevated hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]"
              aria-label={`Copy ${link.label} search payload to clipboard`}
              data-testid={`verify-link-${link.key}-copy`}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          <button
            type="button"
            onClick={canCopy ? handleCopyAndOpen : () => window.open(link.href, '_blank', 'noopener,noreferrer')}
            className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-accent text-content-inverse hover:bg-accent-hover transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.97]"
            aria-label={canCopy ? `Copy ${link.label} payload and open portal` : `Open ${link.label} portal`}
            data-testid={`verify-link-${link.key}-open`}
          >
            <ExternalLink size={10} /> {canCopy ? 'Copy + Open' : 'Open'}
          </button>
        </div>
      </div>
      {canCopy && (
        <details className="mt-2 group">
          <summary className="text-[10px] text-content-muted cursor-pointer hover:text-content-secondary list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform duration-150">▶</span>
            Show payload
          </summary>
          <pre className="mt-1.5 text-[10px] text-content-secondary bg-bg-elevated border border-hairline rounded px-2 py-1.5 whitespace-pre-wrap break-words font-mono">
            {link.copy_text}
          </pre>
        </details>
      )}
    </li>
  );
}
