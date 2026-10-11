import { batchResolveUserRoles } from '../../risks/services/riskPermissions';
import { getAccessibleProjectIds } from '../../../common/projectAccess';

/**
 * Per-object permissions for the performance review module.
 *
 * Modeled on riskPermissions.ts, and deliberately reusing its
 * `batchResolveUserRoles` verbatim: the legacy `users.role` ENUM must beat a stale
 * `user_roles` row, and this database contains superuser accounts carrying a
 * leftover 'member' record. Re-deriving role resolution here would silently
 * downgrade those accounts.
 */

export interface ReviewPermissions {
    canViewCycle: boolean;
    canConfigure: boolean;
    canDraftReview: boolean;
    canSubmitReview: boolean;
    canPublishReview: boolean;
    canViewOthersReviews: boolean;
    canViewMemberScore: boolean;
    canManageSources: boolean;
    canAssignReviewers: boolean;
    canTransitionCycle: boolean;
    canRecompute: boolean;
}

const NONE: ReviewPermissions = {
    canViewCycle: false,
    canConfigure: false,
    canDraftReview: false,
    canSubmitReview: false,
    canPublishReview: false,
    canViewOthersReviews: false,
    canViewMemberScore: false,
    canManageSources: false,
    canAssignReviewers: false,
    canTransitionCycle: false,
    canRecompute: false,
};

const ALL: ReviewPermissions = {
    canViewCycle: true,
    canConfigure: true,
    canDraftReview: true,
    canSubmitReview: true,
    canPublishReview: true,
    canViewOthersReviews: true,
    canViewMemberScore: true,
    canManageSources: true,
    canAssignReviewers: true,
    canTransitionCycle: true,
    canRecompute: true,
};

export interface ReviewContext {
    /** Projects the cycle draws from. Access is granted by overlap with these. */
    scopeProjectIds: number[];
    cycleStatus: string;
    /** The reviewer assigned to the subject, when acting on one person. */
    reviewerUserId?: number | null;
    /** True when the requester is the person being reviewed. */
    isSelf?: boolean;
    /** The subject's lead review status, for member visibility. */
    reviewStatus?: string;
}

const FROZEN = ['locked', 'published', 'archived'];

/**
 * Resolve what a user may do with a cycle.
 *
 * The rules that matter:
 *  - A lead may draft and publish only the reviews assigned to THEM, and cannot
 *    see other leads' reviews. Drafting privately is the point.
 *  - A member sees their own score only once it is published.
 *  - Configuration (cadence, weights, project scope) is superuser-only, even for
 *    managers: it changes how everyone in the account is measured.
 *  - Once frozen, every write flag drops except for a superuser.
 */
export function resolveReviewPermissions(
    user: { id: number; roleName: string },
    ctx: ReviewContext,
    permittedProjectIds: number[],
): ReviewPermissions {
    const role = user.roleName;

    if (role === 'superuser') return { ...ALL };

    // Executives are customer-facing and read-only; they have no place here at
    // all. Customer feedback, when it ships, goes through its own path.
    if (role === 'executive') return { ...NONE };

    // Access is by project overlap: a cycle spans several projects, and seeing any
    // one of them is enough to see the cycle.
    const hasOverlap =
        ctx.scopeProjectIds.length === 0 ||
        ctx.scopeProjectIds.some(id => permittedProjectIds.includes(id));
    if (!hasOverlap) return { ...NONE };

    const frozen = FROZEN.includes(ctx.cycleStatus);
    const isAssignedReviewer = !!ctx.reviewerUserId && ctx.reviewerUserId === user.id;

    if (role === 'admin' || role === 'manager') {
        return {
            ...NONE,
            canViewCycle: true,
            canViewOthersReviews: true,
            canViewMemberScore: true,
            canPublishReview: !frozen,
            canManageSources: !frozen,
            canRecompute: !frozen,
            // Managers may lock a cycle, but not configure or publish it.
            canTransitionCycle: !frozen,
        };
    }

    if (role === 'lead') {
        return {
            ...NONE,
            canViewCycle: true,
            canViewMemberScore: true,
            // Only for their own assignees, and only while the cycle is open.
            canDraftReview: isAssignedReviewer && !frozen,
            canSubmitReview: isAssignedReviewer && !frozen,
            canPublishReview: isAssignedReviewer && !frozen,
            canManageSources: !frozen,
            canRecompute: !frozen,
        };
    }

    // Members: their own published score, nothing else.
    return {
        ...NONE,
        canViewMemberScore: !!ctx.isSelf && ctx.reviewStatus === 'published',
    };
}

/**
 * Projects a user may act on.
 *
 * Uses `getAccessibleProjectIds` from common/projectAccess rather than the risks
 * module's own version, because that one does not expand program-scoped
 * permissions — a program owner would silently lose access to their projects.
 */
export async function resolvePermittedProjectIds(userId: number): Promise<number[]> {
    return [...(await getAccessibleProjectIds(userId))];
}

export { batchResolveUserRoles };
