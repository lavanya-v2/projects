import { Request, Response } from 'express';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { UserPermission } from '../../../models/UserPermission';
import { Op, Sequelize, WhereOptions } from 'sequelize';
import sequelize from '../../../config/connection';

interface AuthenticatedRequest extends Request {
  user?: {
    id?: number;
    role?: string;
    roleName?: string;
  };
}

export async function adminGetAccounts(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    if (userRole === 'SUPERUSER') {
      const accounts = await Account.findAll({
        attributes: {
          include: [
            [
              Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('teamMembers.team_member_id'))),
              'memberCounts',
            ],
            [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('projects.id'))), 'projectCounts'],
          ],
        },
        include: [
          {
            model: AccountTeamMember,
            as: 'teamMembers',
            attributes: [],
            required: false,
          },
          {
            model: Project,
            as: 'projects',
            attributes: [],
            required: false,
          },
        ],
        group: ['Account.id', 'Account.name', 'teamMembers.account_id', 'projects.account_id'],
        order: [['name', 'ASC']],
      });
      return res.json({ success: true, data: accounts });
    }

    const getUserPermissions = await UserPermission.findAll({
      where: { userId },
      raw: true,
    });

    const accIds = Array.from(new Set(getUserPermissions.map(p => p.accountId).filter(Boolean)));

    const projectIdsSet = new Set<number>();
    const accountIdsForFullAccess: number[] = [];
    const programIds: number[] = [];

    for (const p of getUserPermissions) {
      if (p.accountId && !p.programId && (!p.projectIds || p.projectIds.length === 0)) {
        accountIdsForFullAccess.push(p.accountId);
      } else {
        if (p.programId) {
          programIds.push(p.programId);
        }
        if (p.projectIds && p.projectIds.length > 0) {
          for (const id of p.projectIds) {
            projectIdsSet.add(id);
          }
        }
      }
    }

    if (accountIdsForFullAccess.length > 0 || programIds.length > 0) {
      const orConditions: WhereOptions[] = [];

      if (accountIdsForFullAccess.length > 0) {
        orConditions.push({ accountId: { [Op.in]: accountIdsForFullAccess } });
      }
      if (programIds.length > 0) {
        orConditions.push({ programId: { [Op.in]: programIds } });
      }

      const projects = await Project.findAll({
        where: { [Op.or]: orConditions },
        attributes: ['id'],
        raw: true,
      });

      for (const p of projects) {
        projectIdsSet.add(p.id);
      }
    }

    const projIds = Array.from(projectIdsSet);

    const accounts = await Account.findAll({
      where: {
        id: {
          [Op.in]: accIds,
        },
      },
      attributes: {
        include: [
          [
            Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('teamMembers.team_member_id'))),
            'memberCounts',
          ],
          [Sequelize.fn('COUNT', Sequelize.fn('DISTINCT', Sequelize.col('projects.id'))), 'projectCounts'],
        ],
      },
      include: [
        {
          model: AccountTeamMember,
          as: 'teamMembers',
          where: { projectId: projIds.length > 0 ? projIds : [0] },
          attributes: [],
          required: false,
        },
        {
          model: Project,
          as: 'projects',
          where: { id: projIds.length > 0 ? projIds : [0] },
          attributes: [],
          required: false,
        },
      ],
      group: ['Account.id', 'Account.name', 'teamMembers.account_id', 'projects.account_id'],
      order: [['name', 'ASC']],
    });

    return res.json({ success: true, data: accounts });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminCreateAccount(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const roleName = req.user?.roleName;
    const { name, code, description, amberThresholdPercentage, redThresholdPercentage, redProjectCountFloor, redCeilingBadPercentage, weekStartDay } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'name and code are required' });
    }
    const result = await sequelize.transaction(async t => {
      const account = await Account.create(
        {
          name,
          code,
          description,
          amberThresholdPercentage,
          redThresholdPercentage,
          redProjectCountFloor,
          redCeilingBadPercentage,
          weekStartDay,
        },
        { transaction: t }
      );

      if (roleName === 'admin') {
        await UserPermission.create(
          {
            userId: userId,
            accountId: account.id,
          },
          { transaction: t }
        );
      }

      return account;
    });

    return res.status(201).json({ success: true, data: result });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string; name: string };
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Account code already exists' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminUpdateAccount(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const { name, code, description, amberThresholdPercentage, redThresholdPercentage, redProjectCountFloor, redCeilingBadPercentage, weekStartDay } = req.body;
    const account = await Account.findByPk(id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    await account.update({ name, code, description, amberThresholdPercentage, redThresholdPercentage, redProjectCountFloor, redCeilingBadPercentage, weekStartDay });
    return res.json({ success: true, data: account });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string; name: string };
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Account code already exists' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function adminDeleteAccount(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id as string);
    const account = await Account.findByPk(id);
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    const projectCount = await Project.count({ where: { accountId: id } });
    if (projectCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete: account has ${projectCount} project(s). Remove projects first.`,
      });
    }
    await account.destroy();
    return res.json({ success: true });
  } catch (e) {
    const err = e as { response?: { status?: number }; status?: number; message?: string };
    return res.status(500).json({ success: false, message: err.message });
  }
}
