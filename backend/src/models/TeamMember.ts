import { Table, Column, Model, DataType, HasMany, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { AccountTeamMember } from './AccountTeamMember';
import { User } from './User';

@Table({
    tableName: 'team_members',
    timestamps: true
})
export class TeamMember extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @Column({
        type: DataType.STRING,
        allowNull: false,
        field: 'first_name'
    })
    firstName!: string;

    @Column({
        type: DataType.STRING,
        allowNull: false,
        field: 'last_name'
    })
    lastName!: string;

    @Column({
        type: DataType.STRING,
        allowNull: false,
        unique: true
    })
    email!: string;

    /**
     * Nullable since 20260908100002: a roster member need not have a Jira account
     * (Excel projects, non-delivery roles). Still unique for everyone who has one.
     */
    @Column({
        type: DataType.STRING,
        allowNull: true,
        unique: true,
        field: 'jira_login_id'
    })
    jiraLoginId!: string | null;

    /**
     * Explicit link to the app login, replacing the iLike email match that
     * memberDashboardService.resolveMember() has to fall back on. NULL where no
     * unambiguous single user matched — those are resolved by a superuser rather
     * than guessed at.
     */
    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'user_id'
    })
    userId!: number | null;

    @BelongsTo(() => User)
    user!: User | null;

    @Column({
        type: DataType.STRING,
        allowNull: true,
        field: 'partner_email_id'
    })
    partnerEmailId!: string;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'v2_member'
    })
    v2Member!: boolean;

    @HasMany(() => AccountTeamMember)
    accountAssociations!: AccountTeamMember[];

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
