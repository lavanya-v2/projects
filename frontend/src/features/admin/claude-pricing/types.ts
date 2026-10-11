export interface RateTiers {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export interface PricingRates {
  models: Record<string, RateTiers>;
  fallback: RateTiers;
}

export interface PricingVersion {
  id: number;
  version: number;
  rates: PricingRates;
  note: string | null;
  effectiveFrom: string;
  createdAt: string;
  createdBy: string | null;
}
