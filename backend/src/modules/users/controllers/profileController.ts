import bcrypt from 'bcrypt';
import { Request, Response } from 'express';
import { User } from '../../../models/User';
import { UserPermission } from '../../../models/UserPermission';
import { UserRole } from '../../../models/UserRole';
import { Role } from '../../../models/Role';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { Program } from '../../../models/Program';
import { Op } from 'sequelize';

interface AuthRequest extends Request {
  user: User;
}

/**
 * GET /api/profile
 * Returns the currently authenticated user's profile, including read-only
 * account / project / role assignments.
 */
export const getMyProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const user = await User.findByPk(userId, {
      attributes: ['id', 'userId', 'firstName', 'lastName', 'isActive', 'role'],
      include: [
        {
          model: UserPermission,
          include: [{ model: Account, attributes: ['id', 'name', 'code'] }],
        },
        {
          model: UserRole,
          include: [{ model: Role, attributes: ['id', 'name', 'description'] }],
        },
      ],
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    // Map projectIds → names so the UI can show a friendly read-only list.
    // Mirrors the pattern used by userController.getUsers (line 64-83).
    const allProjects = await Project.findAll({ attributes: ['id', 'name', 'code', 'accountId'] });
    const projectMap = new Map(allProjects.map(p => [p.id, p]));
    const data = user.toJSON();

    const accounts: Array<{
      id: number;
      name: string;
      code: string;
      projects: Array<{ id: number; name: string; code: string }>;
    }> = [];

    const programId: number[] = [];

    const programs: Array<{
      id: number;
      name: string;
      projects: Array<{ id: number; name: string; code: string }>;
    }> = [];

    for (const perm of data.permissions || []) {
      if (!perm.account) continue;

      let projectList: Array<{ id: number; name: string; code: string }> = [];

      if (perm.projectIds && perm.projectIds.length > 0) {
        // Specific project assignments
        projectList = perm.projectIds
          .map((id: number) => projectMap.get(id))
          .filter((p: Project) => p)
          .map((p: Project) => ({ id: p.id, name: p.name, code: p.code }));

        accounts.push({
          id: perm.account.id,
          name: perm.account.name,
          code: perm.account.code,
          projects: projectList,
        });
      } else if (perm.programId) {
        programId.push(perm.programId);
      } else {
        // Empty array → full account access → list every project under that account
        projectList = allProjects
          .filter(p => p.accountId === perm.accountId)
          .map(p => ({ id: p.id, name: p.name, code: p.code }));

        accounts.push({
          id: perm.account.id,
          name: perm.account.name,
          code: perm.account.code,
          projects: projectList,
        });
      }
    }
    const getProgramsWithProjects = await Program.findAll({
      where: {
        id: { [Op.in]: programId },
      },
      attributes: ['id', 'accountId', 'name'],
      include: [
        {
          model: Project,
          attributes: ['id', 'name', 'code'],
        },
      ],
    });

    getProgramsWithProjects.map(progMap => {
      programs.push({
        id: progMap.id,
        name: progMap.name,
        projects: progMap.projects.map((p: Project) => ({ id: p.id, name: p.name, code: p.code })),
      });
    });

    const roleName = data.role === 'SUPERUSER' ? 'superuser' : data.userRoles?.[0]?.role?.name;

    res.json({
      success: true,
      data: {
        id: data.id,
        userId: data.userId,
        firstName: data.firstName,
        lastName: data.lastName,
        isActive: data.isActive,
        role: data.role,
        roleName,
        accounts,
        programs,
      },
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PUT /api/profile
 * Updates ONLY firstName, lastName, and password for the authenticated user.
 *
 * Deliberately ignores any other fields (role, permissions, isActive, userId)
 * even if a malicious client sends them — those are admin-only and live on
 * the superuser-protected /api/users routes.
 */
export const updateMyProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { firstName, lastName, newPassword, currentPassword } = req.body || {};

    // Lightweight validation. We do NOT require a current-password challenge
    // because the user is already authenticated via JWT for this session.
    if (firstName !== undefined && (typeof firstName !== 'string' || firstName.trim().length === 0)) {
      return res.status(400).json({ error: 'firstName must be a non-empty string' });
    }
    if (lastName !== undefined && (typeof lastName !== 'string' || lastName.trim().length === 0)) {
      return res.status(400).json({ error: 'lastName must be a non-empty string' });
    }
    if (newPassword !== undefined) {
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: 'New Password must be at least 6 characters' });
      }

      const isValid = await bcrypt.compare(currentPassword, req.user.password);
      if (!isValid) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (firstName !== undefined) user.firstName = firstName.trim();
    if (lastName !== undefined) user.lastName = lastName.trim();
    if (newPassword !== undefined) {
      // BeforeUpdate hook on the User model will hash this automatically.
      user.password = newPassword;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: user.id,
        userId: user.userId,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
