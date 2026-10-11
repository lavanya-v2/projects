import { Table, Column, Model, DataType } from 'sequelize-typescript';

/**
 * One row per Anthropic API call this application makes.
 *
 * Until this table existed there was no measurement of the app's own Claude spend at
 * all — `response.usage` was returned by every call and read by none of them, so cost
 * questions could only be answered by modelling. This is the meter.
 *
 * Deliberately NOT the same thing as `claude_usage_daily`, which records what our
 * engineers do in Claude Code via the collector. This records what the DSR generator
 * itself spends on report generation.
 *
 * Attribution ids are plain integers rather than declared foreign keys, matching the
 * `pricing_version_id` treatment in ClaudeUsageDaily. Billing history should neither
 * cascade-delete when a project is removed nor block that removal, and the table stays
 * trivially droppable if this instrumentation is retired.
 */
@Table({
    tableName: 'ai_call_usage',
    timestamps: false,
    indexes: [
        { fields: ['created_at'] },
        { fields: ['call_site'] },
        { fields: ['project_id'] },
    ],
})
export class AiCallUsage extends Model {
    @Column({ primaryKey: true, autoIncrement: true, type: DataType.BIGINT })
    id!: number;

    @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW, field: 'created_at' })
    createdAt!: Date;

    /**
     * Which prompt made the call — e.g. 'daily-dsr', 'weekly-summary', 'risk-summary'.
     * This is the primary grouping dimension: it answers "which report type costs most".
     */
    @Column({ type: DataType.STRING(64), allowNull: false, field: 'call_site' })
    callSite!: string;

    /** Model id exactly as sent, e.g. 'claude-sonnet-4-5-20250929'. */
    @Column({ type: DataType.STRING(100), allowNull: false, field: 'model' })
    model!: string;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'input_tokens' })
    inputTokens!: number;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'output_tokens' })
    outputTokens!: number;

    /** Populated only if prompt caching is ever enabled; 0 today. */
    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'cache_read_tokens' })
    cacheReadTokens!: number;

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'cache_creation_tokens' })
    cacheCreationTokens!: number;

    /** Attribution, where the calling context knows it. Rollup calls have no single project. */
    @Column({ type: DataType.INTEGER, allowNull: true, field: 'project_id' })
    projectId!: number | null;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'account_id' })
    accountId!: number | null;

    @Column({ type: DataType.INTEGER, allowNull: true, field: 'program_id' })
    programId!: number | null;

    /**
     * The pricing_model version in force when the call was made. Cost is computed at
     * read time from this version's rates, so editing the rate card later does not
     * silently rewrite historical spend.
     */
    @Column({ type: DataType.BIGINT, allowNull: true, field: 'pricing_version_id' })
    pricingVersionId!: number | null;
}
