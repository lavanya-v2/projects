import { Router } from 'express';
import { installController } from '../controllers/installController';

// PUBLIC installer content (no auth). Streamed via curl|bash / iwr|iex so no file
// is Finder-downloaded → no macOS Gatekeeper prompt. No secrets are served here.
const router = Router();
router.get('/install.sh', (req, res) => installController.installSh(req, res));
router.get('/install.ps1', (req, res) => installController.installPs1(req, res));
router.get('/collector.js', (req, res) => installController.collectorJs(req, res));
router.get('/setup.js', (req, res) => installController.setupJs(req, res));
// The VPN gate. collector.js requires this, and treats it as "on a VPN" if it is
// absent — so a machine that fails to fetch it goes quiet rather than reporting
// from inside a customer network.
router.get('/vpn.js', (req, res) => installController.vpnJs(req, res));

export { router as installRoutes };
