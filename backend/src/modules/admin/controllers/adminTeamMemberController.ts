/* eslint-disable @typescript-eslint/no-unused-vars */
import { Request, Response } from 'express';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { TeamMember } from '../../../models/TeamMember';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { UserPermission } from '../../../models/UserPermission';
import { col, fn, Op, where, WhereOptions } from 'sequelize';
import { getAccessibleProjectIds, getAccessibleProjectIdsInAccount } from '../../../common/projectAccess';

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    role?: string;
  };
}

// ─── Team Members ─────────────────────────────────────────────────────────────

export async function adminGetTeamMembers(req: Request, res: Response) {
  try {
    const members = await TeamMember.findAll({
      include: [
        {
          model: AccountTeamMember,
          include: [
            { model: Project, attributes: ['id', 'name', 'code'] },
            { model: Account, attributes: ['id', 'name'] },
          ],
        },
      ],
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
    });
    return res.json({ success: true, data: members });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminGetAccountTeamMembers(req: AuthenticatedRequest, res: Response) {
  try {
    const accountId = parseInt(req.params.id as string);
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'user not authenticated' });
    const page = Number(req.query.pageNumber) || 1;
    const limit = Number(req.query.pageLimit) || 10;
    const offset = (page - 1) * limit;

    if (!accountId) {
      return res.status(400).json({ success: false, message: 'Please provide account Id' });
    }
    const searchValue = req.query.searchValue as string;
    const searchFilter =
      typeof searchValue === 'string' && searchValue.trim() !== ''
        ? {
            [Op.or]: [
              where(fn('concat', col('TeamMember.first_name'), ' ', col('TeamMember.last_name')), {
                [Op.iLike]: `%${searchValue.trim()}%`,
              }),
              { email: { [Op.iLike]: `%${searchValue.trim()}%` } },
              { jiraLoginId: { [Op.iLike]: `%${searchValue.trim()}%` } },
            ],
          }
        : {};

    const projectConditions: WhereOptions[] = [{ accountId: accountId }];

    if (user.role !== 'SUPERUSER') {
      const permissions = await getAccessibleProjectIdsInAccount(user.id, accountId);
      const orConditions = {
        id: { [Op.in]: Array.from(permissions) },
      };
      projectConditions.push({ [Op.or]: orConditions });
    }

    const allTeamMembers = await TeamMember.findAll({
      where: { ...searchFilter },
      subQuery: false,
      include: [
        {
          model: AccountTeamMember,
          where: { accountId: accountId },
          required: true,
          include: [
            {
              model: Project,
              attributes: [],
              where: user.role === 'SUPERUSER' ? { accountId: accountId } : { [Op.and]: projectConditions },
              required: true,
            },
          ],
        },
      ],
      raw: true,
    });

    const uniqueIds = Array.from(new Set(allTeamMembers.map(row => row.id)));
    const totalCount = uniqueIds.length;

    if (uniqueIds.length === 0) {
      return res.json({ success: true, data: [], total: totalCount });
    }

    const finalData = await TeamMember.findAll({
      where: { id: uniqueIds },
      include: [
        {
          model: AccountTeamMember,
          where: { accountId: accountId },
          required: true,
          include: [
            { model: Project, attributes: ['id', 'name', 'code'] },
            ...(user.role === 'SUPERUSER' ? [{ model: Account, attributes: ['id', 'name'] }] : []),
          ],
        },
      ],
      limit,
      offset,
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
    });

    return res.json({
      success: true,
      data: finalData,
      total: totalCount,
    });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(422).json({ success: false, message: err.message });
  }
}

export async function adminCreateTeamMember(req: Request, res: Response) {
  try {
    const { firstName, lastName, email, jiraLoginId, partnerEmailId, v2Member = true } = req.body;
    if (!firstName || !lastName || !email || !jiraLoginId) {
      return res.status(400).json({ success: false, message: 'firstName, lastName, email, jiraLoginId are required' });
    }
    const member = await TeamMember.create({
      firstName,
      lastName,
      email,
      jiraLoginId,
      partnerEmailId,
      v2Member,
    });
    return res.status(201).json({ success: true, data: member });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string; name: string };
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Email or Jira Login ID already exists' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminUpdateTeamMember(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const { firstName, lastName, email, jiraLoginId, partnerEmailId, v2Member } = req.body;
    const member = await TeamMember.findByPk(id);
    if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
    await member.update({
      firstName,
      lastName,
      email,
      jiraLoginId,
      partnerEmailId,
      ...(v2Member !== undefined && { v2Member }),
    });
    return res.json({ success: true, data: member });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string; name: string };
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Email or Jira Login ID already exists' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminDeleteTeamMember(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const member = await TeamMember.findByPk(id);
    if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
    // Cascade: remove all project associations first
    await AccountTeamMember.destroy({ where: { teamMemberId: id } });
    await member.destroy();
    return res.json({ success: true });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}
