import { Table, Column, Model, DataType } from 'sequelize-typescript';

/**
 * Global floor on how often a single ingest token may successfully push (ADDENDUM
 * 11 Phase 1). A single mutable row (no versioning — unlike PricingModel, there's
 * no need to freeze historical values; this only affects future ingest decisions).
 * Admin-editable from the UI so tightening/loosening it never needs a redeploy.
 * A token's own `minIntervalMinutesOverride` takes precedence when set.
 */
@Table({
    tableName: 'ingest_rate_limit_setting',
    timestamps: false,
})
export class IngestRateLimitSetting extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.BIGINT,
    })
    id!: number;

    /** Minimum minutes between accepted ingests, per user, when no token override applies. */
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 1440, // once per day
        field: 'min_interval_minutes',
    })
    minIntervalMinutes!: number;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
        field: 'updated_at',
    })
    updatedAt!: Date;
}
