/**
 * Risk Module — RBAC API E2E suite.
 *
 * Exercises the full Risk access-control matrix from the API layer:
 *   Suite A — Visibility (GET /api/risks)
 *   Suite B — Single risk read (GET /api/risks/:id) + permission flags
 *   Suite C — Create (POST /api/risks)
 *   Suite D — Update (PUT /api/risks/:id)
 *   Suite E — Status transition (PUT /api/risks/:id/status)
 *   Suite F — Mark done (PUT /api/risks/:id/done) — leads cannot close
 *   Suite G — Comments (POST /api/risks/:id/comments)
 *   Suite H — Mitigation plans
 *   Suite I — Delete risk
 *
 * Setup creates 8 fixture risks (one from each role/visibility combination)
 * + 2 extra users (manager2, lead2) so we can test "same rank, different user"
 * denials. All data is torn down in afterAll. Mid-run crashes are recovered
 * via the persistent /tmp/dsr-e2e-rbac-seeds.json file.
 */

import { test, expect } from '@playwright/test';
import {
    setupRbacFixtures,
    teardownRbacFixtures,
    trackExtraRisk,
    listRisks,
    getRisk,
    createRisk,
    updateRisk,
    deleteRisk,
    transitionStatus,
    markDone,
    addComment,
    addMitigationPlan,
    type RbacFixtures,
} from './risk-rbac-helpers';

// Serial mode + retries: 0 — retries restart the worker, which would re-run
// beforeAll and create duplicate fixtures while leaking the originals.
test.describe.configure({ mode: 'serial', retries: 0 });

test.describe('Risk RBAC — API matrix', () => {
    let fx: RbacFixtures;

    test.beforeAll(async () => {
        fx = await setupRbacFixtures();
        console.log('[rbac] Fixtures ready:', {
            projectId: fx.projectId,
            riskIds: fx.risks,
            extraUsers: fx.extraUserIds,
        });
    });

    test.afterAll(async () => {
        if (fx) await teardownRbacFixtures(fx);
    });

    // ----------------------------------------------------------------------
    // Suite A — Visibility (GET /api/risks)
    // ----------------------------------------------------------------------

    test.describe('Suite A — Visibility', () => {
        test('A1 superuser sees all 8 fixture risks', async () => {
            const res = await listRisks(fx.tokens.superuser);
            expect(res.status).toBe(200);
            const ids = (res.data ?? []).map((r: any) => r.id);
            for (const fixtureId of fx.createdRiskIds) {
                expect(ids).toContain(fixtureId);
            }
        });

        test('A2 admin sees own-project risks AND unlinked risks (all 8 fixtures)', async () => {
            const res = await listRisks(fx.tokens.admin);
            expect(res.status).toBe(200);
            const ids = (res.data ?? []).map((r: any) => r.id);
            // Admin should see all fixtures regardless of creator (admin has full account access)
            for (const fixtureId of fx.createdRiskIds) {
                expect(ids).toContain(fixtureId);
            }
        });

        test('A3 manager1 sees mgr+lead risks; NOT admin/SU-created or unlinked', async () => {
            const res = await listRisks(fx.tokens.manager1);
            expect(res.status).toBe(200);
            const ids = (res.data ?? []).map((r: any) => r.id);

            expect(ids).toContain(fx.risks.riskByMgr1);
            expect(ids).toContain(fx.risks.riskByMgr2);
            expect(ids).toContain(fx.risks.riskByLead1);
            expect(ids).toContain(fx.risks.riskByLead2);

            expect(ids).not.toContain(fx.risks.riskBySu);
            expect(ids).not.toContain(fx.risks.riskBySuUnlinked);
            expect(ids).not.toContain(fx.risks.riskByAdmin);
            expect(ids).not.toContain(fx.risks.riskByAdminUnlinked);
        });

        test('A4 manager2 sees the same set as manager1', async () => {
            const res = await listRisks(fx.tokens.manager2);
            expect(res.status).toBe(200);
            const ids = (res.data ?? []).map((r: any) => r.id);

            expect(ids).toContain(fx.risks.riskByMgr1);
            expect(ids).toContain(fx.risks.riskByMgr2);
            expect(ids).toContain(fx.risks.riskByLead1);
            expect(ids).toContain(fx.risks.riskByLead2);
            expect(ids).not.toContain(fx.risks.riskBySu);
            expect(ids).not.toContain(fx.risks.riskByAdmin);
        });

        test('A5 lead1 sees mgr+lead risks; NOT admin/SU-created or unlinked', async () => {
            const res = await listRisks(fx.tokens.lead1);
            expect(res.status).toBe(200);
            const ids = (res.data ?? []).map((r: any) => r.id);

            expect(ids).toContain(fx.risks.riskByMgr1);
            expect(ids).toContain(fx.risks.riskByMgr2);
            expect(ids).toContain(fx.risks.riskByLead1);
            expect(ids).toContain(fx.risks.riskByLead2);

            expect(ids).not.toContain(fx.risks.riskBySu);
            expect(ids).not.toContain(fx.risks.riskBySuUnlinked);
            expect(ids).not.toContain(fx.risks.riskByAdmin);
            expect(ids).not.toContain(fx.risks.riskByAdminUnlinked);
        });

        test('A6 member is blocked at the route middleware (403)', async () => {
            const res = await listRisks(fx.tokens.member);
            expect(res.status).toBe(403);
        });

        test('A7 each risk in the response has a permissions object with all flags', async () => {
            const res = await listRisks(fx.tokens.superuser);
            expect(res.status).toBe(200);
            const sample = (res.data ?? [])[0];
            expect(sample).toBeTruthy();
            expect(sample.permissions).toBeDefined();
            expect(typeof sample.permissions.canView).toBe('boolean');
            expect(typeof sample.permissions.canEdit).toBe('boolean');
            expect(typeof sample.permissions.canComment).toBe('boolean');
            expect(typeof sample.permissions.canTransition).toBe('boolean');
            expect(typeof sample.permissions.canMarkDone).toBe('boolean');
            expect(typeof sample.permissions.canDelete).toBe('boolean');
        });
    });

    // ----------------------------------------------------------------------
    // Suite B — Single risk read + permission flags
    // ----------------------------------------------------------------------

    test.describe('Suite B — Single risk read', () => {
        test('B1 superuser GETs any risk with all-true permissions', async () => {
            const res = await getRisk(fx.tokens.superuser, fx.risks.riskByLead1);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canView).toBe(true);
            expect(res.data.permissions.canEdit).toBe(true);
            expect(res.data.permissions.canMarkDone).toBe(true);
            expect(res.data.permissions.canDelete).toBe(true);
        });

        test('B2 admin GET riskBySu — visible but cannot edit/delete', async () => {
            const res = await getRisk(fx.tokens.admin, fx.risks.riskBySu);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canView).toBe(true);
            expect(res.data.permissions.canEdit).toBe(false);
            expect(res.data.permissions.canDelete).toBe(false);
        });

        test('B3 admin GET riskByMgr1 — full action perms (higher rank)', async () => {
            const res = await getRisk(fx.tokens.admin, fx.risks.riskByMgr1);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canEdit).toBe(true);
            expect(res.data.permissions.canMarkDone).toBe(true);
        });

        test('B4 admin GET riskByAdminUnlinked — visible to admin', async () => {
            const res = await getRisk(fx.tokens.admin, fx.risks.riskByAdminUnlinked);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canView).toBe(true);
        });

        test('B5 manager1 GET riskBySu — 404 (visibility hidden)', async () => {
            const res = await getRisk(fx.tokens.manager1, fx.risks.riskBySu);
            expect(res.status).toBe(404);
        });

        test('B6 manager1 GET riskByAdmin — 404', async () => {
            const res = await getRisk(fx.tokens.manager1, fx.risks.riskByAdmin);
            expect(res.status).toBe(404);
        });

        test('B7 manager1 GET riskByAdminUnlinked — 404', async () => {
            const res = await getRisk(fx.tokens.manager1, fx.risks.riskByAdminUnlinked);
            expect(res.status).toBe(404);
        });

        test('B8 manager1 GET riskByMgr1 (own) — full perms', async () => {
            const res = await getRisk(fx.tokens.manager1, fx.risks.riskByMgr1);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canEdit).toBe(true);
            expect(res.data.permissions.canMarkDone).toBe(true);
        });

        test('B9 manager1 GET riskByMgr2 (other manager) — comment-only', async () => {
            const res = await getRisk(fx.tokens.manager1, fx.risks.riskByMgr2);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canView).toBe(true);
            expect(res.data.permissions.canEdit).toBe(false);
            expect(res.data.permissions.canMarkDone).toBe(false);
            expect(res.data.permissions.canComment).toBe(true);
            expect(res.data.permissions.canTransition).toBe(true);
        });

        test('B10 manager1 GET riskByLead1 — full edit (higher rank than lead)', async () => {
            const res = await getRisk(fx.tokens.manager1, fx.risks.riskByLead1);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canEdit).toBe(true);
            expect(res.data.permissions.canMarkDone).toBe(true);
        });

        test('B11 lead1 GET riskBySu — 404', async () => {
            const res = await getRisk(fx.tokens.lead1, fx.risks.riskBySu);
            expect(res.status).toBe(404);
        });

        test('B12 lead1 GET riskByAdmin — 404', async () => {
            const res = await getRisk(fx.tokens.lead1, fx.risks.riskByAdmin);
            expect(res.status).toBe(404);
        });

        test('B13 lead1 GET riskByLead1 (own) — canEdit=true, canMarkDone=FALSE', async () => {
            const res = await getRisk(fx.tokens.lead1, fx.risks.riskByLead1);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canEdit).toBe(true);
            expect(res.data.permissions.canMarkDone).toBe(false);
        });

        test('B14 lead1 GET riskByLead2 (other lead) — comment-only', async () => {
            const res = await getRisk(fx.tokens.lead1, fx.risks.riskByLead2);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canView).toBe(true);
            expect(res.data.permissions.canEdit).toBe(false);
            expect(res.data.permissions.canMarkDone).toBe(false);
            expect(res.data.permissions.canComment).toBe(true);
        });

        test('B15 lead1 GET riskByMgr1 — comment-only (higher rank creator)', async () => {
            const res = await getRisk(fx.tokens.lead1, fx.risks.riskByMgr1);
            expect(res.status).toBe(200);
            expect(res.data.permissions.canView).toBe(true);
            expect(res.data.permissions.canEdit).toBe(false);
            expect(res.data.permissions.canMarkDone).toBe(false);
            expect(res.data.permissions.canComment).toBe(true);
        });
    });

    // ----------------------------------------------------------------------
    // Suite C — Create
    // ----------------------------------------------------------------------

    test.describe('Suite C — Create', () => {
        test('C1 superuser creates with projectId — 201', async () => {
            const res = await createRisk(fx.tokens.superuser, {
                projectId: fx.projectId,
                title: '[E2E-RBAC] C1 superuser linked',
            });
            expect(res.status).toBe(201);
            if (res.data?.id) trackExtraRisk(fx, res.data.id);
        });

        test('C2 superuser creates without projectId — 201 (unlinked allowed)', async () => {
            const res = await createRisk(fx.tokens.superuser, {
                title: '[E2E-RBAC] C2 superuser unlinked',
            });
            expect(res.status).toBe(201);
            if (res.data?.id) trackExtraRisk(fx, res.data.id);
        });

        test('C3 admin creates with projectId — 201', async () => {
            const res = await createRisk(fx.tokens.admin, {
                projectId: fx.projectId,
                title: '[E2E-RBAC] C3 admin linked',
            });
            expect(res.status).toBe(201);
            if (res.data?.id) trackExtraRisk(fx, res.data.id);
        });

        test('C4 admin creates without projectId — 201', async () => {
            const res = await createRisk(fx.tokens.admin, {
                title: '[E2E-RBAC] C4 admin unlinked',
            });
            expect(res.status).toBe(201);
            if (res.data?.id) trackExtraRisk(fx, res.data.id);
        });

        test('C5 manager1 creates with own projectId — 201', async () => {
            const res = await createRisk(fx.tokens.manager1, {
                projectId: fx.projectId,
                title: '[E2E-RBAC] C5 manager1 linked',
            });
            expect(res.status).toBe(201);
            if (res.data?.id) trackExtraRisk(fx, res.data.id);
        });

        test('C6 manager1 creates without projectId — 400', async () => {
            const res = await createRisk(fx.tokens.manager1, {
                title: '[E2E-RBAC] C6 manager1 unlinked attempt',
            });
            expect(res.status).toBe(400);
        });

        test('C7 manager1 creates with foreign projectId — 403', async () => {
            // Use a project id that the manager certainly does not have access to.
            const foreignProjectId = 999999;
            const res = await createRisk(fx.tokens.manager1, {
                projectId: foreignProjectId,
                title: '[E2E-RBAC] C7 manager1 foreign project',
            });
            expect(res.status).toBe(403);
        });

        test('C8 lead1 creates with own projectId — 201', async () => {
            const res = await createRisk(fx.tokens.lead1, {
                projectId: fx.projectId,
                title: '[E2E-RBAC] C8 lead1 linked',
            });
            expect(res.status).toBe(201);
            if (res.data?.id) trackExtraRisk(fx, res.data.id);
        });

        test('C9 lead1 creates without projectId — 400', async () => {
            const res = await createRisk(fx.tokens.lead1, {
                title: '[E2E-RBAC] C9 lead1 unlinked attempt',
            });
            expect(res.status).toBe(400);
        });

        test('C10 member create — 403 (middleware)', async () => {
            const res = await createRisk(fx.tokens.member, {
                projectId: fx.projectId,
                title: '[E2E-RBAC] C10 member attempt',
            });
            expect(res.status).toBe(403);
        });

        test('C11 superuser missing required field — 400', async () => {
            const res = await createRisk(fx.tokens.superuser, {
                projectId: fx.projectId,
                title: '[E2E-RBAC] C11 missing priority',
                priority: undefined as any,
            });
            // Service throws 400 when a required field is missing.
            expect(res.status).toBe(400);
        });
    });

    // ----------------------------------------------------------------------
    // Suite D — Update
    // ----------------------------------------------------------------------

    test.describe('Suite D — Update', () => {
        const okBody = { priority: 'LOW' };

        test('D1 superuser updates riskBySu — 200', async () => {
            const res = await updateRisk(fx.tokens.superuser, fx.risks.riskBySu, okBody);
            expect(res.status).toBe(200);
        });

        test('D2 superuser updates riskByAdmin — 200', async () => {
            const res = await updateRisk(fx.tokens.superuser, fx.risks.riskByAdmin, okBody);
            expect(res.status).toBe(200);
        });

        test('D3 superuser updates riskByMgr1 — 200', async () => {
            const res = await updateRisk(fx.tokens.superuser, fx.risks.riskByMgr1, okBody);
            expect(res.status).toBe(200);
        });

        test('D4 superuser updates riskByLead1 — 200', async () => {
            const res = await updateRisk(fx.tokens.superuser, fx.risks.riskByLead1, okBody);
            expect(res.status).toBe(200);
        });

        test('D5 admin updates riskBySu — 403 (cannot edit superuser-created)', async () => {
            const res = await updateRisk(fx.tokens.admin, fx.risks.riskBySu, okBody);
            expect(res.status).toBe(403);
        });

        test('D6 admin updates riskByAdmin (own) — 200', async () => {
            const res = await updateRisk(fx.tokens.admin, fx.risks.riskByAdmin, okBody);
            expect(res.status).toBe(200);
        });

        test('D7 admin updates riskByMgr1 — 200 (higher rank)', async () => {
            const res = await updateRisk(fx.tokens.admin, fx.risks.riskByMgr1, okBody);
            expect(res.status).toBe(200);
        });

        test('D8 admin updates riskByLead1 — 200 (higher rank)', async () => {
            const res = await updateRisk(fx.tokens.admin, fx.risks.riskByLead1, okBody);
            expect(res.status).toBe(200);
        });

        test('D9 manager1 updates riskBySu — denied (not visible)', async () => {
            const res = await updateRisk(fx.tokens.manager1, fx.risks.riskBySu, okBody);
            // Either 403 (canEdit denied) or 404 (visibility hidden) is acceptable.
            expect([403, 404]).toContain(res.status);
        });

        test('D10 manager1 updates riskByAdmin — denied (not visible)', async () => {
            const res = await updateRisk(fx.tokens.manager1, fx.risks.riskByAdmin, okBody);
            expect([403, 404]).toContain(res.status);
        });

        test('D11 manager1 updates riskByMgr1 (own) — 200', async () => {
            const res = await updateRisk(fx.tokens.manager1, fx.risks.riskByMgr1, okBody);
            expect(res.status).toBe(200);
        });

        test('D12 manager1 updates riskByMgr2 (same rank, other) — 403', async () => {
            const res = await updateRisk(fx.tokens.manager1, fx.risks.riskByMgr2, okBody);
            expect(res.status).toBe(403);
        });

        test('D13 manager1 updates riskByLead1 — 200 (higher rank than lead)', async () => {
            const res = await updateRisk(fx.tokens.manager1, fx.risks.riskByLead1, okBody);
            expect(res.status).toBe(200);
        });

        test('D14 lead1 updates riskByLead1 (own) — 200', async () => {
            const res = await updateRisk(fx.tokens.lead1, fx.risks.riskByLead1, okBody);
            expect(res.status).toBe(200);
        });

        test('D15 lead1 updates riskByLead2 (same rank, other) — 403', async () => {
            const res = await updateRisk(fx.tokens.lead1, fx.risks.riskByLead2, okBody);
            expect(res.status).toBe(403);
        });

        test('D16 lead1 updates riskByMgr1 — 403 (lower rank cannot edit higher)', async () => {
            const res = await updateRisk(fx.tokens.lead1, fx.risks.riskByMgr1, okBody);
            expect(res.status).toBe(403);
        });

        test('D17 lead1 updates riskByAdmin — denied (not visible)', async () => {
            const res = await updateRisk(fx.tokens.lead1, fx.risks.riskByAdmin, okBody);
            expect([403, 404]).toContain(res.status);
        });

        test('D18 member update any — 403 (middleware)', async () => {
            const res = await updateRisk(fx.tokens.member, fx.risks.riskByMgr1, okBody);
            expect(res.status).toBe(403);
        });
    });

    // ----------------------------------------------------------------------
    // Suite E — Status transition (NEW/WIP/STALE)
    // ----------------------------------------------------------------------

    test.describe('Suite E — Status transition', () => {
        test('E1 superuser transitions any visible risk', async () => {
            const res = await transitionStatus(fx.tokens.superuser, fx.risks.riskByMgr1, 'WORK_IN_PROGRESS', 'E1 transition');
            expect(res.status).toBe(200);
        });

        test('E2 admin transitions riskByMgr1', async () => {
            const res = await transitionStatus(fx.tokens.admin, fx.risks.riskByMgr1, 'STALE', 'E2 transition');
            expect(res.status).toBe(200);
        });

        test('E3 manager1 transitions riskByLead1', async () => {
            const res = await transitionStatus(fx.tokens.manager1, fx.risks.riskByLead1, 'WORK_IN_PROGRESS', 'E3 transition');
            expect(res.status).toBe(200);
        });

        test('E4 manager1 transitions riskByMgr2 (visible — canTransition=true)', async () => {
            const res = await transitionStatus(fx.tokens.manager1, fx.risks.riskByMgr2, 'WORK_IN_PROGRESS', 'E4 transition');
            expect(res.status).toBe(200);
        });

        test('E5 lead1 transitions riskByMgr1', async () => {
            const res = await transitionStatus(fx.tokens.lead1, fx.risks.riskByMgr1, 'WORK_IN_PROGRESS', 'E5 transition');
            expect(res.status).toBe(200);
        });

        test('E6 lead1 transitions riskByLead2', async () => {
            const res = await transitionStatus(fx.tokens.lead1, fx.risks.riskByLead2, 'WORK_IN_PROGRESS', 'E6 transition');
            expect(res.status).toBe(200);
        });

        test('E7 manager1 transitions riskBySu — denied (not visible)', async () => {
            const res = await transitionStatus(fx.tokens.manager1, fx.risks.riskBySu, 'WORK_IN_PROGRESS', 'E7 transition');
            expect([403, 404]).toContain(res.status);
        });

        test('E8 transition with empty comment — 400', async () => {
            const res = await transitionStatus(fx.tokens.superuser, fx.risks.riskByMgr1, 'WORK_IN_PROGRESS', '');
            expect(res.status).toBe(400);
        });

        test('E9 transition to DONE via /status endpoint — 400', async () => {
            const res = await transitionStatus(fx.tokens.superuser, fx.risks.riskByMgr1, 'DONE', 'attempting via status endpoint');
            expect(res.status).toBe(400);
        });
    });

    // ----------------------------------------------------------------------
    // Suite F — Mark Done
    // ----------------------------------------------------------------------

    test.describe('Suite F — Mark Done', () => {
        // Use the disposable risks created in Suite C if available, OR create
        // dedicated disposables here so we don't permanently DONE the shared
        // fixtures (other tests still need them in active states).
        let disposableRiskBySu = 0;
        let disposableRiskByMgr1A = 0;
        let disposableRiskByMgr1B = 0;
        let disposableRiskByMgr2 = 0;
        let disposableRiskByLead1A = 0;
        let disposableRiskByLead1B = 0;
        let disposableRiskByLead1C = 0;

        test.beforeAll(async () => {
            // Disposable risks for the close tests
            disposableRiskBySu = (await createRisk(fx.tokens.superuser, { projectId: fx.projectId, title: '[E2E-RBAC] F-disposable SU' })).data?.id;
            disposableRiskByMgr1A = (await createRisk(fx.tokens.manager1, { projectId: fx.projectId, title: '[E2E-RBAC] F-disposable mgr1 A' })).data?.id;
            disposableRiskByMgr1B = (await createRisk(fx.tokens.manager1, { projectId: fx.projectId, title: '[E2E-RBAC] F-disposable mgr1 B' })).data?.id;
            disposableRiskByMgr2 = (await createRisk(fx.tokens.manager2, { projectId: fx.projectId, title: '[E2E-RBAC] F-disposable mgr2' })).data?.id;
            disposableRiskByLead1A = (await createRisk(fx.tokens.lead1, { projectId: fx.projectId, title: '[E2E-RBAC] F-disposable lead1 A' })).data?.id;
            disposableRiskByLead1B = (await createRisk(fx.tokens.lead1, { projectId: fx.projectId, title: '[E2E-RBAC] F-disposable lead1 B' })).data?.id;
            disposableRiskByLead1C = (await createRisk(fx.tokens.lead1, { projectId: fx.projectId, title: '[E2E-RBAC] F-disposable lead1 C' })).data?.id;

            for (const id of [disposableRiskBySu, disposableRiskByMgr1A, disposableRiskByMgr1B, disposableRiskByMgr2, disposableRiskByLead1A, disposableRiskByLead1B, disposableRiskByLead1C]) {
                if (id) trackExtraRisk(fx, id);
            }
        });

        test('F1 superuser closes any visible risk', async () => {
            // Use a fresh disposable so other tests are unaffected
            const created = await createRisk(fx.tokens.superuser, { projectId: fx.projectId, title: '[E2E-RBAC] F1 SU close target' });
            if (created.data?.id) trackExtraRisk(fx, created.data.id);
            const res = await markDone(fx.tokens.superuser, created.data.id, 'F1 closed by SU');
            expect(res.status).toBe(200);
        });

        test('F2 admin closes riskByMgr1', async () => {
            const res = await markDone(fx.tokens.admin, disposableRiskByMgr1A, 'F2 closed by admin');
            expect(res.status).toBe(200);
        });

        test('F3 admin closes riskByLead1', async () => {
            const res = await markDone(fx.tokens.admin, disposableRiskByLead1A, 'F3 closed by admin');
            expect(res.status).toBe(200);
        });

        test('F4 admin closes riskBySu — 403', async () => {
            const res = await markDone(fx.tokens.admin, disposableRiskBySu, 'F4 attempt');
            expect(res.status).toBe(403);
        });

        test('F5 manager1 closes own risk', async () => {
            const res = await markDone(fx.tokens.manager1, disposableRiskByMgr1B, 'F5 closed by self');
            expect(res.status).toBe(200);
        });

        test('F6 manager1 closes riskByLead1', async () => {
            const res = await markDone(fx.tokens.manager1, disposableRiskByLead1B, 'F6 closed by manager');
            expect(res.status).toBe(200);
        });

        test('F7 manager1 closes riskByMgr2 — 403', async () => {
            const res = await markDone(fx.tokens.manager1, disposableRiskByMgr2, 'F7 attempt');
            expect(res.status).toBe(403);
        });

        test('F8 lead1 closes own risk — 403 (leads CANNOT close)', async () => {
            const res = await markDone(fx.tokens.lead1, disposableRiskByLead1C, 'F8 attempt by self');
            expect(res.status).toBe(403);
        });

        test('F9 lead1 closes riskByMgr1 — 403', async () => {
            const created = await createRisk(fx.tokens.manager1, { projectId: fx.projectId, title: '[E2E-RBAC] F9 mgr risk for lead' });
            if (created.data?.id) trackExtraRisk(fx, created.data.id);
            const res = await markDone(fx.tokens.lead1, created.data.id, 'F9 attempt');
            expect(res.status).toBe(403);
        });

        test('F10 mark done with empty resolution — 400', async () => {
            const created = await createRisk(fx.tokens.superuser, { projectId: fx.projectId, title: '[E2E-RBAC] F10 empty resolution' });
            if (created.data?.id) trackExtraRisk(fx, created.data.id);
            const res = await markDone(fx.tokens.superuser, created.data.id, '');
            expect(res.status).toBe(400);
        });
    });

    // ----------------------------------------------------------------------
    // Suite G — Comments
    // ----------------------------------------------------------------------

    test.describe('Suite G — Comments', () => {
        test('G1 superuser comments on any risk', async () => {
            const res = await addComment(fx.tokens.superuser, fx.risks.riskByMgr1, 'G1 SU comment');
            expect(res.status).toBe(201);
        });

        test('G2 admin comments on riskByMgr1', async () => {
            const res = await addComment(fx.tokens.admin, fx.risks.riskByMgr1, 'G2 admin comment');
            expect(res.status).toBe(201);
        });

        test('G3 manager1 comments on riskByMgr2 (visible — canComment=true)', async () => {
            const res = await addComment(fx.tokens.manager1, fx.risks.riskByMgr2, 'G3 cross-manager comment');
            expect(res.status).toBe(201);
        });

        test('G4 manager1 comments on riskBySu — 404 (not visible)', async () => {
            const res = await addComment(fx.tokens.manager1, fx.risks.riskBySu, 'G4 attempt');
            expect([403, 404]).toContain(res.status);
        });

        test('G5 lead1 comments on riskByMgr1', async () => {
            const res = await addComment(fx.tokens.lead1, fx.risks.riskByMgr1, 'G5 lead comment on mgr risk');
            expect(res.status).toBe(201);
        });

        test('G6 lead1 comments on riskByLead2 (cross-lead, visible)', async () => {
            const res = await addComment(fx.tokens.lead1, fx.risks.riskByLead2, 'G6 cross-lead comment');
            expect(res.status).toBe(201);
        });

        test('G7 lead1 comments on riskByAdmin — 404', async () => {
            const res = await addComment(fx.tokens.lead1, fx.risks.riskByAdmin, 'G7 attempt');
            expect([403, 404]).toContain(res.status);
        });

        test('G8 empty comment — 400', async () => {
            const res = await addComment(fx.tokens.superuser, fx.risks.riskByMgr1, '');
            expect(res.status).toBe(400);
        });

        test('G9 member comment — 403 (middleware)', async () => {
            const res = await addComment(fx.tokens.member, fx.risks.riskByMgr1, 'G9 member attempt');
            expect(res.status).toBe(403);
        });
    });

    // ----------------------------------------------------------------------
    // Suite H — Mitigation plans
    // ----------------------------------------------------------------------

    test.describe('Suite H — Mitigation plans', () => {
        test('H1 manager1 adds mitigation plan to own risk — 201', async () => {
            const res = await addMitigationPlan(fx.tokens.manager1, fx.risks.riskByMgr1, 'H1 plan');
            expect(res.status).toBe(201);
        });

        test('H2 manager1 adds plan to riskByMgr2 — 403', async () => {
            const res = await addMitigationPlan(fx.tokens.manager1, fx.risks.riskByMgr2, 'H2 attempt');
            expect(res.status).toBe(403);
        });

        test('H3 lead1 adds plan to own risk — 201', async () => {
            const res = await addMitigationPlan(fx.tokens.lead1, fx.risks.riskByLead1, 'H3 plan');
            expect(res.status).toBe(201);
        });

        test('H4 lead1 adds plan to riskByMgr1 — 403', async () => {
            const res = await addMitigationPlan(fx.tokens.lead1, fx.risks.riskByMgr1, 'H4 attempt');
            expect(res.status).toBe(403);
        });

        test('H5 admin adds plan to riskByLead1 — 201', async () => {
            const res = await addMitigationPlan(fx.tokens.admin, fx.risks.riskByLead1, 'H5 plan by admin');
            expect(res.status).toBe(201);
        });

        test('H6 admin adds plan to riskBySu — 403', async () => {
            const res = await addMitigationPlan(fx.tokens.admin, fx.risks.riskBySu, 'H6 attempt');
            expect(res.status).toBe(403);
        });
    });

    // ----------------------------------------------------------------------
    // Suite I — Delete (uses disposable risks; deleted ones removed from createdRiskIds)
    // ----------------------------------------------------------------------

    test.describe('Suite I — Delete', () => {
        async function createDisposable(creatorRoleKey: keyof RbacFixtures['tokens'], label: string) {
            const res = await createRisk(fx.tokens[creatorRoleKey] as string, {
                projectId: fx.projectId,
                title: `[E2E-RBAC] I-disposable ${label}`,
            });
            if (res.data?.id) trackExtraRisk(fx, res.data.id);
            return res.data?.id as number;
        }

        test('I1 superuser deletes any risk', async () => {
            const id = await createDisposable('manager1', 'I1');
            const res = await deleteRisk(fx.tokens.superuser, id);
            expect(res.status).toBe(200);
            // Remove from createdRiskIds since it's gone
            fx.createdRiskIds = fx.createdRiskIds.filter(x => x !== id);
        });

        test('I2 admin deletes manager-created risk', async () => {
            const id = await createDisposable('manager1', 'I2');
            const res = await deleteRisk(fx.tokens.admin, id);
            expect(res.status).toBe(200);
            fx.createdRiskIds = fx.createdRiskIds.filter(x => x !== id);
        });

        test('I3 admin deletes superuser-created risk — 403', async () => {
            const id = await createDisposable('superuser', 'I3');
            const res = await deleteRisk(fx.tokens.admin, id);
            expect(res.status).toBe(403);
        });

        test('I4 manager1 deletes manager2 risk — 403', async () => {
            const id = await createDisposable('manager2', 'I4');
            const res = await deleteRisk(fx.tokens.manager1, id);
            expect(res.status).toBe(403);
        });

        test('I5 manager1 deletes own risk', async () => {
            const id = await createDisposable('manager1', 'I5');
            const res = await deleteRisk(fx.tokens.manager1, id);
            expect(res.status).toBe(200);
            fx.createdRiskIds = fx.createdRiskIds.filter(x => x !== id);
        });

        test('I6 lead1 deletes manager1 risk — 403', async () => {
            const id = await createDisposable('manager1', 'I6');
            const res = await deleteRisk(fx.tokens.lead1, id);
            expect(res.status).toBe(403);
        });

        test('I7 lead1 deletes own risk', async () => {
            const id = await createDisposable('lead1', 'I7');
            const res = await deleteRisk(fx.tokens.lead1, id);
            expect(res.status).toBe(200);
            fx.createdRiskIds = fx.createdRiskIds.filter(x => x !== id);
        });
    });
});
