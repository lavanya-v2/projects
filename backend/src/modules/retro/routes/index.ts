import { Router } from 'express';
import { authenticate, leadOrAboveMiddleware } from '../../../middleware/authMiddleware';
import { requireBoardAccess } from '../middleware/requireBoardAccess';
import { retroBoardController } from '../controllers/retroBoardController';
import { retroItemController } from '../controllers/retroItemController';

const router = Router();

// Authentication only at router level — unlike the risk router, ordinary
// members must be able to join a retro they were invited to. Everything beyond
// that is gated per-route by requireBoardAccess, which enforces "project team
// only" against the user's UserPermission scope.
router.use(authenticate as never);

// --- Boards -----------------------------------------------------------------
router.get('/boards', retroBoardController.listBoards as never);

// Creating a board is a lead-or-above action. The service additionally checks
// the chosen project is within the creator's own scope.
router.post('/boards', leadOrAboveMiddleware as never, retroBoardController.createBoard as never);

// Static path MUST be registered before '/boards/:boardId', or Express matches
// 'by-token' as a board id.
router.get(
    '/boards/by-token/:token',
    requireBoardAccess('read') as never,
    retroBoardController.getBoard as never
);

router.get('/boards/:boardId', requireBoardAccess('read') as never, retroBoardController.getBoard as never);
// 'configure' rather than 'facilitate': these change the board's own setup, so
// they must respect the freeze once the retro is complete.
router.patch('/boards/:boardId', requireBoardAccess('configure') as never, retroBoardController.updateBoard as never);
router.put('/boards/:boardId/lanes', requireBoardAccess('configure') as never, retroBoardController.updateLanes as never);
router.post('/boards/:boardId/status', requireBoardAccess('facilitate') as never, retroBoardController.changeStatus as never);
router.delete('/boards/:boardId', requireBoardAccess('facilitate') as never, retroBoardController.archiveBoard as never);
router.post('/boards/:boardId/join', requireBoardAccess('read') as never, retroBoardController.joinBoard as never);
router.get('/boards/:boardId/summary', requireBoardAccess('read') as never, retroBoardController.getSummary as never);

// --- Items ------------------------------------------------------------------
router.post('/boards/:boardId/items', requireBoardAccess('write') as never, retroItemController.createItem as never);
router.patch('/items/:itemId', requireBoardAccess('write') as never, retroItemController.updateItem as never);
router.delete('/items/:itemId', requireBoardAccess('write') as never, retroItemController.deleteItem as never);
router.post('/items/:itemId/vote', requireBoardAccess('write') as never, retroItemController.toggleVote as never);
router.put('/items/:itemId/top-pick', requireBoardAccess('facilitate') as never, retroItemController.setTopPick as never);

// --- Comments ---------------------------------------------------------------
router.get('/items/:itemId/comments', requireBoardAccess('read') as never, retroItemController.listComments as never);
router.post('/items/:itemId/comments', requireBoardAccess('write') as never, retroItemController.createComment as never);
router.patch('/comments/:commentId', requireBoardAccess('write') as never, retroItemController.updateComment as never);
router.delete('/comments/:commentId', requireBoardAccess('write') as never, retroItemController.deleteComment as never);

// --- Conversion (optional, facilitator's decision) ---------------------------
// Never automatic. A retro is complete with zero conversions; these exist only
// for when the facilitator decides an item should become tracked work.
router.post(
    '/items/:itemId/convert/action-item',
    requireBoardAccess('facilitate') as never,
    retroItemController.convertToActionItem as never
);
router.post(
    '/items/:itemId/convert/risk',
    requireBoardAccess('facilitate') as never,
    retroItemController.convertToRisk as never
);

// --- Continuity between retros ----------------------------------------------
// The outcome write is guarded against the REVIEWING board, not the board that
// produced the point. Guarding the old board would break as soon as a different
// lead runs the next retro, since that board's creator is someone else — and it
// would also mean relaxing the completed-board freeze. Authority comes from
// "you are facilitating this retro"; the service then verifies the target point
// belongs to the same project.
router.get(
    '/boards/:boardId/carry-forward',
    requireBoardAccess('read') as never,
    retroBoardController.getCarryForward as never
);
router.put(
    '/boards/:boardId/carry-forward/:itemId/outcome',
    requireBoardAccess('facilitate') as never,
    retroBoardController.setOutcome as never
);

// Converting a carried-forward point. Separate from /items/:itemId/convert/*
// because that route derives permission from the board that OWNS the item —
// the frozen previous board — which would refuse a different lead running this
// retro. Provenance still records the original board.
router.post(
    '/boards/:boardId/carry-forward/:itemId/convert/:target',
    requireBoardAccess('facilitate') as never,
    retroBoardController.convertCarriedPoint as never
);

// Project-scoped, so there is no board to resolve. Access is enforced inside
// the service via getAccessibleProjectIds rather than by a board middleware.
router.get(
    '/projects/:projectId/agreed-points',
    retroBoardController.getAgreedPointsHistory as never
);

export { router as retroRoutes };
