import type { ReactNode } from 'react';
import {
  EventNoteRounded,
  CalendarTodayRounded,
  BusinessRounded,
  DateRangeRounded,
  AccountBalanceRounded,
  TrendingUpRounded,
  ShowChartRounded,
  TaskAltRounded,
  ShieldRounded,
  AccountTreeRounded,
  HubRounded,
  ViewListRounded,
  TodayRounded,
  CloudUploadRounded,
  InsightsRounded,
  AutoAwesomeRounded,
  PsychologyRounded,
  GroupsRounded,
  HelpOutlineRounded,
  RateReviewRounded,
  StarRounded,
  EventRepeatRounded,
} from '@mui/icons-material';
import { PATHS } from '../routes/paths';

export type Section = 'executive' | 'reports' | 'presentation' | 'team-performance' | 'management' | 'data-imports' | 'claude-usage';

export interface SubItem {
  path: string;
  label: string;
  icon: ReactNode;
}

export interface SectionDef {
  id: Section;
  label: string;
  icon: ReactNode;
}

/** Child items for each top-level section. */
export const SUB_ITEMS: Record<Section, SubItem[]> = {
  executive: [
    { path: PATHS.EXECUTIVE_DASHBOARD, label: 'Executive Dashboard', icon: <InsightsRounded fontSize="small" /> },
  ],
  reports: [
    { path: PATHS.REPORTS_DAILY, label: 'Daily Reports', icon: <EventNoteRounded fontSize="small" /> },
    { path: PATHS.REPORTS_WEEKLY_PROJECT, label: 'Weekly Project', icon: <CalendarTodayRounded fontSize="small" /> },
    { path: PATHS.REPORTS_WEEKLY_ACCOUNT, label: 'Weekly Account', icon: <BusinessRounded fontSize="small" /> },
    { path: PATHS.REPORTS_MONTHLY_PROJECT, label: 'Monthly Project', icon: <DateRangeRounded fontSize="small" /> },
    { path: PATHS.REPORTS_CUSTOM_RANGE, label: 'Custom Range Report', icon: <EventRepeatRounded fontSize="small" /> },
    { path: PATHS.REPORTS_MONTHLY_ACCOUNT, label: 'Monthly Account', icon: <AccountBalanceRounded fontSize="small" /> },
    { path: PATHS.REPORTS_DAILY_PROGRAM, label: 'Daily Program', icon: <TodayRounded fontSize="small" /> },
    { path: PATHS.REPORTS_WEEKLY_PROGRAM, label: 'Weekly Program', icon: <HubRounded fontSize="small" /> },
    { path: PATHS.REPORTS_MONTHLY_PROGRAM, label: 'Monthly Program', icon: <ViewListRounded fontSize="small" /> },
  ],
  presentation: [
    { path: PATHS.PORTFOLIO_PRESENTATION, label: 'Delivery Presentation', icon: <AccountTreeRounded fontSize="small" /> },
  ],
  'team-performance': [
    { path: PATHS.TEAM_PERFORMANCE_SPRINT, label: 'Board View', icon: <TrendingUpRounded fontSize="small" /> },
    { path: PATHS.TEAM_PERFORMANCE_TRENDS, label: 'Trends', icon: <ShowChartRounded fontSize="small" /> },
    { path: PATHS.TEAM_REVIEWS, label: 'Team Reviews', icon: <RateReviewRounded fontSize="small" /> },
    { path: PATHS.MY_PERFORMANCE_REVIEW, label: 'My Review', icon: <StarRounded fontSize="small" /> },
  ],
  management: [
    { path: PATHS.ACTION_ITEMS, label: 'Action Items', icon: <TaskAltRounded fontSize="small" /> },
    { path: PATHS.RISK_MANAGEMENT, label: 'Risk Board', icon: <ShieldRounded fontSize="small" /> },
    { path: PATHS.RETRO_BOARDS, label: 'Retro Boards', icon: <GroupsRounded fontSize="small" /> },
  ],
  'data-imports': [
    { path: PATHS.DATA_IMPORTS, label: 'Daily Data Uploads', icon: <CloudUploadRounded fontSize="small" /> },
  ],
  'claude-usage': [
    { path: PATHS.MY_CLAUDE_REPORT, label: 'My Claude Report', icon: <AutoAwesomeRounded fontSize="small" /> },
    { path: PATHS.TEAM_CLAUDE_REPORT, label: 'Team Prompt Coaching', icon: <PsychologyRounded fontSize="small" /> },
    { path: PATHS.CLAUDE_USAGE_GUIDE, label: 'Understanding Your Report', icon: <HelpOutlineRounded fontSize="small" /> },
  ],
};

/** Reverse lookup: which section does this path belong to? */
export const SECTION_OF_PATH: Partial<Record<string, Section>> = {
  [PATHS.EXECUTIVE_DASHBOARD]: 'executive',
  [PATHS.REPORTS_DAILY]: 'reports',
  [PATHS.REPORTS_WEEKLY_PROJECT]: 'reports',
  [PATHS.REPORTS_WEEKLY_ACCOUNT]: 'reports',
  [PATHS.REPORTS_MONTHLY_PROJECT]: 'reports',
  [PATHS.REPORTS_CUSTOM_RANGE]: 'reports',
  [PATHS.REPORTS_MONTHLY_ACCOUNT]: 'reports',
  [PATHS.REPORTS_DAILY_PROGRAM]: 'reports',
  [PATHS.REPORTS_WEEKLY_PROGRAM]: 'reports',
  [PATHS.REPORTS_MONTHLY_PROGRAM]: 'reports',
  [PATHS.PORTFOLIO_PRESENTATION]: 'presentation',
  [PATHS.TEAM_PERFORMANCE]: 'team-performance',
  [PATHS.TEAM_PERFORMANCE_SPRINT]: 'team-performance',
  [PATHS.TEAM_PERFORMANCE_TRENDS]: 'team-performance',
  [PATHS.TEAM_REVIEWS]: 'team-performance',
  [PATHS.MY_PERFORMANCE_REVIEW]: 'team-performance',
  [PATHS.ACTION_ITEMS]: 'management',
  [PATHS.RISK_MANAGEMENT]: 'management',
  [PATHS.RETRO_BOARDS]: 'management',
  [PATHS.DATA_IMPORTS]: 'data-imports',
  [PATHS.MY_CLAUDE_REPORT]: 'claude-usage',
  [PATHS.TEAM_CLAUDE_REPORT]: 'claude-usage',
  [PATHS.CLAUDE_USAGE_GUIDE]: 'claude-usage',
};

export const SECTION_LABEL: Record<Section, string> = {
  executive: 'Executive',
  reports: 'Reports',
  presentation: 'Presentation',
  'team-performance': 'Team Performance',
  management: 'Management',
  'data-imports': 'Data Imports',
  'claude-usage': 'Claude Usage',
};
