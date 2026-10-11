import { Table, Column, Model, DataType, HasMany } from 'sequelize-typescript';
import { Project } from './Project';
import { AccountTeamMember } from './AccountTeamMember';

@Table({
    tableName: 'accounts',
    timestamps: true
})
export class Account extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.INTEGER
    })
    id!: number;

    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    name!: string;

    @Column({
        type: DataType.STRING,
        allowNull: false,
        unique: true
    })
    code!: string;

    @Column({
        type: DataType.INTEGER,
        defaultValue: 30,
        field: 'red_threshold_percentage'
    })
    redThresholdPercentage!: number;

    @Column({
        type: DataType.INTEGER,
        defaultValue: 20,
        field: 'amber_threshold_percentage'
    })
    amberThresholdPercentage!: number;

    // Percentage-only rollup can fully hide a small, real number of Red projects once the
    // account is large enough (e.g. 2 Red out of 15 never crosses a 40% threshold). This floor
    // is a fixed, size-independent count — "this many simultaneous critical projects is a
    // crisis regardless of portfolio size" — layered on top of the percentage rule, not
    // replacing it. Any 1+ Red project already forces at least Amber (a fixed structural rule,
    // no separate config needed for that part); this floor only governs escalation to Red.
    @Column({
        type: DataType.INTEGER,
        defaultValue: 2,
        field: 'red_project_count_floor'
    })
    redProjectCountFloor!: number;

    // Optional. When set, Red+Amber percentage crossing this ceiling forces Red even with zero
    // actual Red projects — for accounts that want "most of the portfolio is unhealthy" to count
    // as Red too, not just "something is individually critical." Left null (default), pure-Amber
    // saturation is capped at Amber, which is the default philosophy: Red means something
    // individually critical, unless an org explicitly opts into the broader definition.
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        defaultValue: null,
        field: 'red_ceiling_bad_percentage'
    })
    redCeilingBadPercentage!: number | null;

    // The day the reporting week starts on (JS Date.getDay() convention: 0=Sun...6=Sat). The end
    // day is always (weekStartDay + 6) % 7, a fixed 7-day window. Default 5 (Friday) preserves
    // today's hardcoded Friday-Thursday cycle for every existing account until explicitly
    // changed -- required NOT NULL with a DEFAULT so Postgres backfills every existing row
    // atomically when this column is added, no separate seed step needed.
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 5,
        field: 'week_start_day'
    })
    weekStartDay!: number;

    @Column({
        type: DataType.STRING,
        allowNull: true
    })
    description!: string;

    @HasMany(() => Project)
    projects!: Project[];

    @HasMany(() => AccountTeamMember)
    teamMembers!: AccountTeamMember[];

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
