/**
 * Cleans a block of risk/bullet text into plain lines, stripping emoji, markdown
 * bullet markers, and bold formatting. Returns an array of non-empty lines.
 */
export const stripRiskLines = (text: string): string[] =>
    text
        .split('\n')
        .map(line =>
            line
                .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
                .replace(/^[\s*\-•]+/, '')
                .replace(/\*\*/g, '')
                .trim(),
        )
        .filter(Boolean);
