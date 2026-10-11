import { Request, Response } from 'express';
import { Op, WhereOptions } from 'sequelize';
import { NotificationLog } from '../../../models/NotificationLog';
import { NotificationPendingAggregate } from '../../../models/NotificationPendingAggregate';
import { NotificationRule } from '../../../models/NotificationRule';
import { Project } from '../../../models/Project';
import { Account } from '../../../models/Account';
import { getAccessibleProjectIds, getAccessibleProjectIdsInAccount } from '../../../common/projectAccess';

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    role?: string;
  };
}

async function attachProjectAccount(rows: NotificationLog[]): Promise<NotificationLog[]> {
  const projectIds = Array.from(new Set(rows.map(r => r.projectId).filter((x): x is number => !!x)));
  const accountIds = Array.from(new Set(rows.map(r => r.accountId).filter((x): x is number => !!x)));
  const [projects, accounts] = await Promise.all([
    projectIds.length
      ? Project.findAll({ where: { id: projectIds }, attributes: ['id', 'name', 'accountId'] })
      : Promise.resolve([]),
    accountIds.length
      ? Account.findAll({ where: { id: accountIds }, attributes: ['id', 'name'] })
      : Promise.resolve([]),
  ]);
  const pById = new Map(projects.map((p: Project) => [p.id, p]));
  const aById = new Map(accounts.map((a: Account) => [a.id, a]));
  // Fill account from project's accountId when log has projectId but no accountId
  return rows.map(r => {
    const json = r.toJSON();
    const proj = json.projectId ? pById.get(json.projectId) : null;
    const accId = json.accountId ?? (proj ? proj.accountId : null);
    const acc = accId ? aById.get(accId) : null;
    json.projectName = proj ? proj.name : null;
    json.accountName = acc ? acc.name : null;
    return json;
  });
}

/**
 * Returns the most recent N logs (default cap 100) matching filters.
 * The UI is expected to paginate client-side within this pool.
 */
export async function listLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
  const cap = Math.min(parseInt((req.query.cap as string) || '100'), 500);
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'User not authenticated' });
    return;
  }
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const where: WhereOptions = {};
  if (req.query.eventCode) where.eventCode = req.query.eventCode;
  if (req.query.status) where.status = req.query.status;
  if (req.query.projectId) where.projectId = parseInt(req.query.projectId as string);
  if (req.query.fromDate || req.query.toDate) {
    where.createdAt = {};
    if (req.query.fromDate) where.createdAt[Op.gte] = new Date(req.query.fromDate as string);
    if (req.query.toDate) where.createdAt[Op.lte] = new Date(req.query.toDate as string);
  }
  const offset: number = (page - 1) * limit;
  if (offset >= cap) {
    res.json({ data: [], count: 0 });
    return;
  }
  if (user.role === 'SUPERUSER') {
    if (req.query.accountId) where.accountId = parseInt(req.query.accountId as string);
    const { count, rows } = await NotificationLog.findAndCountAll({
      where,
      offset: offset,
      limit: limit,
      order: [['createdAt', 'DESC']],
    });
    const finalCount = Math.min(count, cap);
    const items = await attachProjectAccount(rows);
    res.json({ success: true, data: items, count: finalCount });
    return;
  }
  if (!req.query.projectId) {
    let permissions: Set<number> | number[];
    if (typeof req.query.accountId === 'string') {
      const accId = parseInt(req.query.accountId);
      permissions = await getAccessibleProjectIdsInAccount(user.id, accId);
    } else {
      permissions = await getAccessibleProjectIds(user.id);
    }
    const accessibleProjectIds = [...permissions];
    where.projectId = Array.from(accessibleProjectIds);
  }
  const { count, rows } = await NotificationLog.findAndCountAll({
    where,
    offset: offset,
    limit: limit,
    order: [['createdAt', 'DESC']],
  });
  const finalCount = Math.min(count, cap);
  const items = await attachProjectAccount(rows);
  res.json({ success: true, data: items, count: finalCount });
  return;
}

export async function getLog(req: Request, res: Response): Promise<void> {
  const id = parseInt(req.params.id as string);
  const log = await NotificationLog.findByPk(id);
  if (!log) {
    res.status(404).json({ error: 'Log not found' });
    return;
  }
  const [enriched] = await attachProjectAccount([log]);
  res.json(enriched);
}

/**
 * Returns currently pending (coalescing) aggregates — i.e. scheduled but not yet flushed.
 */
export async function listPending(_req: AuthenticatedRequest, res: Response): Promise<void> {
  const user = _req.user;
  if (!user) {
    res.status(401).json({ error: 'User not authenticated' });
    return;
  }
  const where: WhereOptions = {};
  if (user.role === 'SUPERUSER') {
    const rows = await NotificationPendingAggregate.findAll({
      where: { status: 'PENDING' },
      order: [['flushAt', 'ASC']],
      include: [{ model: NotificationRule }],
      limit: 100,
    });

    const items = rows.map(r => ({
      id: r.id,
      ruleId: r.ruleId,
      eventCode: r.rule?.eventCode ?? null,
      coalesceKey: r.coalesceKey,
      flushAt: r.flushAt,
      createdAt: r.createdAt,
      eventCount: Array.isArray(r.events) ? r.events.length : 0,
      jobId: r.jobId,
    }));

    res.json({ items });
    return;
  }
  const permissions = await getAccessibleProjectIds(user.id);
  const formattedKeys = Array.from(permissions).map(id => `projectId=${id}`);

  where.coalesce_key = {
    [Op.in]: formattedKeys,
  };

  const rows = await NotificationPendingAggregate.findAll({
    where: { ...where, status: 'PENDING' },
    order: [['flushAt', 'ASC']],
    include: [{ model: NotificationRule }],
    limit: 100,
  });

  const items = rows.map(r => ({
    id: r.id,
    ruleId: r.ruleId,
    eventCode: r.rule?.eventCode ?? null,
    coalesceKey: r.coalesceKey,
    flushAt: r.flushAt,
    createdAt: r.createdAt,
    eventCount: Array.isArray(r.events) ? r.events.length : 0,
    jobId: r.jobId,
  }));

  res.json({ items });
  return;
}
