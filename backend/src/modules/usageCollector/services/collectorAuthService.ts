import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../../../config';
import { UsageIngestToken } from '../../../models/UsageIngestToken';
import { UsageCollectorConsent } from '../../../models/UsageCollectorConsent';

/**
 * Token + consent logic for the Claude usage collector.
 *
 * Tokens: a per-user random secret, shown once, stored only as SHA-256(pepper+token).
 * Consent: versioned + revocable; ingest is gated on an active row for the current
 * CONSENT_VERSION.
 */

const TOKEN_PREFIX = 'clct_';

function hashToken(plaintext: string): string {
    return crypto
        .createHash('sha256')
        .update(config.collector.tokenPepper + plaintext)
        .digest('hex');
}

export const collectorAuthService = {
    hashToken,

    /** Mint a new token for a user, revoking any previous active ones. Returns plaintext ONCE. */
    async generateToken(userId: number): Promise<{ plaintext: string; lastFour: string }> {
        await UsageIngestToken.update(
            { revokedAt: new Date() },
            { where: { userId, revokedAt: null as any } },
        );
        const plaintext = TOKEN_PREFIX + crypto.randomBytes(24).toString('hex');
        const lastFour = plaintext.slice(-4);
        await UsageIngestToken.create({
            userId,
            tokenHash: hashToken(plaintext),
            lastFour,
        } as any);
        return { plaintext, lastFour };
    },

    /** Resolve a bearer token to its (active) row, or null. Constant-time via hash lookup. */
    async resolveToken(plaintext: string): Promise<UsageIngestToken | null> {
        if (!plaintext) return null;
        const row = await UsageIngestToken.findOne({
            where: { tokenHash: hashToken(plaintext), revokedAt: null as any },
        });
        return row;
    },

    async revokeTokens(userId: number): Promise<void> {
        await UsageIngestToken.update(
            { revokedAt: new Date() },
            { where: { userId, revokedAt: null as any } },
        );
    },

    async tokenStatus(userId: number): Promise<{
        exists: boolean;
        lastFour: string | null;
        lastSeenAt: Date | null;
    }> {
        const row = await UsageIngestToken.findOne({
            where: { userId, revokedAt: null as any },
            order: [['createdAt', 'DESC']],
        });
        return {
            exists: !!row,
            lastFour: row?.lastFour ?? null,
            lastSeenAt: row?.lastSeenAt ?? null,
        };
    },

    async markSeen(tokenId: number): Promise<void> {
        await UsageIngestToken.update({ lastSeenAt: new Date() }, { where: { id: tokenId } });
    },

    /**
     * The collector release this server is currently handing out, read from the
     * very file the install endpoints serve.
     *
     * Deliberately NOT a constant anywhere: a hardcoded copy drifts the moment
     * COLLECTOR_VERSION in collector.js is bumped without a matching edit, and the
     * drift is invisible. Since the VPN gate the stakes are higher — this value
     * drives the "your collector is out of date" prompt, and an un-upgraded
     * collector is the one that still reports from inside a customer network. So
     * there is one source of truth and everything reads it.
     *
     * Null if the file cannot be read, which callers must treat as "cannot say"
     * rather than "out of date".
     */
    currentCollectorVersion(): string | null {
        try {
            const src = fs.readFileSync(path.join(config.collector.sourceDir, 'collector.js'), 'utf8');
            const m = src.match(/COLLECTOR_VERSION\s*=\s*['"]([^'"]+)['"]/);
            return m ? m[1] : null;
        } catch {
            return null;
        }
    },

    // --- consent ---
    get currentConsentVersion(): string {
        return config.collector.consentVersion;
    },

    async hasActiveConsent(userId: number): Promise<boolean> {
        const row = await UsageCollectorConsent.findOne({
            where: {
                userId,
                consentVersion: config.collector.consentVersion,
                revokedAt: null as any,
            },
        });
        return !!row;
    },

    async recordConsent(userId: number, consentTextHash?: string): Promise<void> {
        // Supersede any prior active consent rows for this user, then insert one.
        await UsageCollectorConsent.update(
            { revokedAt: new Date() },
            { where: { userId, revokedAt: null as any } },
        );
        await UsageCollectorConsent.create({
            userId,
            consentVersion: config.collector.consentVersion,
            consentTextHash: consentTextHash ?? null,
            source: 'ui',
        } as any);
    },

    async revokeConsent(userId: number): Promise<void> {
        await UsageCollectorConsent.update(
            { revokedAt: new Date() },
            { where: { userId, revokedAt: null as any } },
        );
    },

    async consentStatus(userId: number): Promise<{
        consented: boolean;
        version: string;
        currentVersion: string;
        needsReconsent: boolean;
        consentedAt: Date | null;
    }> {
        const latest = await UsageCollectorConsent.findOne({
            where: { userId, revokedAt: null as any },
            order: [['consentedAt', 'DESC']],
        });
        const current = config.collector.consentVersion;
        return {
            consented: !!latest && latest.consentVersion === current,
            version: latest?.consentVersion ?? '',
            currentVersion: current,
            needsReconsent: !!latest && latest.consentVersion !== current,
            consentedAt: latest?.consentedAt ?? null,
        };
    },

    /** Purge a user's collected aggregates (used by "delete my data"). */
    async purgeUserData(userId: number): Promise<number> {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ClaudeUsageDaily } = require('../../../models/ClaudeUsageDaily');
        return ClaudeUsageDaily.destroy({ where: { userId } });
    },
};
