/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op, Order, WhereOptions } from 'sequelize';
import { ProgramActionItem } from '../../../models/ProgramActionItem';
import { ActionItemStatusHistory } from '../../../models/ActionItemStatusHistory';
import { ActionItemComment } from '../../../models/ActionItemComment';
import { updateActionItemComment, type CommentUpdateResult } from './actionItemComments';
import { User } from '../../../models/User';
import { ALLOWED_TRANSITIONS, ACTION_ITEM_STATUSES, ACTION_ITEM_CATEGORIES } from './actionItemService';
import { Program } from '../../../models/Program';

export interface ResponseItems {
  count: number;
  rows: ProgramActionItem[];
}

class ProgramActionItemService {
  async listByProgram(programId: number, statusFilter?: string): Promise<any[]> {
    const where: WhereOptions = { programId };
    if (statusFilter === 'open') {
      where.status = { [Op.in]: ['Open', 'In-Progress'] };
    } else if (statusFilter && ACTION_ITEM_STATUSES.includes(statusFilter)) {
      where.status = statusFilter;
    }

    const items = await ProgramActionItem.findAll({
      where,
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'DESC']],
    });
    return items.map(i => i.toJSON());
  }

  /**
   * Aggregate list across many programs in a single query. Used by the
   * "my items" endpoint that replaces the frontend's per-program fan-out.
   */
  async listMine(
    programIds: number | number[] | 'all',
    page: number,
    limit: number,
    statusFilter?: string[],
    searchFilter?: string,
    sortBy?: string,
    sortOrder?: string,
    categoryFilter?: string[],
    accountId?: number
  ): Promise<ResponseItems | object> {
    const offset: number = (page - 1) * limit;
    const where: WhereOptions = {};
    if (programIds === 'all' && accountId !== 0) {
      const getPrograms = await Program.findAll({ where: { accountId: accountId }, attributes: ['id'] });
      const programsIdsList = getPrograms.map(p => p.id);
      where.programId = { [Op.in]: programsIdsList };
    } else {
      const programIdArray = Array.isArray(programIds) ? programIds : [programIds];
      where.programId = { [Op.in]: programIdArray };
    }

    if (statusFilter && statusFilter?.length > 0) {
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
    const items = await ProgramActionItem.findAndCountAll({
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

  async createItem(programId: number, data: any, userId?: number): Promise<any> {
    const item = await ProgramActionItem.create({
      programId,
      title: data.title,
      category: data.category,
      owner: data.owner,
      status: 'Open',
      dueDate: data.dueDate ?? null,
      createdById: userId ?? null,
    });

    await ActionItemStatusHistory.create({
      programActionItemId: item.id,
      fromStatus: null,
      toStatus: 'Open',
      note: data.note ?? null,
      changedById: userId ?? null,
      changedAt: new Date(),
    });

    return this.getItem(item.id);
  }

  async getItem(id: number): Promise<any | null> {
    const item = await ProgramActionItem.findByPk(id, {
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] }],
    });
    if (!item) return null;

    const history = await ActionItemStatusHistory.findAll({
      where: { programActionItemId: id },
      include: [{ model: User, as: 'changedBy', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['changedAt', 'ASC']],
    });

    const comments = await ActionItemComment.findAll({
      where: { programActionItemId: id },
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
    const item = await ProgramActionItem.findByPk(id);
    if (!item) return null;

    await item.update({
      title: data.title ?? item.title,
      category: data.category ?? item.category,
      owner: data.owner ?? item.owner,
      dueDate: data.dueDate !== undefined ? data.dueDate : item.dueDate,
    });

    return this.getItem(id);
  }

  async transitionStatus(id: number, toStatus: string, note: string | undefined, userId?: number): Promise<any | null> {
    const item = await ProgramActionItem.findByPk(id);
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
      programActionItemId: id,
      fromStatus,
      toStatus,
      note: note ?? null,
      changedById: userId ?? null,
      changedAt: new Date(),
    });

    return this.getItem(id);
  }

  async deleteItem(id: number): Promise<boolean> {
    const item = await ProgramActionItem.findByPk(id);
    if (!item) return false;
    await item.destroy();
    return true;
  }

  async addComment(itemId: number, userId: number, content: string): Promise<any> {
    const comment = await ActionItemComment.create({
      programActionItemId: itemId,
      userId,
      content,
    });
    const full = await ActionItemComment.findByPk(comment.id, {
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
    });
    return full!.toJSON();
  }

  async deleteComment(commentId: number, requestingUserId: number, isPrivileged: boolean): Promise<boolean> {
    const comment = await ActionItemComment.findByPk(commentId);
    if (!comment) return false;
    if (!isPrivileged && comment.userId !== requestingUserId) return false;
    await comment.destroy();
    return true;
  }

  // Author-only, latest-comment-only edit. See updateActionItemComment.
  async updateComment(commentId: number, requestingUserId: number, content: string): Promise<CommentUpdateResult> {
    return updateActionItemComment(commentId, requestingUserId, content);
  }
}

export const programActionItemService = new ProgramActionItemService();
