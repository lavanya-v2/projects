/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op, Order, WhereOptions } from 'sequelize';
import { ProjectActionItem } from '../../../models/ProjectActionItem';
import { ActionItemStatusHistory } from '../../../models/ActionItemStatusHistory';
import { ActionItemComment } from '../../../models/ActionItemComment';
import { updateActionItemComment, type CommentUpdateResult } from './actionItemComments';
import { User } from '../../../models/User';
import { Project } from '../../../models/Project';
import { emit as emitNotification } from '../../notifications/services/notificationService';
import { EVENTS } from '../../notifications/events/eventCatalog';

export interface ResponseItems {
  count: number;
  rows: ProjectActionItem[];
}

interface ProjectActionItemNotification {
  id: number;
  title: string;
  category: string;
  owner: string;
  dueDate: string | null;
  fromStatus?: string;
  toStatus?: string;
}
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Open: ['In-Progress', 'Closed', 'Discarded'],
  'In-Progress': ['Closed', 'Discarded'],
  Closed: [],
  Discarded: [],
};

export const ACTION_ITEM_CATEGORIES = [
  'Task',
  'Follow-up',
  'Decision Required',
  'Issue',
  'Risk & Mitigation',
  'Dependency',
];

export const ACTION_ITEM_STATUSES = ['Open', 'In-Progress', 'Closed', 'Discarded'];

class ActionItemService {
  async listByProject(projectId: number, statusFilter?: string): Promise<any[]> {
    const where: WhereOptions = { projectId };
    if (statusFilter === 'open') {
      where.status = { [Op.in]: ['Open', 'In-Progress'] };
    } else if (statusFilter && ACTION_ITEM_STATUSES.includes(statusFilter)) {
      where.status = statusFilter;
    }

    const items = await ProjectActionItem.findAll({
      where,
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'DESC']],
    });
    return items.map(i => i.toJSON());
  }

  /**
   * Aggregate list across many projects in a single query. Used by the
   * "my items" endpoint that replaces the frontend's per-project fan-out.
   */
  async listMine(
    projectIds: number | number[] | 'all',
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
    if (projectIds === 'all') {
      const projects = await Project.findAll({
        where: { accountId },
        attributes: ['id'],
        raw: true,
      });
      const projectIdsList = projects.map(p => p.id);
      where.projectId = { [Op.in]: projectIdsList };
    } else {
      const projectIdArray = Array.isArray(projectIds) ? projectIds : [projectIds];
      where.projectId = { [Op.in]: projectIdArray };
    }

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
    const items = await ProjectActionItem.findAndCountAll({
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

  async createItem(projectId: number, data: any, userId?: number): Promise<any> {
    const item = await ProjectActionItem.create({
      projectId,
      title: data.title,
      category: data.category,
      owner: data.owner,
      status: 'Open',
      dueDate: data.dueDate ?? null,
      createdById: userId ?? null,
    });

    // Record creation event in history
    await ActionItemStatusHistory.create({
      actionItemId: item.id,
      fromStatus: null,
      toStatus: 'Open',
      note: data.note ?? null,
      changedById: userId ?? null,
      changedAt: new Date(),
    });
    const event = 'created';
    void this.emitActionItem(item, event, userId);
    return this.getItem(item.id);
  }

  async getItem(id: number): Promise<any | null> {
    const item = await ProjectActionItem.findByPk(id, {
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] }],
    });
    if (!item) return null;

    const history = await ActionItemStatusHistory.findAll({
      where: { actionItemId: id },
      include: [{ model: User, as: 'changedBy', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['changedAt', 'ASC']],
    });

    const comments = await ActionItemComment.findAll({
      where: { actionItemId: id },
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'ASC']],
    });

    return {
      ...item.toJSON(),
      statusHistory: history.map(h => h.toJSON()),
      comments: comments.map(c => c.toJSON()),
    };
  }

  async addComment(itemId: number, userId: number, content: string): Promise<any> {
    const comment = await ActionItemComment.create({
      actionItemId: itemId,
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

  // Edit a comment. Author-only (no one else, not even superuser) and only the
  // latest comment in its thread — once a follow-up exists, earlier comments lock.
  async updateComment(commentId: number, requestingUserId: number, content: string): Promise<CommentUpdateResult> {
    return updateActionItemComment(commentId, requestingUserId, content);
  }

  async updateItem(id: number, data: Partial<ProjectActionItem>, userId?: number): Promise<any | null> {
    const item = await ProjectActionItem.findByPk(id);
    if (!item) return null;

    await item.update({
      title: data.title ?? item.title,
      category: data.category ?? item.category,
      owner: data.owner ?? item.owner,
      dueDate: data.dueDate !== undefined ? data.dueDate : item.dueDate,
    });
    const event = 'updated';
    void this.emitActionItem(item, event, userId);
    return this.getItem(id);
  }

  async transitionStatus(id: number, toStatus: string, note: string | undefined, userId?: number): Promise<any | null> {
    const item = await ProjectActionItem.findByPk(id);
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
      actionItemId: id,
      fromStatus,
      toStatus,
      note: note ?? null,
      changedById: userId ?? null,
      changedAt: new Date(),
    });
    const event = 'statusUpdated';
    void this.emitActionItem(item, event, userId, fromStatus);
    return this.getItem(id);
  }

  private async emitActionItem(
    item: ProjectActionItem,
    eventType: string,
    userId?: number,
    fromStatus?: string
  ): Promise<void> {
    try {
      const projectPromise = item.projectId ? Project.findByPk(item.projectId) : Promise.resolve(null);
      const actorPromise = userId
        ? User.findByPk(userId, { attributes: ['id', 'firstName', 'lastName'] })
        : Promise.resolve(null);
      const [project, actor] = await Promise.all([projectPromise, actorPromise]);

      const eventName =
        eventType === 'created'
          ? EVENTS.ACTION_ITEM_CREATED
          : eventType === 'updated'
            ? EVENTS.ACTION_ITEM_UPDATED
            : EVENTS.ACTION_ITEM_STATUS_UPDATED;
      let actionItems: ProjectActionItemNotification = {
        id: item.id,
        title: item.title,
        category: item.category,
        owner: item.owner,
        dueDate: item.dueDate,
      };
      if (eventType === 'statusUpdated') {
        actionItems = {
          id: item.id,
          title: item.title,
          category: item.category,
          owner: item.owner,
          dueDate: item.dueDate,
          fromStatus: fromStatus,
          toStatus: item.status,
        };
      }
      emitNotification(
        eventName,
        {
          actionItem: actionItems,
          project: project ? { id: project.id, name: project.name, accountId: project.accountId ?? null } : null,
          actor: actor ? { id: actor.id, name: `${actor.firstName} ${actor.lastName}` } : null,
        },
        { projectId: item.projectId, accountId: project?.accountId ?? null }
      );
    } catch (error) {
      // non-blocking
      console.error('failed to trigger email notification', error);
    }
  }
  async deleteItem(id: number): Promise<boolean> {
    const item = await ProjectActionItem.findByPk(id);
    if (!item) return false;
    await item.destroy();
    return true;
  }
}

export const actionItemService = new ActionItemService();
