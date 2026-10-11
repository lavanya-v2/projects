import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';

const router = Router();

router.post('/auth/register', AuthController.register);
router.post('/auth/login', AuthController.login);
router.post('/auth/logout', AuthController.logout);

export const authRoutes = router;
