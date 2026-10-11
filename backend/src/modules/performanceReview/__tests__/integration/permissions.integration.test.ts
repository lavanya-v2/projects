import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import sequelize from '../../../../config/connection';
import { createApp } from '../../../../app';
import { seedFixture, passIdentityGate, Fixture } from './helpers/seed';
import { ReviewCycleConfig } from '../../../../models/ReviewCycleConfig';
import { ReviewCycle } from '../../../../models/ReviewCycle';
import { ReviewCycleSource } from '../../../../models/ReviewCycleSource';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import { User } from '../../../../models/User';

/**
 * The HTTP layer and the permission matrix, through the real Express app.
 *
 * Service-level tests cannot prove routing, middleware order or role gating. In
 * particular they cannot catch the mounting trap this module was designed around:
 * `checkPermission` is mounted at `/api` where it cannot see `:cycleId`, and falls
 * through to `next()` when it can infer no resource — so a module mounted inside
 * that block would be wide open. The unauthenticated tests below are what prove
 * this module sits outside it.
 */

const BASE = '/api/performance-review';

let app: Express;
let fx: Fixture;
let cycleId: number;

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
    cycleId = cycle!.id;
    await cycleService.openCycle(cycleId, fx.users.superuser.id);
});

describe('authentication', () => {
    /**
     * Every route must 401 without a token. If any returned 200, the module would
     * be inside the `/api` checkPermission block and effectively unguarded.
     */
    it.each([
        ['get', `${BASE}/cycles?accountId=1`],
        ['get', `${BASE}/cycles/1`],
        ['get', `${BASE}/cycles/1/scores`],
        ['get', `${BASE}/cycles/1/sources`],
        ['get', `${BASE}/cycles/1/participants`],
        ['get', `${BASE}/config/account/1`],
        ['put', `${BASE}/config/account/1`],
        ['get', `${BASE}/identity/project/1`],
        ['post', `${BASE}/identity/project/1/seed`],
        ['post', `${BASE}/cycles/generate`],
    ])('rejects an unauthenticated %s %s', async (method, path) => {
        const res = await (request(app) as any)[method](path);
        expect(res.status).toBe(401);
    });
});

describe('configuration is superuser-only', () => {
    it('lets a superuser read the config and rollout state', async () => {
        const res = await request(app)
            .get(`${BASE}/config/account/${fx.account.id}`)
            .set(auth(fx.users.superuser));

        expect(res.status).toBe(200);
        expect(res.body.config.scopeProjectIds.sort()).toEqual([fx.projectA.id, fx.projectB.id].sort());
        expect(res.body.rollout.length).toBeGreaterThan(0);
    });

    it.each([
        ['manager', () => fx.users.manager],
        ['lead', () => fx.users.leadA],
        ['member', () => fx.users.member],
        ['executive', () => fx.users.executive],
    ])('forbids %s from reading the config', async (_role, getUser) => {
        const res = await request(app)
            .get(`${BASE}/config/account/${fx.account.id}`)
            .set(auth(getUser()));
        expect(res.status).toBe(403);
    });

    it('forbids a lead from changing the configuration', async () => {
        const res = await request(app)
            .put(`${BASE}/config/account/${fx.account.id}`)
            .set(auth(fx.users.leadA))
            .send({ weightSystem: 100, weightLead: 0, weightCustomer: 0 });
        expect(res.status).toBe(403);
    });
});

describe('identity resolution state never blocks rollout (Phase 8)', () => {
    it('adds a project with undecided identities to scope, unblocked — 200, not 409', async () => {
        // Project C has never been through the gate.
        const res = await request(app)
            .put(`${BASE}/config/account/${fx.account.id}`)
            .set(auth(fx.users.superuser))
            .send({
                scopeProjectIds: [fx.projectA.id, fx.projectB.id, fx.projectC.id],
                cadence: 'monthly',
                anchorDate: '2026-10-01',
                weightSystem: 60,
                weightLead: 40,
                weightCustomer: 0,
            });

        expect(res.status).toBe(200);
        expect(res.body.scopeProjectIds).toContain(fx.projectC.id);
    });

    it('still accepts the same project once its identities are resolved', async () => {
        await passIdentityGate(fx.projectC.id, fx.users.superuser.id);

        const res = await request(app)
            .put(`${BASE}/config/account/${fx.account.id}`)
            .set(auth(fx.users.superuser))
            .send({
                scopeProjectIds: [fx.projectA.id, fx.projectB.id, fx.projectC.id],
                cadence: 'monthly',
                anchorDate: '2026-10-01',
                weightSystem: 60,
                weightLead: 40,
                weightCustomer: 0,
            });

        expect(res.status).toBe(200);
        expect(res.body.scopeProjectIds).toContain(fx.projectC.id);
    });

    it('still reports identity coverage as information on the rollout list', async () => {
        const res = await request(app)
            .get(`${BASE}/config/account/${fx.account.id}`)
            .set(auth(fx.users.superuser));

        expect(res.status).toBe(200);
        const projectC = res.body.rollout.find((p: any) => p.projectId === fx.projectC.id);
        expect(projectC).toBeDefined();
        expect(projectC.gate.undecidedKeyCount).toBeGreaterThan(0);
        expect(projectC.gate.ready).toBe(false);
    });

    it('rejects weights that do not total 100', async () => {
        const res = await request(app)
            .put(`${BASE}/config/account/${fx.account.id}`)
            .set(auth(fx.users.superuser))
            .send({ anchorDate: '2026-10-01', weightSystem: 60, weightLead: 30, weightCustomer: 0 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/total 100/i);
    });
});

describe('cycle access is scoped by project overlap', () => {
    it('lets a lead with access read the cycle', async () => {
        const res = await request(app).get(`${BASE}/cycles/${cycleId}`).set(auth(fx.users.leadA));
        expect(res.status).toBe(200);
        expect(res.body.cycle.id).toBe(cycleId);
    });

    it('forbids a lead whose projects do not overlap the cycle scope', async () => {
        // leadOutside can only reach project C, which is not in this cycle.
        const res = await request(app).get(`${BASE}/cycles/${cycleId}`).set(auth(fx.users.leadOutside));
        expect(res.status).toBe(403);
    });

    it('omits out-of-scope cycles from the list rather than erroring', async () => {
        const res = await request(app)
            .get(`${BASE}/cycles?accountId=${fx.account.id}`)
            .set(auth(fx.users.leadOutside));
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('forbids a member from reading the whole roster of scores', async () => {
        const res = await request(app).get(`${BASE}/cycles/${cycleId}/scores`).set(auth(fx.users.member));
        expect(res.status).toBe(403);
    });

    it('forbids an executive from every review route', async () => {
        for (const path of [
            `${BASE}/cycles/${cycleId}`,
            `${BASE}/cycles/${cycleId}/scores`,
            `${BASE}/cycles/${cycleId}/participants`,
        ]) {
            const res = await request(app).get(path).set(auth(fx.users.executive));
            expect(res.status).toBe(403);
        }
    });
});

describe('transitions', () => {
    it('lets a manager lock a cycle', async () => {
        const res = await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.manager))
            .send({ toStatus: 'locked', note: 'period closed' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('locked');
    });

    it('forbids a manager from publishing — that is superuser-only', async () => {
        await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.superuser))
            .send({ toStatus: 'locked' });

        const res = await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.manager))
            .send({ toStatus: 'published' });

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/superuser/i);
    });

    it('lets a superuser publish', async () => {
        await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.superuser))
            .send({ toStatus: 'locked' });

        const res = await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.superuser))
            .send({ toStatus: 'published' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('published');
    });

    it('rejects an unknown status', async () => {
        const res = await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.superuser))
            .send({ toStatus: 'nonsense' });
        expect(res.status).toBe(400);
    });

    it('refuses to recompute a locked cycle', async () => {
        await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.superuser))
            .send({ toStatus: 'locked' });

        const res = await request(app)
            .post(`${BASE}/cycles/${cycleId}/recompute`)
            .set(auth(fx.users.superuser));
        expect(res.status).toBe(409);
    });
});

describe('source exclusion requires a reason', () => {
    it('rejects an exclusion with no reason', async () => {
        const source = await ReviewCycleSource.findOne({ where: { reviewCycleId: cycleId } });
        const res = await request(app)
            .patch(`${BASE}/cycles/${cycleId}/sources/${source!.id}`)
            .set(auth(fx.users.superuser))
            .send({ excluded: true });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/reason/i);
    });

    it('accepts an exclusion carrying a reason', async () => {
        const source = await ReviewCycleSource.findOne({ where: { reviewCycleId: cycleId } });
        const res = await request(app)
            .patch(`${BASE}/cycles/${cycleId}/sources/${source!.id}`)
            .set(auth(fx.users.superuser))
            .send({ excluded: true, reason: 'Sprint abandoned' });

        expect(res.status).toBe(200);
        expect(res.body.excluded).toBe(true);
        expect(res.body.exclusionReason).toBe('Sprint abandoned');
    });
});

describe('scores payload', () => {
    it('returns one row per member with the expected shape and no customer factor', async () => {
        const res = await request(app).get(`${BASE}/cycles/${cycleId}/scores`).set(auth(fx.users.superuser));
        expect(res.status).toBe(200);

        const solo = res.body.find((s: any) => s.teamMemberId === fx.members.solo.id);
        expect(solo).toBeDefined();
        expect(Number(solo.overallCoverage)).toBe(60);
        expect(solo.isProvisional).toBe(true);
        expect(solo.customerScore).toBeNull();

        // Account scoping: the cross-project member appears exactly once.
        const across = res.body.filter((s: any) => s.teamMemberId === fx.members.across.id);
        expect(across).toHaveLength(1);
        expect(across[0].contributingProjectIds.sort()).toEqual(
            [fx.projectA.id, fx.projectB.id].sort(),
        );
    });
});
