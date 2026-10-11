export interface SpendBucket {
    key: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
}

export interface AiSpendSummary {
    from: string;
    to: string;
    totals: SpendBucket;
    byCallSite: SpendBucket[];
    byModel: SpendBucket[];
    byDay: SpendBucket[];
    /** True when at least one row could not be priced (no rate card configured). */
    unpriced: boolean;
}
