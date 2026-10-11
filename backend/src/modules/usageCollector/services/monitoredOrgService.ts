import { MonitoredOrg } from '../../../models/MonitoredOrg';
import { config } from '../../../config';

export interface OrgLicense {
    licenseType: 'seat' | 'api';
    seatMonthlyUsd: number;
    /** 'org' when the org has an explicit override, 'benchmark' when using the global default. */
    source: 'org' | 'benchmark';
}

/**
 * Allowlist of customer Claude orgs we may monitor. Ingest is accepted only for
 * an ENABLED org. An unseen org is auto-recorded as disabled ('pending') so an
 * admin can review + enable it.
 */
export const monitoredOrgService = {
    async isEnabled(orgUuid: string): Promise<boolean> {
        const row = await MonitoredOrg.findOne({ where: { orgUuid } });
        return !!row && row.enabled;
    },

    /** Record an org on first sight (disabled/pending). Refresh the name if changed. */
    async upsertSeen(orgUuid: string, orgName: string | null): Promise<void> {
        const existing = await MonitoredOrg.findOne({ where: { orgUuid } });
        if (!existing) {
            await MonitoredOrg.create({ orgUuid, orgName, enabled: false } as any);
        } else if (orgName && existing.orgName !== orgName) {
            await existing.update({ orgName });
        }
    },

    async list(): Promise<MonitoredOrg[]> {
        return MonitoredOrg.findAll({ order: [['enabled', 'DESC'], ['orgName', 'ASC']] });
    },

    async setEnabled(orgUuid: string, enabled: boolean): Promise<MonitoredOrg | null> {
        const row = await MonitoredOrg.findOne({ where: { orgUuid } });
        if (!row) return null;
        await row.update({ enabled });
        return row;
    },

    /**
     * Set license economics for an org (VALUE view). Pass null to clear an override
     * and fall back to the global benchmark. Only provided fields are updated.
     */
    async setLicense(
        orgUuid: string,
        patch: { licenseType?: 'seat' | 'api' | null; seatMonthlyUsd?: number | null },
    ): Promise<MonitoredOrg | null> {
        const row = await MonitoredOrg.findOne({ where: { orgUuid } });
        if (!row) return null;
        const update: { licenseType?: 'seat' | 'api' | null; seatMonthlyUsd?: number | null } = {};
        if ('licenseType' in patch) update.licenseType = patch.licenseType ?? null;
        if ('seatMonthlyUsd' in patch) {
            update.seatMonthlyUsd =
                patch.seatMonthlyUsd == null || Number.isNaN(patch.seatMonthlyUsd)
                    ? null
                    : Math.max(0, patch.seatMonthlyUsd);
        }
        await row.update(update);
        return row;
    },

    /**
     * Resolve the effective license for an org: the org's own override if set,
     * else the global benchmark from config.collector. `source` says which applied
     * so the UI can label a benchmark as an assumption.
     */
    async getLicense(orgUuid: string | null | undefined): Promise<OrgLicense> {
        const benchmark: OrgLicense = {
            licenseType: config.collector.defaultLicenseType,
            seatMonthlyUsd: config.collector.defaultSeatMonthlyUsd,
            source: 'benchmark',
        };
        if (!orgUuid) return benchmark;
        const row = await MonitoredOrg.findOne({ where: { orgUuid } });
        if (!row) return benchmark;
        const type = row.licenseType ?? null;
        const seat = row.seatMonthlyUsd ?? null;
        if (type == null && seat == null) return benchmark;
        return {
            licenseType: (type ?? benchmark.licenseType) as 'seat' | 'api',
            seatMonthlyUsd: seat ?? benchmark.seatMonthlyUsd,
            source: 'org',
        };
    },
};
