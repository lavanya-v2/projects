/* eslint-disable @typescript-eslint/no-explicit-any */
import { RetroBoard } from '../../../models/RetroBoard';
import { RetroItem } from '../../../models/RetroItem';
import { actionItemService, ACTION_ITEM_CATEGORIES } from '../../reports/services/actionItemService';
import { riskService } from '../../risks/services/riskService';
import { emitToBoard } from '../realtime/retroEvents';
import { HttpError } from './retroBoardService';
import { retroItemService } from './retroItemService';

/**
 * Turning a retro item into an action item or a risk.
 *
 * Entirely optional and always a human decision — nothing here runs
 * automatically, and the route is facilitator-only (the board's creator, or a
 * superuser/admin/manager). A retro is perfectly valid with zero conversions.
 *
 * Conversion COPIES rather than moves: the retro item stays exactly as it was
 * agreed, frozen with the rest of the board, while the action item or risk
 * carries its own independent lifecycle forward.
 */

/** Provenance recorded on the created item — board-level, never author-level. */
function provenanceNote(board: RetroBoard): string {
    return `From retro board #${board.id} (${board.title}, ${board.meetingDate})`;
}

async function assertNotAlreadyConverted(item: RetroItem, force: boolean) {
    if (item.convertedType && !force) {
        throw new HttpError(
            `This item was already converted to a ${item.convertedType === 'ACTION_ITEM' ? 'action item' : 'risk'} (#${item.convertedRefId})`,
            409
        );
    }
}

export const retroConversionService = {
    async toActionItem(item: RetroItem, board: RetroBoard, user: any, data: any, force = false) {
        await assertNotAlreadyConverted(item, force);

        const category = data.category;
        if (!ACTION_ITEM_CATEGORIES.includes(category)) {
            throw new HttpError(`category must be one of: ${ACTION_ITEM_CATEGORIES.join(', ')}`);
        }
        const owner = String(data.owner ?? '').trim();
        if (!owner) throw new HttpError('owner is required');

        const title = String(data.title ?? item.content).trim().slice(0, 500);

        // Reuses the existing service rather than re-implementing: it already
        // writes the ActionItemStatusHistory row and fires the notification.
        const created = await actionItemService.createItem(
            board.projectId,
            {
                title,
                category,
                owner,
                dueDate: data.dueDate ?? null,
                note: provenanceNote(board),
            },
            // The facilitator is the creator of record. Never the retro item's
            // author — which for an anonymous item does not exist at all.
            user.id
        );

        await item.update({
            convertedType: 'ACTION_ITEM',
            convertedRefId: created.id,
            convertedAt: new Date(),
            convertedById: user.id,
        });

        const dto = await retroItemService.serializeOne(item, board, user);
        emitToBoard(board.id, 'retro:item_converted', {
            boardId: board.id,
            itemId: item.id,
            item: dto,
            converted: { type: 'ACTION_ITEM', refId: created.id },
        });

        return { item: dto, actionItem: created };
    },

    async toRisk(item: RetroItem, board: RetroBoard, user: any, data: any, force = false) {
        await assertNotAlreadyConverted(item, force);

        if (!data.priority) throw new HttpError('priority is required');
        if (!data.source) throw new HttpError('source is required');
        if (!data.notifiedDate) throw new HttpError('notifiedDate is required');

        const title = String(data.title ?? item.content).trim().slice(0, 255);
        const description = String(data.description ?? item.content).trim();

        const created = await riskService.createRisk(
            {
                source: data.source,
                notifiedDate: data.notifiedDate,
                title,
                description,
                priority: data.priority,
                assigneeId: data.assigneeId,
                projectId: board.projectId,
            },
            user.id,
            { id: user.id, roleName: user.roleName, role: user.role } as any
        );

        await item.update({
            convertedType: 'RISK',
            convertedRefId: created.id,
            convertedAt: new Date(),
            convertedById: user.id,
        });

        const dto = await retroItemService.serializeOne(item, board, user);
        emitToBoard(board.id, 'retro:item_converted', {
            boardId: board.id,
            itemId: item.id,
            item: dto,
            converted: { type: 'RISK', refId: created.id },
        });

        return { item: dto, risk: created };
    },
};
