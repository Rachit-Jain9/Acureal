// Editorial markdown renderer for public legal pages.
// Uses raw light-theme stone Tailwind colors (not design-system tokens) so
// the rendering is independent of the app's dark/light theme switch — these
// pages are always editorial-light.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';

const components = {
  h1: ({ children, ...props }) => (
    <h1
      className="font-serif text-2xl sm:text-3xl font-semibold text-stone-900 tracking-tight mb-4 mt-2"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2
      className="font-serif text-lg sm:text-xl font-semibold text-stone-900 tracking-tight mt-8 mb-3"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3
      className="font-serif text-base font-semibold text-stone-900 tracking-tight mt-5 mb-2"
      {...props}
    >
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="text-sm text-stone-700 leading-relaxed mb-3" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc list-outside pl-5 mb-4 space-y-1.5 text-sm text-stone-700" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal list-outside pl-5 mb-4 space-y-1.5 text-sm text-stone-700" {...props}>
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
    <strong className="font-semibold text-stone-900" {...props}>
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
        className="font-mono text-[0.85em] bg-stone-100 border border-stone-200 rounded px-1 py-0.5 text-stone-800"
        {...props}
      >
        {children}
      </code>
    ) : (
      <code className="font-mono text-xs leading-relaxed text-stone-800" {...props}>
        {children}
      </code>
    ),
  pre: ({ children, ...props }) => (
    <pre
      className="bg-stone-100 border border-stone-200 rounded p-3 text-xs overflow-x-auto mb-4"
      {...props}
    >
      {children}
    </pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote className="border-l-4 border-stone-300 pl-4 italic text-stone-700 mb-4" {...props}>
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-stone-200 my-6" />,
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border-collapse" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="text-[11px] uppercase tracking-[0.08em] text-stone-600 bg-stone-100 font-medium" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }) => (
    <th className="text-left font-medium px-3 py-2 border-b border-stone-200" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="px-3 py-2 border-b border-stone-200 align-top text-stone-700" {...props}>
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
