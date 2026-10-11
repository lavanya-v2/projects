import { describe, it, expect } from 'vitest';
import { redactPii, redactPiiDetailed, redactIfEnabled } from '../piiRedactor';

describe('piiRedactor — positive cases', () => {
    it('masks email addresses', () => {
        expect(redactPii('Contact jane.doe@customer.com about the export'))
            .toBe('Contact [email] about the export');
    });

    it('masks US phone numbers in several formats', () => {
        expect(redactPii('Call 555-867-5309 today')).toBe('Call [phone] today');
        expect(redactPii('Call (415) 555-1234 today')).toBe('Call [phone] today');
        expect(redactPii('Call 415.555.1234 today')).toBe('Call [phone] today');
    });

    it('masks SSNs', () => {
        expect(redactPii('SSN 123-45-6789 on file')).toBe('SSN [ssn] on file');
    });

    it('masks a Luhn-valid card number', () => {
        // 4111 1111 1111 1111 is the canonical Visa test number.
        expect(redactPii('Card 4111111111111111 declined')).toBe('Card [card] declined');
    });

    it('masks street addresses', () => {
        expect(redactPii('Site visit at 42 Oak Street')).toBe('Site visit at [address]');
        expect(redactPii('Deliver to 1600 Pennsylvania Ave')).toBe('Deliver to [address]');
    });

    it('masks keyword-anchored account numbers', () => {
        expect(redactPii('Policy number 99321456 lapsed')).toBe('Policy [account-no] lapsed');
        expect(redactPii('Account 4455661 closed')).toBe('Account [account-no] closed');
        // NOT "Policy number AB-99321" — that is Jira-key shaped and is protected
        // upstream by design. A ticket key must never be redacted.
    });

    it('masks honorific- and person-context names', () => {
        expect(redactPii('Escalated by Dr. Patel')).toBe('Escalated by [name]');
        expect(redactPii('customer Jane Smith refund')).toBe('customer [name] refund');
    });

    it('reports which categories fired', () => {
        const r = redactPiiDetailed('Email a@b.com or call 555-867-5309');
        expect(r.changed).toBe(true);
        expect(r.hits.email).toBe(1);
        expect(r.hits.phone).toBe(1);
    });
});

// The important half: things that must survive untouched.
describe('piiRedactor — negative cases (false-positive guards)', () => {
    const untouched = [
        'ABC-123 fix the login redirect',
        'LOSAI-6232 spillover into next sprint',
        'Deployed on 2026-07-31',
        'Sync failed at 2026-07-31T10:15:00Z',
        'Upgrade to v2.14.3',
        'Bump 1.0.0-rc1 to stable',
        'Estimated 8 SP for this story',
        'Spent 3.5 hrs on investigation',
        'Q3 2026 roadmap item',
        'Payment Gateway Service returns 500',
        'Prod Bug in the export pipeline',
        'Refactor the St Louis region mapping',
        'Order of operations bug in the parser',
    ];

    for (const input of untouched) {
        it(`leaves "${input}" unchanged`, () => {
            expect(redactPii(input)).toBe(input);
        });
    }

    it('treats "Dr Smith" as a name, never as a street address', () => {
        // The address rule requires a leading house number, which is what
        // disambiguates Dr (Drive) from Dr (Doctor).
        const r = redactPiiDetailed('Dr Smith review of the schema');
        expect(r.hits.address).toBeUndefined();
        expect(r.text).toBe('[name] review of the schema');
    });

    it('does not treat a bare digit run as a phone number', () => {
        expect(redactPii('Build 4155551234 completed')).toBe('Build 4155551234 completed');
    });

    it('does not treat a non-Luhn digit run as a card', () => {
        const input = 'Batch 1234567890123456 processed';
        expect(redactPii(input)).toBe(input);
    });

    it('preserves surrounding whitespace around protected tokens', () => {
        expect(redactPii('ABC-123 and DEF-456 both fail'))
            .toBe('ABC-123 and DEF-456 both fail');
    });
});

// Drawn verbatim from 20,820 real CCMH ticket titles. Every one of these was
// being mangled by the first version of the rules (14.3% of all titles were
// modified, essentially all false positives). These are the regression guards —
// invented test cases missed all of them.
describe('piiRedactor — real-corpus false positives', () => {
    const realTitles = [
        'API | Automation | After reassigning a to-do task from one LO to another Loan Officer (LO), ensure that all related activities are properly recorded.',
        'UI | Enhance global search to prioritize 2.0 loan numbers',
        'UI | Loan Summary tooltip cache issue',
        'UI | Loan summary Automation | Add "Interest Only" to Loan Summary',
        'API | Process LoanOfficerSubmissionEvents to get ob loan data which doesn\'t have obloanId mapped.',
        'Analyze Existing RPA Processes for Transition Needs',
        'DoNotDeploy | API | Disable subscription tracking for Pricing Exception notifications',
        'UI | Update Price on Loan Details page for Import Float pricing',
        'Document Form Pre-Population URL Format and Supported Parameters for Lead Creation',
        'Price PRO | UI | Step 1 - Review & Update Pricing Component',
        'API | Add Unit Test Cases for loan-servicing-api - 90% Code Coverage',
        'API | Optimize MRC API unit test run time (currently > 15 mins)',
        'UI|Edit configuration: When user add new category and steps and questions details , 500 error displayed on publish',
        'AD:API: comparablePropertyId and appraisalDisputeId values display "00000000-0000-0000-0000-000000000000"',
        'CLP: API: "reviewId": "00000000-0000-0000-0000-000000000000" for all loans whose reviews have been started',
    ];

    for (const title of realTitles) {
        it(`leaves untouched: ${title.slice(0, 60)}...`, () => {
            expect(redactPii(title)).toBe(title);
        });
    }

    // "Mr. Cooper" is a mortgage servicer, not a person — 22 hits in the real corpus.
    const orgTitles = [
        'Legacy | Goodbye Letter | Update Payment Date for Mr. Cooper - CCM template',
        'API | TE | Pass Mr. Cooper Loan Data Fields to Total Expert',
        'API | Mr. Cooper Data Verification',
        'Purchase Advice - Mr. Cooper',
        'Legacy | Goodbye Letter | Update Mappings for TruMark, Mutual of Omaha, and Mr Cooper',
    ];
    for (const title of orgTitles) {
        it(`treats a business name as non-PII: ${title.slice(0, 50)}...`, () => {
            expect(redactPii(title)).toBe(title);
        });
    }

    it('still redacts a genuine honorific-anchored person', () => {
        expect(redactPii('Escalated to Dr. Patel for review')).toContain('[name]');
    });

    it('still catches a real account number in mortgage-domain prose', () => {
        // Masked as [card] rather than [account-no] because this 14-digit value is
        // Luhn-valid and the card rule runs first. Either way it is redacted, which
        // is the property that matters.
        const out = redactPii('Clear invalid loan 20852303460604 and its activities');
        expect(out).not.toContain('20852303460604');
        expect(out).toMatch(/\[(card|account-no)\]/);
    });
});

describe('piiRedactor — contract', () => {
    it('is idempotent', () => {
        const input = 'Call John Doe at 555-867-5309 or jane@x.com re: 42 Oak Street';
        const once = redactPii(input);
        expect(redactPii(once)).toBe(once);
    });

    it('leaves text untouched when disabled', () => {
        const input = 'Call 555-867-5309';
        expect(redactIfEnabled(input, false)).toBe(input);
        expect(redactIfEnabled(input, true)).toBe('Call [phone]');
    });

    it('handles null and undefined', () => {
        expect(redactIfEnabled(null, true)).toBe('');
        expect(redactIfEnabled(undefined, true)).toBe('');
    });

    it('returns oversized input untouched', () => {
        const big = 'a@b.com '.repeat(2000);
        expect(redactPii(big)).toBe(big);
    });

    it('honours a category filter', () => {
        const input = 'a@b.com and 555-867-5309';
        expect(redactPii(input, { categories: ['email'] })).toBe('[email] and 555-867-5309');
    });

    it('never leaks the internal delimiter into output', () => {
        const out = redactPii('ABC-123 on 2026-07-31 for jane@x.com');
        expect(out).not.toMatch(/[]/);
        expect(out).toBe('ABC-123 on 2026-07-31 for [email]');
    });
});
