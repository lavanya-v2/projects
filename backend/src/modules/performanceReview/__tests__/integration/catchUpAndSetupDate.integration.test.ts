import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import sequelize from '../../../../config/connection';
import { createApp } from '../../../../app';
import { seedFixture, passIdentityGate, addExtraSprint, ReviewCycleConfig, ReviewCycle, Fixture } from './helpers/seed';
import { generateCycles, generateCatchUpCycle } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import { User } from '../../../../models/User';

/**
 * Phase 12c (forward-only visibility by default) and 12d (a superuser
 * catch-up cycle for the months hidden by 12c).
 */

const BASE = '/api/performance-review';

let app: Express;
let fx: Fixture;

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
});

describe('generateCycles respects setupDate as the default backfill start', () => {
    it('starts from setupDate, not the fiscal year start, when setupDate is set', async () => {
        await ReviewCycleConfig.create({
            accountId: fx.account.id,
            scopeProjectIds: [fx.projectA.id],
            cadence: 'monthly',
            anchorDate: '2026-10-01',
            reviewYearStartMonth: 4,
            weightSystem: 60, weightLead: 40, weightCustomer: 0,
            isEnabled: true,
            createdByUserId: fx.users.superuser.id,
            setupDate: '2026-10-01',
        } as any);

        const { periods } = await generateCycles(fx.account.id, '2027-03-31');
        expect(periods[0].startDate).toBe('2026-10-01');
        expect(periods.some(p => p.startDate < '2026-10-01')).toBe(false);
    });

    it('falls back to the fiscal-year start when setupDate is null — existing accounts unaffected', async () => {
        await ReviewCycleConfig.create({
            accountId: fx.account.id,
            scopeProjectIds: [fx.projectA.id],
            cadence: 'monthly',
            anchorDate: '2026-10-01',
            reviewYearStartMonth: 4,
            weightSystem: 60, weightLead: 40, weightCustomer: 0,
            isEnabled: true,
            createdByUserId: fx.users.superuser.id,
            // setupDate intentionally omitted — null.
        } as any);

        const { periods } = await generateCycles(fx.account.id, '2027-03-31');
        expect(periods[0].startDate).toBe('2026-04-01');
    });
});

describe('GET /cycles hides pre-setupDate periods by default', () => {
    it('hides historical periods by default and reveals them with includeHistorical=true', async () => {
        await ReviewCycleConfig.create({
            accountId: fx.account.id,
            scopeProjectIds: [fx.projectA.id],
            cadence: 'monthly',
            anchorDate: '2026-10-01',
            reviewYearStartMonth: 4,
            weightSystem: 60, weightLead: 40, weightCustomer: 0,
            isEnabled: true,
            createdByUserId: fx.users.superuser.id,
            setupDate: '2026-10-01',
        } as any);
        // Force-generate a historical period predating setupDate directly, to
        // prove the LIST filter (not just generation) hides it.
        await generateCycles(fx.account.id, '2027-03-31', '2026-04-01');

        const hidden = await request(app)
            .get(`${BASE}/cycles`)
            .query({ accountId: fx.account.id })
            .set(auth(fx.users.superuser));
        expect(hidden.status).toBe(200);
        expect(hidden.body.every((c: any) => c.startDate >= '2026-10-01')).toBe(true);

        const shown = await request(app)
            .get(`${BASE}/cycles`)
            .query({ accountId: fx.account.id, includeHistorical: 'true' })
            .set(auth(fx.users.superuser));
        expect(shown.status).toBe(200);
        expect(shown.body.some((c: any) => c.startDate < '2026-10-01')).toBe(true);
    });
});

describe('generateCatchUpCycle', () => {
    beforeEach(async () => {
        await ReviewCycleConfig.create({
            accountId: fx.account.id,
            scopeProjectIds: [fx.projectA.id],
            cadence: 'monthly',
            anchorDate: '2026-10-01',
            reviewYearStartMonth: 4,
            weightSystem: 60, weightLead: 40, weightCustomer: 0,
            isEnabled: true,
            createdByUserId: fx.users.superuser.id,
            setupDate: '2026-10-01',
        } as any);
    });

    it('creates one correctly-windowed, labeled catch-up cycle outside the normal sequence', async () => {
        const cycle = await generateCatchUpCycle(fx.account.id, '2026-04-01', '2026-09-30');
        expect(cycle.isCatchUp).toBe(true);
        expect(cycle.startDate).toBe('2026-04-01');
        expect(cycle.endDate).toBe('2026-09-30');
        expect(cycle.sequenceNo).toBe(0);
        expect(cycle.status).toBe('scheduled');
    });

    it('rejects a window overlapping an existing period', async () => {
        await generateCycles(fx.account.id, '2027-03-31');
        await expect(generateCatchUpCycle(fx.account.id, '2026-09-15', '2026-10-15')).rejects.toThrow(/overlaps/);
    });

    it('opening it attaches sources across the whole span and scores correctly, without polluting a later cycle\'s trend', async () => {
        // The fixture's own syncs all fall in October (SPRINT_WINDOW) — outside
        // this Apr-Sep catch-up window — so real data has to be added directly
        // inside the span for there to be anything to attach and score.
        await addExtraSprint(fx.projectA.id, fx.members.solo.id, 'catchup-sprint', '2026-04-05', '2026-04-19', {
            spPlanned: 10, spDone: 8, deliveredCount: 5,
        });

        const catchUp = await generateCatchUpCycle(fx.account.id, '2026-04-01', '2026-09-30');
        await cycleService.openCycle(catchUp.id, fx.users.superuser.id);

        const scores = await cycleService.recomputeCycle(catchUp.id, 'manual');
        expect(scores.scored).toBeGreaterThan(0);

        // Now generate and open the account's first REAL cadence cycle (Oct
        // 2026, sequenceNo 1) — its cumulative/trend must not pick up the
        // catch-up cycle as a "prior" period despite sequenceNo 0 < 1.
        await generateCycles(fx.account.id, '2027-03-31');
        const octCycle = await ReviewCycle.findOne({
            where: { accountId: fx.account.id, startDate: '2026-10-01' },
        });
        await cycleService.openCycle(octCycle!.id, fx.users.superuser.id);

        const octScore = await import('../../../../models/ReviewMemberScore').then(m =>
            m.ReviewMemberScore.findOne({ where: { reviewCycleId: octCycle!.id } }),
        );
        expect(octScore).not.toBeNull();
        expect(octScore!.cumCyclesCount).toBe(1);
        expect(octScore!.trendDirection).toBe('na');
    });
});
