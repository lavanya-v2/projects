import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { Account } from './Account';
import { TeamMember } from './TeamMember';
import { Project } from './Project';

@Table({
    tableName: 'account_team_members',
    timestamps: true
})
export class AccountTeamMember extends Model {
    @ForeignKey(() => Account)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'account_id'
    })
    accountId!: number;

    @BelongsTo(() => Account)
    account!: Account;

    @ForeignKey(() => TeamMember)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'team_member_id'
    })
    teamMemberId!: number;

    @BelongsTo(() => TeamMember)
    teamMember!: TeamMember;

    @ForeignKey(() => Project)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'project_id'
    })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @Column({
        type: DataType.STRING,
        allowNull: true
    })
    role!: string;

    // Per-member working hours/day for hours-based projects. Null falls back to the
    // project's defaultDailyCapacityHours (or 8). Used in team capacity computation.
    @Column({
        type: DataType.DECIMAL(5, 2),
        allowNull: true,
        field: 'daily_capacity_hours'
    })
    dailyCapacityHours?: number | null;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'created_at'
    })
    createdAt!: Date;

    @Column({
        type: DataType.DATE,
        defaultValue: DataType.NOW,
        field: 'updated_at'
    })
    updatedAt!: Date;
}
