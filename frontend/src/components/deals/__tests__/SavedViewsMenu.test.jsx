import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SavedViewsMenu from '../SavedViewsMenu';

const sampleViews = [
  { id: 'v1', name: 'My active sourcing', filters: { stage: 'sourcing', assignedToMe: true } },
  { id: 'v2', name: 'Bengaluru office',   filters: { city: 'Bengaluru' } },
];

const setup = (overrides = {}) => {
  const props = {
    views: sampleViews,
    activeView: null,
    currentFilters: { stage: 'screening' },
    onApply: vi.fn(),
    onSave: vi.fn(),
    onRemove: vi.fn(),
    canSave: true,
    ...overrides,
  };
  render(<SavedViewsMenu {...props} />);
  return props;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SavedViewsMenu', () => {
  it('renders the trigger button with "Saved views" label by default', () => {
    setup();
    expect(screen.getByRole('button', { name: /Saved views/i })).toBeInTheDocument();
  });

  it('renders the active view name on the trigger when one is active', () => {
    setup({ activeView: sampleViews[0] });
    expect(screen.getByRole('button', { name: /My active sourcing/i })).toBeInTheDocument();
  });

  it('clicking the trigger opens the dropdown listing saved views', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Saved views/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('My active sourcing')).toBeInTheDocument();
    expect(screen.getByText('Bengaluru office')).toBeInTheDocument();
  });

  it('clicking a view triggers onApply with the view object', () => {
    const { onApply } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Saved views/i }));
    fireEvent.click(screen.getByText('Bengaluru office'));
    expect(onApply).toHaveBeenCalledWith(sampleViews[1]);
  });

  it('clicking the delete icon triggers onRemove with the view id', () => {
    const { onRemove } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Saved views/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete My active sourcing/i }));
    expect(onRemove).toHaveBeenCalledWith('v1');
  });

  it('Save current view → input → Enter persists via onSave', async () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Saved views/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save current view/i }));
    const input = await screen.findByPlaceholderText(/View name/i);
    fireEvent.change(input, { target: { value: 'My screening' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('My screening', { stage: 'screening' });
  });

  it('Save action is disabled when canSave=false', () => {
    setup({ canSave: false });
    fireEvent.click(screen.getByRole('button', { name: /Saved views/i }));
    const saveBtn = screen.getByRole('button', { name: /No filters to save/i });
    expect(saveBtn).toBeDisabled();
  });

  it('renders an empty-state message when no views exist', () => {
    setup({ views: [] });
    fireEvent.click(screen.getByRole('button', { name: /Saved views/i }));
    expect(screen.getByText(/No saved views yet/i)).toBeInTheDocument();
  });

  it('Escape key closes the dropdown', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Saved views/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('shows a checkmark next to the active view in the dropdown', () => {
    const { container } = render(
      <SavedViewsMenu
        views={sampleViews}
        activeView={sampleViews[0]}
        currentFilters={sampleViews[0].filters}
        onApply={vi.fn()}
        onSave={vi.fn()}
        onRemove={vi.fn()}
        canSave={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /My active sourcing/i }));
    // The active row should have an SVG checkmark — assert by querying
    // for its parent menu item containing "My active sourcing" and the
    // accent class on the label.
    const activeLabel = screen.getAllByText('My active sourcing').find((el) => el.className.includes('accent'));
    expect(activeLabel).toBeTruthy();
  });
});
