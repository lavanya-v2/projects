import type { RetroLane } from './types';

/**
 * Mirror of backend/src/modules/retro/services/retroLaneTemplates.ts.
 *
 * Duplicated rather than shared because this codebase has no shared types
 * package — the same convention as features/risk-management/types.ts. Keep the
 * two in sync when adding a template.
 */
export type RetroLaneTemplateKey =
  | 'WENT_WELL'
  | 'START_STOP_CONTINUE'
  | 'FOUR_LS'
  | 'MAD_SAD_GLAD'
  | 'CUSTOM';

export const RETRO_LANE_TEMPLATES: Record<Exclude<RetroLaneTemplateKey, 'CUSTOM'>, RetroLane[]> = {
  WENT_WELL: [
    { key: 'went_well', name: 'What Went Well', order: 0, color: '#2e7d32' },
    { key: 'can_be_better', name: 'What Can Be Better', order: 1, color: '#e65100' },
    { key: 'action_items', name: 'Action Items', order: 2, color: '#1565c0' },
  ],
  START_STOP_CONTINUE: [
    { key: 'start', name: 'Start', order: 0, color: '#2e7d32' },
    { key: 'stop', name: 'Stop', order: 1, color: '#c62828' },
    { key: 'continue', name: 'Continue', order: 2, color: '#1565c0' },
  ],
  FOUR_LS: [
    { key: 'liked', name: 'Liked', order: 0, color: '#2e7d32' },
    { key: 'learned', name: 'Learned', order: 1, color: '#1565c0' },
    { key: 'lacked', name: 'Lacked', order: 2, color: '#e65100' },
    { key: 'longed_for', name: 'Longed For', order: 3, color: '#6a1b9a' },
  ],
  MAD_SAD_GLAD: [
    { key: 'mad', name: 'Mad', order: 0, color: '#c62828' },
    { key: 'sad', name: 'Sad', order: 1, color: '#e65100' },
    { key: 'glad', name: 'Glad', order: 2, color: '#2e7d32' },
  ],
};

export const TEMPLATE_LABELS: Record<RetroLaneTemplateKey, string> = {
  WENT_WELL: 'Went Well / Can Be Better / Action Items',
  START_STOP_CONTINUE: 'Start / Stop / Continue',
  FOUR_LS: 'Liked / Learned / Lacked / Longed For',
  MAD_SAD_GLAD: 'Mad / Sad / Glad',
  CUSTOM: 'Custom lanes',
};

export const MIN_LANES = 2;
export const MAX_LANES = 6;
export const LANE_PALETTE = ['#2e7d32', '#e65100', '#1565c0', '#6a1b9a', '#c62828', '#00838f'];
