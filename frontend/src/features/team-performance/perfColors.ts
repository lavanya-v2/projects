/**
 * Pure color-mapping helpers driven by the thresholds in `perfConstants.ts`.
 * Centralizing these eliminates the four duplicated copies of the
 * "≥80 good, ≥60 warn, else bad" ladder that used to live inline in the JSX.
 */
import {
  BAR_FILL,
  DELIVERY_HEX,
  DELIVERY_THRESHOLDS,
  QA_RATING_BANDS,
  QA_RATING_MIN_TESTED,
} from './perfConstants';

export type DeliverySeverity = 'success' | 'warning' | 'error';

/** MUI severity color used by Chip / LinearProgress */
export const deliveryColor = (pct: number): DeliverySeverity => {
  if (pct >= DELIVERY_THRESHOLDS.good) return 'success';
  if (pct >= DELIVERY_THRESHOLDS.warn) return 'warning';
  return 'error';
};

/** Hex color for inline styles when an MUI severity isn't enough */
export const deliveryHex = (pct: number | null | undefined): string => {
  if (pct == null) return DELIVERY_HEX.none;
  if (pct >= DELIVERY_THRESHOLDS.good) return DELIVERY_HEX.good;
  if (pct >= DELIVERY_THRESHOLDS.warn) return DELIVERY_HEX.warn;
  return DELIVERY_HEX.bad;
};

/** Recharts bar cell fill based on a delivery percentage */
export const barFill = (pct: number): string => {
  if (pct >= DELIVERY_THRESHOLDS.good) return BAR_FILL.good;
  if (pct >= DELIVERY_THRESHOLDS.warn) return BAR_FILL.warn;
  return BAR_FILL.bad;
};

export type QualityBand = 'excellent' | 'good' | 'fair' | 'low' | 'insufficient' | 'none';

export const qualityBand = (pct: number | null | undefined): QualityBand => {
  if (pct == null) return 'none';
  if (pct < 0) return 'insufficient';
  if (pct <= QA_RATING_BANDS.excellent) return 'excellent';
  if (pct <= QA_RATING_BANDS.good) return 'good';
  if (pct <= QA_RATING_BANDS.fair) return 'fair';
  return 'low';
};

export const qualityBandLabel = (pct: number | null | undefined): string => {
  switch (qualityBand(pct)) {
    case 'excellent':    return 'Excellent';
    case 'good':         return 'Good';
    case 'fair':         return 'Fair';
    case 'low':          return 'Low';
    case 'insufficient': return 'N/A';
    default:          return '\u2014';
  }
};

/**
 * Effective QA rating gated on minimum tested-ticket count.
 * Returns -1 (sentinel → "N/A" band) when the sample is too small to rate.
 * Handles historical sync rows that stored 0 instead of -1 before the backend guard existed.
 */
export const effectiveQualityRate = (
  pct: number | null | undefined,
  ticketsTested: number | null | undefined,
): number | null | undefined => {
  if (pct == null) return pct;
  if (ticketsTested != null && ticketsTested < QA_RATING_MIN_TESTED) return -1;
  return pct;
};

/** Hex color for the QA rating card / cell */
export const qaRatingHex = (pct: number | null | undefined): string => {
  if (pct == null || pct < 0) return DELIVERY_HEX.none;
  if (pct <= QA_RATING_BANDS.good) return DELIVERY_HEX.good;
  if (pct <= QA_RATING_BANDS.fair) return DELIVERY_HEX.warn;
  return DELIVERY_HEX.bad;
};
