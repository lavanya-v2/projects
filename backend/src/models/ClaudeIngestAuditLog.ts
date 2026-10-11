import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';
import { UsageIngestToken } from './UsageIngestToken';

/**
 * One row per Claude-usage ingest ATTEMPT — accepted or rejected (ADDENDUM 11 Phase
 * 3). Append-only, unlike claude_usage_daily's upsert-per-day: re-pushes and
 * repeated failures are all preserved as history, so this is the actual audit
 * trail (who pushed, when, from where, what happened) — Data Quality is a
 * different, coaching-oriented feature over the stored aggregate rows only.
 *
 * No IP address is captured — `req.ip` behind this app's reverse proxy never
 * reflects a real client address (no `trust proxy` config, and it would be
 * unreliable behind a VPN anyway), so it added no actionable signal. `payload`
 * is only ever the already-validated, content-free payload (never raw request
 * bodies pre-validation).
 */
@Table({
    tableName: 'claude_ingest_audit_log',
    timestamps: false,
})
export class ClaudeIngestAuditLog extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.BIGINT })
    id!: number;

    /** Null when the token itself couldn't be resolved to a user (bad/missing token). */
    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'user_id' })
    userId!: number | null;

    @BelongsTo(() => User)
    user!: User;

    @ForeignKey(() => UsageIngestToken)
    @Column({ type: DataType.BIGINT, allowNull: true, field: 'token_id' })
    tokenId!: number | null;

    /** Only known once the payload parses/validates successfully. */
    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'day' })
    day!: string | null;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'user_agent' })
    userAgent!: string | null;

    @Column({ type: DataType.STRING(20), allowNull: true, field: 'collector_version' })
    collectorVersion!: string | null;

    @Column({ type: DataType.STRING(64), allowNull: true, field: 'org_uuid' })
    orgUuid!: string | null;

    /** VPN gate Stage 2. Mirrors the enum stamped on the payload itself (enforced /
     * disabled / allowed-after-failed-check) — null when unknown (rejected before
     * the payload validated, or a collector that predates the gate). Kept as its
     * own column, not just read out of `payload`, so it's visible and filterable
     * here even on rows where payload itself is null (e.g. rejected-rate-limit). */
    @Column({ type: DataType.STRING(30), allowNull: true, field: 'vpn_gate' })
    vpnGate!: string | null;

    @Column({ type: DataType.STRING(30), allowNull: false, field: 'outcome' })
    outcome!:
        | 'accepted'
        | 'rejected-auth'
        | 'rejected-consent'
        | 'rejected-rate-limit'
        | 'rejected-payload'
        | 'rejected-integrity'
        | 'rejected-org-required'
        | 'rejected-org-not-monitored'
        | 'rejected-outdated-collector';

    @Column({ type: DataType.INTEGER, allowNull: false, field: 'http_status' })
    httpStatus!: number;

    /** The validated, content-free payload — only set once validatePayload succeeds. */
    @Column({ type: DataType.JSONB, allowNull: true, field: 'payload' })
    payload!: Record<string, unknown> | null;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'received_at' })
    receivedAt!: Date;
}
