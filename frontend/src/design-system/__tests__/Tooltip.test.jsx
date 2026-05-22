import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

describe('Tooltip', () => {
  it('renders the trigger', () => {
    render(
      <Tooltip content="Helpful hint">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument();
  });

  it('renders the bubble with role="tooltip"', () => {
    render(
      <Tooltip content="Helpful hint">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Helpful hint');
  });

  it('links the trigger to the bubble via aria-describedby', () => {
    render(
      <Tooltip content="Helpful hint">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.getAttribute('id'));
  });

  it('renders only the children when content is empty', () => {
    render(
      <Tooltip content="">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument();
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });
});
