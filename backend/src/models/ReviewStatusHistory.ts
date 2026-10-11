import { Table, Column, Model, DataType, ForeignKey } from 'sequelize-typescript';
import { User } from './User';

export type ReviewHistoryEntity = 'cycle' | 'lead_review' | 'member_score';

/**
 * Audit trail for lifecycle transitions.
 *
 * One table with an entity discriminator rather than a history table per entity,
 * mirroring ActionItemStatusHistory. `timestamps: false` for the same reason that
 * model uses it — the row is itself the timestamp.
 */
@Table({
    tableName: 'review_status_history',
    timestamps: false,
    underscored: true,
})
export class ReviewStatusHistory extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @Column({ type: DataType.STRING(30), allowNull: false, field: 'entity_type' })
    entityType!: ReviewHistoryEntity;

    @Column({ type: DataType.INTEGER, allowNull: false, field: 'entity_id' })
    entityId!: number;

    @Column({ type: DataType.STRING(30), allowNull: true, field: 'from_status' })
    fromStatus!: string | null;

    @Column({ type: DataType.STRING(30), allowNull: false, field: 'to_status' })
    toStatus!: string;

    @Column({ type: DataType.TEXT, allowNull: true })
    note!: string | null;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'changed_by_user_id' })
    changedByUserId!: number | null;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'changed_at' })
    changedAt!: Date;
}
