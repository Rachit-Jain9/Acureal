const { normalizeDatabaseUrl } = require('../src/config/databaseUrl');

describe('normalizeDatabaseUrl', () => {
  test('encodes special characters in the password segment', () => {
    const input = 'postgresql://postgres.project:pa@ss:word@db.example.com:6543/postgres';
    const output = normalizeDatabaseUrl(input);

    expect(output).toBe('postgresql://postgres.project:pa%40ss%3Aword@db.example.com:6543/postgres');
  });

  test('leaves already-safe connection strings unchanged', () => {
    const input = 'postgresql://postgres.project:safe-password@db.example.com:6543/postgres';

    expect(normalizeDatabaseUrl(input)).toBe(input);
  });

  test('returns non-postgres strings unchanged', () => {
    expect(normalizeDatabaseUrl('not-a-url')).toBe('not-a-url');
  });
});
