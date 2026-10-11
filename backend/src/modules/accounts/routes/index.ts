import { Router } from 'express';
import { AccountController } from '../controllers/accountController';

const router = Router();
const accountController = new AccountController();

router.get('/accounts', accountController.getAllAccounts.bind(accountController));

export const accountRoutes = router;
