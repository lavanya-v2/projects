import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';

/**
 * Per-user allowlist for gating a feature to a PILOT group. A row (with
 * revoked_at = null) means the user is in the pilot for that feature. Mirrors the
 * UsageCollectorConsent shape so it doesn't collide with the app's single-primary-role
 * assumption. Managed by superusers via the User Management screen.
 */
export const FEATURE_CLAUDE_USAGE = 'claude-usage';

@Table({
    tableName: 'feature_pilot',
    timestamps: false,
})
export class FeaturePilot extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.BIGINT })
    id!: number;

    @ForeignKey(() => User)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'user_id' })
    userId!: number;

    @BelongsTo(() => User)
    user!: User;

    @Column({ type: DataType.STRING(40), allowNull: false, defaultValue: FEATURE_CLAUDE_USAGE, field: 'feature' })
    feature!: string;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'enabled_at' })
    enabledAt!: Date;

    @Column({ type: DataType.DATE, allowNull: true, field: 'revoked_at' })
    revokedAt!: Date | null;
}
