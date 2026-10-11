import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from './User';

/**
 * One row per user per local day of Claude Code usage, pushed by the machine
 * collector (tools/claude-usage-collector). The payload is CONTENT-FREE — counts,
 * token totals per model, category signal tallies and tool/skill/MCP usage counts
 * only. No prompt text, code, file paths, project names, branches or session ids
 * are ever stored (engineers use the customer's Claude license — that boundary is
 * absolute). See ClaudeUsageMetrics for the exact shape.
 *
 * Ingest is an idempotent upsert keyed by the unique (user_id, day) index, so the
 * collector may safely re-send a day. Derived scalars (total_prompts, avg_score,
 * vibe_index) are recomputed server-side on every ingest for fast list queries.
 */

/** The content-free metrics blob the collector sends and we persist verbatim. */
export interface ClaudeUsageMetrics {
    schemaVersion: number;
    collectorVersion: string;
    prompts: { total: number; scored: number; acks: number };
    scores: { good: number; ok: number; poor: number; sum: number };
    signals: {
        no_context: number;
        vague: number;
        rework: number;
        unclear_referent: number;
        very_short: number;
        short: number;
    };
    tokensByModel: Record<string, {
        input: number;
        output: number;
        cache_write: number;
        cache_read: number;
    }>;
    activity: { sessions: number; distinctProjects: number };
    structure: {
        skillInvocations: number;
        mcpCalls: number;
        builtinTools: Record<string, number>;
        freeTextTurns: number;
        toolAssistedTurns: number;
        // schemaVersion >= 2 (collector >= 1.1.0). Absent on older rows → treated as 0.
        planModeTurns?: number;
        acceptEditsTurns?: number;
        // schemaVersion >= 3 (collector >= 1.2.0). Absent on older rows → treated as 0.
        // editsAccepted/editsRejected: best-effort accept/reject signal for Edit/Write-family
        // tool calls. distinctMcpServers: a COUNT of unique MCP servers used — never names.
        editsAccepted?: number;
        editsRejected?: number;
        distinctMcpServers?: number;
    };
    // schemaVersion >= 3. Prompt category TALLIES only — never the prompt text.
    promptTypes?: PromptTypeTally;
    // ---------------------------------------------------------------------
    // schemaVersion >= 4 (collector >= 1.5.0) — efficiency signals. Absent on
    // every earlier row and NOT backfillable, so each block is optional and
    // every reader must treat "missing" as "not measured", never as zero.
    // All of these are counts/sums over a day, exactly like the blocks above:
    // no session ids, no timestamps, no paths.
    // ---------------------------------------------------------------------
    /** Context lost to compaction. droppedTokens is Σ(preTokens − postTokens) per event. */
    context?: {
        compactions: number;
        autoCompactions: number;
        manualCompactions: number;
        droppedTokens: number;
        preTokensSum: number;
        compactionMs: number;
        sessionsCompacted: number;
    };
    /** Distribution of how much work each session carried. Buckets, never per-session rows. */
    sessionShape?: {
        sizeBuckets: { s1_5: number; s6_20: number; s21_100: number; s100plus: number };
        durationBuckets: { lt15m: number; m15_60: number; h1_4: number; h4plus: number };
    };
    /** Working on several sessions at once. Derived from time spans that never leave the machine. */
    concurrency?: {
        maxConcurrent: number;
        overlappingSessions: number;
        switches: number;
        switchesUnder5m: number;
    };
    /** How long between Claude finishing and the next scored prompt. Bucket counts only. */
    pace?: {
        gapBuckets: { lt10s: number; s10_60: number; m1_5: number; m5_30: number; gt30m: number };
    };
    /** Which model answered which kind of work — the basis for a model-fit suggestion. */
    promptTypesByModel?: Record<string, PromptTypeTally>;
}

/** Prompt category tallies. Shared by the day total and the per-model cross-tab. */
export interface PromptTypeTally {
    debugging: number;
    codeGen: number;
    refactor: number;
    review: number;
    explain: number;
    other: number;
}

@Table({
    tableName: 'claude_usage_daily',
    timestamps: true,
    // Map the auto createdAt/updatedAt to the snake_case columns the migration
    // created (created_at/updated_at). Every other column already sets `field:`
    // explicitly, so this only affects the timestamp columns.
    underscored: true,
})
export class ClaudeUsageDaily extends Model {
    @Column({
        primaryKey: true,
        autoIncrement: true,
        type: DataType.BIGINT,
    })
    id!: number;

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: 'user_id',
    })
    userId!: number;

    @BelongsTo(() => User)
    user!: User;

    /** Local calendar day on the engineer's machine, YYYY-MM-DD. */
    @Column({
        type: DataType.DATEONLY,
        allowNull: false,
        field: 'day',
    })
    day!: string;

    /** The full content-free payload (validated on ingest). */
    @Column({
        type: DataType.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'metrics',
    })
    metrics!: ClaudeUsageMetrics;

    /** Derived scalars — recomputed server-side on each ingest for fast lists. */
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'total_prompts',
    })
    totalPrompts!: number;

    @Column({
        type: DataType.FLOAT,
        allowNull: false,
        defaultValue: 0,
        field: 'avg_score',
    })
    avgScore!: number;

    /** 0-100; higher = more "vibe coding" (low structure, high rework/vagueness). */
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'vibe_index',
    })
    vibeIndex!: number;

    @Column({
        type: DataType.STRING(20),
        allowNull: true,
        field: 'collector_version',
    })
    collectorVersion!: string | null;

    /**
     * The pricing_model version this row's cost is computed with. Stamped at first
     * ingest and never changed, so historical cost is frozen to the rates that
     * applied then (and the row references exactly which model was used).
     */
    @Column({
        type: DataType.BIGINT,
        allowNull: true,
        field: 'pricing_version_id',
    })
    pricingVersionId!: number | null;

    /** Customer org (Claude organizationUuid) this row was attributed to. */
    @Column({
        type: DataType.STRING(64),
        allowNull: true,
        field: 'org_uuid',
    })
    orgUuid!: string | null;

    /** Integrity (ADDENDUM 5): 'ok' or 'flagged'. Impossible rows are rejected, never stored. */
    @Column({
        type: DataType.STRING(12),
        allowNull: false,
        defaultValue: 'ok',
        field: 'integrity_status',
    })
    integrityStatus!: string;

    /** Anomaly flags [{code, detail, severity}] surfaced in the admin Data Quality view. */
    @Column({
        type: DataType.JSONB,
        allowNull: false,
        defaultValue: [],
        field: 'integrity_flags',
    })
    integrityFlags!: Array<{ code: string; detail: string; severity: string }>;

    /**
     * How the reporting machine is triggered, as read back from its own OS:
     * 'scheduler' (a real weekday OS job), 'startup' (login only), 'hook'
     * (Claude session end only), 'none'.
     *
     * This exists because a missing row is ambiguous — "their schedule is broken"
     * and "they took the day off" look identical — and that ambiguity once hid a
     * fleet-wide scheduling gap. Nullable: rows from collectors older than the
     * scheduler rollout simply have no opinion.
     */
    @Column({
        type: DataType.STRING(16),
        allowNull: true,
        field: 'trigger_tier',
    })
    triggerTier!: string | null;

    /**
     * Consecutive runs this machine suppressed because it detected a VPN.
     *
     * Nothing is transmitted while the VPN gate is closed, so this can only ever
     * arrive on a run that got through — it is the record of a silence, reported
     * after the fact. It exists because "no data because they were inside a
     * customer network all fortnight" and "no data because the agent is broken"
     * are otherwise the same missing row. Nullable: older collectors have no
     * opinion, and a run that was never deferred reports 0.
     */
    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: 'vpn_deferrals',
    })
    vpnDeferrals!: number | null;

    /** Server receive time (audit / late-submission signal). */
    @Column({
        type: DataType.DATE,
        allowNull: true,
        field: 'received_at',
    })
    receivedAt!: Date | null;
}
