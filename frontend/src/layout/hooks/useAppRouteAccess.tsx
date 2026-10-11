import { matchPath, useLocation } from 'react-router-dom';
import { PATHS } from '../../routes/paths';
import { useActiveAccountProjects, type ActiveAccountProjects } from '../../shared/hooks/useActiveAccountProjects';
import { useAccount } from '../../context/UseAccount';

type ProjectFlags = Pick<
  ActiveAccountProjects,
  'hasJiraProjects' | 'hasExcelProjects' | 'hasNonSprintProjects' | 'hasClaudeProjects'
>;

const ROUTE_ACCESS_RULES: Array<{
  paths: string[];
  canAccess: (projects: ProjectFlags) => boolean;
}> = [
  {
    paths: [
      PATHS.REPORTS_DAILY,
      PATHS.REPORTS_WEEKLY_PROJECT,
      PATHS.REPORTS_WEEKLY_ACCOUNT,
      PATHS.REPORTS_MONTHLY_ACCOUNT,
      PATHS.REPORTS_MONTHLY_PROJECT,
      PATHS.REPORTS_CUSTOM_RANGE,
    ],
    canAccess: ({ hasNonSprintProjects }) => hasNonSprintProjects,
  },
  {
    paths: [
      PATHS.PORTFOLIO_PRESENTATION,
      PATHS.PORTFOLIO_PRESENTATION_VIEW,
      PATHS.PORTFOLIO_PRESENTATION_CREATE,
      PATHS.PORTFOLIO_PRESENTATION_EDIT,
      PATHS.RISK_MANAGEMENT,
      PATHS.ACTION_ITEMS,
      PATHS.TEAM_PERFORMANCE_TRENDS,
    ],
    canAccess: ({ hasJiraProjects }) => hasJiraProjects,
  },
  {
    paths: [
      PATHS.REPORTS_DAILY_PROGRAM,
      PATHS.REPORTS_WEEKLY_PROGRAM,
      PATHS.REPORTS_MONTHLY_PROGRAM,
    ],
    canAccess: ({ hasJiraProjects, hasNonSprintProjects }) => hasJiraProjects && hasNonSprintProjects,
  },
  {
    paths: [
      PATHS.RETRO_BOARDS,
      PATHS.RETRO_BOARD_VIEW,
      PATHS.TEAM_PERFORMANCE_SPRINT,
      PATHS.TEAM_REVIEWS,
      PATHS.MY_PERFORMANCE_REVIEW,
    ],
    canAccess: ({ hasJiraProjects, hasExcelProjects }) => hasJiraProjects || hasExcelProjects,
  },
  {
    paths: [PATHS.DATA_IMPORTS],
    canAccess: ({ hasExcelProjects }) => hasExcelProjects,
  },
  {
    paths: [
      PATHS.MY_CLAUDE_REPORT,
      PATHS.TEAM_CLAUDE_REPORT,
      PATHS.TEAM_MEMBER_DETAIL,
      PATHS.CLAUDE_USAGE_GUIDE,
    ],
    canAccess: ({ hasClaudeProjects }) => hasClaudeProjects,
  },
];

export const useAppRouteAccess = () => {
  const location = useLocation();
  const { activeAccount, isLoading: accountLoading } = useAccount();
  const projects = useActiveAccountProjects();
  const accessRule = ROUTE_ACCESS_RULES.find(({ paths }) =>
    paths.some((path) => matchPath(path, location.pathname)),
  );
  const canAccessRoute = !accessRule || (
    !!activeAccount?.id && accessRule.canAccess(projects)
  );
  const isLoading = !!accessRule && (accountLoading || projects.loading);

  return {
    canAccessRoute,
    isLoading,
  };
};