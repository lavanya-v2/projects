import { CollectorVersionPolicy } from '../../../models/CollectorVersionPolicy';
import { compareVersions } from './promptQualityService';

/**
 * Fleet-wide minimum collector version, enforced at ingest (ADDENDUM 22).
 *
 * This is the structural fix for `ungated-collector`: that flag's root cause is
 * purely a version fact (any collector below the version that introduced the
 * VPN gate has no `vpnGate` field at all — see promptQualityService's
 * detectAnomalies). Flagging it forever relies on people choosing to update;
 * this makes staying on an old collector eventually stop working at all, but
 * only after `enforceAfter` — giving the fleet a real window to update first,
 * so a policy set the same day a fix ships doesn't go dark for anyone mid-sync.
 *
 * Same single-mutable-row shape as IngestRateLimitSetting: no versioning, this
 * only affects future ingest decisions.
 */
export interface CollectorVersionPolicyView {
    minEnforcedVersion: string | null;
    enforceAfter: string | null; // ISO, or null
}

export const collectorVersionPolicyService = {
    async getPolicy(): Promise<CollectorVersionPolicyView> {
        const row = await CollectorVersionPolicy.findOne({ order: [['id', 'ASC']] });
        return {
            minEnforcedVersion: row?.minEnforcedVersion ?? null,
            enforceAfter: row?.enforceAfter ? row.enforceAfter.toISOString() : null,
        };
    },

    async setPolicy(minVersion: string | null, enforceAfter: Date | null): Promise<CollectorVersionPolicyView> {
        const row = await CollectorVersionPolicy.findOne({ order: [['id', 'ASC']] });
        if (row) {
            await row.update({ minEnforcedVersion: minVersion, enforceAfter, updatedAt: new Date() });
        } else {
            await CollectorVersionPolicy.create({ minEnforcedVersion: minVersion, enforceAfter } as any);
        }
        return this.getPolicy();
    },

    /**
     * Whether THIS report, arriving now, should be rejected. False whenever no
     * policy is set or the grace window hasn't closed yet — i.e. a no-op unless
     * an admin has both set a floor AND an effective date that has passed.
     */
    async shouldReject(collectorVersion: string): Promise<{ reject: boolean; minEnforcedVersion: string | null }> {
        const policy = await this.getPolicy();
        if (!policy.minEnforcedVersion || !policy.enforceAfter) {
            return { reject: false, minEnforcedVersion: policy.minEnforcedVersion };
        }
        if (new Date(policy.enforceAfter).getTime() > Date.now()) {
            return { reject: false, minEnforcedVersion: policy.minEnforcedVersion };
        }
        return {
            reject: compareVersions(collectorVersion, policy.minEnforcedVersion) < 0,
            minEnforcedVersion: policy.minEnforcedVersion,
        };
    },
};
