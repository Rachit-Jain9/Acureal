import useAuthStore from '../store/authStore';
import { roleSatisfies } from '../utils/roles';

// Canonical "may this user edit org data?" check. Editor / admin / owner can
// edit; viewer is read-only. Uses roleSatisfies (alias-aware: maps the legacy
// `analyst` role to editor, which the older inline `['owner','admin','editor']`
// checks missed). Mirror of the backend requireRole('admin','analyst') gate —
// the UI hides/disables affordances, the server still enforces.
export function useCanEdit() {
  const role = useAuthStore((s) => s.user?.role);
  return roleSatisfies(role, ['editor']);
}

// "May this user administer the workspace?" (admin / owner) — for org-level
// destructive or management actions (delete deal, manage members/domains).
export function useCanManageOrg() {
  const role = useAuthStore((s) => s.user?.role);
  return roleSatisfies(role, ['admin']);
}
