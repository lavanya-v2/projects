import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { LeadReview } from './LeadReview';
import { CompetencyTemplateItem } from './CompetencyTemplateItem';

/**
 * One answer on one review.
 *
 * `comment` is the justification and is mandatory for every rating — enforced in
 * leadReviewService at submit, not by a DB constraint, because a draft is allowed
 * to be incomplete while it is being worked on.
 */
@Table({
    tableName: 'lead_review_ratings',
    timestamps: true,
    underscored: true,
})
export class LeadReviewRating extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => LeadReview)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'lead_review_id' })
    leadReviewId!: number;

    @BelongsTo(() => LeadReview)
    review!: LeadReview;

    @ForeignKey(() => CompetencyTemplateItem)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'template_item_id' })
    templateItemId!: number;

    @BelongsTo(() => CompetencyTemplateItem)
    item!: CompetencyTemplateItem;

    /** Within the template's scale. NULL when `na`, or for non-rating items. */
    @Column({ type: DataType.SMALLINT, allowNull: true })
    rating!: number | null;

    @Column({ type: DataType.TEXT, allowNull: true, field: 'text_value' })
    textValue!: string | null;

    @Column({ type: DataType.BOOLEAN, allowNull: true, field: 'boolean_value' })
    booleanValue!: boolean | null;

    /** The written justification for this rating. */
    @Column({ type: DataType.TEXT, allowNull: true })
    comment!: string | null;

    /** Explicitly not applicable. Excluded from the weighted score. */
    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
    na!: boolean;
}
