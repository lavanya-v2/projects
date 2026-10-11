import { FeaturePilot, FEATURE_CLAUDE_USAGE } from '../../../models/FeaturePilot';

/**
 * Per-user pilot allowlist. A non-revoked FeaturePilot row means the user is in
 * the pilot for that feature. Superuser/admin bypass is handled by the callers
 * (middleware / access endpoint), not here.
 */
export const pilotService = {
    async isEnabled(userId: number, feature: string = FEATURE_CLAUDE_USAGE): Promise<boolean> {
        const row = await FeaturePilot.findOne({ where: { userId, feature, revokedAt: null as any } });
        return !!row;
    },

    async enable(userId: number, feature: string = FEATURE_CLAUDE_USAGE): Promise<void> {
        const existing = await FeaturePilot.findOne({ where: { userId, feature } });
        if (existing) {
            if (existing.revokedAt) await existing.update({ revokedAt: null, enabledAt: new Date() });
        } else {
            await FeaturePilot.create({ userId, feature } as any);
        }
    },

    async disable(userId: number, feature: string = FEATURE_CLAUDE_USAGE): Promise<void> {
        await FeaturePilot.update(
            { revokedAt: new Date() },
            { where: { userId, feature, revokedAt: null as any } },
        );
    },

    /** Ids of users currently in the pilot for a feature. */
    async enabledUserIds(feature: string = FEATURE_CLAUDE_USAGE): Promise<number[]> {
        const rows = await FeaturePilot.findAll({
            where: { feature, revokedAt: null as any },
            attributes: ['userId'],
        });
        return rows.map((r) => r.userId);
    },
};
