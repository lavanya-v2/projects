import { Request, Response } from 'express';
import { programActionItemService } from '../services/programActionItemService';
import { respondToCommentUpdate } from '../services/actionItemComments';
import { ProgramActionItem } from '../../../models/ProgramActionItem';
import { Program } from '../../../models/Program';
import { UserPermission } from '../../../models/UserPermission';
import { ResponseItems } from '../services/programActionItemService';
import { User } from '../../../models/User';

interface AuthUser {
  roleName?: string;
}

interface AuthRequest extends Request {
  user?: User & AuthUser;
}

/**
 * Check if user can access the program that owns this action item. Returns programId or null.
 * Mirrors the PROGRAM branch of checkPermission: superuser/admin bypass; otherwise the user
 * must hold a UserPermission row scoped to the item's program (program owner).
 */
async function verifyProgramActionItemAccess(actionItemId: number, req: AuthRequest): Promise<number | null> {
  const user = req.user;
  if (!user) return null;
  const legacyRole: string = user?.role ?? '';
  const roleName: string = user?.roleName ?? '';
  if (legacyRole === 'SUPERUSER' || roleName === 'admin' || roleName === 'superuser') return -1; // bypass

  const item = await ProgramActionItem.findByPk(actionItemId);
  if (!item) return null;

  const program = await Program.findByPk(item.programId);
  if (!program) return null;

  const permissions = await UserPermission.findAll({ where: { userId: user.id } });
  for (const p of permissions) {
    if (p.programId === item.programId && p.accountId === program.accountId) {
      return item.programId;
    }
  }
  return null;
}

class ProgramActionItemController {
  /**
   * Aggregate list of all program action items the user can access, in one
   * request. Replaces the frontend's per-program fan-out.
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
      const isSuperuserOrAdmin = legacyRole === 'SUPERUSER' || roleName === 'admin' || roleName === 'superuser';
      const categoryFilter = req.query.categoryFilter as string | string[] | undefined;

      let programId = req.query.programId as number | 'all';
      if (programId === undefined) programId = 'all';

      const page = Number(req.query.pageNumber) || 1;
      const limit = Number(req.query.pageLimit) || 10;

      const parsedCategory = (filter?: string | string[]) => {
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

      const category = parsedCategory(categoryFilter);
      const status = parsedCategory(statusFilter);

      let items: ResponseItems | object = {};

      if (isSuperuserOrAdmin) {
        items = await programActionItemService.listMine(
          programId,
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
        if (programId === 'all') {
          const perms = await UserPermission.findAll({ where: { userId: user.id, accountId: accountId } });
          const programIds = Array.from(
            new Set(perms.filter(p => p.programId != null).map(p => p.programId as number))
          );
          items = await programActionItemService.listMine(
            programIds,
            page,
            limit,
            status,
            searchFilter,
            sortBy,
            sortOrder,
            category
          );
        } else {
          items = await programActionItemService.listMine(
            programId,
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
      res.status(500).json({ error: 'Failed to fetch program action items' });
    }
  }

  async listByProgram(req: Request, res: Response) {
    try {
      const programId = parseInt(req.params.programId as string);
      const statusFilter = req.query.status as string | undefined;
      const items = await programActionItemService.listByProgram(programId, statusFilter);
      res.json(items);
    } catch (err) {
      console.error('listByProgram error:', err);
      res.status(500).json({ error: 'Failed to fetch program action items' });
    }
  }

  async createItem(req: AuthRequest, res: Response) {
    try {
      const programId = parseInt(req.params.programId as string);
      const userId = req.user?.id;
      const item = await programActionItemService.createItem(programId, req.body, userId);
      res.status(201).json(item);
    } catch (err) {
      console.error('createItem error:', err);
      res.status(500).json({ error: 'Failed to create program action item' });
    }
  }

  async getItem(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const access = await verifyProgramActionItemAccess(id, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });
      const item = await programActionItemService.getItem(id);
      if (!item) return res.status(404).json({ error: 'Program action item not found' });
      res.json(item);
    } catch (err) {
      console.error('getItem error:', err);
      res.status(500).json({ error: 'Failed to fetch program action item' });
    }
  }

  async updateItem(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const access = await verifyProgramActionItemAccess(id, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });

      // Block edit on terminal statuses
      const existing = await ProgramActionItem.findByPk(id);
      if (!existing) return res.status(404).json({ error: 'Program action item not found' });
      if (existing.status === 'Closed' || existing.status === 'Discarded') {
        return res.status(400).json({ error: 'Cannot edit a closed or discarded action item' });
      }

      const item = await programActionItemService.updateItem(id, req.body);
      if (!item) return res.status(404).json({ error: 'Program action item not found' });
      res.json(item);
    } catch (err) {
      console.error('updateItem error:', err);
      res.status(500).json({ error: 'Failed to update program action item' });
    }
  }

  async transitionStatus(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const access = await verifyProgramActionItemAccess(id, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });

      const { toStatus, note } = req.body;
      if (!toStatus) return res.status(400).json({ error: 'toStatus is required' });

      if ((toStatus === 'Closed' || toStatus === 'Discarded') && !note?.trim()) {
        return res.status(400).json({
          error: `A comment is required when ${toStatus === 'Closed' ? 'closing' : 'discarding'} an action item`,
        });
      }

      const userId = req.user?.id;
      const item = await programActionItemService.transitionStatus(id, toStatus, note, userId);
      if (!item) return res.status(404).json({ error: 'Program action item not found' });
      res.json(item);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.message?.includes('not allowed') || err.message?.includes('required when')) {
        return res.status(400).json({ error: err.message });
      }
      console.error('transitionStatus error:', err);
      res.status(500).json({ error: 'Failed to transition status' });
    }
  }

  async deleteItem(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const access = await verifyProgramActionItemAccess(id, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });

      const user = req.user;
      const legacyRole: string = user?.role ?? '';
      const roleName: string = user?.roleName ?? '';
      const isPrivileged = legacyRole === 'SUPERUSER' || roleName === 'superuser' || roleName === 'admin';

      const existing = await ProgramActionItem.findByPk(id);
      if (!existing) return res.status(404).json({ error: 'Program action item not found' });

      // Deletion is restricted to the creator, superusers, and admins
      if (!isPrivileged && existing.createdById !== user?.id) {
        return res
          .status(403)
          .json({ error: 'Only the creator, an admin, or a superuser can delete this action item' });
      }

      const deleted = await programActionItemService.deleteItem(id);
      if (!deleted) return res.status(404).json({ error: 'Program action item not found' });
      res.json({ success: true });
    } catch (err) {
      console.error('deleteItem error:', err);
      res.status(500).json({ error: 'Failed to delete program action item' });
    }
  }

  async addComment(req: AuthRequest, res: Response) {
    try {
      const itemId = parseInt(req.params.id as string);
      const access = await verifyProgramActionItemAccess(itemId, req);
      if (access === null) return res.status(403).json({ error: 'Access denied' });
      const existing = await ProgramActionItem.findByPk(itemId);
      if (existing && (existing.status === 'Closed' || existing.status === 'Discarded')) {
        return res.status(400).json({ error: 'Cannot add comments to a closed or discarded action item' });
      }
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
      const comment = await programActionItemService.addComment(itemId, userId, content.trim());
      res.status(201).json(comment);
    } catch (err) {
      console.error('addComment error:', err);
      res.status(500).json({ error: 'Failed to add comment' });
    }
  }

  async deleteComment(req: AuthRequest, res: Response) {
    try {
      const commentId = parseInt(req.params.commentId as string);
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      const legacyRole: string = user?.role ?? '';
      const roleName: string = user?.roleName ?? '';
      const isPrivileged = legacyRole === 'SUPERUSER' || roleName === 'superuser' || roleName === 'admin';
      const deleted = await programActionItemService.deleteComment(commentId, user.id, isPrivileged);
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
      const result = await programActionItemService.updateComment(commentId, userId, content.trim());
      return respondToCommentUpdate(res, result);
    } catch (err) {
      console.error('updateComment error:', err);
      res.status(500).json({ error: 'Failed to update comment' });
    }
  }
}

export const programActionItemController = new ProgramActionItemController();
