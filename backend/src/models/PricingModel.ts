import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';

/**
 * A versioned Claude cost model. Each edit in the admin screen creates a NEW row
 * (a new version) — rows are immutable once created. Every claude_usage_daily row
 * is stamped with the version active at ingest, so historical cost is FROZEN to the
 * rates that applied then, and each day carries a reference to the exact model used.
 * The "current" pricing = the highest version.
 */

export interface RateTiers {
    input: number;
    output: number;
    cache_write: number;
    cache_read: number;
}
export interface PricingRates {
    /** Per-model USD rates per 1,000,000 tokens. */
    models: Record<string, RateTiers>;
    /** Used when a model id isn't in `models`. */
    fallback: RateTiers;
}

@Table({
    tableName: 'pricing_model',
    timestamps: false,
})
export class PricingModel extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.BIGINT })
    id!: number;

    /** Monotonic human-facing version (v1, v2, …). Unique. */
    @Column({ type: DataType.INTEGER, allowNull: false, unique: true, field: 'version' })
    version!: number;

    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'rates' })
    rates!: PricingRates;

    @Column({ type: DataType.STRING(200), allowNull: true, field: 'note' })
    note!: string | null;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'effective_from' })
    effectiveFrom!: Date;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'created_by_user_id' })
    createdByUserId!: number | null;

    @BelongsTo(() => User)
    createdBy!: User | null;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;
}
