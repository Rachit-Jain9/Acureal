import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, SectionHeader, MetricTile, ErrorState } from '../index';

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
