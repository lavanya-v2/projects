import { useMemo } from 'react';
import { AssessmentRounded, SlideshowRounded, GroupsRounded, TrendingUpRounded, CloudUploadRounded, InsightsRounded, AutoAwesomeRounded } from '@mui/icons-material';
import { usePermissions } from '../../shared/hooks/usePermissions';
import { PATHS } from '../../routes/paths';
import { SUB_ITEMS } from '../navigation';
import type { Section, SectionDef, SubItem } from '../navigation';
import { useAccessiblePrograms } from '../../features/programs/hooks';
import { useAuth } from '../../context/AuthContext';
import { useActiveAccountProjects } from '../../shared/hooks/useActiveAccountProjects';
import { useAccount } from '../../context/UseAccount';

/**
 * Reports that shouldn't be visible to the "lead" role.
 * Leads can see per-project reports but not per-account reports.
 */
const LEAD_EXCLUDED_REPORT_PATHS: string[] = [
  PATHS.REPORTS_WEEKLY_ACCOUNT,
  PATHS.REPORTS_MONTHLY_ACCOUNT,
];

const PROGRAM_REPORT_PATHS: string[] = [
  PATHS.REPORTS_DAILY_PROGRAM,
  PATHS.REPORTS_WEEKLY_PROGRAM,
  PATHS.REPORTS_MONTHLY_PROGRAM,
];

/**
 * Reports hidden from the "member" role. Members see only Daily + Weekly Project;
 * everything account-level, program-level, and Monthly Project is hidden.
 */
const MEMBER_EXCLUDED_REPORT_PATHS: string[] = [
  PATHS.REPORTS_WEEKLY_ACCOUNT,
  PATHS.REPORTS_MONTHLY_ACCOUNT,
  PATHS.REPORTS_MONTHLY_PROJECT,
  PATHS.REPORTS_CUSTOM_RANGE,
  ...PROGRAM_REPORT_PATHS,
];

/**
 * Returns the sections and child items the current user is allowed to see.
 * Filters out items the user doesn't have permission for.
 *
 * Data-source gating (Phase 1.6): sections that only support Jira projects
 * (Presentation, Team Performance, Management) are hidden when the active
 * account has no accessible Jira projects. Data Imports is hidden when the
 * active account has no accessible Excel projects. The data-source gate
 * layers ON TOP of the existing role gates — both must pass.
 */
export const useAppNavigation = () => {
  const { isSuperuser, isLead, isMember, isExecutive, isAdmin, isManager, canSeeRiskMgmt, canSeePresentation, canSeeActionItems, canSeeRetroBoard, canSeeTeamReviews, canSeeMyPerformanceReview } = usePermissions();
  const { isAuthenticated } = useAuth();
  const { activeAccount } = useAccount();
  const { hasJiraProjects, hasExcelProjects, hasNonSprintProjects, hasClaudeProjects } = useActiveAccountProjects();

  // Conditional visibility: program-report nav entries only render when the
  // active account has at least one accessible program. The existing query
  // returns programs across all accessible accounts, so we filter locally.
  const accessibleProgramsQuery = useAccessiblePrograms(isAuthenticated);
  const hasAccessiblePrograms = useMemo(() => {
    const all = accessibleProgramsQuery.data ?? [];
    if (!activeAccount?.id) return all.length > 0;
    return all.some((p) => p.accountId === activeAccount.id);
  }, [accessibleProgramsQuery.data, activeAccount]);

  const getSubItems = useMemo(
    () =>
      (section: Section): SubItem[] => {
        const items = SUB_ITEMS[section];
        // Executives are locked to the Executive Dashboard only — every other
        // section resolves empty so nothing else appears in the rail.
        if (isExecutive) return section === 'executive' ? items : [];
        if (section === 'executive') return [];
        if (section === 'reports') {
          // Hide the whole Reports section when every project in the account is
          // sprint-based (no daily/weekly reporting) — those projects report via the
          // Team Performance Board View instead.
          if (!hasNonSprintProjects) return [];
          return items.filter(i => {
            if (isMember && MEMBER_EXCLUDED_REPORT_PATHS.includes(i.path)) return false;
            if (isLead && LEAD_EXCLUDED_REPORT_PATHS.includes(i.path)) return false;
            // Program reports require both a Jira project AND a program in the active account.
            if (PROGRAM_REPORT_PATHS.includes(i.path) && (!hasAccessiblePrograms || !hasJiraProjects)) return false;
            return true;
          });
        }
        if (section === 'presentation') {
          return (canSeePresentation && hasJiraProjects) ? items : [];
        }
        if (section === 'management') {
          // Retro boards are not tied to Jira — a retro is a conversation about
          // any project — so they survive on Excel-only accounts, where the rest
          // of this section does not.
          const anyProjects = hasJiraProjects || hasExcelProjects;
          return items.filter(i => {
            if (i.path === PATHS.RETRO_BOARDS) return canSeeRetroBoard && anyProjects;
            if (!hasJiraProjects) return false;
            if (i.path === PATHS.RISK_MANAGEMENT) return canSeeRiskMgmt;
            if (i.path === PATHS.ACTION_ITEMS) return canSeeActionItems;
            return true;
          });
        }
        if (section === 'team-performance') {
          // Board View is available for Jira OR Excel projects (Excel-only accounts get the
          // reduced Excel Sprint Board). Trends stays a Jira-only, non-member org-wide view.
          if (!hasJiraProjects && !hasExcelProjects) return [];
          return items.filter(i => {
            if (i.path === PATHS.TEAM_PERFORMANCE_TRENDS) return hasJiraProjects && !isMember;
            // Team Reviews is the reviewer's worklist, so it is lead-and-above.
            // Members reach their own review from their dashboard, not from here.
            if (i.path === PATHS.TEAM_REVIEWS) return canSeeTeamReviews;
            if (i.path === PATHS.MY_PERFORMANCE_REVIEW) return canSeeMyPerformanceReview;
            return true;
          });
        }
        if (section === 'data-imports') {
          return (canSeePresentation && hasExcelProjects) ? items : [];
        }
        if (section === 'claude-usage') {
          // Project-level gate (ADDENDUM 25): the whole section is hidden unless at
          // least one of the user's active-account projects is set to Claude as its
          // dev-assistant tool — never show Claude-shaped nav to someone whose
          // project doesn't use it at all, not even as a "coming soon" link.
          if (!hasClaudeProjects) return [];
          // ADDENDUM 23: once a Claude project exists, the section is visible to any
          // non-executive regardless of the viewer's OWN pilot enrollment — "My Claude
          // Report" stays in the nav even when not enrolled (clicking it shows a
          // "coming soon" screen, which is more honest than hiding the link entirely).
          // "Team" is filtered by role only, same as before.
          if (isExecutive) return [];
          const canSeeTeam = isSuperuser || isAdmin || isManager || isLead;
          return items.filter(i => (i.path === PATHS.TEAM_CLAUDE_REPORT ? canSeeTeam : true));
        }
        return items;
      },
    [isMember, isLead, isExecutive, isAdmin, isManager, isSuperuser, canSeePresentation, canSeeRiskMgmt, canSeeActionItems, canSeeRetroBoard, canSeeTeamReviews, canSeeMyPerformanceReview, hasAccessiblePrograms, hasJiraProjects, hasExcelProjects, hasNonSprintProjects, hasClaudeProjects],
  );

  // Drop any section whose visible sub-items are empty (e.g. members have no
  // Management items once Action Items + Risk Board are hidden).
  const sections: SectionDef[] = useMemo(
    () =>
      ([
        { id: 'executive' as Section,        label: 'Executive',        icon: <InsightsRounded /> },
        { id: 'reports' as Section,          label: 'Reports',          icon: <AssessmentRounded /> },
        ...(canSeePresentation
          ? [{ id: 'presentation' as Section, label: 'Presentation', icon: <SlideshowRounded /> }]
          : []),
        { id: 'team-performance' as Section, label: 'Team Performance', icon: <TrendingUpRounded /> },
        { id: 'management' as Section,       label: 'Management',       icon: <GroupsRounded /> },
        ...(canSeePresentation
          ? [{ id: 'data-imports' as Section, label: 'Data Imports', icon: <CloudUploadRounded /> }]
          : []),
        { id: 'claude-usage' as Section,     label: 'Claude Usage',     icon: <AutoAwesomeRounded /> },
      ] as SectionDef[]).filter(s => getSubItems(s.id).length > 0),
    [canSeePresentation, getSubItems],
  );

  return { sections, getSubItems, isSuperuser };
};
