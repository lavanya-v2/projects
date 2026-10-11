import { Router } from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { getMyProfile, updateMyProfile } from '../modules/users/controllers/profileController';

// Profile routes — any authenticated user (NOT superuser-gated).
// Mounted at /api/profile in app.ts.
const router = Router();

router.use(authenticate as any);

router.get('/', getMyProfile as any);
router.put('/', updateMyProfile as any);

export default router;
