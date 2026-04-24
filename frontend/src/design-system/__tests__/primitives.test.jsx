import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IndianRupee } from 'lucide-react';
import { Card, SectionHeader, MetricTile, ErrorState } from '../index';
import Badge from '../../components/common/Badge';

describe('Card', () => {
  it('renders children and applies base surface classes', () => {
    render(<Card data-testid="c">hi</Card>);
    const el = screen.getByTestId('c');
    expect(el).toHaveTextContent('hi');
    expect(el.className).toMatch(/bg-bg-elevated/);
    expect(el.className).toMatch(/border-hairline/);
    expect(el.className).toMatch(/rounded-editorial/);
  });

  it('adds shadow-editorial when elevated', () => {
    render(<Card elevated data-testid="c" />);
    expect(screen.getByTestId('c').className).toMatch(/shadow-editorial/);
  });

  it('respects `as` polymorphism', () => {
    render(<Card as="section" data-testid="c" />);
    expect(screen.getByTestId('c').tagName).toBe('SECTION');
  });
});

describe('SectionHeader', () => {
  it('renders title, eyebrow, sub and action', () => {
    render(
      <SectionHeader
        eyebrow="CTX"
        title="Pipeline"
        sub="hello"
        action={<button type="button">Go</button>}
      />,
    );
    expect(screen.getByText('Pipeline')).toBeInTheDocument();
    expect(screen.getByText('CTX')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('omits eyebrow and sub when not provided', () => {
    render(<SectionHeader title="Bare" />);
    expect(screen.getByText('Bare')).toBeInTheDocument();
    expect(screen.queryByText('CTX')).toBeNull();
  });

  it('renders an icon when passed via the `icon` prop', () => {
    const { container } = render(
      <SectionHeader icon={IndianRupee} title="Financial Summary" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('Financial Summary')).toBeInTheDocument();
  });

  it('renders as h3 with tighter spacing when size="sm"', () => {
    const { container } = render(
      <SectionHeader size="sm" title="Sub-section" />,
    );
    expect(container.querySelector('h3')).not.toBeNull();
    expect(container.querySelector('h2')).toBeNull();
  });

  it('defaults to h2 when size is omitted', () => {
    const { container } = render(<SectionHeader title="Top" />);
    expect(container.querySelector('h2')).not.toBeNull();
  });
});

describe('MetricTile', () => {
  it('renders label, value, unit, footnote', () => {
    render(
      <MetricTile
        label="Pipeline Value"
        value="₹ 124 Cr"
        unit="total"
        footnote="Cumulative ask · active deals"
      />,
    );
    expect(screen.getByText('Pipeline Value')).toBeInTheDocument();
    expect(screen.getByText('₹ 124 Cr')).toBeInTheDocument();
    expect(screen.getByText('total')).toBeInTheDocument();
    expect(screen.getByText('Cumulative ask · active deals')).toBeInTheDocument();
  });

  it('applies data-positive tone class when tone=up', () => {
    const { container } = render(
      <MetricTile label="IRR" value="22%" delta="+4%" tone="up" />,
    );
    const deltaEl = container.querySelector('.text-data-positive');
    expect(deltaEl).not.toBeNull();
    expect(deltaEl).toHaveTextContent('+4%');
  });

  it('applies data-negative tone class when tone=down', () => {
    const { container } = render(
      <MetricTile label="Risk" value="3" delta="open" tone="down" />,
    );
    const deltaEl = container.querySelector('.text-data-negative');
    expect(deltaEl).not.toBeNull();
  });

  it('hides delta block entirely when delta is null/undefined', () => {
    const { container } = render(<MetricTile label="X" value="1" />);
    expect(container.querySelector('.text-data-positive')).toBeNull();
    expect(container.querySelector('.text-data-negative')).toBeNull();
  });
});

describe('Badge', () => {
  it('renders children and applies the neutral tone class by default', () => {
    const { container } = render(<Badge>Draft</Badge>);
    const span = container.querySelector('span.badge');
    expect(span).not.toBeNull();
    expect(span?.className).toMatch(/badge-neutral/);
    expect(span).toHaveTextContent('Draft');
  });

  it('applies tone-specific classes for each tone', () => {
    const tones = ['success', 'warn', 'danger', 'info', 'premium'];
    tones.forEach((tone) => {
      const { container, unmount } = render(<Badge tone={tone}>{tone}</Badge>);
      expect(container.querySelector('span.badge')?.className).toMatch(
        new RegExp(`badge-${tone}`),
      );
      unmount();
    });
  });

  it('falls back to neutral when an unknown tone is passed', () => {
    const { container } = render(<Badge tone="bogus">x</Badge>);
    expect(container.querySelector('span.badge')?.className).toMatch(/badge-neutral/);
  });

  it('preserves consumer className alongside the tone class', () => {
    const { container } = render(<Badge tone="success" className="uppercase">ok</Badge>);
    const cls = container.querySelector('span.badge')?.className ?? '';
    expect(cls).toMatch(/badge-success/);
    expect(cls).toMatch(/uppercase/);
  });
});

describe('ErrorState', () => {
  it('renders title + children with warn palette (default)', () => {
    render(
      <ErrorState title="Missing">
        please fill out the form
      </ErrorState>,
    );
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status.className).toMatch(/bg-amber-50/);
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText(/please fill/)).toBeInTheDocument();
  });

  it('uses rose palette for danger tone', () => {
    render(<ErrorState tone="danger" title="Boom" />);
    expect(screen.getByRole('status').className).toMatch(/bg-rose-50/);
  });

  it('uses sky palette for info tone', () => {
    render(<ErrorState tone="info" title="FYI" />);
    expect(screen.getByRole('status').className).toMatch(/bg-sky-50/);
  });
});
