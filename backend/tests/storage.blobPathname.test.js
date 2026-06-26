'use strict';

// Org-scoped Vercel Blob keys for NEW uploads — defense-in-depth foundation.
// The dormant Blob provider previously keyed only by deal id, ignoring the
// organizationId uploadFile already accepts. Pure pathname helper: no SDK, no
// network. (The bucket is service-role-only today, so the prefix is
// organisation, not yet an access boundary — true enforcement is the deferred
// Supabase-Storage migration.)

const { buildBlobPathname } = require('../src/config/storage');

describe('buildBlobPathname', () => {
  test('org-scopes the key when an organizationId is supplied', () => {
    expect(buildBlobPathname('deal-1', 'title.pdf', 'org-9', 1700000000000))
      .toBe('orgs/org-9/deals/deal-1/1700000000000-title.pdf');
  });

  test('falls back to the legacy deals/<id>/... shape when org is unknown', () => {
    expect(buildBlobPathname('deal-1', 'title.pdf', null, 1700000000000))
      .toBe('deals/deal-1/1700000000000-title.pdf');
    expect(buildBlobPathname('deal-1', 'title.pdf', undefined, 1700000000000))
      .toBe('deals/deal-1/1700000000000-title.pdf');
  });

  test('preserves deal id, filename and timestamp in both shapes', () => {
    const orged = buildBlobPathname('d', 'f.pdf', 'o', 42);
    expect(orged).toBe('orgs/o/deals/d/42-f.pdf');
    const legacy = buildBlobPathname('d', 'f.pdf', null, 42);
    expect(legacy).toBe('deals/d/42-f.pdf');
  });
});
