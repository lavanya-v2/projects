/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { authenticate } from '../../../middleware/authMiddleware';
import { adminOrSuperuserMiddleware } from '../../users/controllers/userController';
import {
  listEventsWithPagination,
  listEventsWithoutPagination,
  listTemplatesWithoutPagination,
  listTemplatesWithPagination,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listRules,
  createRule,
  updateRule,
  deleteRule,
} from '../controllers/notificationAdminController';
import { listLogs, getLog, listPending } from '../controllers/notificationLogController';

const router = Router();

router.use(authenticate as any);
router.use(adminOrSuperuserMiddleware as any);

router.get('/events/pagination', listEventsWithPagination as any);
router.get('/events', listEventsWithoutPagination as any);

router.get('/templates/pagination', listTemplatesWithPagination as any);
router.get('/templates', listTemplatesWithoutPagination as any);
router.post('/templates', createTemplate as any);
router.put('/templates/:id', updateTemplate as any);
router.delete('/templates/:id', deleteTemplate as any);

router.get('/rules', listRules as any);
router.post('/rules', createRule as any);
router.put('/rules/:id', updateRule as any);
router.delete('/rules/:id', deleteRule as any);

router.get('/logs', listLogs as any);
router.get('/logs/pending', listPending as any);
router.get('/logs/:id', getLog as any);

export const notificationRoutes = router;
