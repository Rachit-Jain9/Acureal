import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Briefcase } from 'lucide-react';
import EmptyState from '../EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No deals found" />);
    expect(screen.getByText('No deals found')).toBeInTheDocument();
  });

  it('falls back to a default title', () => {
    render(<EmptyState />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="No deals" description="Create your first deal." />);
    expect(screen.getByText('Create your first deal.')).toBeInTheDocument();
  });

  it('renders the primary and secondary actions', () => {
    render(
      <EmptyState
        title="No deals"
        action={<button type="button">Create</button>}
        secondaryAction={<button type="button">Import</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });

  it('renders a custom icon as an svg inside the chip', () => {
    const { container } = render(<EmptyState title="x" icon={Briefcase} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('omits the icon chip when icon is null', () => {
    const { container } = render(<EmptyState title="x" icon={null} />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('applies the compact size', () => {
    const { container } = render(<EmptyState title="x" size="sm" />);
    expect(container.firstChild.className).toContain('py-8');
  });

  it('applies the default (md) size', () => {
    const { container } = render(<EmptyState title="x" />);
    expect(container.firstChild.className).toContain('py-12');
  });
});
