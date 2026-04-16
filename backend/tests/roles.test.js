const {
  normalizeRole,
  roleSatisfies,
  mapLegacyUserRoleToOrganizationRole,
  mapOrganizationRoleToLegacyUserRole,
} = require('../src/constants/roles');

describe('organization role helpers', () => {
  test('normalizes legacy analyst into editor', () => {
    expect(normalizeRole('analyst')).toBe('editor');
    expect(normalizeRole('editor')).toBe('editor');
  });

  test('applies hierarchical access correctly', () => {
    expect(roleSatisfies('owner', ['admin'])).toBe(true);
    expect(roleSatisfies('admin', ['editor'])).toBe(true);
    expect(roleSatisfies('editor', ['analyst'])).toBe(true);
    expect(roleSatisfies('viewer', ['editor'])).toBe(false);
    expect(roleSatisfies('admin', ['owner'])).toBe(false);
  });

  test('maps between legacy and organization roles safely', () => {
    expect(mapLegacyUserRoleToOrganizationRole('admin')).toBe('admin');
    expect(mapLegacyUserRoleToOrganizationRole('analyst')).toBe('editor');
    expect(mapOrganizationRoleToLegacyUserRole('owner')).toBe('admin');
    expect(mapOrganizationRoleToLegacyUserRole('editor')).toBe('analyst');
  });
});
