// Platform-admin permission helper. Distinct from workspace role:
//   - workspace `role` (owner / admin / editor / viewer) is the user's
//     position inside their own organization, which everyone has.
//   - platform admin is the operator(s) of REDIP itself who get access to
//     cross-org admin surfaces — Master Plan, Parcel Intelligence, the
//     Comps Review Queue, AI Usage & Cost, A/B Evaluations.
//
// The SERVER computes `is_platform_admin` (persisted users flag OR the
// backend break-glass allowlist) into /auth/me and every auth response.
// The browser holds no operator list — it renders a server fact. The real
// boundary is requirePlatformAdmin on every /api/admin/* route; this helper
// only decides what UI to show.

export function isPlatformAdmin(user) {
  return user?.is_platform_admin === true;
}
