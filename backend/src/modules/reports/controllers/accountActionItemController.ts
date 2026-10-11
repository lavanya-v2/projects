import { Request, Response } from 'express';
import { accountActionItemService } from '../services/accountActionItemService';
import { respondToCommentUpdate } from '../services/actionItemComments';
import { AccountActionItem } from '../../../models/AccountActionItem';
import { UserPermission } from '../../../models/UserPermission';
import { ResponseItems } from '../services/accountActionItemService';
import { User } from '../../../models/User';

interface AuthUser {
  roleName?: string;
}

interface AuthRequest extends Request {
  user?: User & AuthUser;
}

class AccountActionItemController {
  /**
   * Aggregate list of all account action items the user can access, in one
   * request. Replaces the frontend's per-account fan-out.
   */
  async listMine(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const accountId = parseInt(req.query.accountId as string);
      if (!accountId) return res.status(400).json({ error: 'Account Id is required' });
      const statusFilter = req.query.statusFilter as string | string[] | string[] | undefined;
      const searchFilter = req.query.searchFilter as string | undefined;
      const legacyRole: string = user?.role ?? '';
      const roleName: string = user?.roleName ?? '';
      const isSuperuserOrAdmin = legacyRole === 'SUPERUSER' || roleName === 'admin' || roleName === 'superuser';
      const sortBy = req.query.sortBy as string;
      const sortOrder = req.query.sortOrder as string;
      const categoryFilter = req.query.categoryFilter as string | string[] | undefined;

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

      if (isSuperuserOrAdmin) {
        items = await accountActionItemService.listMine(
          accountId,
          page,
          limit,
          searchFilter,
          status,
          sortBy,
          sortOrder,
          category
        );
      } else {
        const perms = await UserPermission.findAll({ where: { userId: user?.id, accountId: accountId } });
        // Require FULL account access (empty/null projectIds). A project-scoped row
        // (accountId set, programId null, projectIds populated) must NOT leak account
        // items to the member/lead it belongs to.
        const accountIds = Array.from(
          new Set(
            perms
              .filter(
                p => p.accountId != null && !p.programId && (!p.projectIds || (p.projectIds as number[]).length === 0)
              )
              .map(p => p.accountId as number)
          )
        );
        items = await accountActionItemService.listMine(
          accountIds,
          page,
          limit,
          searchFilter,
          status,
          sortBy,
          sortOrder
        );
      }
      const actualItems = items as ResponseItems;
      return res.json({
        success: true,
        data: actualItems.rows,
        totalItems: actualItems.count,
      });
    } catch (err) {
      console.error('listMine error:', err);
      res.status(500).json({ error: 'Failed to fetch account action items' });
    }
  }

  async listByAccount(req: Request, res: Response) {
    try {
      const accountId = parseInt(req.params.accountId as string);
      const statusFilter = req.query.status as string | undefined;
      const items = await accountActionItemService.listByAccount(accountId, statusFilter);
      res.json(items);
    } catch (err) {
      console.error('listByAccount error:', err);
      res.status(500).json({ error: 'Failed to fetch account action items' });
    }
  }

  async createItem(req: AuthRequest, res: Response) {
    try {
      const accountId = parseInt(req.params.accountId as string);
      const userId = req.user?.id;
      const item = await accountActionItemService.createItem(accountId, req.body, userId);
      res.status(201).json(item);
    } catch (err) {
      console.error('createItem error:', err);
      res.status(500).json({ error: 'Failed to create account action item' });
    }
  }

  async getItem(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const item = await accountActionItemService.getItem(id);
      if (!item) return res.status(404).json({ error: 'Account action item not found' });
      res.json(item);
    } catch (err) {
      console.error('getItem error:', err);
      res.status(500).json({ error: 'Failed to fetch account action item' });
    }
  }

  async updateItem(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Not authenticated' });
      const legacyRole: string = user?.role ?? '';
      const roleName: string = user?.roleName ?? '';
      const isSuperuser = legacyRole === 'SUPERUSER' || roleName === 'superuser';

      // Admin can only edit own items; superuser can edit any
      if (!isSuperuser && roleName === 'admin') {
        const existing = await AccountActionItem.findByPk(id);
        if (!existing) return res.status(404).json({ error: 'Account action item not found' });
        if (existing.createdById !== user.id) {
          return res.status(403).json({ error: 'Admins can only edit account action items they created' });
        }
      }

      const item = await accountActionItemService.updateItem(id, req.body);
      if (!item) return res.status(404).json({ error: 'Account action item not found' });
      res.json(item);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.message?.includes('Cannot edit')) {
        return res.status(400).json({ error: err.message });
      }
      console.error('updateItem error:', err);
      res.status(500).json({ error: 'Failed to update account action item' });
    }
  }

  async transitionStatus(req: AuthRequest, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      const { toStatus, note } = req.body;
      if (!toStatus) return res.status(400).json({ error: 'toStatus is required' });

      const user = req.user;
      const userId = user?.id;
      const legacyRole: string = user?.role ?? '';
      const roleName: string = user?.roleName ?? '';
      const isSuperuser = legacyRole === 'SUPERUSER' || roleName === 'superuser';

      // Admin can only close/discard own items; superuser can do any
      if ((toStatus === 'Closed' || toStatus === 'Discarded') && !isSuperuser && roleName === 'admin') {
        const existing = await AccountActionItem.findByPk(id);
        if (!existing) return res.status(404).json({ error: 'Account action item not found' });
        if (existing.createdById !== userId) {
          return res.status(403).json({ error: 'Admins can only close/discard account action items they created' });
        }
      }

      const item = await accountActionItemService.transitionStatus(id, toStatus, note, userId);
      if (!item) return res.status(404).json({ error: 'Account action item not found' });
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

  async addComment(req: AuthRequest, res: Response) {
    try {
      const itemId = parseInt(req.params.id as string);
      const existing = await AccountActionItem.findByPk(itemId);
      if (!existing) return res.status(404).json({ error: 'Account action item not found' });
      if (existing.status === 'Closed' || existing.status === 'Discarded') {
        return res.status(400).json({ error: 'Cannot add comments to a closed or discarded action item' });
      }
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Not authenticated' });
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
      const comment = await accountActionItemService.addComment(itemId, userId, content.trim());
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
      const deleted = await accountActionItemService.deleteComment(commentId, userId, isSuperuser);
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
      const result = await accountActionItemService.updateComment(commentId, userId, content.trim());
      return respondToCommentUpdate(res, result);
    } catch (err) {
      console.error('updateComment error:', err);
      res.status(500).json({ error: 'Failed to update comment' });
    }
  }

  async deleteItem(req: Request, res: Response) {
    return res.status(403).json({ error: 'Delete is not supported. Use Discard status instead.' });
  }
}

export const accountActionItemController = new AccountActionItemController();
