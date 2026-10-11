/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op, Order, WhereOptions } from 'sequelize';
import { AccountActionItem } from '../../../models/AccountActionItem';
import { ActionItemStatusHistory } from '../../../models/ActionItemStatusHistory';
import { ActionItemComment } from '../../../models/ActionItemComment';
import { updateActionItemComment, type CommentUpdateResult } from './actionItemComments';
import { User } from '../../../models/User';

export interface ResponseItems {
  count: number;
  rows: AccountActionItem[];
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Open: ['In-Progress', 'Closed', 'Discarded'],
  'In-Progress': ['Closed', 'Discarded'],
  Closed: [],
  Discarded: [],
};

const ACTION_ITEM_STATUSES = ['Open', 'In-Progress', 'Closed', 'Discarded'];
const ACTION_ITEM_CATEGORIES = ['Task', 'Follow-up', 'Decision Required', 'Issue', 'Risk & Mitigation', 'Dependency'];

class AccountActionItemService {
  async listByAccount(accountId: number, statusFilter?: string): Promise<any[]> {
    const where: WhereOptions = { accountId };
    if (statusFilter === 'open') {
      where.status = { [Op.in]: ['Open', 'In-Progress'] };
    } else if (statusFilter && ACTION_ITEM_STATUSES.includes(statusFilter)) {
      where.status = statusFilter;
    }

    const items = await AccountActionItem.findAll({
      where,
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'DESC']],
    });
    return items.map(i => i.toJSON());
  }

  /**
   * Aggregate list across many accounts in a single query. Used by the
   * "my items" endpoint that replaces the frontend's per-account fan-out.
   */
  async listMine(
    accountIds: number | number[],
    page: number,
    limit: number,
    searchFilter?: string,
    statusFilter?: string[],
    sortBy?: string,
    sortOrder?: string,
    categoryFilter?: string[]
  ): Promise<ResponseItems | object> {
    const offset: number = (page - 1) * limit;
    const accountIdsArray = Array.isArray(accountIds) ? accountIds : [accountIds];
    const where: WhereOptions = { accountId: { [Op.in]: accountIdsArray } };

    if (statusFilter && statusFilter.length > 0) {
      const status = statusFilter.filter(p => ACTION_ITEM_STATUSES.includes(p));
      where.status = {
        [Op.in]: status,
      };
    }

    if (searchFilter && searchFilter.trim() !== '') {
      where.title = {
        [Op.iLike]: `%${searchFilter.trim()}%`,
      };
    }
    if (categoryFilter && categoryFilter.length > 0) {
      const category = categoryFilter.filter(p => ACTION_ITEM_CATEGORIES.includes(p));
      where.category = {
        [Op.in]: category,
      };
    }
    const order: Order = [[sortBy || 'createdAt', sortOrder || 'DESC']];
    const items = await AccountActionItem.findAndCountAll({
      where,
      offset: offset,
      limit: limit,
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] }],
      order,
    });
    const response = {
      count: items.count,
      rows: items.rows.map(i => i.toJSON()),
    };
    return response;
  }

  async createItem(accountId: number, data: any, userId?: number): Promise<any> {
    const item = await AccountActionItem.create({
      accountId,
      title: data.title,
      category: data.category,
      owner: data.owner,
      status: 'Open',
      dueDate: data.dueDate ?? null,
      createdById: userId ?? null,
    });

    await ActionItemStatusHistory.create({
      actionItemId: null,
      accountActionItemId: item.id,
      fromStatus: null,
      toStatus: 'Open',
      note: data.note ?? null,
      changedById: userId ?? null,
      changedAt: new Date(),
    });

    return this.getItem(item.id);
  }

  async getItem(id: number): Promise<any | null> {
    const item = await AccountActionItem.findByPk(id, {
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] }],
    });
    if (!item) return null;

    const history = await ActionItemStatusHistory.findAll({
      where: { accountActionItemId: id },
      include: [{ model: User, as: 'changedBy', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['changedAt', 'ASC']],
    });

    const comments = await ActionItemComment.findAll({
      where: { accountActionItemId: id },
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'ASC']],
    });

    return {
      ...item.toJSON(),
      statusHistory: history.map(h => h.toJSON()),
      comments: comments.map(c => c.toJSON()),
    };
  }

  async updateItem(id: number, data: any): Promise<any | null> {
    const item = await AccountActionItem.findByPk(id);
    if (!item) return null;

    if (item.status === 'Closed' || item.status === 'Discarded') {
      throw new Error('Cannot edit a closed or discarded action item');
    }

    await item.update({
      title: data.title ?? item.title,
      category: data.category ?? item.category,
      owner: data.owner ?? item.owner,
      dueDate: data.dueDate !== undefined ? data.dueDate : item.dueDate,
    });

    return this.getItem(id);
  }

  async transitionStatus(id: number, toStatus: string, note?: string, userId?: number): Promise<any | null> {
    const item = await AccountActionItem.findByPk(id);
    if (!item) return null;

    const allowed = ALLOWED_TRANSITIONS[item.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new Error(`Transition from '${item.status}' to '${toStatus}' is not allowed`);
    }

    if ((toStatus === 'Closed' || toStatus === 'Discarded') && !note?.trim()) {
      throw new Error(`A comment is required when ${toStatus === 'Closed' ? 'closing' : 'discarding'} an action item`);
    }

    const fromStatus = item.status;
    await item.update({ status: toStatus });

    await ActionItemStatusHistory.create({
      actionItemId: null,
      accountActionItemId: id,
      fromStatus,
      toStatus,
      note: note ?? null,
      changedById: userId ?? null,
      changedAt: new Date(),
    });

    return this.getItem(id);
  }

  async addComment(itemId: number, userId: number, content: string): Promise<any> {
    const comment = await ActionItemComment.create({
      actionItemId: null,
      accountActionItemId: itemId,
      userId,
      content,
    });
    const full = await ActionItemComment.findByPk(comment.id, {
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
    });
    return full!.toJSON();
  }

  async deleteComment(commentId: number, requestingUserId: number, isSuperuser: boolean): Promise<boolean> {
    const comment = await ActionItemComment.findByPk(commentId);
    if (!comment) return false;
    if (!isSuperuser && comment.userId !== requestingUserId) return false;
    await comment.destroy();
    return true;
  }

  // Author-only, latest-comment-only edit. See updateActionItemComment.
  async updateComment(commentId: number, requestingUserId: number, content: string): Promise<CommentUpdateResult> {
    return updateActionItemComment(commentId, requestingUserId, content);
  }

  async deleteItem(id: number): Promise<boolean> {
    const item = await AccountActionItem.findByPk(id);
    if (!item) return false;
    await item.destroy();
    return true;
  }
}

export const accountActionItemService = new AccountActionItemService();
