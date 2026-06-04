import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import SpotlightBackdrop from '../SpotlightBackdrop';

// jsdom can't lay out, so we stub the target's getBoundingClientRect. This
// covers the measurement → geometry path; the visual tween is verified in a
// real browser.
function mountTarget({ top, left, width, height }) {
  const el = document.createElement('div');
  el.id = 'tab-overview';
  el.getBoundingClientRect = () => ({
    top, left, width, height, right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => {},
  });
  document.body.appendChild(el);
  return el;
}

describe('SpotlightBackdrop', () => {
  afterEach(() => {
    document.querySelectorAll('#tab-overview').forEach((n) => n.remove());
  });

  it('renders nothing when the target is absent', () => {
    render(<SpotlightBackdrop target="#nope" />);
    expect(document.getElementById('redip-spotlight-mask')).toBeNull();
  });

  it('cuts a padded window around a measured target', () => {
    mountTarget({ top: 100, left: 100, width: 80, height: 30 });
    render(<SpotlightBackdrop target="#tab-overview" />);
    const mask = document.getElementById('redip-spotlight-mask');
    expect(mask).not.toBeNull();
    const cutout = mask.querySelector('rect[fill="black"]');
    // PAD = 8 → x = 100 - 8 = 92, width = 80 + 16 = 96
    expect(cutout.getAttribute('x')).toBe('92');
    expect(cutout.getAttribute('width')).toBe('96');
  });
});
