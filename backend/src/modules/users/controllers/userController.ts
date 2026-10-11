import { NextFunction, Request, Response } from 'express';
import { User } from '../../../models/User';
import { UserPermission } from '../../../models/UserPermission';
import { UserRole } from '../../../models/UserRole';
import { Role } from '../../../models/Role';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { col, fn, Op, Order, where, WhereOptions } from 'sequelize';
import sequelize from '../../../config/connection';
import { pilotService } from '../../usageCollector/services/pilotService';

interface AuthUser {
  role?: 'SUPERUSER' | string;
  roleName?: 'admin' | string;
}

interface AuthRequest extends Request {
  user?: AuthUser;
}

// Ensure the request is coming from a superuser
const requireSuperuser = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'SUPERUSER') {
    return res.status(403).json({ error: 'Access denied: Superuser role required' });
  }
  next();
};

// Ensure the request is coming from a superuser or admin
const requireAdminOrSuperuser = (req: AuthRequest, res: Response, next: NextFunction) => {
  const isSuperuser = req.user?.role === 'SUPERUSER';
  const isAdmin = req.user?.roleName === 'admin';
  if (!isSuperuser && !isAdmin) {
    return res.status(403).json({ error: 'Access denied: Admin or Superuser role required' });
  }
  next();
};

export const getRoles = async (_req: AuthRequest, res: Response) => {
  try {
    const roles = await Role.findAll({ attributes: ['id', 'name', 'description'], order: [['name', 'ASC']] });
    res.json({ success: true, data: roles });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { searchValue, accountName, projectName, roleName, statusFilter, pageNumber, pageLimit } = req.query;

    const sortBy = String(req.query.sortBy) || 'firstName';
    const sortOrder = String(req.query.sortOrder) || 'ASC';

    const page = Number(pageNumber) || 1;
    const limit = Number(pageLimit) || 10;
    const offset = (page - 1) * limit;

    let order: Order | undefined;

    if (sortBy === 'role') {
      order = [['userRoles', 'role', 'name', sortOrder || 'ASC']];
    } else {
      order = [[sortBy, sortOrder]];
    }

    const formattedUsers = async (users: User[]) => {
      // We need to fetch projects to map IDs to names for the UI
      const allProjects = await Project.findAll({ attributes: ['id', 'name', 'accountId'] });
      const projectMap = new Map(allProjects.map(p => [p.id, p.name]));
      // Claude-usage pilot membership, so the admin toggle can prefill.
      const pilotIds = new Set(await pilotService.enabledUserIds());

      return users.map(user => {
        const userData = user.toJSON();
        const accounts = userData.permissions?.map((p: UserPermission) => p.account?.name).filter(Boolean) || [];

        const projects: string[] = [];
        userData.permissions?.forEach((p: UserPermission) => {
          // Program-scoped rows have empty projectIds by design; they confer program-level
          // access, not account-wide. Skip in this listing — the dedicated Programs UI shows them.
          if (p.programId) return;

          if (p.projectIds && p.projectIds.length > 0) {
            p.projectIds.forEach((id: number) => {
              const projName = projectMap.get(id);
              if (projName) projects.push(projName);
            });
          } else if (p.accountId) {
            // Full access to the account - add all projects for this account
            allProjects
              .filter(proj => proj.accountId === p.accountId)
              .forEach(proj => {
                projects.push(proj.name);
              });
          }
        });

        const primaryRole = userData.userRoles?.[0]?.role?.name || 'member';

        // Return the structured object along with computed projects for filtering
        return {
          id: userData.id,
          userId: userData.userId,
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email ?? null,
          isActive: userData.isActive,
          roleName: primaryRole,
          accounts: [...new Set(accounts)].join(', '),
          projects: [...new Set(projects)].join(', '),
          permissions: userData.permissions,
          claudeUsagePilot: pilotIds.has(userData.id),
        };
      });
    };

    const parsedRoleNames = (() => {
      if (typeof roleName === 'string' && roleName.trim() !== '') {
        return roleName
          .split(',')
          .map(role => role.trim())
          .filter(Boolean);
      }
      if (Array.isArray(roleName)) {
        return roleName
          .flatMap(item => (typeof item === 'string' ? item.split(',') : []))
          .map(role => role.trim())
          .filter(Boolean);
      }
      return [];
    })();

    const targetProjects: string[] = [];
    if (projectName && typeof projectName === 'string' && projectName.trim() !== '') {
      projectName.split(',').forEach(name => targetProjects.push(name.trim()));
    }
    if (Array.isArray(projectName)) {
      projectName
        .flatMap(item => (typeof item === 'string' ? item.split(',') : []))
        .forEach(name => targetProjects.push(name.trim()));
    }

    const filterIncludes = [];
    const hasAccountFilter = typeof accountName === 'string' && accountName.trim() !== '';
    const hasProjectFilter = targetProjects.length > 0;

    if (hasAccountFilter || hasProjectFilter) {
      const permissionWhere: WhereOptions = {};

      if (hasProjectFilter) {
        // 1. Fetch project records to map names back to IDs and identify their owner accounts
        const matchingProjects = await Project.findAll({
          where: { name: { [Op.in]: targetProjects } },
          attributes: ['id', 'accountId'],
        });

        const projectIdsToFilter = matchingProjects.map(p => p.id);
        const ownerAccountIds = [...new Set(matchingProjects.map(p => p.accountId).filter(Boolean))];

        (permissionWhere as Record<symbol, unknown>)[Op.and] = [
          { programId: { [Op.is]: null } },
          {
            [Op.or]: [
              { projectIds: { [Op.overlap]: projectIdsToFilter } },
              {
                accountId: { [Op.in]: ownerAccountIds },
                [Op.or]: [{ projectIds: { [Op.eq]: [] } }, { projectIds: { [Op.is]: null } }],
              },
            ],
          },
        ];
      }

      filterIncludes.push({
        model: UserPermission,
        required: true,
        where: permissionWhere,
        include: [
          {
            model: Account,
            attributes: ['id', 'name'],
            required: hasAccountFilter,
            ...(hasAccountFilter ? { where: { name: accountName } } : {}),
          },
        ],
      });
    }

    if (parsedRoleNames.length > 0) {
      filterIncludes.push({
        model: UserRole,
        required: true,
        include: [
          {
            model: Role,
            attributes: ['id', 'name'],
            required: true,
            where: { name: { [Op.in]: parsedRoleNames } },
          },
        ],
      });
    }

    if (sortBy === 'role') {
      filterIncludes.push({
        model: UserRole,
        as: 'userRoles',
        required: true,
        include: [
          {
            model: Role,
            as: 'role',
            attributes: ['id', 'name'],
            required: true,
          },
        ],
      });
    }

    const fullHydrationIncludes = [
      {
        model: UserPermission,
        include: [{ model: Account, attributes: ['id', 'name'] }],
      },
      {
        model: UserRole,
        include: [{ model: Role, attributes: ['id', 'name'] }],
      },
    ];

    if (!pageNumber && !pageLimit) {
      const usersWithoutPagination = await User.findAll({
        where: { role: 'USER' },
        attributes: ['id', 'userId', 'firstName', 'lastName', 'email', 'isActive'],
        include: filterIncludes.length > 0 ? filterIncludes : fullHydrationIncludes,
        order: [['firstName', 'ASC']],
      });

      const formattedUsersResult = await formattedUsers(usersWithoutPagination);
      return res.json({ success: true, data: formattedUsersResult });
    }

    const searchFilter =
      typeof searchValue === 'string' && searchValue.trim() !== ''
        ? {
            [Op.or]: [
              where(fn('concat', col('first_name'), ' ', col('last_name')), {
                [Op.iLike]: `%${searchValue.trim()}%`,
              }),
              { userId: { [Op.iLike]: `%${searchValue.trim()}%` } },
            ],
          }
        : {};
    const status =
      typeof statusFilter === 'string' && statusFilter.trim() !== ''
        ? statusFilter === 'active'
          ? true
          : false
        : undefined;
    const hasStatusFilter = typeof status !== 'undefined' ? { isActive: status } : {};
    const userIdsResult = await User.findAndCountAll({
      where: {
        role: 'USER',
        ...searchFilter,
        ...hasStatusFilter,
      },
      subQuery: false,
      include: filterIncludes,
      distinct: true,
      offset,
      limit,
      attributes: ['id'],
      order,
    });

    const targetUserIds = userIdsResult.rows.map((u: User) => u.id);

    let finalUsersRows: User[] = [];
    if (targetUserIds.length > 0) {
      finalUsersRows = await User.findAll({
        where: {
          id: { [Op.in]: targetUserIds },
        },
        attributes: ['id', 'userId', 'firstName', 'lastName', 'email', 'isActive'],
        include: fullHydrationIncludes,
        order,
      });
    }

    const formattedUsersResult = await formattedUsers(finalUsersRows);
    return res.json({
      success: true,
      data: formattedUsersResult,
      totalItems: userIdsResult.count,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id;
    const fullHydrationIncludes = [
      {
        model: UserPermission,
        include: [
          {
            model: Account,
            attributes: ['id', 'name'],
          },
        ],
      },
      {
        model: UserRole,
        include: [
          {
            model: Role,
            attributes: ['id', 'name'],
          },
        ],
      },
    ];

    const user = await User.findOne({ where: { id }, include: fullHydrationIncludes });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const pilotIds = new Set(await pilotService.enabledUserIds());
    const userData = user.toJSON();

    return res.json({
      success: true,
      data: {
        ...userData,
        roleName: userData.userRoles?.[0]?.role?.name || 'member',
        claudeUsagePilot: pilotIds.has(userData.id),
      },
    });
  } catch (e: unknown) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'Internal server error' });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, firstName, lastName, email, password, isActive, permissions, roleName } = req.body;

    const existingUser = await User.findOne({ where: { userId } });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const newUser = await User.create({
      userId,
      firstName,
      lastName,
      email: email || null,
      password: password, // The User model has a BeforeCreate hook that hashes this automatically
      role: 'USER',
      isActive: isActive !== undefined ? isActive : true,
    });

    // Assign role via user_roles table (single role enforced at API level)
    const roleRecord = await Role.findOne({ where: { name: roleName || 'member' } });
    if (roleRecord) {
      await UserRole.create({ userId: newUser.id, roleId: roleRecord.id });
    }

    // Process permissions
    if (permissions && Array.isArray(permissions)) {
      for (const perm of permissions) {
        // perm is expected to be { accountId: 1, projectIds: [1, 2] }
        await UserPermission.create({
          userId: newUser.id,
          accountId: perm.accountId,
          projectIds: perm.projectIds || [],
        });
      }
    }

    res.status(201).json({ success: true, message: 'User created successfully', data: { id: newUser.id } });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id;
    const { firstName, lastName, email, password, isActive, permissions, roleName, claudeUsagePilot } = req.body;

    const user = await User.findByPk(id as string);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only allow updating regular users
    if (user.role === 'SUPERUSER') {
      return res.status(403).json({ error: 'Cannot modify superuser accounts via this endpoint' });
    }

    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    if (email !== undefined) {
      user.email = email || null;
    }
    if (isActive !== undefined) {
      user.isActive = isActive;
    }

    if (password) {
      user.password = password; // The User model has a BeforeUpdate hook that hashes this automatically
    }

    await user.save();

    // Update role if provided (API enforces single role: replace existing)
    if (roleName) {
      const roleRecord = await Role.findOne({ where: { name: roleName } });
      if (roleRecord) {
        await UserRole.destroy({ where: { userId: user.id } });
        await UserRole.create({ userId: user.id, roleId: roleRecord.id });
      }
    }

    // Claude-usage pilot allowlist toggle (superuser-managed).
    if (typeof claudeUsagePilot === 'boolean') {
      if (claudeUsagePilot) await pilotService.enable(user.id);
      else await pilotService.disable(user.id);
    }

    if (permissions && Array.isArray(permissions)) {
      // Replace only the account-scoped permission rows. Program-owner rows
      // (programId != null) are managed by the Programs admin UI and must
      // survive a User Modal save — otherwise editing a user's email silently
      // wipes their program ownerships.
      //
      // destroy + create in one transaction: a failure partway through the
      // loop used to leave the destroy committed but some accounts' rows
      // missing (or, under concurrent saves, a duplicate row surviving next
      // to a fresh one) — no atomicity meant "replace" wasn't actually a
      // single operation. See hasFullAccountAccess/verifyAccountInsightsAccess
      // for why a stray duplicate row is a real over-permission risk, not just
      // untidy data.
      await sequelize.transaction(async transaction => {
        await UserPermission.destroy({ where: { userId: user.id, programId: null }, transaction });
        for (const perm of permissions) {
          await UserPermission.create(
            {
              userId: user.id,
              accountId: perm.accountId,
              projectIds: perm.projectIds || [],
            },
            { transaction }
          );
        }
      });
    }

    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deactivateUser = async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id;
    const user = await User.findByPk(id as string);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'SUPERUSER') return res.status(403).json({ error: 'Cannot deactivate superuser' });

    user.isActive = false;
    await user.save();
    res.json({ success: true, message: 'User deactivated' });
  } catch (error) {
    console.error('Error deactivating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const superuserMiddleware = requireSuperuser;
export const adminOrSuperuserMiddleware = requireAdminOrSuperuser;

/**
 * Flat, unpaginated user list for pickers that need every user at once (e.g.
 * the Performance Review reviewer-assignment screen's account-wide fallback
 * list) — distinct from `getUsers`, which is the paginated/filtered listing
 * behind the User Management grid.
 */
export const adminGetAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await User.findAll({
      include: [
        { model: UserRole, include: [{ model: Role, attributes: ['name', 'description'] }] },
        { model: UserPermission, include: [{ model: Account, attributes: ['id', 'name'] }] },
      ],
      order: [['firstName', 'ASC']],
    });

    const formatted = await Promise.all(
      users.map(async u => {
        const userRole = u.userRoles?.[0];
        const roleName = userRole?.role?.name || u.role?.toLowerCase() || 'unknown';
        const permissions: UserPermission[] = u.permissions || [];

        const accountNames = [...new Set(permissions.map(p => p.account?.name).filter(Boolean))];

        let projectNames: string[] = [];
        if (permissions.length > 0) {
          for (const p of permissions) {
            if (p.projectIds && p.projectIds.length > 0) {
              const projs = await Project.findAll({
                where: { id: p.projectIds },
                attributes: ['name'],
              });
              projectNames.push(...projs.map(pr => pr.name));
            } else if (p.accountId) {
              const projs = await Project.findAll({
                where: { accountId: p.accountId },
                attributes: ['name'],
              });
              projectNames.push(...projs.map(pr => pr.name));
            }
          }
          projectNames = [...new Set(projectNames)];
        }

        return {
          id: u.id,
          userId: u.userId,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          roleName,
          isActive: u.isActive,
          accounts: accountNames.join(', '),
          projects: projectNames.join(', '),
        };
      })
    );

    return res.json({ success: true, data: formatted });
  } catch (err: unknown) {
    return res.status(500).json({ success: false, message: (err as Error).message });
  }
};
