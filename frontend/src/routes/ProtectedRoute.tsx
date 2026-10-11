import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PATHS } from './paths';
import { Box, CircularProgress } from '@mui/material';
import { NoAccess } from '../shared/components/NoAccess';

interface ProtectedRouteProps {
  /** If provided, only users whose roleName or role matches are allowed through. */
  allowedRoles?: string[];
}

export const ProtectedRoute = ({ allowedRoles }: ProtectedRouteProps) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    // Preserve query string (e.g. ?expired=true) so the Login page can show the right banner,
    // and stash the intended location so we can return here after a successful login.
    return <Navigate to={`${PATHS.LOGIN}${location.search}`} state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0) {
    // A user can be authorized via either the fine-grained roleName (user_roles table)
    // or the legacy role ENUM. Treat both as valid identifiers so a user with
    // role='SUPERUSER' but no user_roles record (e.g. seeded superuser) is not locked out.
    const roleName = user?.roleName?.toLowerCase() ?? '';
    const legacyRole = user?.role?.toLowerCase() ?? '';
    const userRoles = new Set<string>([roleName, legacyRole].filter(Boolean));
    // Normalize legacy SUPERUSER ENUM so it matches the 'superuser' allow-list value.
    if (user?.role === 'SUPERUSER') userRoles.add('superuser');

    const hasRole = allowedRoles.some(r => userRoles.has(r.toLowerCase()));
    if (!hasRole) {
      return <NoAccess />;
    }
  }

  return <Outlet />;
};
