/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryTypes } from 'sequelize';
import sequelize from '../../../config/connection';
import { usageTrackingService } from '../../../services/usageTrackingService';

/**
 * A session's meaningful duration. `ended_at` is set on logout / expiry / stale
 * close; while a session is still open we fall back to the last heartbeat, so
 * this expression is correct in every state.
 */
const SESSION_DURATION_SECONDS = `EXTRACT(EPOCH FROM (COALESCE(ended_at, last_seen_at) - started_at))`;

/**
 * Resolves one role per user. `user_roles` is many-to-many in the schema but the
 * API enforces a single role, so DISTINCT ON guards against duplicate rows
 * fanning out the user join.
 */
const ROLE_CTE = `
    user_role AS (
        SELECT DISTINCT ON (ur.user_id) ur.user_id, r.name AS role_name
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        ORDER BY ur.user_id, ur.id ASC
    )
`;

export interface UsageSummary {
  dau: number;
  wau: number;
  mau: number;
  windowActiveUsers: number;
  totalUsers: number;
  neverLoggedIn: number;
  totalSessions: number;
  totalLogins: number;
  avgSessionMinutes: number;
  totalFeatureEvents: number;
}

class UsageAnalyticsService {
  /** Headline numbers. DAU/WAU/MAU are anchored on now(), independent of the filter window. */
  async getSummary(from: Date, to: Date): Promise<UsageSummary> {
    await usageTrackingService.closeStaleSessions();

    const [rolling] = await sequelize.query<any>(
      `SELECT
                COUNT(DISTINCT user_id) FILTER (WHERE occurred_at >= NOW() - INTERVAL '1 day')   AS dau,
                COUNT(DISTINCT user_id) FILTER (WHERE occurred_at >= NOW() - INTERVAL '7 days')  AS wau,
                COUNT(DISTINCT user_id) FILTER (WHERE occurred_at >= NOW() - INTERVAL '30 days') AS mau
             FROM usage_events`,
      { type: QueryTypes.SELECT }
    );

    const [windowed] = await sequelize.query<any>(
      `SELECT
                COUNT(DISTINCT user_id)                                       AS window_active_users,
                COUNT(*) FILTER (WHERE event_type = 'login')                  AS total_logins,
                COUNT(*) FILTER (WHERE event_type = 'feature')                AS total_feature_events
             FROM usage_events
             WHERE occurred_at >= :from AND occurred_at < :to`,
      { type: QueryTypes.SELECT, replacements: { from, to } }
    );

    const [sessions] = await sequelize.query<any>(
      `SELECT
                COUNT(*)                                        AS total_sessions,
                COALESCE(AVG(${SESSION_DURATION_SECONDS}), 0)   AS avg_session_seconds
             FROM user_sessions
             WHERE started_at >= :from AND started_at < :to`,
      { type: QueryTypes.SELECT, replacements: { from, to } }
    );

    const [users] = await sequelize.query<any>(
      `SELECT
                COUNT(*)                                                        AS total_users,
                COUNT(*) FILTER (WHERE NOT EXISTS (
                    SELECT 1 FROM user_sessions s WHERE s.user_id = u.id
                ))                                                              AS never_logged_in
             FROM users u
             WHERE u.is_active = true`,
      { type: QueryTypes.SELECT }
    );

    return {
      dau: Number(rolling?.dau || 0),
      wau: Number(rolling?.wau || 0),
      mau: Number(rolling?.mau || 0),
      windowActiveUsers: Number(windowed?.window_active_users || 0),
      totalUsers: Number(users?.total_users || 0),
      neverLoggedIn: Number(users?.never_logged_in || 0),
      totalSessions: Number(sessions?.total_sessions || 0),
      totalLogins: Number(windowed?.total_logins || 0),
      avgSessionMinutes: Math.round(Number(sessions?.avg_session_seconds || 0) / 60),
      totalFeatureEvents: Number(windowed?.total_feature_events || 0),
    };
  }

  /** Per-day active users / sessions / events. Days with no activity are filled with zeros. */
  async getDailyTrend(from: Date, to: Date) {
    await usageTrackingService.closeStaleSessions();

    const rows = await sequelize.query<any>(
      // NOTE: CAST(...) rather than Postgres '::' casts — Sequelize's named
      // replacement parser treats the second colon in ':from::timestamptz'
      // as the start of another parameter.
      `WITH days AS (
                SELECT generate_series(
                    date_trunc('day', CAST(:from AS timestamptz)),
                    date_trunc('day', CAST(:to AS timestamptz) - INTERVAL '1 day'),
                    INTERVAL '1 day'
                ) AS day
            ),
            ev AS (
                SELECT date_trunc('day', occurred_at) AS day,
                       COUNT(DISTINCT user_id)                       AS active_users,
                       COUNT(*) FILTER (WHERE event_type = 'feature') AS events
                FROM usage_events
                WHERE occurred_at >= :from AND occurred_at < :to
                GROUP BY 1
            ),
            se AS (
                SELECT date_trunc('day', started_at) AS day, COUNT(*) AS sessions
                FROM user_sessions
                WHERE started_at >= :from AND started_at < :to
                GROUP BY 1
            )
            SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
                   COALESCE(ev.active_users, 0) AS active_users,
                   COALESCE(se.sessions, 0)     AS sessions,
                   COALESCE(ev.events, 0)       AS events
            FROM days d
            LEFT JOIN ev ON ev.day = d.day
            LEFT JOIN se ON se.day = d.day
            ORDER BY d.day ASC`,
      { type: QueryTypes.SELECT, replacements: { from, to } }
    );

    return rows.map(r => ({
      date: r.date,
      activeUsers: Number(r.active_users),
      sessions: Number(r.sessions),
      events: Number(r.events),
    }));
  }

  /**
   * Per-user breakdown. LEFT JOINed from `users` on purpose: accounts with zero
   * usage must appear in the report — that is the most actionable row in it.
   */
  async getUserBreakdown(from: Date, to: Date, roleFilter?: string) {
    await usageTrackingService.closeStaleSessions();

    const rows = await sequelize.query<any>(
      `WITH ${ROLE_CTE},
            sess AS (
                SELECT user_id,
                       COUNT(*)                                          AS session_count,
                       SUM(${SESSION_DURATION_SECONDS})                  AS total_seconds,
                       MAX(started_at)                                   AS last_login,
                       MAX(COALESCE(ended_at, last_seen_at))             AS last_seen
                FROM user_sessions
                WHERE started_at >= :from AND started_at < :to
                GROUP BY user_id
            ),
            ev AS (
                SELECT user_id, COUNT(*) AS event_count
                FROM usage_events
                WHERE occurred_at >= :from AND occurred_at < :to AND event_type = 'feature'
                GROUP BY user_id
            ),
            ranked AS (
                SELECT user_id, feature, COUNT(*) AS cnt,
                       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY COUNT(*) DESC, feature ASC) AS rn
                FROM usage_events
                WHERE occurred_at >= :from AND occurred_at < :to
                  AND event_type = 'feature' AND feature IS NOT NULL
                GROUP BY user_id, feature
            ),
            topf AS (
                SELECT user_id, string_agg(feature || ' (' || cnt || ')', ', ' ORDER BY cnt DESC) AS top_features
                FROM ranked WHERE rn <= 3 GROUP BY user_id
            ),
            ever AS (
                SELECT user_id, MAX(started_at) AS last_login_ever FROM user_sessions GROUP BY user_id
            )
            SELECT u.id,
                   u.first_name, u.last_name, u.user_id, u.email, u.is_active,
                   COALESCE(ur.role_name, CASE WHEN u.role = 'SUPERUSER' THEN 'superuser' ELSE 'member' END) AS role_name,
                   COALESCE(sess.session_count, 0) AS session_count,
                   COALESCE(sess.total_seconds, 0) AS total_seconds,
                   sess.last_login,
                   sess.last_seen,
                   ever.last_login_ever,
                   COALESCE(ev.event_count, 0)     AS event_count,
                   topf.top_features
            FROM users u
            LEFT JOIN user_role ur ON ur.user_id = u.id
            LEFT JOIN sess ON sess.user_id = u.id
            LEFT JOIN ev   ON ev.user_id = u.id
            LEFT JOIN topf ON topf.user_id = u.id
            LEFT JOIN ever ON ever.user_id = u.id
            WHERE u.is_active = true
              ${roleFilter !== 'All roles' ? "AND COALESCE(ur.role_name, CASE WHEN u.role = 'SUPERUSER' THEN 'superuser' ELSE 'member' END) = :roleFilter" : ''}
            ORDER BY COALESCE(ev.event_count, 0) DESC, u.first_name ASC`,
      { type: QueryTypes.SELECT, replacements: { from, to, roleFilter: roleFilter } }
    );

    return rows.map(r => {
      const sessionCount = Number(r.session_count);
      const totalMinutes = Math.round(Number(r.total_seconds) / 60);
      return {
        id: Number(r.id),
        name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        userId: r.user_id,
        email: r.email,
        roleName: r.role_name,
        sessionCount,
        totalMinutes,
        avgSessionMinutes: sessionCount ? Math.round(totalMinutes / sessionCount) : 0,
        lastLogin: r.last_login,
        lastSeen: r.last_seen,
        lastLoginEver: r.last_login_ever,
        eventCount: Number(r.event_count),
        topFeatures: r.top_features || '',
      };
    });
  }

  /** Which parts of the product actually get used. */
  async getFeatureBreakdown(from: Date, to: Date) {
    const rows = await sequelize.query<any>(
      `SELECT feature,
                    COUNT(*)                AS event_count,
                    COUNT(DISTINCT user_id) AS user_count
             FROM usage_events
             WHERE occurred_at >= :from AND occurred_at < :to
               AND event_type = 'feature' AND feature IS NOT NULL
             GROUP BY feature
             ORDER BY event_count DESC`,
      { type: QueryTypes.SELECT, replacements: { from, to } }
    );

    return rows.map(r => ({
      feature: r.feature,
      eventCount: Number(r.event_count),
      userCount: Number(r.user_count),
    }));
  }
}

export const usageAnalyticsService = new UsageAnalyticsService();
