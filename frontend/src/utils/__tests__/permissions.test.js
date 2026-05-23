import { describe, it, expect } from 'vitest';
import { isPlatformAdmin } from '../permissions';

describe('isPlatformAdmin', () => {
  it('returns true for the founding admin email', () => {
    expect(isPlatformAdmin({ email: 'rachitj579@gmail.com' })).toBe(true);
  });

  it('is case-insensitive on the email', () => {
    expect(isPlatformAdmin({ email: 'RachitJ579@Gmail.COM' })).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(isPlatformAdmin({ email: '  rachitj579@gmail.com  ' })).toBe(true);
  });

  it('returns false for a non-admin user', () => {
    expect(isPlatformAdmin({ email: 'someone-else@gmail.com' })).toBe(false);
  });

  it('returns false for null / undefined / missing email', () => {
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin({})).toBe(false);
    expect(isPlatformAdmin({ email: '' })).toBe(false);
  });
});
