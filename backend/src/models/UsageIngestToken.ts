import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';

/**
 * Per-user personal ingest token for the Claude usage collector. This is the
 * machine-to-server credential — the collector sends it as `Authorization: Bearer
 * <token>` and it both identifies the user and authorizes the push (no JWT / login
 * session on the machine).
 *
 * Only the SHA-256 hash (peppered with COLLECTOR_TOKEN_PEPPER) is stored — the
 * plaintext is shown to the user exactly once at generation time. `last_four` is
 * kept for display ("…a1b2"). Revoking (setting revoked_at) makes the collector's
 * next POST fail 401 — the primary self-service opt-out mechanism.
 */
@Table({
    tableName: 'usage_ingest_tokens',
    timestamps: false,
})
export class UsageIngestToken extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.BIGINT,
    })
    id!: number;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'user_id',
    })
    userId!: number;

    @BelongsTo(() => User)
    user!: User;

    /** SHA-256(pepper + plaintext) as hex. Never the plaintext. */
    @Column({
        type: DataType.STRING(64),
        allowNull: false,
        unique: true,
        field: 'token_hash',
    })
    tokenHash!: string;

    @Column({
        type: DataType.STRING(4),
        allowNull: true,
        field: 'last_four',
    })
    lastFour!: string | null;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
        field: 'created_at',
    })
    createdAt!: Date;

    /** Set when the user disables/rotates — a revoked token authenticates nothing. */
    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'revoked_at',
    })
    revokedAt!: Date | null;

    /** Last time this token successfully ingested — powers "last report" + fleet health. */
    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'last_seen_at',
    })
    lastSeenAt!: Date | null;

    /**
     * Per-token override of the minimum minutes between accepted ingests (ADDENDUM
     * 11 Phase 1). Null = use the global IngestRateLimitSetting. Admin-settable, so
     * one developer's token can be loosened for testing without weakening the
     * server-side floor for everyone else — the client cannot bypass this itself.
     */
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'min_interval_minutes_override',
    })
    minIntervalMinutesOverride!: number | null;
}
