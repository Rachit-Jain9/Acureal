// Editorial markdown renderer for public legal pages.
// Routes through the semantic design-system tokens (text-content-*, bg-bg-*,
// border-hairline) so it is theme-correct anywhere. The legal pages that use it
// force the light ("editorial") theme via usePublicLightTheme(), so the tokens
// resolve to the intended light values there; the brand-orange link hex is
// intentional and kept literal.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';

const components = {
  h1: ({ children, ...props }) => (
    <h1
      className="font-serif text-2xl sm:text-3xl font-semibold text-content-primary tracking-tight mb-4 mt-2"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="font-serif text-lg sm:text-xl font-semibold text-content-primary tracking-tight mt-8 mb-3"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="font-serif text-base font-semibold text-content-primary tracking-tight mt-5 mb-2"
      {...props}
    >
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="text-sm text-content-secondary leading-relaxed mb-3" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc list-outside pl-5 mb-4 space-y-1.5 text-sm text-content-secondary" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal list-outside pl-5 mb-4 space-y-1.5 text-sm text-content-secondary" {...props}>
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
        className="text-[#c2410c] hover:text-[#9a3412] underline underline-offset-2"
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
    <em className="italic" {...props}>
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
      className="bg-bg-secondary border border-hairline rounded p-3 text-xs overflow-x-auto mb-4"
      {...props}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="border-l-4 border-hairline-strong pl-4 italic text-content-secondary mb-4" {...props}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-hairline my-6" />,
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border-collapse" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="text-[11px] uppercase tracking-[0.08em] text-content-muted bg-bg-secondary font-medium" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }) => (
    <th className="text-left font-medium px-3 py-2 border-b border-hairline" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-3 py-2 border-b border-hairline align-top text-content-secondary" {...props}>
      {children}
    </td>
  ),
};

export default function Markdown({ children, className }) {
  return (
    <div className={clsx('redip-markdown', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
