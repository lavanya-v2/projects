import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { Account } from './Account';
import { User } from './User';
import { ReviewCycleConfig } from './ReviewCycleConfig';
import { ReviewCycleSource } from './ReviewCycleSource';
import { ReviewCycleParticipant } from './ReviewCycleParticipant';

export type ReviewCycleStatus = 'scheduled' | 'open' | 'locked' | 'published' | 'archived';

/** Statuses after which nothing may be recomputed or edited except by a superuser. */
export const FROZEN_CYCLE_STATUSES: ReviewCycleStatus[] = ['locked', 'published', 'archived'];

/**
 * One materialised review period.
 *
 * Weights, template and project scope are snapshotted here rather than read from
 * the config: a published score is an HR artefact and must not change because
 * someone later edited the account's configuration.
 *
 * Transitions are manual — there is no scheduler in v1. `published` in particular
 * is never automatic; auto-publishing scores partly built from missing-factor
 * defaults is the worst failure mode available.
 */
@Table({
    tableName: 'review_cycles',
    timestamps: true,
    underscored: true,
})
export class ReviewCycle extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => Account)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'account_id' })
    accountId!: number;

    @BelongsTo(() => Account)
    account!: Account;

    @ForeignKey(() => ReviewCycleConfig)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'config_id' })
    configId!: number;

    @BelongsTo(() => ReviewCycleConfig)
    config!: ReviewCycleConfig;

    /** '2026-10' monthly, 'FY27-Q1' quarterly. */
    @Column({ type: DataType.STRING(50), allowNull: false, field: 'period_label' })
    periodLabel!: string;

    @Column({ type: DataType.DATEONLY, allowNull: false, field: 'start_date' })
    startDate!: string;

    @Column({ type: DataType.DATEONLY, allowNull: false, field: 'end_date' })
    endDate!: string;

    /** 'FY2026-27' — the window cumulative scores accumulate over. */
    @Column({ type: DataType.STRING(16), allowNull: false, field: 'review_year' })
    reviewYear!: string;

    /** 1-based position within reviewYear; drives the trend comparison. */
    @Column({ type: DataType.SMALLINT, allowNull: false, field: 'sequence_no' })
    sequenceNo!: number;

    @Column({
        type: DataType.ENUM('scheduled', 'open', 'locked', 'published', 'archived'),
        allowNull: false,
        defaultValue: 'scheduled',
    })
    status!: ReviewCycleStatus;

    // ── Snapshotted at open ─────────────────────────────────────────────────
    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, field: 'weight_system' })
    weightSystem!: number;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, field: 'weight_lead' })
    weightLead!: number;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, field: 'weight_customer' })
    weightCustomer!: number;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'lead_template_id' })
    leadTemplateId!: number | null;

    @Column({ type: DataType.ARRAY(DataType.INTEGER), allowNull: false, defaultValue: [], field: 'scope_project_ids' })
    scopeProjectIds!: number[];

    @Column({ type: DataType.DATE, allowNull: true, field: 'opened_at' })
    openedAt!: Date | null;

    @Column({ type: DataType.DATE, allowNull: true, field: 'locked_at' })
    lockedAt!: Date | null;

    @Column({ type: DataType.DATE, allowNull: true, field: 'published_at' })
    publishedAt!: Date | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'published_by_user_id' })
    publishedByUserId!: number | null;

    /**
     * A superuser-created period covering several skipped pre-setup months at
     * once, reviewed and scored as one span. Labeling/filtering/permission
     * concept only — the scoring engine treats it exactly like any other cycle.
     */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_catch_up' })
    isCatchUp!: boolean;

    @HasMany(() => ReviewCycleSource)
    sources!: ReviewCycleSource[];

    @HasMany(() => ReviewCycleParticipant)
    participants!: ReviewCycleParticipant[];

    /** True once the cycle's scores are an artefact of record. */
    get isFrozen(): boolean {
        return FROZEN_CYCLE_STATUSES.includes(this.status);
    }
}
