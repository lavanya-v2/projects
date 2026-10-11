import { describe, it, expect } from 'vitest';
import { toItemDTO, toCommentDTO } from '../services/retroSerializer';
import type { RetroItem } from '../../../models/RetroItem';
import type { RetroItemComment } from '../../../models/RetroItemComment';

/**
 * These tests are the regression fence around the anonymity guarantee.
 *
 * The DB CHECK constraint stops an author being WRITTEN for an anonymous item;
 * these stop one being READ BACK OUT if the schema ever changes or someone
 * widens an include. Between them, a leak has to get past both.
 */

const SECRET_USER_ID = 424242;
const SECRET_FIRST = 'Zebediah';
const SECRET_LAST = 'Quibblesworth';

const ctx = {
    user: { id: 7, roleName: 'member' },
    board: { status: 'ACTIVE' as const, createdById: 1, votingEnabled: true },
    facilitator: false,
    voteCounts: new Map<number, number>(),
    votedItemIds: new Set<number>(),
    commentCounts: new Map<number, number>(),
};

/**
 * A deliberately hostile fixture: an anonymous item that nevertheless carries a
 * populated author association, as would happen if a future migration dropped
 * the CHECK constraint or an include started eager-loading the author.
 * The serializer must drop it regardless.
 */
function hostileAnonymousItem(): RetroItem {
    return {
        id: 1,
        boardId: 1,
        laneKey: 'went_well',
        content: 'Something candid',
        isAnonymous: true,
        authorId: SECRET_USER_ID,
        authorRoleName: 'member',
        author: { id: SECRET_USER_ID, firstName: SECRET_FIRST, lastName: SECRET_LAST },
        sortOrder: 1,
        topPickRank: null,
        convertedType: null,
        convertedRefId: null,
        convertedAt: null,
        createdAt: new Date('2026-08-16T10:17:43.482Z'),
    } as unknown as RetroItem;
}

describe('toItemDTO — anonymous items leak nothing', () => {
    it('serializes no trace of the author anywhere in the payload', () => {
        const dto = toItemDTO(hostileAnonymousItem(), ctx);
        const json = JSON.stringify(dto);

        expect(dto.author).toBeNull();
        expect(json).not.toContain(String(SECRET_USER_ID));
        expect(json).not.toContain(SECRET_FIRST);
        expect(json).not.toContain(SECRET_LAST);
        expect(json).not.toContain('authorId');
        expect(json).not.toContain('authorRoleName');
    });

    it('coarsens createdAt to the minute so timing cannot attribute it', () => {
        const dto = toItemDTO(hostileAnonymousItem(), ctx);
        expect(dto.createdAt.getSeconds()).toBe(0);
        expect(dto.createdAt.getMilliseconds()).toBe(0);
    });

    it('marks the item anonymous so the UI can say so plainly', () => {
        expect(toItemDTO(hostileAnonymousItem(), ctx).isAnonymous).toBe(true);
    });
});

describe('toItemDTO — named items keep attribution', () => {
    const namedItem = {
        ...hostileAnonymousItem(),
        isAnonymous: false,
    } as unknown as RetroItem;

    it('exposes the author', () => {
        const dto = toItemDTO(namedItem, ctx);
        expect(dto.author).toEqual({
            id: SECRET_USER_ID,
            firstName: SECRET_FIRST,
            lastName: SECRET_LAST,
        });
    });

    it('never exposes an email even for named authors', () => {
        const withEmail = {
            ...namedItem,
            author: { id: 5, firstName: 'A', lastName: 'B', email: 'a.b@example.com' },
        } as unknown as RetroItem;
        expect(JSON.stringify(toItemDTO(withEmail, ctx))).not.toContain('example.com');
    });

    it('preserves exact createdAt', () => {
        expect(toItemDTO(namedItem, ctx).createdAt.getMilliseconds()).toBe(482);
    });
});

describe('toItemDTO — vote exposure', () => {
    it('reports counts and the requester\'s own vote, never a voter list', () => {
        const dto = toItemDTO(hostileAnonymousItem(), {
            ...ctx,
            voteCounts: new Map([[1, 4]]),
            votedItemIds: new Set([1]),
        });
        expect(dto.voteCount).toBe(4);
        expect(dto.hasVoted).toBe(true);
        expect(JSON.stringify(dto)).not.toContain('voters');
    });
});

describe('toCommentDTO — anonymous comments leak nothing', () => {
    function hostileAnonymousComment(): RetroItemComment {
        return {
            id: 10,
            itemId: 1,
            authorId: SECRET_USER_ID,
            isAnonymous: true,
            author: { id: SECRET_USER_ID, firstName: SECRET_FIRST, lastName: SECRET_LAST },
            comment: 'candid comment',
            editedAt: null,
            createdAt: new Date('2026-08-16T10:17:43.482Z'),
        } as unknown as RetroItemComment;
    }

    const cctx = { user: { id: 7, roleName: 'member' }, facilitator: false, boardWritable: true };

    it('drops the author entirely', () => {
        const dto = toCommentDTO(hostileAnonymousComment(), cctx);
        const json = JSON.stringify(dto);
        expect(dto.author).toBeNull();
        expect(json).not.toContain(String(SECRET_USER_ID));
        expect(json).not.toContain(SECRET_FIRST);
    });

    it('makes an anonymous comment uneditable by anyone', () => {
        // Even when the requester happens to BE the hidden author.
        const asHiddenAuthor = { ...cctx, user: { id: SECRET_USER_ID, roleName: 'member' } };
        expect(toCommentDTO(hostileAnonymousComment(), asHiddenAuthor).canEdit).toBe(false);
    });

    it('lets a facilitator delete for moderation', () => {
        const dto = toCommentDTO(hostileAnonymousComment(), { ...cctx, facilitator: true });
        expect(dto.canDelete).toBe(true);
    });
});
