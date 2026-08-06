import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonPicker, PersonAvatar } from '../PersonPicker';

const PEOPLE = [
  { id: 'u1', name: 'Bharath Kumar', email: 'bharath@acureal.in', role: 'editor' },
  { id: 'u2', name: 'Mourya M', email: 'mourya@acureal.in', role: 'editor' },
  { id: 'u3', name: null, email: 'nameless@acureal.in', role: 'viewer' },
];

const openList = () => fireEvent.focus(screen.getByRole('combobox'));

describe('PersonAvatar', () => {
  test.each([
    [{ name: 'Bharath Kumar', email: 'b@x.com' }, 'BK'],
    [{ name: 'Cher', email: 'c@x.com' }, 'CH'],
    [{ name: null, email: 'nameless@x.com' }, 'N'],
    [{}, '?'],
  ])('renders initials for %j', (person, expected) => {
    render(<PersonAvatar person={person} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

describe('PersonPicker', () => {
  test('exposes the WAI-ARIA combobox contract', () => {
    render(<PersonPicker people={PEOPLE} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');

    openList();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  test('renders the list it is handed, verbatim — never re-filters', () => {
    // Eligibility is a server decision; a client-side filter would let the UI
    // disagree with the server about who can be shared with.
    render(<PersonPicker people={PEOPLE} />);
    openList();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzzz' } });
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  test('arrow keys move the active option and wrap in both directions', () => {
    render(<PersonPicker people={PEOPLE} />);
    const input = screen.getByRole('combobox');
    openList();

    const activeId = () => input.getAttribute('aria-activedescendant');
    expect(activeId()).toContain('u1');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeId()).toContain('u2');

    // Wraps forward off the end…
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeId()).toContain('u1');

    // …and backward off the start.
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeId()).toContain('u3');
  });

  test('Enter selects the active option', () => {
    const onChange = vi.fn();
    render(<PersonPicker people={PEOPLE} onChange={onChange} />);
    const input = screen.getByRole('combobox');
    openList();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(PEOPLE[1]);
  });

  test('Escape closes the list before it clears the query', () => {
    render(<PersonPicker people={PEOPLE} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'bha' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('bha');   // first Escape only closed the list

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
  });

  test('a selected person replaces the input, and Change restores it', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PersonPicker people={PEOPLE} value={PEOPLE[0]} onChange={onChange} />
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Bharath Kumar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    expect(onChange).toHaveBeenCalledWith(null);

    rerender(<PersonPicker people={PEOPLE} value={null} onChange={onChange} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  test('shows the empty state and its action when there are no candidates', () => {
    render(
      <PersonPicker
        people={[]}
        emptyMessage="No colleagues from your organization found."
        emptyAction={<span>Ask a Team Lead</span>}
      />
    );
    openList();
    expect(screen.getByText(/no colleagues from your organization/i)).toBeInTheDocument();
    expect(screen.getByText('Ask a Team Lead')).toBeInTheDocument();
  });

  test('shows a skeleton, not an empty state, while the first load is in flight', () => {
    render(<PersonPicker people={[]} loading emptyMessage="No colleagues found." />);
    openList();
    expect(screen.queryByText('No colleagues found.')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  test('falls back to the email when a colleague has no name', () => {
    render(<PersonPicker people={[PEOPLE[2]]} />);
    openList();
    expect(screen.getByRole('option')).toHaveTextContent('nameless@acureal.in');
  });

  test('renders the org badge when one is supplied', () => {
    render(<PersonPicker people={PEOPLE} badgeLabel="Acureal" />);
    openList();
    expect(screen.getAllByText('Acureal')).toHaveLength(3);
  });
});
