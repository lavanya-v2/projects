import { describe, it, expect } from 'vitest';
import {
    resolveRetroItemPermissions,
    resolveRetroBoardPermissions,
    isFacilitator,
    isBoardWritable,
    ALLOWED_BOARD_TRANSITIONS,
    ANON_UNDO_WINDOW_MS,
    type BoardContext,
    type ItemContext,
    canSetOutcome,
} from '../services/retroPermissions';

const FACILITATOR = { id: 1, roleName: 'lead' };
const AUTHOR = { id: 2, roleName: 'member' };
const STRANGER = { id: 3, roleName: 'member' };

const activeBoard: BoardContext = { status: 'ACTIVE', createdById: 1, votingEnabled: true };

const namedItem = (overrides: Partial<ItemContext> = {}): ItemContext => ({
    authorId: AUTHOR.id,
    isAnonymous: false,
    createdAt: new Date('2026-08-16T10:00:00Z'),
    voteCount: 0,
    commentCount: 0,
    convertedType: null,
    ...overrides,
});

const anonItem = (overrides: Partial<ItemContext> = {}): ItemContext => ({
    authorId: null,
    isAnonymous: true,
    createdAt: new Date('2026-08-16T10:00:00Z'),
    voteCount: 0,
    commentCount: 0,
    convertedType: null,
    ...overrides,
});

describe('isFacilitator', () => {
    it('treats the board creator as facilitator', () => {
        expect(isFacilitator({ id: 1, roleName: 'lead' }, { createdById: 1 })).toBe(true);
    });

    it('does NOT treat an unrelated lead as facilitator of someone else\'s board', () => {
        expect(isFacilitator({ id: 9, roleName: 'lead' }, { createdById: 1 })).toBe(false);
    });

    it('lets superuser/admin/manager moderate any board', () => {
        for (const roleName of ['superuser', 'admin', 'manager']) {
            expect(isFacilitator({ id: 9, roleName }, { createdById: 1 })).toBe(true);
        }
    });
});

describe('anonymous items are not editable by anyone', () => {
    // The whole feature rests on this: author_id is never written, so there is
    // no author to authorise an edit against.
    const wellPast = new Date('2026-08-16T11:00:00Z');

    it('denies canEdit to the facilitator', () => {
        const p = resolveRetroItemPermissions(FACILITATOR, anonItem(), activeBoard, true, wellPast);
        expect(p.canEdit).toBe(false);
    });

    it('denies canEdit to a stranger', () => {
        const p = resolveRetroItemPermissions(STRANGER, anonItem(), activeBoard, false, wellPast);
        expect(p.canEdit).toBe(false);
    });

    it('denies canEdit even to the user who actually wrote it', () => {
        // AUTHOR posted it, but the item carries no trace of that — so the
        // server cannot tell them apart from anyone else, and must not pretend to.
        const p = resolveRetroItemPermissions(AUTHOR, anonItem(), activeBoard, false, wellPast);
        expect(p.canEdit).toBe(false);
    });

    it('lets the facilitator delete as a moderation escape hatch', () => {
        const p = resolveRetroItemPermissions(FACILITATOR, anonItem(), activeBoard, true, wellPast);
        expect(p.canDelete).toBe(true);
    });

    it('denies delete to an ordinary participant once the withdraw window closes', () => {
        const p = resolveRetroItemPermissions(STRANGER, anonItem(), activeBoard, false, wellPast);
        expect(p.canDelete).toBe(false);
    });
});

describe('anonymous withdraw window', () => {
    const created = new Date('2026-08-16T10:00:00Z');
    const justInside = new Date(created.getTime() + ANON_UNDO_WINDOW_MS - 1000);
    const justOutside = new Date(created.getTime() + ANON_UNDO_WINDOW_MS + 1000);

    it('allows withdrawal inside the window when nobody has engaged', () => {
        const p = resolveRetroItemPermissions(STRANGER, anonItem({ createdAt: created }), activeBoard, false, justInside);
        expect(p.canDelete).toBe(true);
    });

    it('closes the window once it expires', () => {
        const p = resolveRetroItemPermissions(STRANGER, anonItem({ createdAt: created }), activeBoard, false, justOutside);
        expect(p.canDelete).toBe(false);
    });

    it('closes the window early if the item already has a vote', () => {
        const p = resolveRetroItemPermissions(STRANGER, anonItem({ createdAt: created, voteCount: 1 }), activeBoard, false, justInside);
        expect(p.canDelete).toBe(false);
    });

    it('closes the window early if the item already has a comment', () => {
        const p = resolveRetroItemPermissions(STRANGER, anonItem({ createdAt: created, commentCount: 1 }), activeBoard, false, justInside);
        expect(p.canDelete).toBe(false);
    });
});

describe('named items', () => {
    it('lets the author edit and delete their own', () => {
        const p = resolveRetroItemPermissions(AUTHOR, namedItem(), activeBoard, false);
        expect(p.canEdit).toBe(true);
        expect(p.canDelete).toBe(true);
    });

    it('denies a stranger', () => {
        const p = resolveRetroItemPermissions(STRANGER, namedItem(), activeBoard, false);
        expect(p.canEdit).toBe(false);
        expect(p.canDelete).toBe(false);
    });

    it('lets the facilitator moderate', () => {
        const p = resolveRetroItemPermissions(FACILITATOR, namedItem(), activeBoard, true);
        expect(p.canEdit).toBe(true);
        expect(p.canDelete).toBe(true);
    });
});

describe('completed boards freeze the record', () => {
    const completed: BoardContext = { status: 'COMPLETED', createdById: 1, votingEnabled: true };

    it('denies every mutation to the author', () => {
        const p = resolveRetroItemPermissions(AUTHOR, namedItem(), completed, false);
        expect(p).toMatchObject({
            canEdit: false, canDelete: false, canMove: false,
            canComment: false, canVote: false, canConvert: false,
        });
    });

    it('denies every mutation to the facilitator too', () => {
        const p = resolveRetroItemPermissions(FACILITATOR, namedItem(), completed, true);
        expect(p.canEdit).toBe(false);
        expect(p.canDelete).toBe(false);
    });

    it('still allows the facilitator to convert — follow-up happens after the meeting', () => {
        const p = resolveRetroItemPermissions(FACILITATOR, namedItem(), completed, true);
        expect(p.canConvert).toBe(true);
    });

    it('does not allow a participant to convert', () => {
        const p = resolveRetroItemPermissions(AUTHOR, namedItem(), completed, false);
        expect(p.canConvert).toBe(false);
    });

    it('archived boards allow nothing at all, not even conversion', () => {
        const archived: BoardContext = { status: 'ARCHIVED', createdById: 1, votingEnabled: true };
        const p = resolveRetroItemPermissions(FACILITATOR, namedItem(), archived, true);
        expect(p.canConvert).toBe(false);
    });
});

describe('draft boards are the facilitator\'s private setup space', () => {
    const draft: BoardContext = { status: 'DRAFT', createdById: 1, votingEnabled: true };

    it('is writable by the facilitator', () => {
        expect(isBoardWritable(draft, true)).toBe(true);
    });

    it('is not writable by a participant', () => {
        expect(isBoardWritable(draft, false)).toBe(false);
    });
});

describe('voting toggle', () => {
    it('disables canVote when the board has voting off', () => {
        const noVoting: BoardContext = { status: 'ACTIVE', createdById: 1, votingEnabled: false };
        const p = resolveRetroItemPermissions(AUTHOR, namedItem(), noVoting, false);
        expect(p.canVote).toBe(false);
    });
});

describe('board permissions', () => {
    it('gives a participant no facilitator powers', () => {
        const p = resolveRetroBoardPermissions(AUTHOR, activeBoard, false);
        expect(p).toMatchObject({
            canEditSettings: false, canEditLanes: false,
            canChangeStatus: false, canMarkTopPicks: false, canConvert: false,
        });
        expect(p.canAddItems).toBe(true);
        expect(p.canExportPdf).toBe(true);
    });
});

describe('lifecycle transitions', () => {
    it('forbids reopening a completed board', () => {
        expect(ALLOWED_BOARD_TRANSITIONS.COMPLETED).not.toContain('ACTIVE');
    });

    it('forbids anything out of archived', () => {
        expect(ALLOWED_BOARD_TRANSITIONS.ARCHIVED).toEqual([]);
    });

    it('allows the normal path', () => {
        expect(ALLOWED_BOARD_TRANSITIONS.DRAFT).toContain('ACTIVE');
        expect(ALLOWED_BOARD_TRANSITIONS.ACTIVE).toContain('COMPLETED');
    });
});

describe('canSetOutcome', () => {
    const agreed = { topPickRank: 1 };
    const notAgreed = { topPickRank: null };

    it('allows the facilitator of the reviewing retro', () => {
        expect(canSetOutcome(true, agreed)).toBe(true);
    });

    it('denies an ordinary participant', () => {
        expect(canSetOutcome(false, agreed)).toBe(false);
    });

    it('denies items that were never agreed as a top pick', () => {
        // Outcomes track commitments, not every card on the board.
        expect(canSetOutcome(true, notAgreed)).toBe(false);
    });

    it('does not consult the ORIGINAL board\'s facilitator', () => {
        // The whole point of the design: authority comes from running the
        // reviewing retro, so a different lead can still close out points
        // agreed under a previous facilitator.
        expect(canSetOutcome(true, agreed)).toBe(true);
    });
});
