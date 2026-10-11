/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { usageAnalyticsService } from '../services/usageAnalyticsService';

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;

/**
 * Resolves the ?from / ?to query window.
 *
 * `to` is exclusive and snapped to the end of the given day so that passing
 * from=2026-07-01&to=2026-07-31 includes all of the 31st.
 */
function resolveWindow(req: Request): { from: Date; to: Date } | { error: string } {
  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;

  const to = toRaw ? new Date(`${toRaw}T00:00:00.000Z`) : new Date();
  if (isNaN(to.getTime())) return { error: 'Invalid "to" date; expected YYYY-MM-DD' };
  if (toRaw) to.setUTCDate(to.getUTCDate() + 1); // make the end date inclusive

  const from = fromRaw
    ? new Date(`${fromRaw}T00:00:00.000Z`)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (isNaN(from.getTime())) return { error: 'Invalid "from" date; expected YYYY-MM-DD' };

  if (from >= to) return { error: '"from" must be earlier than "to"' };
  const spanDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (spanDays > MAX_WINDOW_DAYS) return { error: `Date range cannot exceed ${MAX_WINDOW_DAYS} days` };

  return { from, to };
}

class UsageAnalyticsController {
  async getSummary(req: Request, res: Response) {
    const win = resolveWindow(req);
    if ('error' in win) return res.status(400).json({ success: false, message: win.error });
    try {
      const data = await usageAnalyticsService.getSummary(win.from, win.to);
      return res.json({ success: true, data });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  async getTrend(req: Request, res: Response) {
    const win = resolveWindow(req);
    if ('error' in win) return res.status(400).json({ success: false, message: win.error });
    try {
      const data = await usageAnalyticsService.getDailyTrend(win.from, win.to);
      return res.json({ success: true, data });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  async getUsers(req: Request, res: Response) {
    const win = resolveWindow(req);
    if ('error' in win) return res.status(400).json({ success: false, message: win.error });
    try {
      const roleFilter = req.query.role as string | undefined;
      const data = await usageAnalyticsService.getUserBreakdown(win.from, win.to, roleFilter);
      return res.json({ success: true, data });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  async getFeatures(req: Request, res: Response) {
    const win = resolveWindow(req);
    if ('error' in win) return res.status(400).json({ success: false, message: win.error });
    try {
      const data = await usageAnalyticsService.getFeatureBreakdown(win.from, win.to);
      return res.json({ success: true, data });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

export const usageAnalyticsController = new UsageAnalyticsController();
