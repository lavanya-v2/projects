import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Project } from './Project';
import { CompetencyTemplate } from './CompetencyTemplate';
import { User } from './User';

/**
 * Per-project overrides for Performance Review setup.
 *
 * A template pointer: "this project uses this competency template" instead
 * of the account-wide default. A plain FK to an existing template — not
 * `CompetencyTemplate.scope === 'project'`, which means "a template variant
 * that only exists for this project." This is a pointer at a shared
 * template, not a new one authored for it.
 *
 * Also a default reviewer: applied to every participant whose dominant
 * project is this one, ahead of the single-unambiguous-lead auto-pick in
 * `resolveDefaultReviewer` — see `freezeParticipants` in reviewCycleService.
 */
@Table({
    tableName: 'review_project_settings',
    timestamps: true,
    underscored: true,
})
export class ReviewProjectSettings extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: false, unique: true, field: 'project_id' })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @ForeignKey(() => CompetencyTemplate)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'template_id' })
    templateId!: number | null;

    @BelongsTo(() => CompetencyTemplate)
    template!: CompetencyTemplate | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'default_reviewer_user_id' })
    defaultReviewerUserId!: number | null;

    @BelongsTo(() => User)
    defaultReviewer!: User | null;
}
