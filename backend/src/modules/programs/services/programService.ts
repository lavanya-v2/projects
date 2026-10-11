/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op, fn, col } from 'sequelize';
import sequelize from '../../../config/connection';
import { Program } from '../../../models/Program';
import { Project } from '../../../models/Project';
import { Account } from '../../../models/Account';
import { UserPermission } from '../../../models/UserPermission';
import { User } from '../../../models/User';
import { ProgramActionItem } from '../../../models/ProgramActionItem';

interface CreateProgramInput {
  accountId: number;
  name: string;
  description?: string;
  redThresholdPercentage?: number | null;
  createdBy?: number;
  userId?: number;
  role?: string;
  roleName?: string;
}

interface UpdateProgramInput {
  name?: string;
  description?: string;
  redThresholdPercentage?: number | null;
}

function throwErr(message: string, statusCode: number): never {
  throw Object.assign(new Error(message), { statusCode });
}

class ProgramService {
  async listByAccount(accountId: number, page: number, limit: number, id?: number, roleName?: string) {
    const offset = limit * (page - 1);
    if (roleName === 'SUPERUSER') {
      const programs = await Program.findAndCountAll({
        where: { accountId: accountId },
        limit: limit,
        offset: offset,
        distinct: true,
        include: [{ model: Project, attributes: ['id', 'name', 'code'], required: false }],
        order: [['name', 'ASC']],
      });
      const response = {
        count: programs.count,
        rows: programs.rows.map(i => i.toJSON()),
      };
      return response;
    }

    const programIds: number[] = [];
    const userPermission = await UserPermission.findAll({ where: { userId: id, accountId: accountId } });
    userPermission.map(p => {
      if (p.programId) {
        programIds.push(p.programId);
      }
    });
    const programs = await Program.findAndCountAll({
      where: {
        id: { [Op.in]: programIds },
        accountId,
        [Op.or]: [
          { '$projects.id$': { [Op.ne]: null } },
          {
            [Op.and]: [{ '$projects.id$': null }, { createdBy: id }],
          },
        ],
      },
      limit: limit,
      offset: offset,
      distinct: true,
      include: [
        {
          model: Project,
          as: 'projects',
          attributes: ['id', 'name', 'code'],
          required: false,
        },
      ],
      subQuery: false,
      order: [['name', 'ASC']],
    });

    const response = {
      count: programs.count,
      rows: programs.rows.map(i => i.toJSON()),
    };
    return response;
  }

  async listByAccountWithoutpagination(accountId: number, opts: { nonEmptyOnly?: boolean } = {}) {
    const programs = await Program.findAll({
      where: { accountId },
      include: [{ model: Project, attributes: ['id', 'name', 'code'], required: false }],
      order: [['name', 'ASC']],
    });

    let progItems: Program[];

    if (opts.nonEmptyOnly) {
      progItems = programs.filter(p => Array.isArray((p as any).projects) && (p as any).projects.length > 0);
      return progItems;
    }
    return programs;
  }

  async getById(programId: number) {
    return Program.findByPk(programId, {
      include: [
        { model: Project, attributes: ['id', 'name', 'code'], required: false },
        { model: Account, attributes: ['id', 'name', 'code', 'redThresholdPercentage', 'weekStartDay'], required: false },
      ],
    });
  }

  async create(input: CreateProgramInput): Promise<Program> {
    const account = await Account.findByPk(input.accountId);
    if (!account) throwErr('Account not found', 404);

    if (!input.name || !input.name.trim()) throwErr('Program name is required', 400);

    const existing = await Program.findOne({
      where: { accountId: input.accountId, name: input.name.trim() },
    });
    if (existing) throwErr('A program with this name already exists for this account', 409);
    const result = await sequelize.transaction(async t => {
      const account = await Program.create(
        {
          accountId: input.accountId,
          name: input.name.trim(),
          description: input.description ?? null,
          redThresholdPercentage: input.redThresholdPercentage ?? null,
          createdBy: input.createdBy ?? null,
        },
        { transaction: t }
      );

      if (input.roleName === 'admin') {
        await UserPermission.create(
          {
            userId: input.userId,
            accountId: input.accountId,
            programId: account.id,
          },
          { transaction: t }
        );
      }

      return account;
    });
    return result;
  }

  async update(programId: number, input: UpdateProgramInput): Promise<Program> {
    const program = await Program.findByPk(programId);
    if (!program) throwErr('Program not found', 404);

    if (input.name !== undefined) {
      const newName = input.name.trim();
      if (!newName) throwErr('Program name cannot be empty', 400);
      if (newName !== program!.name) {
        const dupe = await Program.findOne({
          where: { accountId: program!.accountId, name: newName, id: { [Op.ne]: programId } },
        });
        if (dupe) throwErr('A program with this name already exists for this account', 409);
      }
      program!.name = newName;
    }
    if (input.description !== undefined) program!.description = input.description ?? undefined;
    if (input.redThresholdPercentage !== undefined)
      program!.redThresholdPercentage = input.redThresholdPercentage ?? undefined;

    await program!.save();
    return program!;
  }

  async delete(programId: number, opts: { force?: boolean } = {}): Promise<void> {
    const program = await Program.findByPk(programId);
    if (!program) throwErr('Program not found', 404);

    const projectCount = await Project.count({ where: { programId } });
    if (projectCount > 0 && !opts.force) {
      throwErr(`Program has ${projectCount} assigned project(s). Pass force=true to unassign and delete.`, 409);
    }

    await sequelize.transaction(async t => {
      if (projectCount > 0) {
        await Project.update({ programId: null } as any, { where: { programId }, transaction: t });
      }
      await program!.destroy({ transaction: t });
    });
  }

  async assignProjects(programId: number, projectIds: number[]): Promise<void> {
    const program = await Program.findByPk(programId);
    if (!program) throwErr('Program not found', 404);

    if (!Array.isArray(projectIds)) throwErr('projectIds must be an array', 400);

    if (projectIds.length === 0) {
      // No-op when called without ids; use unassignProjects to clear
      return;
    }

    const projects = await Project.findAll({ where: { id: projectIds } });
    if (projects.length !== projectIds.length) {
      throwErr('One or more projects not found', 404);
    }
    const wrongAccount = projects.find(p => p.accountId !== program!.accountId);
    if (wrongAccount) {
      throwErr(`Project ${wrongAccount.id} (${wrongAccount.name}) does not belong to program's account`, 400);
    }

    await Project.update({ programId } as any, { where: { id: projectIds } });
  }

  async unassignProjects(programId: number, projectIds: number[]): Promise<void> {
    if (!Array.isArray(projectIds) || projectIds.length === 0) return;

    await sequelize.transaction(async t => {
      await Project.update({ programId: null } as any, {
        where: {
          id: projectIds,
          programId,
        },
        transaction: t,
      });

      const remainingProjects = await Project.count({
        where: { programId: programId },
        transaction: t,
      });

      if (remainingProjects === 0) {
        await ProgramActionItem.destroy({
          where: { programId: programId },
          transaction: t,
        });
      }
    });
  }

  async listOwners(programId: number) {
    const program = await Program.findByPk(programId);
    if (!program) throwErr('Program not found', 404);

    const perms = await UserPermission.findAll({
      where: { programId },
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName', ['user_id', 'email']] }],
      order: [
        ['isPrimary', 'DESC'],
        ['createdAt', 'ASC'],
      ],
    });
    return perms.map((p: any) => ({
      id: p.id,
      userId: p.userId,
      user: p.user,
      isPrimary: p.isPrimary,
    }));
  }

  async addOwner(programId: number, userId: number, isPrimary: boolean = false) {
    const program = await Program.findByPk(programId);
    if (!program) throwErr('Program not found', 404);

    const user = await User.findByPk(userId);
    if (!user) throwErr('User not found', 404);

    const existing = await UserPermission.findOne({ where: { userId, programId } });
    if (existing) throwErr('User is already an owner of this program', 409);

    return sequelize.transaction(async t => {
      if (isPrimary) {
        await UserPermission.update({ isPrimary: false } as any, { where: { programId }, transaction: t });
      }
      const perm = await UserPermission.create(
        {
          userId,
          accountId: program!.accountId,
          programId,
          projectIds: [],
          isPrimary,
        } as any,
        { transaction: t }
      );
      return perm;
    });
  }

  async removeOwner(programId: number, userId: number): Promise<void> {
    const perm = await UserPermission.findOne({ where: { userId, programId } });
    if (!perm) throwErr('Owner not found for this program', 404);
    await perm.destroy();
  }

  async setPrimaryOwner(programId: number, userId: number) {
    const perm = await UserPermission.findOne({ where: { userId, programId } });
    if (!perm) throwErr('Owner not found for this program', 404);

    return sequelize.transaction(async t => {
      await UserPermission.update({ isPrimary: false } as any, { where: { programId }, transaction: t });
      perm.isPrimary = true;
      await perm.save({ transaction: t });
      return perm;
    });
  }

  /**
   * Returns programs the user can access AND that have at least one assigned project.
   * Drives conditional nav rendering on the frontend.
   *
   * Access rules (Phase 6):
   *   - SUPERUSER / admin: all non-empty programs
   *   - Otherwise: ONLY programs where the user has an explicit `programId` row in UserPermission.
   *     Account-wide access does NOT grant program report visibility — only designated owners.
   */
  async listAccessibleNonEmptyForUser(user: { id: number; role?: string; roleName?: string }) {
    const isSuperuserOrAdmin = user.role === 'SUPERUSER' || user.roleName === 'admin';

    const allowedProgramIdsByCount = await Program.findAll({
      attributes: ['id', 'accountId', 'name', 'description', [fn('COUNT', col('projects.id')), 'projectCount']],
      include: [{ model: Project, attributes: [], required: true }],
      group: ['Program.id'],
      having: sequelize.where(fn('COUNT', col('projects.id')), { [Op.gt]: 0 }),
      order: [['name', 'ASC']],
    });

    if (isSuperuserOrAdmin) {
      return allowedProgramIdsByCount;
    }

    const perms = await UserPermission.findAll({ where: { userId: user.id } });
    if (perms.length === 0) return [];

    // Only explicit program-scoped permission rows grant access (Phase 6).
    const directProgramIds = new Set<number>();
    for (const p of perms) {
      if (p.programId) {
        directProgramIds.add(p.programId);
      }
    }

    if (directProgramIds.size === 0) return [];

    return allowedProgramIdsByCount.filter(prog => directProgramIds.has(prog.id));
  }
}

export const programService = new ProgramService();
