import { Router } from 'express';
import { projectController } from '../controllers/projectController';

const router = Router();

router.get('/projects', (req, res) => projectController.getAllProjects(req, res));

export const projectRoutes = router;
