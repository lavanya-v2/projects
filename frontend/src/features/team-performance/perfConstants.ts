/**
 * Centralized thresholds, color maps, and business-rule constants for the
 * Team Performance feature. Anything that was previously a magic number or
 * an inline color literal lives here.
 */

export const DELIVERY_THRESHOLDS = { good: 80, warn: 60 } as const;

export const QA_RATING_BANDS = { excellent: 10, good: 25, fair: 40 } as const;

/**
 * Minimum tickets tested for a QA's Quality rating to be meaningful.
 * Mirror of backend guard in performanceSyncService.ts (qualityRate = -1 when below).
 * Kept here so the UI can also gate historical syncs that pre-date the guard.
 */
export const QA_RATING_MIN_TESTED = 5;

/**
 * Show the Kanban "Current span (live)" tab in the board view.
 *
 * Hidden for now (Aug 2026) by request. The live span reads the in-progress cycle
 * straight from Jira rather than from a synced snapshot, so its numbers move
 * during the day and cannot be reconciled against a stored cycle.
 *
 * The state, the query hook and every `kanbanLive` branch are left intact — with
 * this false the mode simply never becomes 'live' (it defaults to 'history'), so
 * the live query never fires. Flip to true to restore the tab.
 */
export const SHOW_KANBAN_LIVE_SPAN = false;

/**
 * Parent issue types a bug can hang off that can never appear in a cycle's
 * ticket list, so they can't answer "was this bug caught against this cycle's
 * work". Bugs with such a parent are excluded from the In-Sprint Catch ratio
 * rather than scored as a miss.
 * Mirror of NON_DELIVERABLE_PARENT_TYPES in performanceSyncService.ts.
 */
export const NON_DELIVERABLE_PARENT_TYPES = new Set(['epic', 'initiative', 'theme']);

export const LOW_SP_THRESHOLD = 6;
export const REWORK_HIGH = 20;
export const BUG_ESCAPE_HIGH = 10;

export const SYNC_POLL_INTERVAL_MS = 3000;

/** MUI-severity → hex used by gradient bars / inline color styles */
export const DELIVERY_HEX = {
  good: '#2e7d32',
  warn: '#ed6c02',
  bad: '#d32f2f',
  none: '#90a4ae',
} as const;

/** Recharts bar fills for the sprint trends chart */
export const BAR_FILL = {
  good: '#4caf50',
  warn: '#ff9800',
  bad: '#f44336',
} as const;

/** Stacked bar colors for the sprint progress panel */
export const SPRINT_BAR_COLORS = {
  done: '#4caf50',
  uat: '#9c27b0',
  qa: '#ff9800',
  review: '#009688',
  inProgress: '#1976d2',
  blocked: '#f44336',
  toDo: '#e0e0e0',
} as const;

export type PipelineStatusKey =
  | 'done'
  | 'inUat'
  | 'inQa'
  | 'inReview'
  | 'inProgress'
  | 'blocked'
  | 'todo';

export interface PipelineStatusStyle {
  bg: string;
  fg: string;
  label: string;
}

/** Background, foreground, and label for each pipeline status chip */
export const PIPELINE_STATUS_STYLES: Record<PipelineStatusKey, PipelineStatusStyle> = {
  done:       { bg: '#e8f5e9', fg: '#2e7d32', label: 'Done' },
  inUat:      { bg: '#f3e5f5', fg: '#7b1fa2', label: 'UAT' },
  inQa:       { bg: '#fff3e0', fg: '#e65100', label: 'QA' },
  inReview:   { bg: '#e0f2f1', fg: '#00695c', label: 'Review' },
  inProgress: { bg: '#e3f2fd', fg: '#1565c0', label: 'In Prog' },
  blocked:    { bg: '#ffebee', fg: '#c62828', label: 'Blocked' },
  todo:       { bg: '#f5f5f5', fg: '#616161', label: 'To Do' },
};

/** Order in which pipeline chips render */
export const PIPELINE_STATUS_ORDER: PipelineStatusKey[] = [
  'done',
  'inUat',
  'inQa',
  'inReview',
  'inProgress',
  'blocked',
  'todo',
];
