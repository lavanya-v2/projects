import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { ReviewCycle } from './ReviewCycle';
import { TeamMember } from './TeamMember';
import type { MemberCategory } from './ReviewCycleParticipant';

export type TrendDirection = 'improved' | 'declined' | 'flat' | 'na';

/** Per-source and per-metric detail behind a score. Shape varies by provider. */
export interface ScoreBreakdown {
    /** One entry per attached, non-excluded source that had data for this member. */
    sources?: Array<{
        sourceId: number;
        projectId: number;
        projectName?: string | null;
        periodLabel?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        spPlanned?: number | null;
        spDone?: number | null;
        deliveryPct?: number | null;
        qualityRate?: number | null;
    }>;
    /** Raw cycle-level counters the normalizer worked from. */
    aggregates?: Record<string, number | null>;
    /** Sub-metrics a source could not supply, which re-weighted the system factor. */
    unavailableMetrics?: string[];
    /** Documented approximations, e.g. the interim QA proxy. */
    approximations?: string[];
    /** Lead override keys applied before aggregation. */
    overridesApplied?: string[];
    /** Override keys refused as out-of-range or not overridable. */
    overridesRejected?: string[];
    /** Per-sync category disagreement for a person who both codes and tests. */
    categoryFlips?: Array<{ sourceId: number; category: string }>;
    /** What redistribution WOULD have produced, for the parked policy toggle. */
    effectiveWeights?: Record<string, number>;
}

/**
 * The computed composite, snapshotted.
 *
 * Not computed on read: performanceSyncService.computeAndSaveScores() deletes and
 * recreates perf_member_scores on every re-sync, so a read-time score would change
 * silently months after publication. `inputHash` makes drift detectable.
 */
@Table({
    tableName: 'review_member_scores',
    timestamps: true,
    underscored: true,
})
export class ReviewMemberScore extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => ReviewCycle)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'review_cycle_id' })
    reviewCycleId!: number;

    @BelongsTo(() => ReviewCycle)
    cycle!: ReviewCycle;

    @ForeignKey(() => TeamMember)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'team_member_id' })
    teamMemberId!: number;

    @BelongsTo(() => TeamMember)
    teamMember!: TeamMember;

    @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'developer', field: 'member_category' })
    memberCategory!: MemberCategory;

    // ── Weights as they applied to THIS score ───────────────────────────────
    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, field: 'weight_system' })
    weightSystem!: number;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, field: 'weight_lead' })
    weightLead!: number;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, defaultValue: 0, field: 'weight_customer' })
    weightCustomer!: number;

    // ── Period factors ──────────────────────────────────────────────────────
    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'system_score' })
    systemScore!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'lead_score' })
    leadScore!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'customer_score' })
    customerScore!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'composite_score' })
    compositeScore!: number | null;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'system_present' })
    systemPresent!: boolean;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'lead_present' })
    leadPresent!: boolean;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'customer_present' })
    customerPresent!: boolean;

    // ── Coverage ────────────────────────────────────────────────────────────
    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'system_coverage' })
    systemCoverage!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'lead_coverage' })
    leadCoverage!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'customer_coverage' })
    customerCoverage!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'overall_coverage' })
    overallCoverage!: number | null;

    /** Coverage < 60 OR any in-scope factor absent. Both clauses are load-bearing. */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_provisional' })
    isProvisional!: boolean;

    // ── Cumulative (YTD within reviewYear) ──────────────────────────────────
    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'cum_system_score' })
    cumSystemScore!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'cum_lead_score' })
    cumLeadScore!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'cum_customer_score' })
    cumCustomerScore!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'cum_composite_score' })
    cumCompositeScore!: number | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'cum_coverage' })
    cumCoverage!: number | null;

    @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 0, field: 'cum_cycles_count' })
    cumCyclesCount!: number;

    // ── Trend ───────────────────────────────────────────────────────────────
    @Column({
        type: DataType.ENUM('improved', 'declined', 'flat', 'na'),
        allowNull: false,
        defaultValue: 'na',
        field: 'trend_direction',
    })
    trendDirection!: TrendDirection;

    @Column({ type: DataType.DECIMAL(6, 2), allowNull: true, field: 'trend_delta' })
    trendDelta!: number | null;

    // ── Audit ───────────────────────────────────────────────────────────────
    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {} })
    breakdown!: ScoreBreakdown;

    @Column({ type: DataType.DATE, allowNull: true, field: 'computed_at' })
    computedAt!: Date | null;

    @Column({ type: DataType.STRING(10), allowNull: false, defaultValue: 'auto', field: 'computed_by' })
    computedBy!: string;

    @Column({ type: DataType.STRING(16), allowNull: false, defaultValue: 'v1', field: 'engine_version' })
    engineVersion!: string;

    @Column({ type: DataType.STRING(64), allowNull: true, field: 'input_hash' })
    inputHash!: string | null;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_published' })
    isPublished!: boolean;

    @Column({ type: DataType.DATE, allowNull: true, field: 'published_at' })
    publishedAt!: Date | null;
}
