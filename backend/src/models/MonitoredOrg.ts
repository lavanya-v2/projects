import { Table, Column, Model, DataType } from 'sequelize-typescript';

/**
 * Allowlist of customer Claude organizations we're permitted to monitor. The
 * platform is multi-customer, so ingest is accepted only for an ENABLED org.
 * A push from an unseen org auto-creates a DISABLED ('pending') row so an admin
 * can review + enable it — nothing is stored until then. This is how "monitor
 * only the customer-provided license" is enforced server-side: the org uuid comes
 * from the machine's current Claude account (~/.claude.json), never its tokens.
 */
@Table({
    tableName: 'monitored_org',
    timestamps: false,
})
export class MonitoredOrg extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.BIGINT })
    id!: number;

    /** Claude organizationUuid (oauthAccount.organizationUuid). */
    @Column({ type: DataType.STRING(64), allowNull: false, unique: true, field: 'org_uuid' })
    orgUuid!: string;

    /** Human label (organizationName), captured for the admin screen. */
    @Column({ type: DataType.STRING(160), allowNull: true, field: 'org_name' })
    orgName!: string | null;

    @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'enabled' })
    enabled!: boolean;

    /**
     * License economics for the VALUE view (ADDENDUM 6). Both nullable — when unset,
     * the report uses the global benchmark (config.collector.defaultLicenseType /
     * defaultSeatMonthlyUsd) and labels the number as an assumption. Set per org when
     * a customer's real seat cost is known.
     */
    @Column({ type: DataType.STRING(12), allowNull: true, field: 'license_type' })
    licenseType!: 'seat' | 'api' | null;

    @Column({ type: DataType.FLOAT, allowNull: true, field: 'seat_monthly_usd' })
    seatMonthlyUsd!: number | null;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'first_seen_at' })
    firstSeenAt!: Date;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;
}
