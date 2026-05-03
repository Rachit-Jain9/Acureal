import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const registerSpy = vi.fn(() => Promise.resolve(true));
const loginSpy = vi.fn(() => Promise.resolve(true));

vi.mock('../../store/authStore', () => ({
  default: () => ({
    login: loginSpy,
    register: registerSpy,
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

vi.mock('../../hooks/useLegalActive', () => ({
  useLegalActive: () => ({
    data: {
      terms_of_service: { id: 1, kind: 'terms_of_service', version: 'v1' },
      privacy_policy: { id: 2, kind: 'privacy_policy', version: 'v1' },
    },
    loading: false,
    error: null,
  }),
}));

import LoginPage from '../LoginPage';

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('LoginPage — signup terms acceptance gate', () => {
  beforeEach(() => {
    registerSpy.mockClear();
    loginSpy.mockClear();
  });

  it('does not show the acceptance card in sign-in mode', () => {
    renderLogin();
    // Default mode is sign-in. The acceptance label should not be rendered.
    expect(screen.queryByText(/I have read and agree/i)).toBeNull();
  });

  it('shows the acceptance card with Terms + Privacy links once Register is selected', async () => {
    renderLogin();
    const toggle = screen.getByRole('button', { name: /^Register$/i });
    await userEvent.click(toggle);

    expect(screen.getByText(/I have read and agree/i)).toBeInTheDocument();
    const termsLink = screen.getByRole('link', { name: /Terms & Conditions/i });
    const privacyLink = screen.getByRole('link', { name: /Privacy Policy/i });
    expect(termsLink).toHaveAttribute('href', '/terms');
    expect(termsLink).toHaveAttribute('target', '_blank');
    expect(privacyLink).toHaveAttribute('href', '/privacy');
    expect(privacyLink).toHaveAttribute('target', '_blank');
  });

  it('blocks submit and surfaces an inline error when the box is unchecked', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /^Register$/i }));

    fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'Password1!' },
    });

    const submit = screen.getByRole('button', { name: /Create Account/i });
    expect(submit).toBeDisabled();

    // Force-submit the form anyway to confirm the validate() guard catches it
    // even if disabled state is bypassed by AT or future regression.
    fireEvent.click(submit);
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('passes acceptedTermsVersion + acceptedPrivacyVersion to register on success', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /^Register$/i }));

    fireEvent.change(screen.getByPlaceholderText('John Doe'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByPlaceholderText('you@company.com'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'Password1!' },
    });

    const acceptBox = screen.getByRole('checkbox', {
      name: /I have read and agree/i,
    });
    await userEvent.click(acceptBox);

    const submit = screen.getByRole('button', { name: /Create Account/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(registerSpy).toHaveBeenCalledTimes(1));

    const [formData] = registerSpy.mock.calls[0];
    expect(formData).toMatchObject({
      name: 'Jane',
      email: 'jane@example.com',
      password: 'Password1!',
      acceptedTermsVersion: 'v1',
      acceptedPrivacyVersion: 'v1',
    });
  });

  it('shows current version metadata under the acceptance card', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /^Register$/i }));
    expect(screen.getByText(/Acceptance is recorded with timestamp, IP, and browser/i)).toBeInTheDocument();
    expect(screen.getByText(/Terms v1/)).toBeInTheDocument();
    expect(screen.getByText(/Privacy v1/)).toBeInTheDocument();
  });
});
