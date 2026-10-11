import { useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { Box, CircularProgress, useMediaQuery, useTheme } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../shared/hooks/usePermissions';
import { PATHS, TAB_LABEL, resolvePageLabel } from '../routes/paths';
import { AppRoutes } from '../routes/AppRoutes';
import { NoAccess } from '../shared/components/NoAccess';
import { SECTION_OF_PATH, SECTION_LABEL } from './navigation';
import type { Section } from './navigation';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useAppRouteAccess } from './hooks/useAppRouteAccess';
import { RAIL_W, PANEL_W, TOPBAR_H } from './constants';
import { DesktopRail } from './DesktopRail';
import { DesktopSubPanel } from './DesktopSubPanel';
import { MobileDrawer } from './MobileDrawer';
import { TopBar } from './TopBar';
import { PageHeader } from './PageHeader';

/**
 * Authenticated app shell. Composes rail + sub-panel + topbar + routed content.
 * Owns only cross-cutting UI state: mobile drawer open flag.
 * All role/nav logic lives in hooks; all presentation lives in child components.
 */
export const AppLayout = () => {
  const { logout } = useAuth();
  const { canSeeUserMgmt } = usePermissions();
  const { sections, getSubItems } = useAppNavigation();
  const { canAccessRoute, isLoading: routeAccessLoading } = useAppRouteAccess();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);

  const currentPath = location.pathname;
  // Exact match first; fall back to a prefix match so deep links that carry an
  // id or token (e.g. /retro/b/<token>) still resolve to their parent section.
  const activeSection =
    SECTION_OF_PATH[currentPath] ??
    (currentPath.startsWith('/retro') ? ('management' as Section) : null);
  const isAdminPath = currentPath.startsWith(PATHS.ADMIN);

  const subPanelVisible = !!activeSection && !isMobile;
  const contentLeft = isMobile ? 0 : subPanelVisible ? RAIL_W + PANEL_W : RAIL_W;

  const sectionLabel = activeSection
    ? SECTION_LABEL[activeSection]
    : isAdminPath
      ? 'Administration'
      : null;
  const pageLabel = resolvePageLabel(currentPath);
  const searchParams = new URLSearchParams(location.search);
  const tabParam = searchParams.get('tab');
  const tabLabel = tabParam ? (TAB_LABEL[tabParam] ?? null) : null;

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) setMobileOpen(false);
  };

  const handleSectionClick = (section: Section) => {
    const items = getSubItems(section);
    if (items.length > 0) handleNavigate(items[0].path);
  };

  const handleLogout = async () => {
    await logout();
    navigate(PATHS.LOGIN);
  };

  if (routeAccessLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!canAccessRoute) return <NoAccess />;

  // Executive Dashboard is a full-bleed, customer-facing surface with its own
  // branded top bar — render it without the app rail / sub-panel / top bar.
  if (currentPath.startsWith(PATHS.EXECUTIVE_DASHBOARD)) {
    return (
      <Box component="main" sx={{ minHeight: '100vh' }}>
        <AppRoutes />
      </Box>
    );
  }
  if (currentPath.startsWith(PATHS.PORTFOLIO_PRESENTATION_CREATE) ||
    matchPath('/presentation/delivery/presentation/:id', currentPath) ||
    matchPath('/presentations/delivery/:mode/:id', currentPath)) {
    return (
      <Box component="main" sx={{ minHeight: '100vh' }}>
        <AppRoutes />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#f4f6f9' }}>
      {!isMobile && (
        <DesktopRail
          currentPath={currentPath}
          activeSection={activeSection}
          sections={sections}
          isAdminPath={isAdminPath}
          canSeeUserMgmt={canSeeUserMgmt}
          onNavigate={handleNavigate}
          onSectionClick={handleSectionClick}
        />
      )}

      {subPanelVisible && activeSection && (
        <DesktopSubPanel
          section={activeSection}
          items={getSubItems(activeSection)}
          currentPath={currentPath}
          onNavigate={handleNavigate}
        />
      )}

      {isMobile && (
        <MobileDrawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          currentPath={currentPath}
          isAdminPath={isAdminPath}
          sections={sections}
          getSubItems={getSubItems}
          canSeeUserMgmt={canSeeUserMgmt}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
        />
      )}

      <TopBar
        isMobile={isMobile}
        contentLeft={contentLeft}
        sectionLabel={sectionLabel}
        pageLabel={pageLabel}
        tabLabel={tabLabel}
        onMobileMenuOpen={() => setMobileOpen(true)}
        onLogout={handleLogout}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          ml: { xs: 0, md: `${contentLeft}px` },
          mt: `${TOPBAR_H}px`,
          p: { xs: 1.5, sm: 2, md: 3 },
          minWidth: 0,
          overflowX: 'hidden',
          transition: 'margin-left 200ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <PageHeader title={pageLabel} />
        <AppRoutes />
      </Box>
    </Box>
  );
};
