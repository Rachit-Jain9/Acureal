// Theme-aware markdown renderer for AI-generated artifacts (deal analysis,
// risk brief, IC memo, parcel narrative). Uses semantic design tokens so
// the output flips correctly under dark/light theme switches — distinct
// from `Markdown.jsx` which is hardcoded stone-* for the legal pages.
//
// Why a sibling component:
//   - Legal pages render at editorial-light always; AI artifacts render
//     inside the themed dashboard chrome.
//   - The markdown shape AI emits is denser (more headings + bullet lists)
//     and benefits from tighter rhythm than the legal long-form pages.
//   - Keeps the legal renderer locked in case Council asks for a strict
//     visual diff for compliance.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';

const components = {
  h1: ({ children, ...props }) => (
    <h1
      className="font-display text-lg font-semibold text-content-primary tracking-tight mt-1 mb-3"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="font-display text-base font-semibold text-content-primary tracking-tight mt-5 mb-2"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="text-sm font-semibold text-content-primary tracking-tight mt-4 mb-1.5"
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="text-xs font-semibold uppercase tracking-wider text-content-muted mt-4 mb-1.5" {...props}>
      {children}
    </h4>
  ),
  p: ({ children, ...props }) => (
    <p className="text-sm text-content-primary leading-relaxed mb-3" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc list-outside pl-5 mb-3 space-y-1 text-sm text-content-primary" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal list-outside pl-5 mb-3 space-y-1 text-sm text-content-primary" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  a: ({ children, href, ...props }) => {
    const isExternal = href && /^https?:\/\//i.test(href);
    return (
      <a
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        className="text-accent hover:underline underline-offset-2"
        {...props}
      >
        {children}
      </a>
    );
  },
  strong: ({ children, ...props }) => (
    <strong className="font-semibold text-content-primary" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-content-primary" {...props}>
      {children}
    </em>
  ),
  code: ({ inline, children, ...props }) =>
    inline ? (
      <code
        className="font-mono text-[0.85em] bg-bg-secondary border border-hairline rounded px-1 py-0.5 text-content-primary"
        {...props}
      >
        {children}
      </code>
    ) : (
      <code className="font-mono text-xs leading-relaxed text-content-primary" {...props}>
        {children}
      </code>
    ),
  pre: ({ children, ...props }) => (
    <pre
      className="bg-bg-secondary border border-hairline rounded p-3 text-xs overflow-x-auto mb-3"
      {...props}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="border-l-2 border-accent pl-3 italic text-content-secondary mb-3 text-sm" {...props}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-hairline my-4" />,
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto mb-3">
      <table className="w-full text-xs border-collapse" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="text-[10px] uppercase tracking-[0.08em] text-content-muted bg-bg-secondary font-medium" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }) => (
    <th className="text-left font-medium px-2 py-1.5 border-b border-hairline" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-2 py-1.5 border-b border-hairline align-top text-content-primary tabular-nums" {...props}>
      {children}
    </td>
  ),
};

export default function AiMarkdown({ children, className }) {
  // Empty / whitespace-only payload — render nothing rather than an empty wrapper.
  if (!children || !String(children).trim()) return null;
  return (
    <div className={clsx('redip-ai-markdown', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
