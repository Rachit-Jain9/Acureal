// Platform-admin permission helper. Distinct from workspace role:
//   - workspace `role` (owner / admin / editor / viewer) is the user's
//     position inside their own organization, which everyone has.
//   - platform admin is the operator(s) of REDIP itself who get access to
//     cross-org admin surfaces — Master Plan, Parcel Intelligence, the
//     Comps Review Queue, AI Usage & Cost, A/B Evaluations.
//
// Source of truth is the VITE_PLATFORM_ADMIN_EMAILS env var (comma-
// separated list). When unset we fall back to the one founding admin so
// the gate is non-empty out of the box.

const FALLBACK = 'rachitj579@gmail.com';

const RAW = (
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PLATFORM_ADMIN_EMAILS)
  || FALLBACK
);

const PLATFORM_ADMIN_EMAILS = new Set(
  String(RAW)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isPlatformAdmin(user) {
  if (!user || !user.email) return false;
  return PLATFORM_ADMIN_EMAILS.has(String(user.email).trim().toLowerCase());
}

// Exposed for tests so the module's env-derived snapshot is inspectable.
export const __PLATFORM_ADMIN_EMAILS_FOR_TEST = PLATFORM_ADMIN_EMAILS;
