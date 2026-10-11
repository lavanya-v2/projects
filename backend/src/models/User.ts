import { Table, Column, Model, DataType, HasMany, BeforeCreate, BeforeUpdate } from 'sequelize-typescript';
import bcrypt from 'bcrypt';
import { UserPermission } from './UserPermission';
import { UserRole } from './UserRole';

@Table({
    tableName: 'users',
    timestamps: true
})
export class User extends Model {
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
        unique: true,
        field: 'user_id'
    })
    userId!: string;

    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    password!: string;

    @Column({
        type: DataType.ENUM('USER', 'SUPERUSER'),
        allowNull: false,
        defaultValue: 'USER'
    })
    role!: 'USER' | 'SUPERUSER';

    @Column({
        type: DataType.STRING(255),
        allowNull: true
    })
    email!: string | null;

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active'
    })
    isActive!: boolean;

    @HasMany(() => UserPermission)
    permissions!: UserPermission[];

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

    // Hash password before saving
    @BeforeCreate
    @BeforeUpdate
    static async hashPassword(instance: User) {
        if (instance.changed('password')) {
            const salt = await bcrypt.genSalt(10);
            instance.password = await bcrypt.hash(instance.password, salt);
        }
    }

    // Instance method to check password
    async checkPassword(password: string): Promise<boolean> {
        return bcrypt.compare(password, this.password);
    }
}
