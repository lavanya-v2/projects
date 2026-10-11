import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';

/**
 * Cached AI coaching tips for one user, derived ONLY from aggregate signals (never
 * from prompt text). Produced by the coachingQueue worker; the member report prefers
 * these when present and falls back to deterministic heuristic tips otherwise.
 */
@Table({
    tableName: 'claude_usage_coaching',
    timestamps: false,
})
export class ClaudeUsageCoaching extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.BIGINT })
    id!: number;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: false, unique: true, field: 'user_id' })
    userId!: number;

    @BelongsTo(() => User)
    user!: User;

    @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [], field: 'tips' })
    tips!: string[];

    @Column({ type: DataType.STRING(40), allowNull: true, field: 'model' })
    model!: string | null;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'based_on_from' })
    basedOnFrom!: string | null;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'based_on_to' })
    basedOnTo!: string | null;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'generated_at' })
    generatedAt!: Date;
}
