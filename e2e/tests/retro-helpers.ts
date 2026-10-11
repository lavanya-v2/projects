/**
 * Helpers for the Retro Board E2E suite.
 *
 * Sessions are established by minting a JWT with the backend's own secret and
 * seeding localStorage, rather than driving the login form for every role —
 * the app reads `token` and `user` from localStorage on mount, so this produces
 * a genuine authenticated session while keeping the tests about the retro board
 * rather than about logging in.
 *
 * Everything this suite creates is prefixed "[E2E-RETRO]" and hard-deleted from
 * Postgres in teardown.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as jwt from 'jsonwebtoken';
import type { Page, BrowserContext } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
export const RETRO_TITLE_PREFIX = '[E2E-RETRO]';

function readBackendEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, '../../backend/.env');
  const env: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim();
    }
  }
  return env;
}

const ENV = readBackendEnv();
const JWT_SECRET = ENV.JWT_SECRET || 'default_secret_key';

export function getDbConfig() {
  return {
    host: ENV.DB_HOST || 'localhost',
    port: parseInt(ENV.DB_PORT || '5432'),
    database: ENV.DB_NAME || 'jira_daily_reports',
    user: ENV.DB_USER || 'postgres',
    password: ENV.DB_PASSWORD || 'postgres',
  };
}

export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client(getDbConfig());
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

export interface RetroUser {
  id: number;
  userId: string;
  firstName: string;
  lastName: string;
  roleName: string;
  role: string;
}

/**
 * Pick real users out of the database: a lead and two members who all share a
 * project, plus somebody with no access to it. Chosen dynamically so the suite
 * does not break when seed data shifts.
 */
export async function resolveTestUsers(): Promise<{
  lead: RetroUser; memberA: RetroUser; memberB: RetroUser; outsider: RetroUser; projectId: number;
}> {
  return withDb(async db => {
    const { rows } = await db.query(`
      SELECT u.id, u.user_id, u.first_name, u.last_name, u.role, r.name AS role_name, up.project_ids
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      JOIN user_permissions up ON up.user_id = u.id
      WHERE r.name IN ('lead','member')
        AND up.project_ids IS NOT NULL AND array_length(up.project_ids, 1) > 0
      ORDER BY u.id
    `);

    const toUser = (r: any): RetroUser => ({
      id: r.id, userId: r.user_id, firstName: r.first_name, lastName: r.last_name,
      roleName: r.role_name, role: r.role === 'SUPERUSER' ? 'SUPERUSER' : 'USER',
    });

    // Find a project that has one lead and at least two members.
    // Deterministic: without an explicit sort, Postgres row order decides which
    // project (and therefore which lead and members) the whole suite runs
    // against, so the same test could exercise different data run to run.
    const candidateProjects = [...new Set(rows.flatMap((r: any) => r.project_ids as number[]))]
      .sort((a, b) => a - b);

    for (const projectId of candidateProjects) {
      const on = rows.filter((r: any) => r.project_ids.includes(projectId));
      const lead = on.find((r: any) => r.role_name === 'lead');
      const members = on.filter((r: any) => r.role_name === 'member');
      if (!lead || members.length < 2) continue;

      const outsider = rows.find((r: any) => !r.project_ids.includes(projectId) && r.role_name === 'member');
      if (!outsider) continue;

      return {
        lead: toUser(lead),
        memberA: toUser(members[0]),
        memberB: toUser(members[1]),
        outsider: toUser(outsider),
        projectId: projectId as number,
      };
    }
    throw new Error('No project found with a lead, two members, and an outsider');
  });
}

export function mintToken(user: RetroUser): string {
  return jwt.sign({ id: user.id, userId: user.userId, role: user.role }, JWT_SECRET, { expiresIn: '2h' });
}

/** Seed an authenticated session into a browser context before any page loads. */
export async function authenticate(context: BrowserContext, user: RetroUser, baseURL: string): Promise<void> {
  const token = mintToken(user);
  await context.addInitScript(
    ([t, u]) => {
      localStorage.setItem('token', t as string);
      localStorage.setItem('user', u as string);
    },
    [token, JSON.stringify({
      id: user.id, userId: user.userId, firstName: user.firstName,
      lastName: user.lastName, role: user.role, roleName: user.roleName,
    })] as const,
  );
  // Touch the origin so localStorage is bound to it before the app boots.
  await context.addCookies([]);
  void baseURL;
}

export async function api(
  user: RetroUser, method: string, endpoint: string, body?: unknown,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BACKEND_URL}/api${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mintToken(user)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

/** Create a board via the API and open it to the team, returning board + token. */
export async function createActiveBoard(
  lead: RetroUser, projectId: number, title: string,
): Promise<{ id: number; shareToken: string }> {
  const created = await api(lead, 'POST', '/retro/boards', {
    projectId, title: `${RETRO_TITLE_PREFIX} ${title}`,
    meetingDate: new Date().toISOString().slice(0, 10),
    meetingTime: '10:00', laneTemplate: 'WENT_WELL',
  });
  if (created.status !== 201) throw new Error(`createBoard failed: ${JSON.stringify(created.data)}`);
  const board = created.data.data;
  await api(lead, 'POST', `/retro/boards/${board.id}/status`, { status: 'ACTIVE' });
  return { id: board.id, shareToken: board.shareToken };
}

export async function cleanupRetroData(): Promise<void> {
  await withDb(async db => {
    await db.query(
      `DELETE FROM project_action_items WHERE id IN (
         SELECT converted_ref_id FROM retro_items
         WHERE converted_type = 'ACTION_ITEM' AND board_id IN (
           SELECT id FROM retro_boards WHERE title LIKE $1))`,
      [`${RETRO_TITLE_PREFIX}%`],
    );
    await db.query(`DELETE FROM retro_boards WHERE title LIKE $1`, [`${RETRO_TITLE_PREFIX}%`]);
  });
}

export async function gotoBoard(page: Page, shareToken: string): Promise<void> {
  await page.goto(`/retro/b/${shareToken}`);
}

/**
 * Temporarily grant a user access to an extra project, then restore.
 *
 * Multi-project rendering cannot be verified against seed data where most users
 * hold a single project, and skipping the test would leave the feature
 * unverified. Provisioning it here — the same approach the risk-rbac suite takes
 * for extra users — keeps the coverage real. Restores in a finally block so a
 * failing assertion cannot leak a permission grant into the database.
 */
export async function withExtraProjectAccess<T>(
  userId: number,
  extraProjectId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const original = await withDb(async db => (await db.query(
    `SELECT id, project_ids FROM user_permissions
     WHERE user_id = $1 AND project_ids IS NOT NULL AND array_length(project_ids, 1) > 0
     ORDER BY id LIMIT 1`, [userId],
  )).rows[0]);

  if (!original) throw new Error(`user ${userId} has no project-scoped permission row to extend`);

  const already = (original.project_ids as number[]).includes(extraProjectId);
  if (!already) {
    await withDb(db => db.query(
      `UPDATE user_permissions SET project_ids = array_append(project_ids, $1) WHERE id = $2`,
      [extraProjectId, original.id],
    ));
  }

  try {
    return await fn();
  } finally {
    if (!already) {
      await withDb(db => db.query(
        `UPDATE user_permissions SET project_ids = $1 WHERE id = $2`,
        [original.project_ids, original.id],
      ));
    }
  }
}

/**
 * A lead who is NOT the given user.
 *
 * Deliberately restricted to roleName 'lead': isFacilitator treats manager,
 * admin and superuser as facilitators of every board, so any of those would
 * quietly pass the very check the caller is trying to prove fails.
 */
export async function findOtherLead(excludingUserId: number): Promise<RetroUser | null> {
  return withDb(async db => {
    const { rows } = await db.query(`
      SELECT u.id, u.user_id, u.first_name, u.last_name, u.role, r.name AS role_name
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      JOIN user_permissions up ON up.user_id = u.id
      WHERE r.name = 'lead' AND u.id <> $1
        AND up.project_ids IS NOT NULL AND array_length(up.project_ids, 1) > 0
      ORDER BY u.id LIMIT 1
    `, [excludingUserId]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id, userId: r.user_id, firstName: r.first_name, lastName: r.last_name,
      roleName: r.role_name, role: r.role === 'SUPERUSER' ? 'SUPERUSER' : 'USER',
    };
  });
}

/** Any project in the same account that the given project is not. */
export async function findSecondProject(excludingProjectId: number): Promise<number | null> {
  return withDb(async db => (await db.query(
    `SELECT p2.id FROM projects p1
     JOIN projects p2 ON p2.account_id = p1.account_id AND p2.id <> p1.id
     WHERE p1.id = $1 ORDER BY p2.id LIMIT 1`, [excludingProjectId],
  )).rows[0]?.id ?? null);
}
