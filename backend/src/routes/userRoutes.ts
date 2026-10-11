import { Router } from 'express';
import {
  getRoles,
  getUsers,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  adminOrSuperuserMiddleware,
} from '../modules/users/controllers/userController';
import { authenticate } from '../middleware/authMiddleware';

const router = Router();

// All user management routes require standard authentication AND superuser role
router.use(authenticate);
router.use(adminOrSuperuserMiddleware);

router.get('/roles', getRoles);
router.get('/', getUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.get('/:id', getUser);
router.delete('/:id', deactivateUser); // Or PUT /:id/deactivate based on preference

export default router;
