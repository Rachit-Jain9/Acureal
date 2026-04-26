'use strict';

/**
 * Pin the cross-asset DD checklist coverage. The platform must NOT silently
 * fall back to the residential checklist for hospitality/retail/industrial —
 * each asset class needs its own specialized items.
 */

const ddService = require('../src/services/dd.service');

describe('dd.service cross-asset checklists', () => {
  // Reach into the module to pull the constants. The seedForDeal function
  // hits the database, so we test the static checklist surface separately.
  // The simplest, side-effect-free path is to read what's exported and
  // reconstruct via require cache.
  const ddSrc = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', 'src', 'services', 'dd.service.js'),
    'utf8'
  );

  test('hospitality checklist includes operator agreement and FSSAI', () => {
    expect(ddSrc).toMatch(/Hotel management \/ brand operating agreement/);
    expect(ddSrc).toMatch(/FSSAI food licence/);
    expect(ddSrc).toMatch(/Tourism Department classification/);
  });

  test('retail checklist includes anchor tenant and ECS parking', () => {
    expect(ddSrc).toMatch(/Anchor tenant LOI \/ lease terms/);
    expect(ddSrc).toMatch(/ECS parking compliance/);
    expect(ddSrc).toMatch(/Trade mix and category exclusivity review/);
  });

  test('industrial checklist includes KIADB, KSPCB consent, BESCOM HT power', () => {
    expect(ddSrc).toMatch(/KIADB allotment/);
    expect(ddSrc).toMatch(/KSPCB.*consent|Karnataka State Pollution Control Board/);
    expect(ddSrc).toMatch(/BESCOM \/ KPTCL HT power feasibility/);
    expect(ddSrc).toMatch(/Heavy-vehicle access/);
  });

  test('mixed-use checklist includes FSI split and common-area apportionment', () => {
    expect(ddSrc).toMatch(/Mixed-use FSI split/);
    expect(ddSrc).toMatch(/Common-area apportionment/);
  });

  test('redevelopment checklist includes society consent and tenant rehab', () => {
    expect(ddSrc).toMatch(/Society \/ association consent/);
    expect(ddSrc).toMatch(/Existing-tenant rehab area schedule/);
  });

  test('module continues to export required CRUD surface', () => {
    expect(typeof ddService.listByDeal).toBe('function');
    expect(typeof ddService.create).toBe('function');
    expect(typeof ddService.update).toBe('function');
    expect(typeof ddService.updateStatus).toBe('function');
    expect(typeof ddService.seedForDeal).toBe('function');
    expect(typeof ddService.getDDScore).toBe('function');
    expect(typeof ddService.delete).toBe('function');
  });
});
