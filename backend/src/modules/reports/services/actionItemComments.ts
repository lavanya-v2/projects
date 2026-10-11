import type { Response } from 'express';
import { ActionItemComment } from '../../../models/ActionItemComment';
import { User } from '../../../models/User';

export type CommentUpdateResult =
    | { ok: true; data: any }
    | { ok: false; code: 'not_found' | 'forbidden' | 'not_latest' };

// Maps a CommentUpdateResult to the HTTP response, shared by the project/account/
// program action-item controllers so the status codes and messages stay identical.
export function respondToCommentUpdate(res: Response, result: CommentUpdateResult): Response {
    if (result.ok) return res.json(result.data);
    if (result.code === 'not_found') return res.status(404).json({ error: 'Comment not found' });
    if (result.code === 'forbidden') return res.status(403).json({ error: 'You can only edit your own comment' });
    return res.status(403).json({ error: 'Only the latest comment in the thread can be edited' });
}

// Shared edit logic for action-item comments (project / account / program all use
// the ActionItemComment model). The thread is derived from whichever action-item
// FK the comment carries, so this is scope-agnostic. Rules:
//  - Author-only: only the user who added the comment may edit it (no superuser override).
//  - Latest-only: editable only while it is the newest comment in its thread.
// On success the comment's editedAt is stamped to drive the "(edited)" indicator.
export async function updateActionItemComment(
    commentId: number,
    requestingUserId: number,
    content: string,
): Promise<CommentUpdateResult> {
    const comment = await ActionItemComment.findByPk(commentId);
    if (!comment) return { ok: false, code: 'not_found' };
    if (comment.userId !== requestingUserId) return { ok: false, code: 'forbidden' };

    const threadWhere =
        comment.actionItemId != null ? { actionItemId: comment.actionItemId }
        : comment.accountActionItemId != null ? { accountActionItemId: comment.accountActionItemId }
        : comment.programActionItemId != null ? { programActionItemId: comment.programActionItemId }
        : null;
    if (threadWhere) {
        const latest = await ActionItemComment.findOne({ where: threadWhere, order: [['id', 'DESC']] });
        if (latest && latest.id !== comment.id) return { ok: false, code: 'not_latest' };
    }

    await comment.update({ content: content.trim(), editedAt: new Date() });
    const full = await ActionItemComment.findByPk(comment.id, {
        include: [{ model: User, attributes: ['id', 'firstName', 'lastName'] }],
    });
    return { ok: true, data: full!.toJSON() };
}
