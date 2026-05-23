// RequirePlatformAdmin — route-level guard. Sends non-admins back to the
// dashboard so they can't reach an admin URL directly even if they guess
// the path. Pair with the sidebar's `isPlatformAdmin` check, which hides
// the admin group entirely for non-admins.

import { Navigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import { isPlatformAdmin } from '../../utils/permissions';

export default function RequirePlatformAdmin({ children }) {
  const user = useAuthStore((s) => s.user);
  if (!isPlatformAdmin(user)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}
