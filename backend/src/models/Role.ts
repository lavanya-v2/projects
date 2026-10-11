import { Table, Column, Model, DataType, HasMany } from 'sequelize-typescript';
import { UserRole } from './UserRole';

@Table({
    tableName: 'roles',
    timestamps: true
})
export class Role extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @Column({
        type: DataType.STRING(50),
        allowNull: false,
        unique: true
    })
    name!: string;

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    description!: string;

    @HasMany(() => UserRole)
    userRoles!: UserRole[];

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
