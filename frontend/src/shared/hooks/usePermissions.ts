import { useAuth } from '../../context/AuthContext';

/**
 * Role-derived permission flags. Centralises the `role` vs `roleName` duality
 * so the rest of the app never has to think about it.
 */
export const usePermissions = () => {
  const { user } = useAuth();
  const roleName = user?.roleName as string | undefined;

  const isSuperuser = user?.role === 'SUPERUSER' || roleName === 'superuser';
  const isAdmin     = roleName === 'admin';
  const isLead      = roleName === 'lead';
  const isManager   = roleName === 'manager';
  // Executive: a customer-facing, read-only role that only ever sees the
  // Executive Dashboard. It is neither a member nor a privileged internal role,
  // so it must be excluded explicitly wherever `!isMember` was used as a proxy
  // for "internal user" (e.g. canSeeActionItems below).
  const isExecutive = roleName === 'executive';
  // Members are the base role: no elevated role, and either explicitly 'member'
  // or no role assigned (profile defaults an unassigned user to 'member').
  const isMember    = !isSuperuser && !isAdmin && !isLead && !isManager && !isExecutive && (roleName === 'member' || !roleName);

  return {
    isSuperuser,
    isAdmin,
    isLead,
    isManager,
    isMember,
    isExecutive,
    canSeeUserMgmt:     isSuperuser || isAdmin,
    canSeeRiskMgmt:     isSuperuser || isAdmin || isManager || isLead,
    // Retro boards are participatory: members join and post, so unlike the risk
    // board this is NOT restricted to lead-and-above. Executives are excluded
    // (customer-facing, read-only role). Creating a board is a separate,
    // narrower right below.
    canSeeRetroBoard:   !isExecutive,
    canCreateRetroBoard: isSuperuser || isAdmin || isManager || isLead,
    canSeePresentation: isSuperuser || isAdmin || isManager || isLead,
    // The reviewer's worklist. Members see their own review elsewhere, never a roster.
    // Hidden from everyone but superusers for now (pre-launch) — the original
    // rule, kept here as a comment so re-enabling later is a one-line change:
    //   isSuperuser || isAdmin || isManager || isLead
    canSeeTeamReviews:  isSuperuser,
    // A member's own review — every role can have one except executive
    // (customer-facing, never a reviewee). Also hidden until launch; original
    // rule: isSuperuser || !isExecutive
    canSeeMyPerformanceReview: isSuperuser,
    canConfigurePerformanceReview: isSuperuser,
    canSeeActionItems:  !isMember && !isExecutive,
    // Executives get the dashboard; superuser retains access for previewing/testing.
    canSeeExecutiveDashboard: isSuperuser || isExecutive,
    roleLabel:          user?.role === 'SUPERUSER' ? 'Superuser' : (roleName ?? ''),
  };
};
