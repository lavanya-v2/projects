import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import sequelize from '../../../../config/connection';
import { createApp } from '../../../../app';
import { seedFixture, passIdentityGate, Fixture } from './helpers/seed';
import { ReviewCycleConfig } from '../../../../models/ReviewCycleConfig';
import { ReviewCycle } from '../../../../models/ReviewCycle';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import { User } from '../../../../models/User';

/**
 * Regression coverage for the three EXP-pilot findings: reviewer options must
 * actually be scoped to the person's project(s) rather than the whole account,
 * a never-opened period must be cancellable without touching anything else, and
 * the scores payload must hand back real numbers — not DECIMAL-as-string, which
 * silently turned "average coverage" into string concatenation and then NaN.
 */

const BASE = '/api/performance-review';

let app: Express;
let fx: Fixture;
let openCycleId: number;

const tokenFor = (user: User): string =>
    jwt.sign(
        { id: user.id, userId: user.userId, role: (user as any).role },
        process.env.JWT_SECRET || 'default_secret_key',
        { expiresIn: '1h' },
    );

const auth = (user: User) => ({ Authorization: `Bearer ${tokenFor(user)}` });

beforeAll(async () => {
    await sequelize.authenticate();
    app = createApp();
});

beforeEach(async () => {
    fx = await seedFixture();
    await passIdentityGate(fx.projectA.id, fx.users.superuser.id);
    await passIdentityGate(fx.projectB.id, fx.users.superuser.id);

    await ReviewCycleConfig.create({
        accountId: fx.account.id,
        scopeProjectIds: [fx.projectA.id, fx.projectB.id],
        cadence: 'monthly',
        anchorDate: '2026-10-01',
        reviewYearStartMonth: 4,
        weightSystem: 60,
        weightLead: 40,
        weightCustomer: 0,
        isEnabled: true,
        createdByUserId: fx.users.superuser.id,
    } as any);
    await generateCycles(fx.account.id, '2027-03-31');

    const cycle = await ReviewCycle.findOne({
        where: { accountId: fx.account.id, startDate: '2026-10-01' },
    });
    openCycleId = cycle!.id;
    await cycleService.openCycle(openCycleId, fx.users.superuser.id);
});

describe('eligible reviewers are scoped to the person\'s own projects', () => {
    it('lists only leads with access to a contributing project, not the whole account', async () => {
        const res = await request(app)
            .get(`${BASE}/cycles/${openCycleId}/eligible-reviewers`)
            .set(auth(fx.users.superuser));
        expect(res.status).toBe(200);

        // The ACROSS member contributes to both A and B; leadA has access to both.
        const acrossOptions: Array<{ id: number }> = res.body[fx.members.across.id];
        expect(acrossOptions.some(r => r.id === fx.users.leadA.id)).toBe(true);

        // leadOutside only has access to project C, which never contributed to
        // this cycle — must never appear as an option for anyone in it.
        for (const options of Object.values(res.body) as Array<Array<{ id: number }>>) {
            expect(options.some(r => r.id === fx.users.leadOutside.id)).toBe(false);
        }
    });

    it('actually lets a reviewer be assigned and saved from the scoped list', async () => {
        const participantsRes = await request(app)
            .get(`${BASE}/cycles/${openCycleId}/participants`)
            .set(auth(fx.users.superuser));
        const across = participantsRes.body.find((p: any) => p.teamMemberId === fx.members.across.id);
        expect(across).toBeDefined();

        const assignRes = await request(app)
            .patch(`${BASE}/participants/${across.id}`)
            .set(auth(fx.users.superuser))
            .send({ reviewerUserId: fx.users.leadA.id });
        expect(assignRes.status).toBe(200);
        expect(assignRes.body.reviewerUserId).toBe(fx.users.leadA.id);
    });
});

describe('cancelling a never-opened period', () => {
    it('lets a superuser cancel a scheduled cycle, leaving other cycles untouched', async () => {
        const scheduled = await ReviewCycle.findOne({
            where: { accountId: fx.account.id, status: 'scheduled' },
        });
        expect(scheduled).not.toBeNull();

        const res = await request(app)
            .post(`${BASE}/cycles/${scheduled!.id}/transition`)
            .set(auth(fx.users.superuser))
            .send({ toStatus: 'archived' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('archived');

        const openCycle = await ReviewCycle.findByPk(openCycleId);
        expect(openCycle!.status).toBe('open');

        const stillThere = await ReviewCycle.findByPk(scheduled!.id);
        expect(stillThere).not.toBeNull();
        expect(stillThere!.status).toBe('archived');
    });

    it('refuses a manager cancelling a scheduled cycle — same tier as generating one', async () => {
        const scheduled = await ReviewCycle.findOne({
            where: { accountId: fx.account.id, status: 'scheduled' },
        });

        const res = await request(app)
            .post(`${BASE}/cycles/${scheduled!.id}/transition`)
            .set(auth(fx.users.manager))
            .send({ toStatus: 'archived' });
        expect(res.status).toBe(403);

        const unchanged = await ReviewCycle.findByPk(scheduled!.id);
        expect(unchanged!.status).toBe('scheduled');
    });
});

describe('scores payload returns real numbers, not DECIMAL-as-string', () => {
    it('every numeric field is typeof number, and averaging them never produces NaN', async () => {
        const rows = await cycleService.getCycleScores(openCycleId);
        expect(rows.length).toBeGreaterThan(0);

        for (const r of rows as any[]) {
            for (const key of ['systemScore', 'leadScore', 'compositeScore', 'systemCoverage', 'overallCoverage']) {
                if (r[key] !== null) expect(typeof r[key]).toBe('number');
            }
        }

        const avgCoverage = rows.reduce((sum: number, r: any) => sum + (r.overallCoverage ?? 0), 0) / rows.length;
        expect(Number.isNaN(avgCoverage)).toBe(false);
    });
});
