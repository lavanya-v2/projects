/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { programService } from '../services/programService';

interface AuthRequest extends Request {
  user?: {
    id: number;
    role?: string;
    roleName?: string;
  };
}

class ProgramController {
  async listByAccount(req: AuthRequest, res: Response) {
    try {
      const accountId = Number(req.query.accountId);
      const page = Number(req.query.pageNumber) || 1;
      const limit = Number(req.query.pageLimit) || 10;
      const id = req.user?.id;
      const roleName = req.user?.role;
      if (!accountId) {
        res.status(400).json({ error: 'accountId query param is required' });
        return;
      }
      const programs = await programService.listByAccount(accountId, page, limit, id, roleName);
      return res.json({
        success: true,
        data: programs.rows,
        totalItems: programs.count,
      });
    } catch (error: any) {
      console.error('Error listing programs:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async listByAccountWithoutpagination(req: AuthRequest, res: Response) {
    try {
      const accountId = Number(req.query.accountId);
      if (!accountId) {
        res.status(400).json({ error: 'accountId query param is required' });
        return;
      }
      const nonEmptyOnly = String(req.query.nonEmptyOnly ?? '').toLowerCase() === 'true';
      const programs = await programService.listByAccountWithoutpagination(accountId, { nonEmptyOnly });
      res.json(programs);
    } catch (error: any) {
      console.error('Error listing programs:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async listAccessible(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'User not authenticated' });
        return;
      }
      const programs = await programService.listAccessibleNonEmptyForUser(user);
      res.json({ success: true, data: programs });
    } catch (error: any) {
      console.error('Error listing accessible programs:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async getById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const programId = parseInt(req.params.programId as string);
      const program = await programService.getById(programId);
      if (!program) {
        res.status(404).json({ error: 'Program not found' });
        return;
      }
      res.json({ success: true, data: program });
    } catch (error: any) {
      console.error('Error fetching program:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const role = req.user?.role;
      const roleName = req.user?.roleName;
      const { accountId, name, description, redThresholdPercentage } = req.body;
      if (!accountId || !name) {
        res.status(400).json({ error: 'accountId and name are required' });
        return;
      }
      const program = await programService.create({
        accountId: Number(accountId),
        name,
        description,
        redThresholdPercentage,
        createdBy: req.user?.id,
        userId,
        role,
        roleName,
      });
      res.status(201).json({ success: true, data: program });
    } catch (error: any) {
      console.error('Error creating program:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const programId = parseInt(req.params.programId as string);
      const { name, description, redThresholdPercentage } = req.body;
      const program = await programService.update(programId, { name, description, redThresholdPercentage });
      res.json({ success: true, data: program });
    } catch (error: any) {
      console.error('Error updating program:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async delete(req: AuthRequest, res: Response): Promise<void> {
    try {
      const programId = parseInt(req.params.programId as string);
      const force = String(req.query.force ?? '').toLowerCase() === 'true';
      await programService.delete(programId, { force });
      res.json({ success: true, message: 'Program deleted' });
    } catch (error: any) {
      console.error('Error deleting program:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async assignProjects(req: AuthRequest, res: Response): Promise<void> {
    try {
      const programId = parseInt(req.params.programId as string);
      const { projectIds, action } = req.body;
      if (!Array.isArray(projectIds)) {
        res.status(400).json({ error: 'projectIds must be an array' });
        return;
      }
      if (action === 'unassign') {
        await programService.unassignProjects(programId, projectIds);
      } else {
        await programService.assignProjects(programId, projectIds);
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error assigning projects to program:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async listOwners(req: AuthRequest, res: Response): Promise<void> {
    try {
      const programId = parseInt(req.params.programId as string);
      const owners = await programService.listOwners(programId);
      res.json({ success: true, data: owners });
    } catch (error: any) {
      console.error('Error listing program owners:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async addOwner(req: AuthRequest, res: Response): Promise<void> {
    try {
      const programId = parseInt(req.params.programId as string);
      const { userId, isPrimary } = req.body;
      if (!userId) {
        res.status(400).json({ error: 'userId is required' });
        return;
      }
      const perm = await programService.addOwner(programId, Number(userId), Boolean(isPrimary));
      res.status(201).json({ success: true, data: perm });
    } catch (error: any) {
      console.error('Error adding program owner:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async removeOwner(req: AuthRequest, res: Response): Promise<void> {
    try {
      const programId = parseInt(req.params.programId as string);
      const userId = parseInt(req.params.userId as string);
      await programService.removeOwner(programId, userId);
      res.json({ success: true, message: 'Owner removed' });
    } catch (error: any) {
      console.error('Error removing program owner:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async setPrimaryOwner(req: AuthRequest, res: Response): Promise<void> {
    try {
      const programId = parseInt(req.params.programId as string);
      const userId = parseInt(req.params.userId as string);
      const perm = await programService.setPrimaryOwner(programId, userId);
      res.json({ success: true, data: perm });
    } catch (error: any) {
      console.error('Error setting primary owner:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }
}

export const programController = new ProgramController();
