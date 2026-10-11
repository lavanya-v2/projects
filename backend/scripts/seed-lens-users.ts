/**
 * Seed Lens application users.
 *
 * Creates login users for the Lens app from a list of email addresses, assigns
 * each to a given account + project, and gives them the default `member` role.
 *
 * For each input email (e.g. amitkumar.sharma@v2solutions.com):
 *   - userId (login)   = the input email itself (lowercased/trimmed)
 *   - firstName        = first token of the email local part, capitalized   -> "Amitkumar"
 *   - lastName         = last token of the email local part, capitalized    -> "Sharma"
 *   - password         = `${firstName}@CCMHV2`                               -> "Amitkumar@CCMHV2"
 *                        (plain text; the User @BeforeCreate hook bcrypt-hashes it)
 *   - email (contact)  = the matched team_members.email  (login != email)
 *
 * The matching team_members row is resolved by NAME ONLY (fuzzy). If there is no
 * confident match, or the match is ambiguous, the input is skipped (logged).
 *
 * Existing users (by login userId OR by contact email) are skipped, so the script
 * is safe to re-run.
 *
 * Usage:
 *   npx ts-node -r dotenv/config scripts/seed-lens-users.ts \
 *     --account CCMH --project LOT --emails "abc.jk@v2s.com, kas.cer@v2s.com"
 */
import 'dotenv/config';
import { Op } from 'sequelize';
import sequelize from '../src/config/connection';
import { User } from '../src/models/User';
import { TeamMember } from '../src/models/TeamMember';
import { Account } from '../src/models/Account';
import { Project } from '../src/models/Project';
import { Role } from '../src/models/Role';
import { UserRole } from '../src/models/UserRole';
import { UserPermission } from '../src/models/UserPermission';

const MATCH_THRESHOLD = 0.85;

// ---- CLI args -------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (!tok.startsWith('--')) continue;
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i++;
        } else {
            out[key] = 'true';
        }
    }
    return out;
}

function usage(): never {
    console.error(
        'Usage:\n' +
            '  npx ts-node -r dotenv/config scripts/seed-lens-users.ts \\\n' +
            '    --account <ACCOUNT_CODE> --project <PROJECT_CODE> --emails "a@x.com, b@x.com"'
    );
    process.exit(2);
}

// ---- name helpers ---------------------------------------------------------

function capitalize(s: string): string {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Strip everything except a-z0-9, lowercase. "Amit Kumar" -> "amitkumar". */
function normalizeName(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const prev = new Array(n + 1);
    const curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        curr[0] = i;
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= n; j++) prev[j] = curr[j];
    }
    return prev[n];
}

/** Similarity ratio in [0,1]; 1 = identical. */
function ratio(a: string, b: string): number {
    if (!a && !b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - levenshtein(a, b) / maxLen;
}

interface DerivedUser {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    nameKey: string; // normalized local part, e.g. "amitkumarsharma"
    displayName: string; // "Amitkumar Sharma"
}

function deriveFromEmail(rawEmail: string): DerivedUser | null {
    const email = rawEmail.trim().toLowerCase();
    if (!email) return null;
    const localPart = email.split('@')[0] || '';
    if (!localPart) return null;
    const tokens = localPart.split('.').filter(Boolean);
    const firstName = capitalize(tokens[0] || '');
    const lastName = capitalize(tokens.length > 1 ? tokens[tokens.length - 1] : '');
    if (!firstName) return null;
    const password = `${firstName}@CCMHV2`;
    return {
        email,
        firstName,
        lastName,
        password,
        nameKey: normalizeName(localPart),
        displayName: `${firstName}${lastName ? ' ' + lastName : ''}`.trim(),
    };
}

// ---- fuzzy team-member match ---------------------------------------------

interface MatchResult {
    status: 'matched' | 'none' | 'ambiguous';
    member?: TeamMember;
    candidates?: TeamMember[];
}

function matchTeamMember(derived: DerivedUser, members: TeamMember[]): MatchResult {
    const key = derived.nameKey;
    const scored = members.map((m) => {
        const memberKey = normalizeName(`${m.firstName}${m.lastName}`);
        let score = ratio(key, memberKey);
        // Boost exact / containment cases (handles extra middle tokens, ordering).
        if (memberKey === key) score = 1;
        else if (memberKey && key && (memberKey.includes(key) || key.includes(memberKey))) {
            score = Math.max(score, 0.95);
        }
        return { member: m, score };
    });

    const candidates = scored.filter((s) => s.score >= MATCH_THRESHOLD).sort((a, b) => b.score - a.score);
    if (candidates.length === 0) return { status: 'none' };
    // Treat near-equal top scores as ambiguous; a clear winner wins.
    if (candidates.length > 1 && candidates[0].score - candidates[1].score < 0.01) {
        return { status: 'ambiguous', candidates: candidates.map((c) => c.member) };
    }
    return { status: 'matched', member: candidates[0].member };
}

// ---- main -----------------------------------------------------------------

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const accountCode = args.account?.trim();
    const projectCode = args.project?.trim();
    const emailsArg = args.emails?.trim();

    if (!accountCode || !projectCode || !emailsArg) usage();

    const emails = emailsArg
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

    if (emails.length === 0) {
        console.error('No email addresses provided in --emails.');
        process.exit(2);
    }

    await sequelize.authenticate();

    const account = await Account.findOne({ where: { code: accountCode } });
    if (!account) {
        console.error(`Account with code "${accountCode}" not found.`);
        process.exit(1);
    }

    const project = await Project.findOne({ where: { code: projectCode } });
    if (!project) {
        console.error(`Project with code "${projectCode}" not found.`);
        process.exit(1);
    }
    if (project.accountId !== account.id) {
        console.error(
            `Project "${projectCode}" (account_id=${project.accountId}) does not belong to account "${accountCode}" (id=${account.id}).`
        );
        process.exit(1);
    }

    const memberRole = await Role.findOne({ where: { name: 'member' } });
    if (!memberRole) {
        console.warn('WARN: role "member" not found in roles table — users will be created without a role assignment.');
    }

    const teamMembers = await TeamMember.findAll();
    console.log(
        `Seeding ${emails.length} user(s) into ${accountCode}/${projectCode} (loaded ${teamMembers.length} team members).\n`
    );

    const tally = { created: 0, existing: 0, noMatch: 0, ambiguous: 0, errors: 0 };

    for (const email of emails) {
        try {
            const derived = deriveFromEmail(email);
            if (!derived) {
                console.log(`! Skipped ${email}: could not derive a name from the email.`);
                tally.errors++;
                continue;
            }

            const match = matchTeamMember(derived, teamMembers);
            if (match.status === 'none') {
                console.log(`- Skipped ${email}: no team member name match (derived "${derived.displayName}").`);
                tally.noMatch++;
                continue;
            }
            if (match.status === 'ambiguous') {
                const names = (match.candidates || []).map((c) => `${c.firstName} ${c.lastName}`).join(', ');
                console.log(`! Skipped ${email}: ambiguous match for "${derived.displayName}" [${names}].`);
                tally.ambiguous++;
                continue;
            }

            const teamMember = match.member!;
            const contactEmail = teamMember.email;

            const existing = await User.findOne({
                where: { [Op.or]: [{ userId: email }, { email: contactEmail }] },
            });
            if (existing) {
                console.log(`- Skipped ${email}: user already exists (login or email "${contactEmail}").`);
                tally.existing++;
                continue;
            }

            await sequelize.transaction(async (transaction) => {
                const newUser = await User.create(
                    {
                        userId: email,
                        firstName: derived.firstName,
                        lastName: derived.lastName,
                        password: derived.password, // hashed by @BeforeCreate hook
                        email: contactEmail,
                        role: 'USER',
                        isActive: true,
                    } as any,
                    { transaction }
                );

                if (memberRole) {
                    await UserRole.create(
                        { userId: newUser.id, roleId: memberRole.id } as any,
                        { transaction }
                    );
                }

                await UserPermission.create(
                    {
                        userId: newUser.id,
                        accountId: account.id,
                        projectIds: [project.id],
                        isPrimary: false,
                    } as any,
                    { transaction }
                );
            });

            console.log(
                `✓ Created ${email} (${derived.displayName}) email=${contactEmail} → ${accountCode}/${projectCode}`
            );
            tally.created++;
        } catch (err) {
            console.error(`! Error processing ${email}:`, err instanceof Error ? err.message : err);
            tally.errors++;
        }
    }

    console.log(
        `\nDone. created=${tally.created} skipped-existing=${tally.existing} ` +
            `skipped-no-match=${tally.noMatch} skipped-ambiguous=${tally.ambiguous} errors=${tally.errors}`
    );
}

main()
    .catch((err) => {
        console.error('Fatal:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await sequelize.close();
        } catch {
            /* ignore */
        }
    });
