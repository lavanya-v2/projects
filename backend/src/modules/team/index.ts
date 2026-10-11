import { Router } from 'express';
import { teamController } from './controllers/teamController';
import { teamPerfReadAccess } from '../../middleware/authMiddleware';

const router = Router();

router.post('/team-members', teamController.addTeamMember);
// Roster read: lead+ org-wide; members scoped to their accessible projects (teamPerfReadAccess).
router.get('/team-members', teamPerfReadAccess as any, (req, res) => teamController.getProjectMembers(req, res));

export const teamRoutes = router;
