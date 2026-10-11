/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { riskService } from '../services/riskService';

interface AuthRequest extends Request {
  user?: any;
}

class RiskController {
  async listBoardRisks(req: AuthRequest, res: Response): Promise<void> {
    try {
      const sourceFilter = req.query.sourceFilter;
      let risks;
      if (sourceFilter && typeof sourceFilter === 'string') {
        risks = await riskService.listBoardRisks(req.user, sourceFilter);
      } else {
        risks = await riskService.listBoardRisks(req.user);
      }
      res.json({ success: true, data: risks });
    } catch (error: any) {
      console.error('Error listing risks:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async getRiskById(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string);
      const risk = await riskService.getRiskById(id, req.user);
      res.json({ success: true, data: risk });
    } catch (error: any) {
      console.error('Error fetching risk:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async createRisk(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { source, notifiedDate, title, description, priority, assigneeId, projectId } = req.body;

      if (!source || !notifiedDate || !title || !description || !priority) {
        res.status(400).json({ error: 'source, notifiedDate, title, description, and priority are required' });
        return;
      }

      const creatorId = req.user.id;
      const risk = await riskService.createRisk(
        { source, notifiedDate, title, description, priority, assigneeId, projectId },
        creatorId,
        req.user
      );

      res.status(201).json({ success: true, data: risk });
    } catch (error: any) {
      console.error('Error creating risk:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async updateRisk(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string);
      const { source, notifiedDate, title, description, priority, assigneeId, projectId } = req.body;

      const risk = await riskService.updateRisk(
        id,
        { source, notifiedDate, title, description, priority, assigneeId, projectId },
        req.user
      );
      res.json({ success: true, data: risk });
    } catch (error: any) {
      console.error('Error updating risk:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async deleteRisk(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string);
      await riskService.deleteRisk(id, req.user);
      res.json({ success: true, message: 'Risk deleted' });
    } catch (error: any) {
      console.error('Error deleting risk:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async transitionStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string);
      const { status, comment } = req.body;

      if (!status) {
        res.status(400).json({ error: 'status is required' });
        return;
      }
      if (!comment || comment.trim().length === 0) {
        res.status(400).json({ error: 'A comment is required to change risk status' });
        return;
      }

      await riskService.transitionStatus(id, status, comment, req.user);
      res.json({ success: true, message: 'Status updated and comment saved' });
    } catch (error: any) {
      console.error('Error transitioning status:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async markDone(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string);
      const { resolution } = req.body;
      await riskService.markDone(id, req.user, resolution);
      res.json({ success: true, message: 'Risk marked as done' });
    } catch (error: any) {
      console.error('Error marking risk done:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async addComment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const riskId = parseInt(req.params.id as string);
      const { comment } = req.body;

      if (!comment || comment.trim().length === 0) {
        res.status(400).json({ error: 'comment is required' });
        return;
      }

      const newComment = await riskService.addComment(riskId, req.user, comment);
      res.status(201).json({ success: true, data: newComment });
    } catch (error: any) {
      console.error('Error adding comment:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async updateComment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const commentId = parseInt(req.params.commentId as string);
      const { comment } = req.body;

      if (!comment || comment.trim().length === 0) {
        res.status(400).json({ error: 'comment is required' });
        return;
      }

      const updated = await riskService.updateComment(commentId, req.user, comment);
      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error('Error updating comment:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async listComments(req: AuthRequest, res: Response): Promise<void> {
    try {
      const riskId = parseInt(req.params.id as string);
      const comments = await riskService.listComments(riskId);
      res.json({ success: true, data: comments });
    } catch (error: any) {
      console.error('Error listing comments:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async addMitigationPlan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const riskId = parseInt(req.params.id as string);
      const { description } = req.body;

      if (!description || description.trim().length === 0) {
        res.status(400).json({ error: 'description is required' });
        return;
      }

      const plan = await riskService.addMitigationPlan(riskId, description, req.user);
      res.status(201).json({ success: true, data: plan });
    } catch (error: any) {
      console.error('Error adding mitigation plan:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async updateMitigationPlan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const planId = parseInt(req.params.planId as string);
      const { description } = req.body;

      if (!description || description.trim().length === 0) {
        res.status(400).json({ error: 'description is required' });
        return;
      }

      const plan = await riskService.updateMitigationPlan(planId, description, req.user);
      res.json({ success: true, data: plan });
    } catch (error: any) {
      console.error('Error updating mitigation plan:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async deleteMitigationPlan(req: AuthRequest, res: Response): Promise<void> {
    try {
      const planId = parseInt(req.params.planId as string);
      await riskService.deleteMitigationPlan(planId, req.user);
      res.json({ success: true, message: 'Mitigation plan deleted' });
    } catch (error: any) {
      console.error('Error deleting mitigation plan:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async getSuperusers(req: AuthRequest, res: Response): Promise<void> {
    try {
      const superusers = await riskService.getSuperusers();
      res.json({ success: true, data: superusers });
    } catch (error: any) {
      console.error('Error fetching superusers:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }

  async getAISummary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string);
      const result = await riskService.generateAISummary(id);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Error generating AI summary:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
    }
  }
}

export const riskController = new RiskController();
