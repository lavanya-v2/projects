import sequelize from '../../../config/connection';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../../config';
import { recordAiUsage } from '../../ai/services/aiUsageRecorder';
import { Risk, RiskStatus, RiskPriority, RiskSource } from '../../../models/Risk';
import { Project } from '../../../models/Project';
import { RiskComment } from '../../../models/RiskComment';
import { RiskMitigationPlan } from '../../../models/RiskMitigationPlan';
import { User } from '../../../models/User';
import { UserRole } from '../../../models/UserRole';
import { Role } from '../../../models/Role';
import { Op, WhereOptions } from 'sequelize';
import {
  RiskPermissions,
  resolveRiskPermissions,
  batchResolveUserRoles,
  resolveCreatorRoleName,
  resolvePermittedProjectIds,
} from './riskPermissions';
import { emit as emitNotification } from '../../notifications/services/notificationService';
import { EVENTS } from '../../notifications/events/eventCatalog';

const CREATOR_ATTRS = ['id', 'firstName', 'lastName'];
const ASSIGNEE_ATTRS = ['id', 'firstName', 'lastName'];

// Priority sort order for board display (CRITICAL first)
const PRIORITY_ORDER: Record<RiskPriority, number> = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

interface RequestingUser {
  id: number;
  role: string;
  roleName: string | null;
}

interface RiskNotificationDetails {
  id: number;
  title: string;
  priority: string;
  description: string;
  source: string;
  fromStatus?: string;
  toStatus?: string;
}

/**
 * Derive effective role name. The legacy users.role ENUM 'SUPERUSER'
 * always wins — some superusers have a stale 'member' record in user_roles.
 */
function effectiveRoleName(user: RequestingUser): string {
  if (user.role === 'SUPERUSER') return 'superuser';
  if (user.roleName) return user.roleName;
  return 'member';
}

function throwErr(message: string, statusCode: number): never {
  throw Object.assign(new Error(message), { statusCode });
}

class RiskService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  async listBoardRisks(
    requestingUser?: RequestingUser,
    sourceFilter?: string
  ): Promise<Array<Risk & { permissions?: RiskPermissions }>> {
    const roleName = requestingUser ? effectiveRoleName(requestingUser) : 'member';

    // Members should never reach here (blocked by middleware), but guard anyway
    if (roleName === 'member') return [];

    let whereClause: WhereOptions = {};
    let permittedProjectIds: number[] = [];

    if (roleName === 'superuser') {
      // Superuser sees everything — no filter
    } else {
      permittedProjectIds = await resolvePermittedProjectIds(requestingUser!.id);

      if (roleName === 'admin') {
        // Admin: sees risks on permitted projects + unlinked (projectId IS NULL)
        whereClause = {
          [Op.or]: [{ projectId: { [Op.in]: permittedProjectIds } }, { projectId: null }],
        };
      } else {
        // Manager/Lead: only permitted projects, no unlinked
        whereClause = { projectId: { [Op.in]: permittedProjectIds } };
      }
    }

    if (sourceFilter) {
      whereClause = {
        ...whereClause,
        source: sourceFilter,
      };
    }

    const risks = await Risk.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'creator', attributes: CREATOR_ATTRS },
        { model: User, as: 'assignee', attributes: ASSIGNEE_ATTRS },
        { model: Project, attributes: ['id', 'name', 'accountId'] },
      ],
    });

    // Batch-resolve creator roles for permission calculation
    const creatorIds = [...new Set(risks.map(r => r.creatorId))];
    const creatorRoleMap = await batchResolveUserRoles(creatorIds);

    // Filter by visibility and attach permissions
    const result: Array<Risk & { permissions?: RiskPermissions }> = [];
    for (const risk of risks) {
      const creatorRoleName = creatorRoleMap.get(risk.creatorId) || 'member';
      const permissions = resolveRiskPermissions(
        { id: requestingUser!.id, roleName },
        { creatorId: risk.creatorId, creatorRoleName, projectId: risk.projectId },
        permittedProjectIds
      );
      if (!permissions.canView) continue;

      const riskJson = risk.toJSON() as Risk & { permissions?: RiskPermissions };
      riskJson.permissions = permissions;
      result.push(riskJson);
    }

    // Sort: DONE last; within groups sort by priority then createdAt DESC
    result.sort((a, b) => {
      const aDone = a.status === 'DONE' ? 1 : 0;
      const bDone = b.status === 'DONE' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;

      const pa = PRIORITY_ORDER[a.priority as RiskPriority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority as RiskPriority] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }

  async getRiskById(
    id: number,
    requestingUser?: RequestingUser
  ): Promise<(Risk & { permissions?: RiskPermissions }) | null> {
    const risk = await Risk.findByPk(id, {
      include: [
        { model: User, as: 'creator', attributes: CREATOR_ATTRS },
        { model: User, as: 'assignee', attributes: ASSIGNEE_ATTRS },
        { model: Project, attributes: ['id', 'name', 'accountId'] },
        {
          model: RiskComment,
          include: [{ model: User, as: 'user', attributes: CREATOR_ATTRS }],
          order: [['created_at', 'ASC']],
        },
        {
          model: RiskMitigationPlan,
          order: [['created_at', 'ASC']],
        },
      ],
    });

    if (!risk) throwErr('risk not found', 404);

    if (requestingUser) {
      const roleName = effectiveRoleName(requestingUser);
      const permittedProjectIds = roleName === 'superuser' ? [] : await resolvePermittedProjectIds(requestingUser.id);
      const creatorRoleName = await resolveCreatorRoleName(risk.creatorId);
      const permissions = resolveRiskPermissions(
        { id: requestingUser.id, roleName },
        { creatorId: risk.creatorId, creatorRoleName, projectId: risk.projectId },
        permittedProjectIds
      );
      if (!permissions.canView) throwErr('permission denied', 403); // hide existence
      const riskJson = risk.toJSON();
      riskJson.permissions = permissions;
      return riskJson;
    }

    return risk;
  }

  async createRisk(
    data: {
      source: RiskSource;
      notifiedDate: string;
      title: string;
      description: string;
      priority: RiskPriority;
      assigneeId?: number;
      projectId?: number;
    },
    creatorId: number,
    requestingUser?: RequestingUser
  ): Promise<Risk> {
    const roleName = requestingUser ? effectiveRoleName(requestingUser) : 'member';

    // Manager/lead must link to a project
    if ((roleName === 'manager' || roleName === 'lead') && !data.projectId) {
      throwErr('A project must be selected when creating a risk', 400);
    }

    // Non-superuser: verify project is in permitted projects
    if (data.projectId && roleName !== 'superuser') {
      const permittedProjectIds = await resolvePermittedProjectIds(requestingUser!.id);
      if (!permittedProjectIds.includes(data.projectId)) {
        throwErr('You do not have access to the selected project', 403);
      }
    }

    if (data.assigneeId) {
      await this.validateAssigneeIsSuperuser(data.assigneeId);
    }

    const risk = await Risk.create({
      ...data,
      creatorId,
      status: 'NEW',
    });
    const event = 'created';
    this.generateAndPersistSummary(risk.id);
    void this.emitRisk(risk, event, creatorId);
    return risk;
  }
  async updateRisk(
    id: number,
    data: Partial<{
      source: RiskSource;
      notifiedDate: string;
      title: string;
      description: string;
      priority: RiskPriority;
      assigneeId: number | null;
      projectId: number | null;
    }>,
    requestingUser?: RequestingUser
  ): Promise<Risk> {
    const risk = await Risk.findByPk(id);
    if (!risk) throwErr('Risk not found', 404);

    if (requestingUser) {
      const permissions = await this.getPermissionsForRisk(risk, requestingUser);
      if (!permissions.canEdit) throwErr('You do not have permission to edit this risk', 403);
    }

    if (data.assigneeId) {
      await this.validateAssigneeIsSuperuser(data.assigneeId);
    }
    const event = 'updated';
    await risk.update(data);
    void this.emitRisk(risk, event, requestingUser?.id);
    return risk;
  }

  async transitionStatus(
    id: number,
    newStatus: RiskStatus,
    comment: string,
    requestingUser: RequestingUser
  ): Promise<void> {
    if (!comment || comment.trim().length === 0) {
      throwErr('A comment is required to move a risk to a new status', 400);
    }
    if (newStatus === 'DONE') {
      throwErr('Use the /done endpoint to close a risk', 400);
    }

    const risk = await Risk.findByPk(id);
    if (!risk) throwErr('Risk not found', 404);
    const fromStatus = risk.status;

    const permissions = await this.getPermissionsForRisk(risk, requestingUser);
    if (!permissions.canTransition) throwErr('You do not have permission to move this risk', 403);

    await sequelize.transaction(async t => {
      await risk.update({ status: newStatus }, { transaction: t });
      await RiskComment.create({ riskId: id, userId: requestingUser.id, comment: comment.trim() }, { transaction: t });
    });
    const event = 'statusUpdated';
    void this.emitRisk(risk, event, requestingUser.id, fromStatus);
  }

  async markDone(id: number, requestingUser: RequestingUser, resolution: string): Promise<void> {
    if (!resolution || resolution.trim().length === 0) {
      throwErr('A resolution is required to close a risk', 400);
    }

    const risk = await Risk.findByPk(id);
    if (!risk) throwErr('Risk not found', 404);

    const permissions = await this.getPermissionsForRisk(risk, requestingUser);
    if (!permissions.canMarkDone) throwErr('You do not have permission to close this risk', 403);
    const fromStatus = risk.status;
    await sequelize.transaction(async t => {
      await risk.update({ status: 'DONE', resolution: resolution.trim() }, { transaction: t });
      await RiskComment.create(
        {
          riskId: id,
          userId: requestingUser.id,
          comment: `Closed -- ${resolution.trim()}`,
        },
        { transaction: t }
      );
    });
    const event = 'statusUpdated';
    void this.emitRisk(risk, event, requestingUser?.id, fromStatus);
    this.generateAndPersistSummary(id);
  }
  private async emitRisk(risk: Risk, eventType: string, creatorId?: number, fromStatus?: string): Promise<void> {
    try {
      const projectPromise = risk.projectId ? Project.findByPk(risk.projectId) : Promise.resolve(null);
      const actorPromise = creatorId
        ? User.findByPk(creatorId, { attributes: ['id', 'firstName', 'lastName'] })
        : Promise.resolve(null);
      const [project, actor] = await Promise.all([projectPromise, actorPromise]);

      const eventName =
        eventType === 'created'
          ? EVENTS.RISK_CREATED
          : eventType === 'updated'
            ? EVENTS.RISK_UPDATED
            : EVENTS.RISK_STATUS_UPDATED;
      let riskDetails: RiskNotificationDetails = {
        id: risk.id,
        title: risk.title,
        priority: risk.priority,
        description: risk.description,
        source: risk.source,
      };
      if (eventType === 'statusUpdated') {
        riskDetails = {
          id: risk.id,
          title: risk.title,
          priority: risk.priority,
          description: risk.description,
          source: risk.source,
          fromStatus: fromStatus,
          toStatus: risk.status,
        };
      }
      emitNotification(
        eventName,
        {
          risk: riskDetails,
          project: project ? { id: project.id, name: project.name, accountId: project.accountId ?? null } : null,
          actor: actor ? { id: actor.id, name: `${actor.firstName} ${actor.lastName}` } : null,
        },
        { projectId: risk.projectId ?? null, accountId: project?.accountId ?? null }
      );
    } catch (error) {
      // non-blocking
      console.error('failed to trigger email notification', error);
    }
  }

  async deleteRisk(id: number, requestingUser?: RequestingUser): Promise<void> {
    const risk = await Risk.findByPk(id);
    if (!risk) throwErr('Risk not found', 404);

    if (requestingUser) {
      const permissions = await this.getPermissionsForRisk(risk, requestingUser);
      if (!permissions.canDelete) throwErr('You do not have permission to delete this risk', 403);
    }

    await risk.destroy();
  }

  async addComment(riskId: number, requestingUser: RequestingUser, comment: string): Promise<RiskComment> {
    const risk = await Risk.findByPk(riskId);
    if (!risk) throwErr('Risk not found', 404);

    const permissions = await this.getPermissionsForRisk(risk, requestingUser);
    if (!permissions.canComment) throwErr('You do not have permission to comment on this risk', 403);

    const newComment = await RiskComment.create({ riskId, userId: requestingUser.id, comment: comment.trim() });
    this.generateAndPersistSummary(riskId);
    return newComment;
  }

  async updateComment(commentId: number, requestingUser: RequestingUser, comment: string): Promise<RiskComment> {
    const existing = await RiskComment.findByPk(commentId);
    if (!existing) throwErr('Comment not found', 404);

    // Author-only: no one else (not even superuser) may edit someone's comment.
    if (existing.userId !== requestingUser.id) throwErr('You can only edit your own comment', 403);

    // Only the latest comment in the thread is editable — once a follow-up
    // comment exists, earlier comments are locked.
    const latest = await RiskComment.findOne({
      where: { riskId: existing.riskId },
      order: [['id', 'DESC']],
    });
    if (latest && latest.id !== existing.id) {
      throwErr('Only the latest comment in the thread can be edited', 403);
    }

    await existing.update({ comment: comment.trim(), editedAt: new Date() });
    this.generateAndPersistSummary(existing.riskId);
    return (await RiskComment.findByPk(commentId, {
      include: [{ model: User, as: 'user', attributes: CREATOR_ATTRS }],
    }))!;
  }

  async listComments(riskId: number): Promise<RiskComment[]> {
    return RiskComment.findAll({
      where: { riskId },
      include: [{ model: User, as: 'user', attributes: CREATOR_ATTRS }],
      order: [['created_at', 'ASC']],
    });
  }

  async addMitigationPlan(
    riskId: number,
    description: string,
    requestingUser?: RequestingUser
  ): Promise<RiskMitigationPlan> {
    const risk = await Risk.findByPk(riskId);
    if (!risk) throwErr('Risk not found', 404);

    if (requestingUser) {
      const permissions = await this.getPermissionsForRisk(risk, requestingUser);
      if (!permissions.canEdit) throwErr('You do not have permission to add mitigation plans to this risk', 403);
    }

    return RiskMitigationPlan.create({ riskId, description: description.trim() });
  }

  async updateMitigationPlan(
    planId: number,
    description: string,
    requestingUser?: RequestingUser
  ): Promise<RiskMitigationPlan> {
    const plan = await RiskMitigationPlan.findByPk(planId, { include: [{ model: Risk }] });
    if (!plan) throwErr('Mitigation plan not found', 404);

    if (requestingUser) {
      const risk = plan.risk as Risk;
      if (risk) {
        const permissions = await this.getPermissionsForRisk(risk, requestingUser);
        if (!permissions.canEdit) throwErr('You do not have permission to edit mitigation plans for this risk', 403);
      }
    }

    await plan.update({ description: description.trim() });
    return plan;
  }

  async deleteMitigationPlan(planId: number, requestingUser?: RequestingUser): Promise<void> {
    const plan = await RiskMitigationPlan.findByPk(planId, { include: [{ model: Risk }] });
    if (!plan) throwErr('Mitigation plan not found', 404);

    if (requestingUser) {
      const risk = plan.risk as Risk;
      if (risk) {
        const permissions = await this.getPermissionsForRisk(risk, requestingUser);
        if (!permissions.canEdit) throwErr('You do not have permission to delete mitigation plans for this risk', 403);
      }
    }

    await plan.destroy();
  }

  async getSuperusers(): Promise<User[]> {
    const superuserRole = await Role.findOne({ where: { name: 'superuser' } });
    if (!superuserRole) return [];

    const userRoles = await UserRole.findAll({
      where: { roleId: superuserRole.id },
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
    });

    return userRoles.map(ur => ur.user).filter(Boolean);
  }

  async generateAISummary(riskId: number): Promise<{ summary: string }> {
    const risk = await this.getRiskById(riskId);
    if (!risk) throwErr('Risk not found', 404);

    const isDummyKey = !config.anthropic.apiKey || config.anthropic.apiKey === 'sk-dummy-key';
    if (isDummyKey) {
      return { summary: 'AI summary unavailable — API not configured.' };
    }

    const riskData =
      typeof risk.toJSON === 'function' ? (risk.toJSON() as Risk & { permissions?: RiskPermissions }) : risk;
    const mitigationPlans = riskData.mitigationPlans || [];
    const comments = riskData.comments || [];

    const plansText =
      mitigationPlans.length > 0
        ? mitigationPlans.map((p, i: number) => `${i + 1}. ${p.description}`).join('\n')
        : 'No mitigation plans have been added yet.';

    const commentsText =
      comments.length > 0
        ? comments
            .map(
              c =>
                `[${new Date(c.createdAt).toISOString().split('T')[0]}] ${c.user?.firstName} ${c.user?.lastName}: ${c.comment}`
            )
            .join('\n')
        : 'No comments have been added yet.';

    const prompt = `You are a risk management assistant. Analyze the following project risk and provide a concise summary.

Risk Title: ${riskData.title}
Priority: ${riskData.priority}
Status: ${riskData.status}
Source: ${riskData.source}
Notified Date: ${riskData.notifiedDate}
Description: ${riskData.description}

Mitigation Plans:
${plansText}

Comment History (chronological):
${commentsText}

Provide a 3-5 sentence summary covering: the nature and severity of this risk, what mitigation actions have been taken or planned, and the current state based on the comment history. Be concise and factual. Do not invent information not present above.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 500,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      });

      recordAiUsage('risk-summary', response.model, response.usage);

      const content = response.content[0];
      const summary = content.type === 'text' ? content.text : 'Unable to generate summary.';
      return { summary };
    } catch (error) {
      console.error('AI summary error:', error);
      return { summary: 'Unable to generate AI summary at this time.' };
    }
  }

  private generateAndPersistSummary(riskId: number): void {
    this.generateAISummary(riskId)
      .then(({ summary }) => Risk.update({ aiSummary: summary }, { where: { id: riskId } }))
      .catch(err => console.error('AI summary background update failed:', err));
  }

  /**
   * Helper: resolve permissions for a given risk and requesting user.
   */
  private async getPermissionsForRisk(risk: Risk, requestingUser: RequestingUser): Promise<RiskPermissions> {
    const roleName = effectiveRoleName(requestingUser);
    const permittedProjectIds = roleName === 'superuser' ? [] : await resolvePermittedProjectIds(requestingUser.id);
    const creatorRoleName = await resolveCreatorRoleName(risk.creatorId);
    return resolveRiskPermissions(
      { id: requestingUser.id, roleName },
      { creatorId: risk.creatorId, creatorRoleName, projectId: risk.projectId },
      permittedProjectIds
    );
  }

  private async validateAssigneeIsSuperuser(assigneeId: number): Promise<void> {
    const superuserRole = await Role.findOne({ where: { name: 'superuser' } });
    if (!superuserRole) throwErr('Superuser role not found', 500);

    const userRole = await UserRole.findOne({
      where: { userId: assigneeId, roleId: superuserRole.id },
    });

    if (!userRole) {
      throwErr('Assignee must have the superuser role', 400);
    }
  }
}

export const riskService = new RiskService();
