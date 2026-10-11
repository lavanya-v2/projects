/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import { authenticate, checkPermission, adminOrSuperuserMiddleware } from '../../../middleware/authMiddleware';
import { programController } from '../controllers/programController';

const router = Router();

router.use(authenticate as any);

// /accessible MUST come before /:programId so 'accessible' isn't treated as an id
// Read endpoint — no resource ID, returns the user's accessible non-empty programs
router.get('/accessible', (req, res) => programController.listAccessible(req, res));

// Read — list programs by account (checkPermission picks up accountId from query)
router.get('/pagination', checkPermission as any, (req, res) => programController.listByAccount(req, res));
router.get('/', checkPermission as any, (req, res) => programController.listByAccountWithoutpagination(req, res));

// Read — single program (checkPermission picks up programId from params)
router.get('/:programId', checkPermission as any, (req, res) => programController.getById(req, res));

// Owner read — anyone with access to the program may view owners
router.get('/:programId/owners', checkPermission as any, (req, res) => programController.listOwners(req, res));

// Write operations — admin/superuser only
router.post('/', adminOrSuperuserMiddleware as any, (req, res) => programController.create(req, res));
router.put('/:programId', adminOrSuperuserMiddleware as any, (req, res) => programController.update(req, res));
router.delete('/:programId', adminOrSuperuserMiddleware as any, (req, res) => programController.delete(req, res));

router.post('/:programId/projects', adminOrSuperuserMiddleware as any, (req, res) =>
  programController.assignProjects(req, res)
);

router.post('/:programId/owners', adminOrSuperuserMiddleware as any, (req, res) =>
  programController.addOwner(req, res)
);
router.delete('/:programId/owners/:userId', adminOrSuperuserMiddleware as any, (req, res) =>
  programController.removeOwner(req, res)
);
router.patch('/:programId/owners/:userId/primary', adminOrSuperuserMiddleware as any, (req, res) =>
  programController.setPrimaryOwner(req, res)
);

export { router as programRoutes };
