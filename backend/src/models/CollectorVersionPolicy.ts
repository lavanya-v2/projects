import { Table, Column, Model, DataType } from 'sequelize-typescript';

/**
 * Fleet-wide minimum collector version, enforced at ingest (ADDENDUM 22). A
 * single mutable row, same shape as IngestRateLimitSetting — no versioning
 * needed, this only affects future ingest decisions, never past rows.
 *
 * Both columns null = no enforcement (today's behavior: `unknown-collector` /
 * `ungated-collector` only FLAG). Set both to open a grace window: `enforceAfter`
 * lets a rollout land everywhere before anything starts rejecting, so nobody's
 * data goes dark the moment a stale-collector fix ships — see ingestController's
 * enforcement check for how these two columns are read together.
 */
@Table({
    tableName: 'collector_version_policy',
    timestamps: false,
})
export class CollectorVersionPolicy extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.BIGINT,
    })
    id!: number;

    /** Reports below this version are rejected once `enforceAfter` has passed. Null = no floor. */
    @Column({
        type: DataType.STRING,
        allowNull: true,
        field: 'min_enforced_version',
    })
    minEnforcedVersion!: string | null;

    /** When enforcement takes effect. Null = never (flag-only, regardless of minEnforcedVersion). */
    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'enforce_after',
    })
    enforceAfter!: Date | null;

    @Column({
        type: DataType.DATE,
        allowNull: false,
        defaultValue: DataType.NOW,
        field: 'updated_at',
    })
    updatedAt!: Date;
}
