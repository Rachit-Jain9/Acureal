// setupChecklist.js — derives the first-run "setup checklist" live from real
// workspace data. Completion is NEVER persisted as booleans: each item's `done`
// is computed from current data every render, so un-doing an action (un-linking
// a parcel, archiving the only deal) correctly un-checks it, and progress is
// the same on every device. The dashboard owns the data fetching; this module
// is pure so it can be unit-tested in isolation.

import { roleSatisfies } from './roles';

// localStorage flag for the one item with no server signal — "did the user
// open Market Intelligence?". Set on that page's mount (see IntelligencePage).
export const INTEL_FLAG_KEY = 'redip.checklist.exploredIntel';

export function hasExploredIntel() {
  try {
    return typeof window !== 'undefined'
      && window.localStorage.getItem(INTEL_FLAG_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function markIntelExplored() {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(INTEL_FLAG_KEY, '1');
  } catch (_) {
    // localStorage may be unavailable (private mode) — best-effort only.
  }
}

// `hasLinkedParcel` / `hasDocument` / `hasModel` are booleans computed
// server-side in the dashboard stats aggregate (across ALL of the user's
// deals). They replace an earlier client-side `.some()` over a separate
// 100-deal fetch — see dashboard.service.js. `memberCount` is the workspace
// member count (> 1 ⇒ a teammate has been invited).
export function buildSetupChecklist({
  role,
  totalDeals = 0,
  hasLinkedParcel = false,
  hasDocument = false,
  hasModel = false,
  memberCount = 1,
  exploredIntel = false,
}) {
  const canCreate = roleSatisfies(role, ['editor']);
  const canInvite = roleSatisfies(role, ['admin']);

  const items = [];

  if (canCreate) {
    items.push({
      id: 'create-deal',
      label: 'Create your first deal',
      hint: 'Start with whatever you have — even a label like “Whitefield opportunity”.',
      done: totalDeals > 0,
      to: '/dashboard/deals?new=1',
      cta: 'New deal',
    });
    items.push({
      id: 'link-parcel',
      label: 'Add the site to a deal',
      hint: 'Link or capture the property so the site facts flow into everything downstream.',
      done: hasLinkedParcel,
      to: '/dashboard/deals',
      cta: 'Open deals',
    });
    items.push({
      id: 'upload-doc',
      label: 'Upload a document',
      hint: 'Drop in a title doc or RERA filing — AI reads it so you don’t have to.',
      done: hasDocument,
      to: '/dashboard/deals',
      cta: 'Open deals',
    });
    items.push({
      id: 'run-model',
      label: 'Run a financial model',
      hint: 'Underwrite a deal — IRR, NPV and sensitivities, computed deterministically.',
      done: hasModel,
      to: '/dashboard/deals',
      cta: 'Open deals',
    });
  } else {
    items.push({
      id: 'explore-deals',
      label: 'Explore the deal pipeline',
      hint: 'See how live deals move from sourcing through diligence to an IC decision.',
      done: totalDeals > 0,
      to: '/dashboard/deals',
      cta: 'Open deals',
    });
  }

  items.push({
    id: 'explore-intel',
    label: 'Scan Market Intelligence',
    hint: 'City-level benchmarks and trends — Bengaluru first, India second.',
    done: exploredIntel,
    to: '/dashboard/intelligence',
    cta: 'Open',
  });

  if (canInvite) {
    items.push({
      id: 'invite-teammate',
      label: 'Invite a teammate',
      hint: 'Diligence is a team sport — bring your analysts into the workspace.',
      done: memberCount > 1,
      to: '/dashboard/settings/team',
      cta: 'Open team',
    });
  }

  return items;
}

export const checklistDoneCount = (items) => items.filter((i) => i.done).length;
export const isChecklistComplete = (items) =>
  items.length > 0 && items.every((i) => i.done);
