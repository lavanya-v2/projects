/**
 * Shared .eml helpers. Extracted from generateTwiceWeeklyEmail.ts so the app (Custom Range
 * Report download) and the twice-weekly script build drafts identically. The X-Unsent header
 * makes Outlook open the file as an editable draft.
 */

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function buildEmlContent(
    from: string,
    to: string,
    cc: string,
    subject: string,
    htmlBody: string
): string {
    let eml = 'From: ' + from + '\r\n';
    if (to) {
        eml += 'To: ' + to + '\r\n';
    }
    if (cc) {
        eml += 'CC: ' + cc + '\r\n';
    }
    eml += 'Subject: ' + subject + '\r\n';
    eml += 'MIME-Version: 1.0\r\n';
    eml += 'Content-Type: text/html; charset="utf-8"\r\n';
    eml += 'X-Unsent: 1\r\n';
    eml += '\r\n';
    eml += htmlBody + '\r\n';

    return eml;
}
