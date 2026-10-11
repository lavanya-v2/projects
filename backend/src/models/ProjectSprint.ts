import {
    Table, Column, Model, DataType, ForeignKey, BelongsTo,
} from 'sequelize-typescript';
import { Project } from './Project';

@Table({ tableName: 'project_sprints', timestamps: true })
export class ProjectSprint extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
    id!: number;

    @ForeignKey(() => Project)
    @Column({ type: DataType.INTEGER, allowNull: false, field: 'project_id' })
    projectId!: number;

    @BelongsTo(() => Project)
    project!: Project;

    @Column({ type: DataType.STRING(255), allowNull: false })
    name!: string;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'start_date' })
    startDate?: string;

    @Column({ type: DataType.DATEONLY, allowNull: true, field: 'end_date' })
    endDate?: string;

    @Column({ type: DataType.STRING(32), allowNull: false, defaultValue: 'excel' })
    source!: 'excel' | 'manual' | 'kanban_cycle';

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    @Column({ type: DataType.DATE, defaultValue: DataType.NOW, field: 'updated_at' })
    updatedAt!: Date;
}
