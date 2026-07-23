import { describe, it, expect } from 'vitest';
import { isPlatformAdmin } from '../permissions';

describe('isPlatformAdmin', () => {
  it('returns true only for the server-computed flag', () => {
    expect(isPlatformAdmin({ is_platform_admin: true })).toBe(true);
  });

  it('returns false when the flag is false or absent', () => {
    expect(isPlatformAdmin({ is_platform_admin: false })).toBe(false);
    expect(isPlatformAdmin({ email: 'anyone@example.com' })).toBe(false);
  });

  it('ignores truthy-but-not-true values (fail-closed)', () => {
    expect(isPlatformAdmin({ is_platform_admin: 'true' })).toBe(false);
    expect(isPlatformAdmin({ is_platform_admin: 1 })).toBe(false);
  });

  it('returns false for null / undefined users', () => {
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin({})).toBe(false);
  });

  it('never decides from an email — the operator list does not exist client-side', () => {
    expect(isPlatformAdmin({ email: 'operator@example.com', role: 'admin' })).toBe(false);
  });
});
