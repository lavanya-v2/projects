import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';

export type UsageEventType = 'login' | 'logout' | 'session_expired' | 'feature';

/**
 * Append-only usage log. Auth events (login/logout/session_expired) are written
 * from AuthController + authMiddleware; `feature` events come from the
 * allowlist-driven usageTracker middleware.
 *
 * Pruned to 180 days — see usageTrackingService.pruneOldEvents().
 */
@Table({
  tableName: 'usage_events',
  timestamps: false,
})
export class UsageEvent extends Model {
  @Column({
    primaryKey: true,
    autoIncrement: true,
    type: DataType.BIGINT,
  })
  id!: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'user_id',
  })
  userId!: number;

  @BelongsTo(() => User)
  user!: User;

  /** Null for tokens minted before session tracking existed. */
  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    field: 'session_id',
  })
  sessionId!: string | null;

  @Column({
    type: DataType.STRING(50),
    allowNull: true,
    field: 'role_name',
  })
  roleName!: string | null;

  @Column({
    type: DataType.STRING(40),
    allowNull: false,
    field: 'event_type',
  })
  eventType!: UsageEventType;

  /** Allowlist key, e.g. 'report.generate'. Null for auth events. */
  @Column({
    type: DataType.STRING(60),
    allowNull: true,
    field: 'feature',
  })
  feature!: string | null;

  @Column({
    type: DataType.STRING(10),
    allowNull: true,
    field: 'method',
  })
  method!: string | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
    field: 'path',
  })
  path!: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'status_code',
  })
  statusCode!: number | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'duration_ms',
  })
  durationMs!: number | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'project_id',
  })
  projectId!: number | null;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
    field: 'occurred_at',
  })
  occurredAt!: Date;
}
