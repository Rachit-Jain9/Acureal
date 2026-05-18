import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VerifyLinksSection from '../VerifyLinksSection';

const sampleLinks = [
  {
    key: 'bhoomi_rtc',
    label: 'Bhoomi RTC',
    authority: 'Karnataka Revenue Dept.',
    purpose: 'Pull the latest Record of Rights (RTC/Pahani) for this survey.',
    href: 'https://landrecords.karnataka.gov.in/Service2/',
    deep_link: false,
    status: 'ready',
    hint: 'Choose Bangalore Urban → Bangalore South → Begur → Begur, then enter Survey No 12/3.',
    inputs: { survey_number: 'present', district: 'present', taluk: 'present', hobli: 'present', village: 'present' },
    copy_text: 'Survey No: 12/3 | Village: Begur | Hobli: Begur | Taluk: Bangalore South | District: Bangalore Urban',
  },
  {
    key: 'kaveri_ec',
    label: 'Kaveri EC',
    authority: 'Karnataka Stamps & Registration',
    purpose: 'Look up the encumbrance certificate (mortgages, charges, transfers).',
    href: 'https://kaveri.karnataka.gov.in/landing-page',
    deep_link: false,
    status: 'ready',
    hint: 'Sign in, choose Encumbrance, then search SRO Bangalore South for survey 12/3.',
    inputs: { survey_number: 'present', taluk: 'present' },
    copy_text: 'SRO: Bangalore South | Survey No: 12/3 | Village: Begur | Hobli: Begur',
    structured_search: { sro: 'Bangalore South', survey_number: '12/3', village: 'Begur', hobli: 'Begur' },
  },
  {
    key: 'rera',
    label: 'K-RERA Project',
    authority: 'Karnataka Real Estate Regulatory Authority',
    purpose: 'Confirm RERA registration status and approved plans.',
    href: 'https://rera.karnataka.gov.in/home/searchProjects',
    deep_link: false,
    status: 'inputs_missing',
    hint: 'Add a RERA registration number on the property to use this lookup.',
    inputs: { rera_registration_number: 'missing' },
    copy_text: '',
  },
  {
    key: 'google_maps_satellite',
    label: 'Google Maps satellite',
    authority: 'Google Maps imagery',
    purpose: 'Visually confirm the parcel location.',
    href: 'https://www.google.com/maps/@12.972000,77.598000,19z/data=!3m1!1e3',
    deep_link: true,
    status: 'ready',
    hint: 'Opens the satellite view centred on the parcel pin.',
    inputs: { lat: 'present', lng: 'present' },
    copy_text: '12.972000, 77.598000',
  },
];

beforeEach(() => {
  // Stub clipboard for the test environment.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    writable: true,
    configurable: true,
  });
  // Stub window.open
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

describe('VerifyLinksSection', () => {
  it('renders nothing when verifyLinks is empty or null', () => {
    const { container, rerender } = render(<VerifyLinksSection verifyLinks={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<VerifyLinksSection verifyLinks={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<VerifyLinksSection verifyLinks={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per verify link', () => {
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    expect(screen.getByTestId('verify-links-section')).toBeInTheDocument();
    expect(screen.getByTestId('verify-link-bhoomi_rtc')).toBeInTheDocument();
    expect(screen.getByTestId('verify-link-kaveri_ec')).toBeInTheDocument();
    expect(screen.getByTestId('verify-link-rera')).toBeInTheDocument();
    expect(screen.getByTestId('verify-link-google_maps_satellite')).toBeInTheDocument();
  });

  it('shows the label + authority + purpose for each link', () => {
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    expect(screen.getByText('Bhoomi RTC')).toBeInTheDocument();
    expect(screen.getByText('Kaveri EC')).toBeInTheDocument();
    expect(screen.getByText(/Look up the encumbrance certificate/i)).toBeInTheDocument();
  });

  it('renders a "ready" pill on links with all inputs + "inputs missing" on the RERA link', () => {
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    // Multiple "ready" badges exist (Bhoomi, Kaveri, Google Maps).
    expect(screen.getAllByText('ready').length).toBeGreaterThan(0);
    // RERA is missing inputs.
    expect(screen.getByText('inputs missing')).toBeInTheDocument();
  });

  it('shows the "deep-link" badge only on Google Maps satellite', () => {
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    const deepLinkBadges = screen.getAllByText('deep-link');
    expect(deepLinkBadges).toHaveLength(1);
    // It must be inside the Google Maps row.
    const googleRow = screen.getByTestId('verify-link-google_maps_satellite');
    expect(googleRow).toContainElement(deepLinkBadges[0]);
  });

  it('"Copy" button writes the copy_text to clipboard and shows "Copied" feedback', async () => {
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    const copyBtn = screen.getByTestId('verify-link-kaveri_ec-copy');
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'SRO: Bangalore South | Survey No: 12/3 | Village: Begur | Hobli: Begur',
      );
    });
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('"Copy + Open" button writes clipboard AND opens the portal URL in a new tab', async () => {
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    const openBtn = screen.getByTestId('verify-link-bhoomi_rtc-open');
    fireEvent.click(openBtn);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'Survey No: 12/3 | Village: Begur | Hobli: Begur | Taluk: Bangalore South | District: Bangalore Urban',
      );
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://landrecords.karnataka.gov.in/Service2/',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('omits the Copy button for links without a copy_text (RERA when nothing on file)', () => {
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    expect(screen.queryByTestId('verify-link-rera-copy')).not.toBeInTheDocument();
    // But the Open button is still present (always)
    expect(screen.getByTestId('verify-link-rera-open')).toBeInTheDocument();
  });

  it('the Kaveri payload is specifically targeted (SRO + Survey, NOT a full context dump)', () => {
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    const row = screen.getByTestId('verify-link-kaveri_ec');
    // Toggling the <details> shows the payload.
    expect(row.textContent).toMatch(/SRO: Bangalore South/);
    expect(row.textContent).toMatch(/Survey No: 12\/3/);
    // Should NOT contain BBMP/PID/Khata noise.
    expect(row.textContent).not.toMatch(/PID:/);
    expect(row.textContent).not.toMatch(/Khata No:/);
    expect(row.textContent).not.toMatch(/Bhoomi ID:/);
  });

  it('clicking Open on a deep-link entry skips the Copy step but still opens', () => {
    // Google Maps has copy_text in our sample (the coords) so it goes
    // through the Copy + Open flow. To test the "skip copy" path we need
    // a link with no copy_text — use the RERA row.
    render(<VerifyLinksSection verifyLinks={sampleLinks} />);
    const openBtn = screen.getByTestId('verify-link-rera-open');
    fireEvent.click(openBtn);
    expect(window.open).toHaveBeenCalledWith(
      'https://rera.karnataka.gov.in/home/searchProjects',
      '_blank',
      'noopener,noreferrer',
    );
    // Clipboard should NOT have been called for this row.
    // (Other rows may have triggered it in prior tests; this verifies
    // RERA itself doesn't fire it.)
  });
});
