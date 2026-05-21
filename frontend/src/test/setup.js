import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement Element.prototype.scrollIntoView. Components that
// call it — typically inside a requestAnimationFrame after a state change —
// otherwise throw an uncaught TypeError when that callback fires. Because the
// callback resolves asynchronously, the error lands non-deterministically and
// can flake the whole CI run even though every test passes. A no-op shim is
// the standard fix; no test asserts on scroll behaviour.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
