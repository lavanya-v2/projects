import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';

/**
 * Records a user's informed consent to the Claude usage collector sending their
 * content-free usage numbers to Lens. Ingest is GATED on an active (non-revoked)
 * consent row for the current CONSENT_VERSION — no consent, no storage (403).
 *
 * Consent is versioned: bumping CONSENT_VERSION (e.g. when new data types are
 * collected) invalidates prior consent and forces re-consent. We store a hash of
 * the exact consent text the user agreed to for auditability.
 */
@Table({
    tableName: 'usage_collector_consent',
    timestamps: false,
})
export class UsageCollectorConsent extends Model {
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

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        field: 'consent_version',
    })
    consentVersion!: string;

    /** SHA-256 of the exact consent copy the user agreed to. */
    @Column({
        type: DataType.STRING(64),
        allowNull: true,
        field: 'consent_text_hash',
    })
    consentTextHash!: string | null;

    @Column({
        type: DataType.STRING(20),
        allowNull: false,
        defaultValue: 'ui',
        field: 'source',
    })
    source!: string;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
        field: 'consented_at',
    })
    consentedAt!: Date;

    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'revoked_at',
    })
    revokedAt!: Date | null;
}
