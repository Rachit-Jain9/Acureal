import { describe, it, expect } from 'vitest';
import config from '../../tailwind.config.js';

// Guards the class of bug where a Tailwind color token is referenced by many
// call sites but never defined: Tailwind then silently omits the utility, so
// the element renders with no color — invisible severity dots, dead primary-
// button hovers, solid-black inactive chart bars. These exact tokens regressed
// before; this test fails loudly if any is dropped again.
const { content, accent } = config.theme.extend.colors;

describe('design-system color tokens', () => {
  it('content.tertiary is defined (text-content-tertiary drives severity/status dots on 11 surfaces)', () => {
    expect(content.tertiary).toBeTruthy();
  });

  it('accent.primary + accent.hover are defined (input focus rings + primary-button hover)', () => {
    expect(accent.primary).toBeTruthy();
    expect(accent.hover).toBeTruthy();
  });
});
