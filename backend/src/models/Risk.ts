import { Table, Column, Model, DataType, ForeignKey, BelongsTo, HasMany } from 'sequelize-typescript';
import { User } from './User';
import { Project } from './Project';
import { RiskMitigationPlan } from './RiskMitigationPlan';
import { RiskComment } from './RiskComment';

export type RiskSource = 'CLIENT' | 'INTERNAL';
export type RiskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type RiskStatus = 'NEW' | 'WORK_IN_PROGRESS' | 'STALE' | 'DONE';

@Table({
    tableName: 'risks',
    timestamps: true
})
export class Risk extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @Column({
        type: DataType.ENUM('CLIENT', 'INTERNAL'),
        allowNull: false
    })
    source!: RiskSource;

    @Column({
        type: DataType.DATEONLY,
        allowNull: false,
        field: 'notified_date'
    })
    notifiedDate!: string;

    @Column({
        type: DataType.STRING(255),
        allowNull: false
    })
    title!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: false
    })
    description!: string;

    @Column({
        type: DataType.ENUM('CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
        allowNull: false
    })
    priority!: RiskPriority;

    @Column({
        type: DataType.ENUM('NEW', 'WORK_IN_PROGRESS', 'STALE', 'DONE'),
        allowNull: false,
        defaultValue: 'NEW'
    })
    status!: RiskStatus;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'creator_id'
    })
    creatorId!: number;

    @BelongsTo(() => User, 'creator_id')
    creator!: User;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'assignee_id'
    })
    assigneeId!: number | null;

    @BelongsTo(() => User, 'assignee_id')
    assignee!: User | null;

    @ForeignKey(() => Project)
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'project_id'
    })
    projectId!: number | null;

    @BelongsTo(() => Project)
    project!: Project | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        defaultValue: null
    })
    resolution!: string | null;

    @Column({
        type: DataType.TEXT,
        allowNull: true,
        field: 'ai_summary'
    })
    aiSummary?: string;

    @HasMany(() => RiskMitigationPlan)
    mitigationPlans!: RiskMitigationPlan[];

    @HasMany(() => RiskComment)
    comments!: RiskComment[];

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
