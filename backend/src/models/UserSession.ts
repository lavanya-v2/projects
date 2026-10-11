import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';

/**
 * One row per login. Correlated to subsequent requests via the `sid` claim
 * embedded in the JWT at login time (see AuthController.login).
 *
 * `last_seen_at` is advanced by a Redis-throttled heartbeat inside the
 * `authenticate` middleware, so session duration reflects real activity
 * rather than just token lifetime.
 */
@Table({
  tableName: 'user_sessions',
  timestamps: false,
})
export class UserSession extends Model {
  @Column({
    primaryKey: true,
    autoIncrement: true,
    type: DataType.INTEGER,
  })
  id!: number;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    unique: true,
    field: 'session_id',
  })
  sessionId!: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'user_id',
  })
  userId!: number;

  @BelongsTo(() => User)
  user!: User;

  @Column({
    type: DataType.STRING(50),
    allowNull: true,
    field: 'role_name',
  })
  roleName!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    field: 'ip_address',
  })
  ipAddress!: string | null;

  @Column({
    type: DataType.STRING(512),
    allowNull: true,
    field: 'user_agent',
  })
  userAgent!: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
    field: 'started_at',
  })
  startedAt!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
    field: 'last_seen_at',
  })
  lastSeenAt!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'ended_at',
  })
  endedAt!: Date | null;

  /** 'logout' | 'expired' | 'stale' */
  @Column({
    type: DataType.STRING(20),
    allowNull: true,
    field: 'end_reason',
  })
  endReason!: string | null;
}
