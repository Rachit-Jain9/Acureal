import { describe, it, expect } from 'vitest';
import {
  buildSetupChecklist, checklistDoneCount, isChecklistComplete,
} from '../setupChecklist';

const ids = (items) => items.map((i) => i.id);
const doneIds = (items) => items.filter((i) => i.done).map((i) => i.id);

describe('buildSetupChecklist — role shaping', () => {
  it('gives an editor the four build steps + intel, but no invite', () => {
    const items = buildSetupChecklist({ role: 'editor' });
    expect(ids(items)).toEqual([
      'create-deal', 'link-parcel', 'upload-doc', 'run-model', 'explore-intel',
    ]);
  });

  it('gives an admin the build steps + intel + invite', () => {
    const items = buildSetupChecklist({ role: 'admin' });
    expect(ids(items)).toContain('invite-teammate');
    expect(ids(items)).toHaveLength(6);
  });

  it('gives a viewer a read-first checklist (explore, not create)', () => {
    const items = buildSetupChecklist({ role: 'viewer' });
    expect(ids(items)).toEqual(['explore-deals', 'explore-intel']);
  });

  it('treats analyst as editor (alias)', () => {
    expect(ids(buildSetupChecklist({ role: 'analyst' }))).toContain('create-deal');
  });
});

describe('buildSetupChecklist — completion detection', () => {
  it('detects each build signal from the server-computed flags', () => {
    const items = buildSetupChecklist({
      role: 'admin',
      totalDeals: 3,
      hasLinkedParcel: true,
      hasDocument: true,
      hasModel: true,
      memberCount: 2,
      exploredIntel: true,
    });
    expect(doneIds(items)).toEqual([
      'create-deal',     // totalDeals > 0
      'link-parcel',     // hasLinkedParcel
      'upload-doc',      // hasDocument
      'run-model',       // hasModel
      'explore-intel',   // flag set
      'invite-teammate', // memberCount > 1
    ]);
    expect(isChecklistComplete(items)).toBe(true);
  });

  it('leaves items undone when their signal is absent', () => {
    const items = buildSetupChecklist({
      role: 'editor',
      totalDeals: 1,
      hasLinkedParcel: false,
      hasDocument: false,
      hasModel: false,
      exploredIntel: false,
    });
    expect(doneIds(items)).toEqual(['create-deal']);
    expect(checklistDoneCount(items)).toBe(1);
    expect(isChecklistComplete(items)).toBe(false);
  });

  it('does not count a solo workspace as having invited (memberCount 1)', () => {
    const items = buildSetupChecklist({ role: 'admin', memberCount: 1 });
    expect(doneIds(items)).not.toContain('invite-teammate');
  });
});
