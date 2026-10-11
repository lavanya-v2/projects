import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { Account } from './Account';
import { User } from './User';
import { ReviewCycle } from './ReviewCycle';

export type ReviewCadence = 'monthly' | 'quarterly';

/**
 * Per-account review configuration.
 *
 * Account-scoped, not project-scoped: on CCM, 108 of 216 people work across two
 * or more of the account's projects, so project-scoped cycles would give one
 * person several disconnected reviews per period.
 */
@Table({
    tableName: 'review_cycle_configs',
    timestamps: true,
    underscored: true,
})
export class ReviewCycleConfig extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => Account)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'account_id' })
    accountId!: number;

    @BelongsTo(() => Account)
    account!: Account;

    /** Empty = every project in the account. Non-empty bounds a pilot. */
    @Column({ type: DataType.ARRAY(DataType.INTEGER), allowNull: false, defaultValue: [], field: 'scope_project_ids' })
    scopeProjectIds!: number[];

    @Column({ type: DataType.ENUM('monthly', 'quarterly'), allowNull: false, defaultValue: 'monthly' })
    cadence!: ReviewCadence;

    @Column({ type: DataType.DATEONLY, allowNull: false, field: 'anchor_date' })
    anchorDate!: string;

    @Column({ type: DataType.STRING(64), allowNull: false, defaultValue: 'Asia/Kolkata' })
    timezone!: string;

    /** 4 = April (Indian FY). Defines the cumulative-score window. */
    @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 4, field: 'review_year_start_month' })
    reviewYearStartMonth!: number;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, defaultValue: 60, field: 'weight_system' })
    weightSystem!: number;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, defaultValue: 40, field: 'weight_lead' })
    weightLead!: number;

    /** 0 in v1 — customer feedback is parked. A weight-0 factor is out of scope. */
    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, defaultValue: 0, field: 'weight_customer' })
    weightCustomer!: number;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'lead_template_id' })
    leadTemplateId!: number | null;

    @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'score_100', field: 'missing_factor_policy' })
    missingFactorPolicy!: string;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_enabled' })
    isEnabled!: boolean;

    /**
     * Set once, at first creation, never updated again — when this account
     * actually started using Performance Review. Null for accounts set up
     * before this column existed, or that haven't set one explicitly; both
     * `generateCycles` and `GET /cycles` treat null as "no forward-only
     * behavior," preserving today's behavior for existing accounts.
     */
    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'setup_date' })
    setupDate!: string | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'created_by_user_id' })
    createdByUserId!: number | null;

    @HasMany(() => ReviewCycle)
    cycles!: ReviewCycle[];
}
