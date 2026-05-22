import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import BuildabilityMassing from '../BuildabilityMassing';

describe('BuildabilityMassing', () => {
  it('renders the massing SVG when buildability data is sufficient', () => {
    const { container, getByRole } = render(
      <BuildabilityMassing
        values={{ ground_coverage_pct: 50, max_far: 2.5, max_buildable_area_sqft: 108900 }}
        landAreaSqft={43560}
      />,
    );
    const svg = getByRole('img');
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute('aria-label')).toMatch(/5 floors/);
    // 1 plot + 3 mass faces.
    expect(container.querySelectorAll('polygon').length).toBeGreaterThanOrEqual(4);
    // 5 floors → 4 floor-line groups on the mass.
    expect(container.querySelectorAll('line').length).toBeGreaterThan(0);
  });

  it('renders nothing when there is not enough data to draw a massing', () => {
    const { container } = render(<BuildabilityMassing values={{}} landAreaSqft={null} />);
    expect(container.firstChild).toBeNull();
  });
});
