import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomizePopover from '../CustomizePopover';
import { DEFAULT_WIDGETS } from '../../../hooks/useDashboardLayout';

const baseLayout = DEFAULT_WIDGETS.map((w) => ({ id: w.id, visible: w.defaultVisible }));

const setup = (overrides = {}) => {
  const props = {
    open: true,
    onClose: vi.fn(),
    layout: baseLayout,
    toggleVisible: vi.fn(),
    moveUp: vi.fn(),
    moveDown: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
  render(<CustomizePopover {...props} />);
  return props;
};

beforeEach(() => {
  // jsdom defaults
});

describe('CustomizePopover', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <CustomizePopover
        open={false}
        onClose={() => {}}
        layout={baseLayout}
        toggleVisible={() => {}}
        moveUp={() => {}}
        moveDown={() => {}}
        reset={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a row per widget with visibility + move buttons', () => {
    setup();
    // Each widget has a "Show / Hide" button (or always-on faded icon).
    // Catalogue has 8 widgets → 8 visibility buttons.
    const eyeButtons = screen.getAllByRole('button', { name: /Hide |Show /i });
    expect(eyeButtons.length).toBe(DEFAULT_WIDGETS.length);
    // Each row has Move up + Move down buttons (8 each).
    const moveUp = screen.getAllByRole('button', { name: /Move .* up/i });
    const moveDown = screen.getAllByRole('button', { name: /Move .* down/i });
    expect(moveUp.length).toBe(DEFAULT_WIDGETS.length);
    expect(moveDown.length).toBe(DEFAULT_WIDGETS.length);
  });

  it('clicking visibility toggle calls toggleVisible(id)', () => {
    const { toggleVisible } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Hide Pipeline distribution/i }));
    expect(toggleVisible).toHaveBeenCalledWith('pipeline_chart');
  });

  it('moveUp button calls moveUp(id)', () => {
    const { moveUp } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Move City distribution up/i }));
    expect(moveUp).toHaveBeenCalledWith('cities_chart');
  });

  it('first widget moveUp button is disabled (boundary)', () => {
    setup();
    const firstMoveUp = screen.getByRole('button', { name: /Move KPI strip up/i });
    expect(firstMoveUp).toBeDisabled();
  });

  it('last widget moveDown button is disabled (boundary)', () => {
    setup();
    const lastWidget = baseLayout[baseLayout.length - 1];
    const widgetLabel = DEFAULT_WIDGETS.find((w) => w.id === lastWidget.id).label;
    const moveDown = screen.getByRole('button', { name: new RegExp(`Move ${widgetLabel} down`, 'i') });
    expect(moveDown).toBeDisabled();
  });

  it('always-on widgets show a disabled visibility toggle', () => {
    setup();
    // KPI strip is always-on
    const kpiToggle = screen.getByRole('button', { name: /Hide KPI strip|Show KPI strip/i });
    expect(kpiToggle).toBeDisabled();
  });

  it('reset button calls reset()', () => {
    const { reset } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Reset to defaults/i }));
    expect(reset).toHaveBeenCalled();
  });

  it('Done button + close icon both call onClose', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Done$/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Escape key calls onClose', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
