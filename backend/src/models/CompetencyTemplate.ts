import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { Account } from './Account';
import { Project } from './Project';
import { User } from './User';
import { CompetencyTemplateItem } from './CompetencyTemplateItem';

export type TemplateScope = 'global' | 'account' | 'project';
export type TemplateStatus = 'draft' | 'active' | 'retired';

/**
 * What a lead is asked to rate.
 *
 * Versioned and never edited in place once active: a published review must stay
 * readable against the exact question set it was answered under. Editing an active
 * template creates a new version and retires the old one, and `lead_reviews`
 * pins the version used.
 */
@Table({
    tableName: 'competency_templates',
    timestamps: true,
    underscored: true,
})
export class CompetencyTemplate extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @Column({ type: DataType.STRING(255), allowNull: false })
    name!: string;

    @Column({ type: DataType.TEXT, allowNull: true })
    description!: string | null;

    @Column({ type: DataType.ENUM('global', 'account', 'project'), allowNull: false, defaultValue: 'account' })
    scope!: TemplateScope;

    @ForeignKey(() => Account)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'account_id' })
    accountId!: number | null;

    @BelongsTo(() => Account)
    account!: Account | null;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'project_id' })
    projectId!: number | null;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
    version!: number;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'parent_template_id' })
    parentTemplateId!: number | null;

    @Column({
        type: DataType.ENUM('draft', 'active', 'retired'),
        allowNull: false,
        defaultValue: 'draft',
    })
    status!: TemplateStatus;

    @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 1, field: 'rating_scale_min' })
    ratingScaleMin!: number;

    @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 5, field: 'rating_scale_max' })
    ratingScaleMax!: number;

    /**
     * Point labels, e.g. `{ "1": "Needs support", "5": "Role model" }`.
     * A bare number means different things to different leads; naming the points is
     * what makes ratings comparable between reviewers.
     */
    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'rating_scale_labels' })
    ratingScaleLabels!: Record<string, string>;

    /** 'developer' | 'qa' | null = everyone. */
    @Column({ type: DataType.STRING(20), allowNull: true, field: 'applies_to_category' })
    appliesToCategory!: string | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'created_by_user_id' })
    createdByUserId!: number | null;

    @HasMany(() => CompetencyTemplateItem)
    items!: CompetencyTemplateItem[];
}
