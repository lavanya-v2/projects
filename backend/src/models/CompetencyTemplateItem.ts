import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { CompetencyTemplate } from './CompetencyTemplate';

export type CompetencyInputType = 'rating' | 'text' | 'boolean';

/**
 * One question on a template.
 *
 * A row rather than an entry in a JSONB blob: a rating must FK to a competency so
 * "show me this person's Code Quality across four cycles" is a join, not app-side
 * matching against labels that may have been reworded between versions.
 */
@Table({
    tableName: 'competency_template_items',
    timestamps: true,
    underscored: true,
})
export class CompetencyTemplateItem extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => CompetencyTemplate)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'template_id' })
    templateId!: number;

    @BelongsTo(() => CompetencyTemplate)
    template!: CompetencyTemplate;

    /** Grouping heading in the form, e.g. 'Delivery', 'Collaboration'. */
    @Column({ type: DataType.STRING(100), allowNull: true })
    section!: string | null;

    /** Stable machine key — survives relabelling, so trends stay joinable. */
    @Column({ type: DataType.STRING(64), allowNull: false })
    key!: string;

    @Column({ type: DataType.STRING(255), allowNull: false })
    label!: string;

    @Column({ type: DataType.TEXT, allowNull: true })
    description!: string | null;

    @Column({
        type: DataType.ENUM('rating', 'text', 'boolean'),
        allowNull: false,
        defaultValue: 'rating',
        field: 'input_type',
    })
    inputType!: CompetencyInputType;

    /** Relative weight within the lead factor. Only meaningful for ratings. */
    @Column({ type: DataType.DECIMAL(5, 2), allowNull: false, defaultValue: 1 })
    weight!: number;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_required' })
    isRequired!: boolean;

    /**
     * Whether a written justification accompanies the answer. Enforced
     * unconditionally for ratings regardless of this flag — a bare number cannot be
     * defended in an appraisal — so it only varies behaviour for text/boolean items.
     */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true, field: 'requires_comment' })
    requiresComment!: boolean;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' })
    sortOrder!: number;
}
