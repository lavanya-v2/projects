import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';
import { TeamMember } from './TeamMember';
import { User } from './User';

/** Delivery systems an identity can come from. Adding one is additive. */
export type IdentitySource = 'jira' | 'excel' | 'azure';

/** How the link was proposed. Only 'manual' and confirmed rows are trusted for scoring. */
export type IdentityMatchMethod = 'auto_email' | 'auto_fuzzy' | 'manual';

export type IdentityLinkStatus = 'suggested' | 'confirmed' | 'rejected';

/**
 * The explicit bridge from a delivery-data identity to a team member.
 *
 * Replaces the fuzzy name matching in perfAggregation.buildV2Matcher() as the
 * source of truth. That matcher stays, but only to SEED `suggested` rows a
 * superuser confirms — a Levenshtein-2 name match is not a basis for a score
 * that reaches HR.
 *
 * Keyed on (projectId, source, sourceKey) so that a display name — the only
 * identity an Excel import has, and unique only within a project — is a
 * first-class key rather than a special case.
 */
@Table({
    tableName: 'perf_identity_links',
    timestamps: true,
    underscored: true,
})
export class PerfIdentityLink extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    /**
     * NULL only for a `rejected` identity — someone in the delivery data who is
     * not a reviewable team member (client-side staff, service accounts). A DB
     * CHECK enforces that a `confirmed` link always resolves to a member.
     */
    @ForeignKey(() => TeamMember)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'team_member_id' })
    teamMemberId!: number | null;

    @BelongsTo(() => TeamMember)
    teamMember!: TeamMember | null;

    @Column({ type: DataType.ENUM('jira', 'excel', 'azure'), allowNull: false })
    source!: IdentitySource;

    /** Jira accountId, or normalizeName(displayName) for Excel. Never an email. */
    @Column({ type: DataType.STRING(255), allowNull: false, field: 'source_key' })
    sourceKey!: string;

    @Column({ type: DataType.STRING(255), allowNull: true, field: 'source_display_name' })
    sourceDisplayName!: string | null;

    @Column({ type: DataType.ENUM('auto_email', 'auto_fuzzy', 'manual'), allowNull: false, field: 'match_method' })
    matchMethod!: IdentityMatchMethod;

    /** 0..1 from the seeder; lets the confirmation UI surface weak matches first. */
    @Column({ type: DataType.FLOAT, allowNull: true, field: 'match_confidence' })
    matchConfidence!: number | null;

    @Column({
        type: DataType.ENUM('suggested', 'confirmed', 'rejected'),
        allowNull: false,
        defaultValue: 'suggested',
    })
    status!: IdentityLinkStatus;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'confirmed_by_user_id' })
    confirmedByUserId!: number | null;

    @BelongsTo(() => User, 'confirmedByUserId')
    confirmedBy!: User | null;

    @Column({ type: DataType.DATE, allowNull: true, field: 'confirmed_at' })
    confirmedAt!: Date | null;

    /** Time bounds for leavers and rejoiners. NULL = unbounded. */
    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'effective_from' })
    effectiveFrom!: string | null;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'effective_to' })
    effectiveTo!: string | null;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' })
    isActive!: boolean;
}
