import { Request, Response } from 'express';
import { actionItemService } from '../services/actionItemService';
import { respondToCommentUpdate } from '../services/actionItemComments';
import { ProjectActionItem } from '../../../models/ProjectActionItem';
import { Project } from '../../../models/Project';
import { UserPermission } from '../../../models/UserPermission';
import { ResponseItems } from '../services/actionItemService';
import { User } from '../../../models/User';
import { getAccessibleProjectIdsInAccount } from '../../../common/projectAccess';

interface AuthUser {
  roleName?: string;
}

interface AuthRequest extends Request {
  user?: User & AuthUser;
}

/** Check if user has access to the project that owns this action item. Returns projectId or null. */
async function verifyActionItemAccess(actionItemId: number, req: AuthRequest): Promise<number | null> {
  const user = req.user;
  if (!user) return null;
  const legacyRole: string = user?.role ?? '';
  const roleName: string = user?.roleName ?? '';
  if (legacyRole === 'SUPERUSER' || roleName === 'admin' || roleName === 'superuser') return -1; // bypass

  const item = await ProjectActionItem.findByPk(actionItemId);
  if (!item) return null;

  const permissions = await UserPermission.findAll({ where: { userId: user.id } });
  let projForCheck: Project | null = null;
  const lazyProj = async () => projForCheck ?? (projForCheck = await Project.findByPk(item.projectId));

  for (const p of permissions) {
    // Program-scoped row: grants access only to projects belonging to that program.
    if (p.programId) {
      const proj = await lazyProj();
      if (proj && proj.programId === p.programId) return item.projectId;
      continue;
    }
    if (p.projectIds && p.projectIds.length > 0 && p.projectIds.includes(item.projectId)) return item.projectId;
    if (!p.projectIds || p.projectIds.length === 0) {
      const proj = await lazyProj();
      if (proj && proj.accountId === p.accountId) return item.projectId;
    }
  }
  return null;
}

class ActionItemController {
  async listByProject(req: Request, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const statusFilter = req.query.status as string | undefined;
      const items = await actionItemService.listByProject(projectId, statusFilter);
      res.json(items);
    } catch (err) {
      console.error('listByProject error:', err);
      res.status(500).json({ error: 'Failed to fetch action items' });
    }
  }

  /**
   * Aggregate list of all project action items the user can access, in one
   * request. Replaces the frontend's per-project fan-out which flooded the
   * connection pool and hung the page.
   */
  async listMine(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      const accountId = parseInt(req.query.accountId as string);
      if (!accountId) return res.status(400).json({ error: 'Account Id is required' });
      const statusFilter = req.query.statusFilter as string | string[] | undefined;
      const searchFilter = req.query.searchFilter as string | undefined;
      const sortBy = req.query.sortBy as string;
      const sortOrder = req.query.sortOrder as string;
      const legacyRole: string = user?.role ?? '';
      const roleName: string = user?.roleName ?? '';
      const isSuperuser = legacyRole === 'SUPERUSER' || roleName === 'superuser';
      const categoryFilter = req.query.categoryFilter as string | string[] | undefined;

      let projectId = req.query.projectId as number | 'all';
      if (projectId === undefined) projectId = 'all';

      const page = Number(req.query.pageNumber) || 1;
      const limit = Number(req.query.pageLimit) || 10;
      const parsedFilters = (filter?: string | string[]) => {
        if (typeof filter === 'string' && filter.trim() !== '') {
          return filter
            .split(',')
            .map(filter => filter.trim())
            .filter(Boolean);
        }
        if (Array.isArray(filter)) {
          return filter
            .flatMap(item => (typeof item === 'string' ? item.split(',') : []))
            .map(filter => filter.trim())
            .filter(Boolean);
        }
        return [];
      };

      const category = parsedFilters(categoryFilter);
      const status = parsedFilters(statusFilter);

      let items: ResponseItems | object = {};

      if (isSuperuser) {
        items = await actionItemService.listMine(
          projectId,
          page,
          limit,
          status,
          searchFilter,
          sortBy,
          sortOrder,
          category,
          accountId
        );
      } else {
        if (projectId === 'all') {
          const getUserPermissions = await getAccessibleProjectIdsInAccount(user.id, accountId);
          const projectParam = Array.from(getUserPermissions);
          items = await actionItemService.listMine(
            projectParam,
            page,
            limit,
            status,
            searchFilter,
            sortBy,
            sortOrder,
            category,
            accountId
          );
        } else {
          items = await actionItemService.listMine(
            projectId,
            page,
            limit,
            status,
            searchFilter,
            sortBy,
            sortOrder,
            category
          );
        }
      }
      const actualItems = items as ResponseItems;
      return res.json({
        success: true,
        data: actualItems.rows,
        totalItems: actualItems.count,
      });
    } catch (err) {
      console.error('listMine error:', err);
      res.status(500).json({ error: 'Failed to fetch action items' });
    }
  }

  async createItem(req: AuthRequest, res: Response) {
    try {
      const projectId = parseInt(req.params.projectId as string);
      const userId = req.user?.id;
      const item = await actionItemService.createItem(projectId, req.body, userId);
      res.status(201).json(item);
    } catch (err) {
      console.error('createItem error:', err);
      res.status(500).json({ error: 'Failed to create action item' });
    }
  }

  async getItem(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const access = await verifyActionItemAccess(id, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });
      const item = await actionItemService.getItem(id);
      if (!item) return res.status(404).json({ error: 'Action item not found' });
      res.json(item);
    } catch (err) {
      console.error('getItem error:', err);
      res.status(500).json({ error: 'Failed to fetch action item' });
    }
  }

  async updateItem(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const access = await verifyActionItemAccess(id, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });

      // Block edit on terminal statuses
      const existing = await ProjectActionItem.findByPk(id);
      if (!existing) return res.status(404).json({ error: 'Action item not found' });
      if (existing.status === 'Closed' || existing.status === 'Discarded') {
        return res.status(400).json({ error: 'Cannot edit a closed or discarded action item' });
      }

      const user = req.user;
      const roleName: string = user?.roleName ?? '';

      // Leads can only edit items they created
      if (roleName === 'lead') {
        if (existing.createdById !== user?.id) {
          return res.status(403).json({ error: 'Leads can only edit action items they created' });
        }
      }

      const item = await actionItemService.updateItem(id, req.body, user?.id);
      if (!item) return res.status(404).json({ error: 'Action item not found' });
      res.json(item);
    } catch (err) {
      console.error('updateItem error:', err);
      res.status(500).json({ error: 'Failed to update action item' });
    }
  }

  async transitionStatus(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const access = await verifyActionItemAccess(id, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });

      const { toStatus, note } = req.body;
      if (!toStatus) return res.status(400).json({ error: 'toStatus is required' });

      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      const userId = user?.id;
      const roleName: string = user?.roleName ?? '';
      const legacyRole: string = user?.role ?? '';
      const isSuperuserOrAdmin = legacyRole === 'SUPERUSER' || roleName === 'admin' || roleName === 'superuser';

      // Role-based close/discard enforcement
      if (toStatus === 'Closed' || toStatus === 'Discarded') {
        if (!note?.trim()) {
          return res.status(400).json({
            error: `A comment is required when ${toStatus === 'Closed' ? 'closing' : 'discarding'} an action item`,
          });
        }
        if (!isSuperuserOrAdmin && roleName === 'lead') {
          const existing = await ProjectActionItem.findByPk(id);
          if (!existing) return res.status(404).json({ error: 'Action item not found' });
          if (existing.createdById !== userId) {
            return res.status(403).json({
              error: `Leads can only ${toStatus === 'Closed' ? 'close' : 'discard'} action items they created`,
            });
          }
        }
      }

      const item = await actionItemService.transitionStatus(id, toStatus, note, userId);
      if (!item) return res.status(404).json({ error: 'Action item not found' });
      res.json(item);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.message?.includes('not allowed') || err.message?.includes('required when closing')) {
        return res.status(400).json({ error: err.message });
      }
      console.error('transitionStatus error:', err);
      res.status(500).json({ error: 'Failed to transition status' });
    }
  }

  async deleteItem(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const access = await verifyActionItemAccess(id, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });
      const deleted = await actionItemService.deleteItem(id);
      if (!deleted) return res.status(404).json({ error: 'Action item not found' });
      res.json({ success: true });
    } catch (err) {
      console.error('deleteItem error:', err);
      res.status(500).json({ error: 'Failed to delete action item' });
    }
  }

  async addComment(req: AuthRequest, res: Response) {
    try {
      const itemId = parseInt(req.params.id as string);
      const access = await verifyActionItemAccess(itemId, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });
      const existing = await ProjectActionItem.findByPk(itemId);
      if (existing && (existing.status === 'Closed' || existing.status === 'Discarded')) {
        return res.status(400).json({ error: 'Cannot add comments to a closed or discarded action item' });
      }
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
      const comment = await actionItemService.addComment(itemId, userId, content.trim());
      res.status(201).json(comment);
    } catch (err) {
      console.error('addComment error:', err);
      res.status(500).json({ error: 'Failed to add comment' });
    }
  }

  async deleteComment(req: AuthRequest, res: Response) {
    try {
      const commentId = parseInt(req.params.commentId as string);
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const isSuperuser = req.user?.role === 'SUPERUSER';
      const deleted = await actionItemService.deleteComment(commentId, userId, isSuperuser);
      if (!deleted) return res.status(403).json({ error: 'Not found or access denied' });
      res.json({ success: true });
    } catch (err) {
      console.error('deleteComment error:', err);
      res.status(500).json({ error: 'Failed to delete comment' });
    }
  }

  async updateComment(req: AuthRequest, res: Response) {
    try {
      const commentId = parseInt(req.params.commentId as string);
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
      const result = await actionItemService.updateComment(commentId, userId, content.trim());
      return respondToCommentUpdate(res, result);
    } catch (err) {
      console.error('updateComment error:', err);
      res.status(500).json({ error: 'Failed to update comment' });
    }
  }
}

export const actionItemController = new ActionItemController();
