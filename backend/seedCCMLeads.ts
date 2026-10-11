/**
 * Seeder script: Create lead users under the CCM account.
 *
 * - Lives outside backend/src/seeders/ on purpose (one-shot script, not part of the
 *   sequelize-cli migration timeline).
 * - Mirrors the DB-insert approach used by existing seeders (see
 *   src/seeders/20260216000001-seed-admin-ganeshan.js for the reference pattern):
 *     1. Lookup CCM account
 *     2. Lookup project IDs from codes
 *     3. Lookup the 'lead' role
 *     4. For each row: skip if user already exists, otherwise create user +
 *        user_roles entry + user_permissions row.
 * - Idempotent: re-running will skip users that already exist and print them
 *   in the result summary.
 *
 * Run with:
 *   cd backend && npx ts-node seedCCMLeads.ts
 */

import 'dotenv/config';
import sequelize from './src/config/connection';
import { Op } from 'sequelize';
import { Account } from './src/models/Account';
import { Project } from './src/models/Project';
import { User } from './src/models/User';
import { Role } from './src/models/Role';
import { UserRole } from './src/models/UserRole';
import { UserPermission } from './src/models/UserPermission';

interface SeedRow {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    projectCodes: string[];
}

// IMPORTANT: passwords transcribed from the source table. Verify before sharing.
const USERS: SeedRow[] = [
    { firstName: 'Sagar',       lastName: 'Pawar',         email: 'sagar.pawar@v2solutions.com',        password: 'G7@kP2!xL9#q', projectCodes: ['LOT'] },
    { firstName: 'Harikrishna', lastName: 'Kanta',         email: 'harikrishna.kanta@v2solutions.com',  password: 'mQ9#Lr5&Z2@t', projectCodes: ['LOWA'] },
    { firstName: 'Shubhangi',   lastName: 'Pawar',         email: 'shubhangi.pawar@v2solutions.com',    password: 'T4!zX8@pR6#n', projectCodes: ['LOSAI'] },
    { firstName: 'Peyush',      lastName: 'K',             email: 'peyush.k@v2solutions.com',           password: 'aR7$yN2!K9@w', projectCodes: ['EXP'] },
    { firstName: 'Vishal',      lastName: 'Laghate',       email: 'vishal.laghate@v2solutions.com',     password: 'Z8#kLp3@M5!x', projectCodes: ['EXP'] },
    { firstName: 'Pravin',      lastName: 'Kambari',       email: 'pravin.kambari@v2solutions.com',     password: 'uY5!mQ9#T2@r', projectCodes: ['EXP', 'LOT', 'LOWA', 'SC'] },
    { firstName: 'Mahesh',      lastName: 'Sankaran',      email: 'mahesh.sankaran@v2solutions.com',    password: 'P2@xR8!kN7#q', projectCodes: ['SC'] },
    { firstName: 'Vidyadhar',   lastName: 'Dighe',         email: 'vidyadhar.dighe@v2solutions.com',    password: 'wN7#T4@zK9!p', projectCodes: ['PRO', 'EXP'] },
    { firstName: 'Pravin',      lastName: 'Dongare',       email: 'pravin.dongare@v2solutions.com',     password: 'K9!pX3@rL6#t', projectCodes: ['PRO', 'EXP', 'MP', 'WO'] },
    { firstName: 'Virendra',    lastName: 'Lad',           email: 'virendra.lad@v2solutions.com',       password: 'm5@Z8#LpR2!x', projectCodes: ['PRO'] },
    { firstName: 'Nirav',       lastName: 'Parekh',        email: 'nirav.parekh@v2solutions.com',       password: 'R2!kT7@yQ9#n', projectCodes: ['LP'] },
    { firstName: 'Sakshee',     lastName: 'Sharma',        email: 'sakshee.sharma@v2solutions.com',     password: 'qP8#N4!xZ6@r', projectCodes: ['WO'] },
    { firstName: 'Gargi',       lastName: 'Sakhare',       email: 'gargi.sakhare@v2solutions.com',      password: 'X3@rM9!kT7#p', projectCodes: ['AST'] },
    { firstName: 'Jayant',      lastName: 'Dharmadhikari', email: 'jayant.d@v2solutions.com',           password: 'L7#pT2@zN5!x', projectCodes: ['MP'] },
];

type Outcome = 'created' | 'skipped' | 'failed';

interface ResultRow {
    email: string;
    name: string;
    outcome: Outcome;
    detail: string;
}

async function main() {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected.\n');

    // 1. Find CCM account (match by name OR code, case-insensitive)
    const account = await Account.findOne({
        where: {
            [Op.or]: [
                { name: { [Op.iLike]: '%CCM%' } },
                { code: { [Op.iLike]: '%CCM%' } },
            ],
        },
    });

    if (!account) {
        console.error('CCM account not found in DB. Aborting.');
        await sequelize.close();
        process.exit(1);
    }
    console.log(`CCM account: id=${account.id} name="${account.name}" code="${account.code}"\n`);

    // 2. Find the 'lead' role
    const leadRole = await Role.findOne({ where: { name: 'lead' } });
    if (!leadRole) {
        console.error("'lead' role not found. Run 20260306000001-seed-roles.js first.");
        await sequelize.close();
        process.exit(1);
    }
    console.log(`Lead role: id=${leadRole.id}\n`);

    // 3. Resolve all project codes upfront so we can warn on missing ones once.
    const allCodesNeeded = Array.from(new Set(USERS.flatMap(u => u.projectCodes)));
    const projects = await Project.findAll({
        where: {
            accountId: account.id,
            code: { [Op.in]: allCodesNeeded },
        },
    });
    const codeToProjectId = new Map<string, number>();
    for (const p of projects) codeToProjectId.set(p.code.toUpperCase(), p.id);

    const missingCodes = allCodesNeeded.filter(c => !codeToProjectId.has(c.toUpperCase()));
    if (missingCodes.length > 0) {
        console.warn(`Warning: project codes not found under CCM and will be skipped per-user: ${missingCodes.join(', ')}\n`);
    }

    // 4. Process each user inside its own transaction (so a single bad row
    //    doesn't poison the others, and a partial create gets rolled back).
    const results: ResultRow[] = [];

    for (const row of USERS) {
        const fullName = `${row.firstName} ${row.lastName}`;
        try {
            const existing = await User.findOne({ where: { userId: row.email } });
            if (existing) {
                results.push({ email: row.email, name: fullName, outcome: 'skipped', detail: `already exists (id=${existing.id})` });
                continue;
            }

            const resolvedProjectIds: number[] = [];
            const unresolvedCodes: string[] = [];
            for (const code of row.projectCodes) {
                const pid = codeToProjectId.get(code.toUpperCase());
                if (pid) resolvedProjectIds.push(pid);
                else unresolvedCodes.push(code);
            }

            await sequelize.transaction(async (t) => {
                // The User model has a BeforeCreate hook that hashes the password.
                const newUser = await User.create({
                    firstName: row.firstName,
                    lastName: row.lastName,
                    userId: row.email,
                    password: row.password,
                    role: 'USER',
                    isActive: true,
                }, { transaction: t });

                await UserRole.create({
                    userId: newUser.id,
                    roleId: leadRole.id,
                }, { transaction: t });

                await UserPermission.create({
                    userId: newUser.id,
                    accountId: account.id,
                    projectIds: resolvedProjectIds,
                }, { transaction: t });

                const detailParts = [
                    `id=${newUser.id}`,
                    `projects=[${row.projectCodes.join(',')}]`,
                ];
                if (unresolvedCodes.length > 0) {
                    detailParts.push(`UNRESOLVED=[${unresolvedCodes.join(',')}]`);
                }
                results.push({ email: row.email, name: fullName, outcome: 'created', detail: detailParts.join(' ') });
            });
        } catch (err: any) {
            results.push({ email: row.email, name: fullName, outcome: 'failed', detail: err.message });
        }
    }

    // 5. Print results table
    console.log('\n============================================================');
    console.log('SEED RESULTS');
    console.log('============================================================');

    const created = results.filter(r => r.outcome === 'created');
    const skipped = results.filter(r => r.outcome === 'skipped');
    const failed = results.filter(r => r.outcome === 'failed');

    const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);

    console.log('\nCreated (' + created.length + '):');
    if (created.length === 0) console.log('  (none)');
    for (const r of created) console.log('  ' + pad(r.email, 38) + ' ' + pad(r.name, 24) + ' ' + r.detail);

    console.log('\nSkipped — already existed (' + skipped.length + '):');
    if (skipped.length === 0) console.log('  (none)');
    for (const r of skipped) console.log('  ' + pad(r.email, 38) + ' ' + pad(r.name, 24) + ' ' + r.detail);

    console.log('\nFailed (' + failed.length + '):');
    if (failed.length === 0) console.log('  (none)');
    for (const r of failed) console.log('  ' + pad(r.email, 38) + ' ' + pad(r.name, 24) + ' ' + r.detail);

    console.log('\n============================================================');
    console.log(`Totals: ${created.length} created, ${skipped.length} skipped, ${failed.length} failed`);
    console.log('============================================================\n');

    await sequelize.close();
    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(async (err) => {
    console.error('Fatal error:', err);
    try { await sequelize.close(); } catch { /* ignore */ }
    process.exit(1);
});
