import { logger } from './logger';

/**
 * Validates AI-generated content for temporal hallucinations
 * Scans text for suspicious duration claims and flags potential issues
 */
export class TemporalValidator {
    // Patterns that indicate temporal claims
    private readonly TEMPORAL_PATTERNS = [
        /(\d+)\s+(day|days|week|weeks|month|months)/gi,
        /(several|multiple|many)\s+(days|weeks|months)/gi,
        /(for|since|over|across)\s+(\d+|several|multiple)\s+(days?|weeks?|months?)/gi,
        /(consecutive|continuous|ongoing)\s+(\d+|several)?\s*(days?|weeks?|months?)/gi,
        /(three|four|five|six|seven|eight|nine|ten)\s+(consecutive)?\s*(days?|weeks?|months?)/gi
    ];

    // Suspicious phrases that often indicate hallucination
    private readonly SUSPICIOUS_PHRASES = [
        'for three consecutive weeks',
        'for several weeks',
        'ongoing for weeks',
        'blocked for months',
        'persisting for weeks',
        'over multiple weeks',
        'for the past weeks',
        'for many days'
    ];

    /**
     * Validate AI-generated text for temporal accuracy
     * @param text AI-generated content to validate
     * @param reportType Type of report (for context in warnings)
     * @returns Validation result with warnings
     */
    validateTemporalClaims(text: string, reportType: string = 'unknown'): TemporalValidationResult {
        if (!text || typeof text !== 'string') {
            return {
                isValid: true,
                warnings: [],
                suspiciousClaims: []
            };
        }

        const warnings: string[] = [];
        const suspiciousClaims: TemporalClaim[] = [];

        // Check for suspicious phrases
        for (const phrase of this.SUSPICIOUS_PHRASES) {
            if (text.toLowerCase().includes(phrase.toLowerCase())) {
                warnings.push(`Found suspicious phrase: "${phrase}"`);
                suspiciousClaims.push({
                    claim: phrase,
                    severity: 'high',
                    reason: 'Common hallucination pattern detected'
                });
            }
        }

        // Extract all temporal claims
        for (const pattern of this.TEMPORAL_PATTERNS) {
            const matches = text.matchAll(pattern);
            for (const match of matches) {
                const fullMatch = match[0];

                // Check if this is a suspicious duration
                if (this.isSuspiciousDuration(fullMatch)) {
                    suspiciousClaims.push({
                        claim: fullMatch,
                        severity: 'medium',
                        reason: 'Duration claim requires verification',
                        context: this.extractContext(text, match.index || 0)
                    });
                }
            }
        }

        // Log warnings if found
        if (suspiciousClaims.length > 0) {
            logger.warn(
                `Temporal validation found ${suspiciousClaims.length} suspicious claim(s) in ${reportType} report: ${JSON.stringify(suspiciousClaims)}`,
                'TemporalValidator'
            );
        }

        return {
            isValid: suspiciousClaims.filter(c => c.severity === 'high').length === 0,
            warnings,
            suspiciousClaims
        };
    }

    /**
     * Check if a duration is suspicious (likely hallucinated)
     */
    private isSuspiciousDuration(claim: string): boolean {
        const lowerClaim = claim.toLowerCase();

        // Multi-week claims are often hallucinated
        if (lowerClaim.includes('week')) {
            const weekMatch = claim.match(/(\d+)\s+weeks?/i);
            if (weekMatch) {
                const numWeeks = parseInt(weekMatch[1]);
                if (numWeeks >= 2) {
                    return true; // Claims of 2+ weeks are suspicious
                }
            }
            // Phrases like "several weeks", "multiple weeks"
            if (/(several|multiple|many)\s+weeks?/i.test(lowerClaim)) {
                return true;
            }
        }

        // "Consecutive" is often added without verification
        if (lowerClaim.includes('consecutive')) {
            return true;
        }

        // Large day counts (>7 days = 1 week, should be expressed as such)
        const dayMatch = claim.match(/(\d+)\s+days?/i);
        if (dayMatch) {
            const numDays = parseInt(dayMatch[1]);
            if (numDays > 7) {
                return true; // Should have been expressed in weeks
            }
        }

        return false;
    }

    /**
     * Extract surrounding context for a match
     */
    private extractContext(text: string, index: number, contextLength: number = 50): string {
        const start = Math.max(0, index - contextLength);
        const end = Math.min(text.length, index + contextLength);
        return '...' + text.substring(start, end) + '...';
    }

    /**
     * Sanitize AI output by removing or flagging suspicious temporal claims
     * @param text AI-generated content
     * @param mode 'flag' adds warnings, 'remove' strips suspicious claims
     */
    sanitizeTemporalClaims(text: string, mode: 'flag' | 'remove' = 'flag'): string {
        if (!text) return text;

        let sanitized = text;

        if (mode === 'remove') {
            // Replace suspicious phrases with safer alternatives
            const replacements: Record<string, string> = {
                'for three consecutive weeks': 'currently blocked',
                'for several weeks': 'for an extended period',
                'ongoing for weeks': 'ongoing',
                'blocked for months': 'long-term blocker',
                'persisting for weeks': 'persistent issue',
                'over multiple weeks': 'recurring across weeks'
            };

            for (const [suspicious, safe] of Object.entries(replacements)) {
                const regex = new RegExp(suspicious, 'gi');
                sanitized = sanitized.replace(regex, safe);
            }
        } else {
            // Flag mode - add markers
            for (const phrase of this.SUSPICIOUS_PHRASES) {
                const regex = new RegExp(phrase, 'gi');
                sanitized = sanitized.replace(regex, `[VERIFY: ${phrase}]`);
            }
        }

        return sanitized;
    }

    /**
     * Generate a validation report for logging/debugging
     */
    generateValidationReport(validationResult: TemporalValidationResult): string {
        if (validationResult.isValid && validationResult.suspiciousClaims.length === 0) {
            return 'No temporal accuracy issues detected.';
        }

        const lines: string[] = ['Temporal Validation Report:', ''];

        if (!validationResult.isValid) {
            lines.push('⚠️  VALIDATION FAILED - High-severity issues detected');
        }

        if (validationResult.warnings.length > 0) {
            lines.push('Warnings:');
            validationResult.warnings.forEach(w => lines.push(`  - ${w}`));
            lines.push('');
        }

        if (validationResult.suspiciousClaims.length > 0) {
            lines.push('Suspicious Claims:');
            validationResult.suspiciousClaims.forEach(claim => {
                lines.push(`  [${claim.severity.toUpperCase()}] ${claim.claim}`);
                lines.push(`    Reason: ${claim.reason}`);
                if (claim.context) {
                    lines.push(`    Context: ${claim.context}`);
                }
            });
        }

        return lines.join('\n');
    }
}

export interface TemporalValidationResult {
    isValid: boolean;
    warnings: string[];
    suspiciousClaims: TemporalClaim[];
}

export interface TemporalClaim {
    claim: string;
    severity: 'low' | 'medium' | 'high';
    reason: string;
    context?: string;
}

export const temporalValidator = new TemporalValidator();
