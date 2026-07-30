import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideCenter from '../GuideCenter';
import useGuideStore from '../../../store/guideStore';

const renderGuide = () =>
  render(
    <MemoryRouter>
      <GuideCenter />
    </MemoryRouter>,
  );

beforeEach(() => {
  useGuideStore.setState({ open: false, topicId: null });
});

describe('GuideCenter', () => {
  it('renders nothing while closed', () => {
    renderGuide();
    expect(screen.queryByRole('dialog', { name: /acureal guide/i })).toBeNull();
  });

  it('opens on the redip:guide-open event and shows navigation topics', () => {
    renderGuide();
    act(() => {
      window.dispatchEvent(new CustomEvent('redip:guide-open'));
    });
    expect(screen.getByRole('dialog', { name: /acureal guide/i })).toBeInTheDocument();
    // Default category is "Getting around" → the Dashboard topic card shows.
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('filters topics by search query', () => {
    renderGuide();
    act(() => {
      useGuideStore.getState().openGuide();
    });
    fireEvent.change(screen.getByLabelText(/search the guide/i), {
      target: { value: 'risk' },
    });
    expect(screen.getByRole('heading', { name: 'Risk' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull();
  });

  it('closes via the close button', () => {
    renderGuide();
    act(() => {
      useGuideStore.getState().openGuide();
    });
    fireEvent.click(screen.getByLabelText(/close guide/i));
    expect(useGuideStore.getState().open).toBe(false);
  });
});
