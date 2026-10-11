import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { ReviewCycle } from './ReviewCycle';
import { TeamMember } from './TeamMember';
import { Account } from './Account';
import { User } from './User';
import { CompetencyTemplate } from './CompetencyTemplate';
import { LeadReviewRating } from './LeadReviewRating';

export type LeadReviewStatus = 'draft' | 'submitted' | 'published' | 'superseded' | 'withdrawn';

/** Statuses in which the lead factor counts as present for scoring. */
export const SCORING_REVIEW_STATUSES: LeadReviewStatus[] = ['submitted', 'published'];

/** The member can see only this one. */
export const MEMBER_VISIBLE_STATUS: LeadReviewStatus = 'published';

/**
 * What the lead was looking at when they rated.
 *
 * Frozen at submission. Delivery data is re-synced routinely and
 * `perf_member_scores` rows are replaced wholesale, so without this there is no
 * way to prove what a rating was actually made against — which is the first thing
 * challenged in an appraisal dispute.
 */
export interface EvidenceSnapshot {
    capturedAt?: string;
    /** The system factor as shown, at the moment of submission. */
    systemScore?: number | null;
    systemCoverage?: number | null;
    systemPresent?: boolean;
    compositeAtSubmit?: number | null;
    memberCategory?: string;
    /** Cycle window and which projects fed the figures. */
    cycle?: { id: number; periodLabel: string; startDate: string; endDate: string };
    contributingProjectIds?: number[];
    /** Per-source delivery detail behind the system score. */
    sources?: Array<Record<string, unknown>>;
    aggregates?: Record<string, number | null>;
    /** Approximations and refused overrides in force when the lead rated. */
    approximations?: string[];
    overridesApplied?: string[];
    overridesRejected?: string[];
    /** The template as answered, so a reworded question cannot change meaning. */
    template?: {
        id: number;
        name: string;
        version: number;
        ratingScaleMin: number;
        ratingScaleMax: number;
        items: Array<{ id: number; key: string; label: string; weight: number; inputType: string }>;
    };
}

/**
 * One lead's review of one person for one cycle.
 *
 * `status` IS the visibility rule — the lead drafts privately, the member sees only
 * `published`. A published review is immutable: a correction creates a new version
 * linked by `supersedesReviewId`, and both are kept, so the record the member saw
 * can never be silently altered.
 */
@Table({
    tableName: 'lead_reviews',
    timestamps: true,
    underscored: true,
})
export class LeadReview extends Model {
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

    @ForeignKey(() => Account)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'account_id' })
    accountId!: number;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'reviewer_user_id' })
    reviewerUserId!: number;

    @BelongsTo(() => User, 'reviewerUserId')
    reviewer!: User;

    /** The exact template VERSION answered. */
    @ForeignKey(() => CompetencyTemplate)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'template_id' })
    templateId!: number;

    @BelongsTo(() => CompetencyTemplate)
    template!: CompetencyTemplate;

    @Column({
        type: DataType.ENUM('draft', 'submitted', 'published', 'superseded', 'withdrawn'),
        allowNull: false,
        defaultValue: 'draft',
    })
    status!: LeadReviewStatus;

    @Column({ type: DataType.TEXT, allowNull: true, field: 'overall_comment' })
    overallComment!: string | null;

    @Column({ type: DataType.TEXT, allowNull: true })
    strengths!: string | null;

    @Column({ type: DataType.TEXT, allowNull: true })
    improvements!: string | null;

    @Column({ type: DataType.DECIMAL(5, 2), allowNull: true, field: 'normalized_score' })
    normalizedScore!: number | null;

    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'evidence_snapshot' })
    evidenceSnapshot!: EvidenceSnapshot;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
    version!: number;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'supersedes_review_id' })
    supersedesReviewId!: number | null;

    /** Why a correction was needed. A DB CHECK requires it when superseding. */
    @Column({ type: DataType.TEXT, allowNull: true, field: 'revision_reason' })
    revisionReason!: string | null;

    @Column({ type: DataType.DATE, allowNull: true, field: 'submitted_at' })
    submittedAt!: Date | null;

    @Column({ type: DataType.DATE, allowNull: true, field: 'published_at' })
    publishedAt!: Date | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'published_by_user_id' })
    publishedByUserId!: number | null;

    /** Evidences that the conversation actually happened. */
    @Column({ type: DataType.DATE, allowNull: true, field: 'acknowledged_at' })
    acknowledgedAt!: Date | null;

    @Column({ type: DataType.TEXT, allowNull: true, field: 'acknowledgement_comment' })
    acknowledgementComment!: string | null;

    @HasMany(() => LeadReviewRating)
    ratings!: LeadReviewRating[];

    /** Published and superseded reviews are records; they are never edited. */
    get isImmutable(): boolean {
        return this.status === 'published' || this.status === 'superseded';
    }
}
