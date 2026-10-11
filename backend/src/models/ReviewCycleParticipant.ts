import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { ReviewCycle } from './ReviewCycle';
import { TeamMember } from './TeamMember';
import { User } from './User';

export type MemberCategory = 'developer' | 'qa' | 'other';

/**
 * Who is in scope for a cycle, and who is accountable for reviewing them.
 *
 * Exists because there is no project_members table and no projects.lead_id — team
 * membership is account_team_members with a free-text role, which cannot express
 * "this person reviews that person". Frozen at cycle open so a review records who
 * was in scope at the time rather than who is on the roster today.
 */
@Table({
    tableName: 'review_cycle_participants',
    timestamps: true,
    underscored: true,
})
export class ReviewCycleParticipant extends Model {
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

    /**
     * The cycle's DOMINANT category by volume, not a per-sprint value. Someone who
     * codes one sprint and tests the next would otherwise switch scoring formula
     * mid-period; the flip is recorded in the score's breakdown instead.
     */
    @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'developer', field: 'member_category' })
    memberCategory!: MemberCategory;

    /** Exactly one reviewer per person, however many projects they worked across. */
    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'reviewer_user_id' })
    reviewerUserId!: number | null;

    @BelongsTo(() => User, 'reviewerUserId')
    reviewer!: User | null;

    /** Which in-scope projects fed this person's score. */
    @Column({
        type: DataType.ARRAY(DataType.INTEGER),
        allowNull: false,
        defaultValue: [],
        field: 'contributing_project_ids',
    })
    contributingProjectIds!: number[];

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_excluded' })
    isExcluded!: boolean;

    @Column({ type: DataType.TEXT, allowNull: true, field: 'exclusion_reason' })
    exclusionReason!: string | null;

    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'roster_snapshot' })
    rosterSnapshot!: Record<string, unknown>;
}
