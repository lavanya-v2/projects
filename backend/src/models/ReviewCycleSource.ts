import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { ReviewCycle } from './ReviewCycle';
import { Project } from './Project';
import { PerfSprintSync } from './PerfSprintSync';
import { User } from './User';

export type ReviewSourceType = 'sprint' | 'kanban' | 'excel_import';

/**
 * A delivery sync feeding one cycle.
 *
 * `projectId` matters here because a cycle spans projects — it is how a member's
 * aggregated score can be explained back to where the work actually happened.
 */
@Table({
    tableName: 'review_cycle_sources',
    timestamps: true,
    underscored: true,
})
export class ReviewCycleSource extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => ReviewCycle)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'review_cycle_id' })
    reviewCycleId!: number;

    @BelongsTo(() => ReviewCycle)
    cycle!: ReviewCycle;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @Column({ type: DataType.ENUM('sprint', 'kanban', 'excel_import'), allowNull: false, field: 'source_type' })
    sourceType!: ReviewSourceType;

    @ForeignKey(() => PerfSprintSync)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'perf_sprint_sync_id' })
    perfSprintSyncId!: number | null;

    @BelongsTo(() => PerfSprintSync)
    sync!: PerfSprintSync | null;

    /** Set instead of perfSprintSyncId for sources that are not sync rows. */
    @Column({ type: DataType.STRING(64), allowNull: true, field: 'external_source_id' })
    externalSourceId!: string | null;

    @Column({ type: DataType.ENUM('auto', 'manual'), allowNull: false, defaultValue: 'auto', field: 'attached_by' })
    attachedBy!: 'auto' | 'manual';

    /** Excluded sources contribute nothing and shrink the coverage denominator. */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
    excluded!: boolean;

    @Column({ type: DataType.TEXT, allowNull: true, field: 'exclusion_reason' })
    exclusionReason!: string | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'excluded_by_user_id' })
    excludedByUserId!: number | null;
}
