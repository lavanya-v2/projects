/**
 * Retro Board E2E — driven through the real UI in a real browser.
 *
 * The anonymity assertions deliberately check Postgres directly rather than
 * trusting the API response: the guarantee is that the author is never STORED,
 * and only the database can confirm that.
 */

import { test, expect, type Browser } from '@playwright/test';
import {
  resolveTestUsers, authenticate, createActiveBoard, cleanupRetroData, gotoBoard,
  withDb, api, RETRO_TITLE_PREFIX, withExtraProjectAccess, findSecondProject, findOtherLead,
  type RetroUser,
} from './retro-helpers';

let users: {
  lead: RetroUser; memberA: RetroUser; memberB: RetroUser; outsider: RetroUser; projectId: number;
};

test.beforeAll(async () => {
  users = await resolveTestUsers();
  await cleanupRetroData();
});

test.afterAll(async () => {
  await cleanupRetroData();
});

async function pageAs(browser: Browser, user: RetroUser, baseURL: string) {
  const context = await browser.newContext();
  await authenticate(context, user, baseURL);
  const page = await context.newPage();
  return { context, page };
}

test.describe('Retro board — creation and participation', () => {
  test('lead creates a board through the UI and it appears in the list', async ({ browser, baseURL }) => {
    const { context, page } = await pageAs(browser, users.lead, baseURL!);

    await page.goto('/retro');
    await expect(page.getByRole('heading', { name: 'Retro Boards' })).toBeVisible();

    await page.getByTestId('new-retro').click();
    await page.getByTestId('retro-title').fill(`${RETRO_TITLE_PREFIX} UI Created Retro`);

    // MUI renders the select as a combobox; the data-testid lands on the hidden
    // native input, so drive it by role.
    await page.getByRole('combobox', { name: 'Project' }).click();
    await page.getByRole('option').first().click();

    await page.getByTestId('retro-create-submit').click();

    // Creation navigates straight into the board.
    await expect(page.getByTestId('board-status')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('board-status')).toHaveText('Draft');

    await context.close();
  });

  test('a member posts a named item and it renders with their name', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Named Items');
    const { context, page } = await pageAs(browser, users.memberA, baseURL!);

    await gotoBoard(page, board.shareToken);
    await expect(page.getByTestId('retro-lane-went_well')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('add-item-went_well').click();
    await page.getByTestId('composer-input-went_well').fill('Pipeline was smooth this sprint');
    await page.getByTestId('composer-submit-went_well').click();

    const card = page.locator('[data-testid^="retro-item-"]').filter({ hasText: 'Pipeline was smooth' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveAttribute('data-anonymous', 'false');
    await expect(card).toContainText(users.memberA.firstName);

    await context.close();
  });
});

test.describe('Anonymity — the guarantee the feature rests on', () => {
  test('an item posted anonymously stores NO author in the database', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Anonymity');
    const { context, page } = await pageAs(browser, users.memberB, baseURL!);

    await gotoBoard(page, board.shareToken);
    await expect(page.getByTestId('retro-lane-can_be_better')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('add-item-can_be_better').click();
    await page.getByTestId('composer-input-can_be_better').fill('Standups overrun consistently');
    await page.getByTestId('anon-toggle-can_be_better').click();
    await page.getByTestId('composer-submit-can_be_better').click();

    const card = page.locator('[data-testid^="retro-item-"]').filter({ hasText: 'Standups overrun' });
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveAttribute('data-anonymous', 'true');
    await expect(card.getByTestId('anonymous-badge')).toBeVisible();

    // The author's name must appear nowhere on the card.
    await expect(card).not.toContainText(users.memberB.firstName);
    await expect(card).not.toContainText(users.memberB.lastName);

    // The load-bearing assertion: go to the database.
    const row = await withDb(async db => (await db.query(
      `SELECT author_id, author_role_name, is_anonymous FROM retro_items
       WHERE board_id = $1 AND content = $2`,
      [board.id, 'Standups overrun consistently'],
    )).rows[0]);

    expect(row).toBeTruthy();
    expect(row.is_anonymous).toBe(true);
    expect(row.author_id).toBeNull();
    expect(row.author_role_name).toBeNull();

    await context.close();
  });

  test('no API response for the board leaks the anonymous author\'s id', async () => {
    const board = await createActiveBoard(users.lead, users.projectId, 'No Leak');
    await api(users.memberB, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'went_well', content: 'anon probe', isAnonymous: true,
    });

    // Check as the facilitator, who is the most privileged viewer of this board.
    const asLead = await api(users.lead, 'GET', `/retro/boards/${board.id}`);
    const payload = JSON.stringify(asLead.data);
    const item = asLead.data.data.items.find((i: any) => i.content === 'anon probe');

    expect(item.author).toBeNull();
    expect(item.isAnonymous).toBe(true);
    expect(payload).not.toContain(users.memberB.userId);
    expect(JSON.stringify(item)).not.toContain(String(users.memberB.id));
  });

  test('the UI explains why an anonymous item cannot be edited', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Anon Explainer');
    const created = await api(users.memberB, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'went_well', content: 'anon uneditable probe', isAnonymous: true,
    });
    expect(created.status).toBe(201);

    // Open as the person who actually wrote it — they get no edit control either.
    const { context, page } = await pageAs(browser, users.memberB, baseURL!);
    await gotoBoard(page, board.shareToken);

    const card = page.locator('[data-testid^="retro-item-"]').filter({ hasText: 'anon uneditable probe' });
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();

    await expect(page.getByTestId('anon-explainer')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);

    await context.close();
  });
});

test.describe('Access control', () => {
  test('a user outside the project is refused, share link and all', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Access Denied');
    const { context, page } = await pageAs(browser, users.outsider, baseURL!);

    await gotoBoard(page, board.shareToken);

    await expect(page.getByTestId('board-access-error')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('retro-lane-went_well')).toHaveCount(0);

    await context.close();
  });

  test('a member sees no "New Retro" button', async ({ browser, baseURL }) => {
    const { context, page } = await pageAs(browser, users.memberA, baseURL!);
    // Members are not routed to the list page, but even reaching it they cannot create.
    await page.goto('/retro');
    await expect(page.getByTestId('new-retro')).toHaveCount(0);
    await context.close();
  });
});

test.describe('Realtime', () => {
  test('one participant\'s item appears in another\'s browser without a reload', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Realtime');

    const a = await pageAs(browser, users.memberA, baseURL!);
    const b = await pageAs(browser, users.memberB, baseURL!);

    await gotoBoard(a.page, board.shareToken);
    await gotoBoard(b.page, board.shareToken);

    // Both sockets must actually be connected, or this would only prove polling.
    await expect(a.page.getByTestId('live-indicator')).toContainText('Synced', { timeout: 20000 });
    await expect(b.page.getByTestId('live-indicator')).toContainText('Synced', { timeout: 20000 });

    await a.page.getByTestId('add-item-went_well').click();
    await a.page.getByTestId('composer-input-went_well').fill('Realtime propagation check');
    await a.page.getByTestId('composer-submit-went_well').click();

    // 4s is under the 5s polling fallback, so arriving in time means it was pushed.
    await expect(
      b.page.locator('[data-testid^="retro-item-"]').filter({ hasText: 'Realtime propagation check' }),
    ).toBeVisible({ timeout: 4000 });

    await a.context.close();
    await b.context.close();
  });

  test('completing the retro makes a participant\'s board read-only live', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Freeze Live');

    const lead = await pageAs(browser, users.lead, baseURL!);
    const member = await pageAs(browser, users.memberA, baseURL!);

    await gotoBoard(lead.page, board.shareToken);
    await gotoBoard(member.page, board.shareToken);

    await expect(member.page.getByTestId('add-item-went_well')).toBeVisible({ timeout: 15000 });
    await expect(member.page.getByTestId('live-indicator')).toContainText('Synced', { timeout: 20000 });

    await lead.page.getByTestId('complete-board').click();

    // The member's board freezes without them doing anything.
    await expect(member.page.getByTestId('frozen-notice')).toBeVisible({ timeout: 8000 });
    await expect(member.page.getByTestId('add-item-went_well')).toHaveCount(0);

    await lead.context.close();
    await member.context.close();
  });
});

test.describe('Voting and top 3', () => {
  test('a member votes and the facilitator ranks the top 3', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Voting');
    const created = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'went_well', content: 'Worth ranking',
    });
    const itemId = created.data.data.id;

    const { context, page } = await pageAs(browser, users.memberB, baseURL!);
    await gotoBoard(page, board.shareToken);
    await expect(page.getByTestId(`retro-item-${itemId}`)).toBeVisible({ timeout: 15000 });

    await page.getByTestId(`vote-${itemId}`).click();
    await expect(page.getByTestId(`retro-item-${itemId}`)).toContainText('1', { timeout: 8000 });
    await context.close();

    // A member has no ranking control; the facilitator does.
    const memberSession = await pageAs(browser, users.memberA, baseURL!);
    await gotoBoard(memberSession.page, board.shareToken);
    await memberSession.page.getByTestId(`retro-item-${itemId}`).click();
    await expect(memberSession.page.getByTestId('top-pick-select')).toHaveCount(0);
    await memberSession.context.close();

    const leadSession = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(leadSession.page, board.shareToken);
    await leadSession.page.getByTestId(`retro-item-${itemId}`).click();
    await leadSession.page.getByTestId('top-pick-select').click();
    await leadSession.page.getByRole('option', { name: 'Top 1' }).click();

    await expect(leadSession.page.getByText('Top 1').first()).toBeVisible({ timeout: 8000 });

    const rank = await withDb(async db => (await db.query(
      'SELECT top_pick_rank FROM retro_items WHERE id = $1', [itemId],
    )).rows[0].top_pick_rank);
    expect(rank).toBe(1);

    await leadSession.context.close();
  });
});

test.describe('Conversion — optional, facilitator only', () => {
  test('the facilitator converts an item into a project action item', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Conversion');
    const created = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'can_be_better', content: 'Flaky tests need attention',
    });
    const itemId = created.data.data.id;

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, board.shareToken);
    await page.getByTestId(`retro-item-${itemId}`).click();

    await expect(page.getByTestId('convert-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('convert-btn').click();

    await page.getByTestId('convert-owner').fill('QA Team');
    await page.getByTestId('convert-submit').click();

    // The card now shows the link to the created work.
    await expect(page.getByTestId(`retro-item-${itemId}`)).toContainText('Action #', { timeout: 10000 });

    const row = await withDb(async db => (await db.query(
      `SELECT ri.converted_type, ri.converted_ref_id, pai.project_id, pai.created_by_id
       FROM retro_items ri JOIN project_action_items pai ON pai.id = ri.converted_ref_id
       WHERE ri.id = $1`, [itemId],
    )).rows[0]);

    expect(row.converted_type).toBe('ACTION_ITEM');
    expect(row.project_id).toBe(users.projectId);
    // Credited to the facilitator who made the call, not to the retro author.
    expect(row.created_by_id).toBe(users.lead.id);

    await context.close();
  });

  test('a member never sees the conversion control', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'No Convert');
    const created = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'went_well', content: 'Member cannot convert this',
    });

    const { context, page } = await pageAs(browser, users.memberA, baseURL!);
    await gotoBoard(page, board.shareToken);
    await page.getByTestId(`retro-item-${created.data.data.id}`).click();
    await expect(page.getByTestId('convert-btn')).toHaveCount(0);
    await context.close();
  });
});

test.describe('Comments', () => {
  test('a member comments and the count shows on the card', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Comments');
    const created = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'went_well', content: 'Discuss this one',
    });
    const itemId = created.data.data.id;

    const { context, page } = await pageAs(browser, users.memberB, baseURL!);
    await gotoBoard(page, board.shareToken);
    await page.getByTestId(`retro-item-${itemId}`).click();

    await page.getByTestId('comment-input').fill('Strongly agree with this');
    await page.getByTestId('comment-submit').click();

    await expect(page.getByText('Strongly agree with this')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId(`retro-item-${itemId}`)).toContainText('1');

    await context.close();
  });
});

test.describe('Navigation and heading', () => {
  test('the page heading shows "Retro Board", never the raw share token', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'Heading');
    const { context, page } = await pageAs(browser, users.lead, baseURL!);

    await gotoBoard(page, board.shareToken);
    await expect(page.getByTestId('retro-lane-went_well')).toBeVisible({ timeout: 15000 });

    // The token must not be rendered as a heading anywhere on the page.
    await expect(page.getByRole('heading', { name: board.shareToken })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(board.shareToken);

    await context.close();
  });

  test('a lead gets a back link to the listing; a member does not', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'BackNav');

    const lead = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(lead.page, board.shareToken);
    await expect(lead.page.getByTestId('back-to-list')).toBeVisible({ timeout: 15000 });
    await lead.page.getByTestId('back-to-list').click();
    await expect(lead.page).toHaveURL(/\/retro$/);
    await expect(lead.page.getByRole('heading', { name: 'Retro Boards' })).toBeVisible();
    await lead.context.close();

    // A member who arrived via the share link has no listing to return to.
    const member = await pageAs(browser, users.memberA, baseURL!);
    await gotoBoard(member.page, board.shareToken);
    await expect(member.page.getByTestId('retro-lane-went_well')).toBeVisible({ timeout: 15000 });
    await expect(member.page.getByTestId('back-to-list')).toHaveCount(0);
    await member.context.close();
  });
});

test.describe('Voting drives the top 3', () => {
  test('most-voted items surface as candidates the facilitator promotes', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'VoteToTop3');

    const low = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'went_well', content: 'Low interest point',
    });
    const high = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'can_be_better', content: 'High interest point',
    });

    // Two people vote for the same item; one votes for the other.
    await api(users.memberA, 'POST', `/retro/items/${high.data.data.id}/vote`, {});
    await api(users.memberB, 'POST', `/retro/items/${high.data.data.id}/vote`, {});
    await api(users.memberB, 'POST', `/retro/items/${low.data.data.id}/vote`, {});

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, board.shareToken);

    const panel = page.getByTestId('top-picks-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });

    // The highest-voted item is offered first for promotion.
    const firstCandidate = panel.locator('[data-testid^="candidate-"]').first();
    await expect(firstCandidate).toContainText('High interest point');

    await page.getByTestId(`promote-${high.data.data.id}`).click();
    await expect(page.getByTestId('top-pick-1')).toContainText('High interest point', { timeout: 8000 });

    const rank = await withDb(async db => (await db.query(
      'SELECT top_pick_rank FROM retro_items WHERE id = $1', [high.data.data.id],
    )).rows[0].top_pick_rank);
    expect(rank).toBe(1);

    await context.close();
  });

  test('a member sees the agreed top 3 but cannot promote', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'MemberTop3');
    const item = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
      laneKey: 'went_well', content: 'Agreed point',
    });
    await api(users.memberA, 'POST', `/retro/items/${item.data.data.id}/vote`, {});
    await api(users.lead, 'PUT', `/retro/items/${item.data.data.id}/top-pick`, { rank: 1 });

    const { context, page } = await pageAs(browser, users.memberA, baseURL!);
    await gotoBoard(page, board.shareToken);

    await expect(page.getByTestId('top-pick-1')).toContainText('Agreed point', { timeout: 15000 });
    await expect(page.locator('[data-testid^="promote-"]')).toHaveCount(0);

    await context.close();
  });
});

test.describe('Vote budget guidance and settings', () => {
  test('the panel suggests a vote count based on item count, and applying it works', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'VoteSuggestion');

    // 18 items → heuristic suggests 6, against a default budget of 3.
    for (let i = 0; i < 18; i++) {
      await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
        laneKey: ['went_well', 'can_be_better', 'action_items'][i % 3],
        content: `Item number ${i}`,
      });
    }

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, board.shareToken);

    const suggestion = page.getByTestId('vote-suggestion');
    await expect(suggestion).toBeVisible({ timeout: 15000 });
    await expect(suggestion).toContainText('18 items');
    await expect(suggestion).toContainText('6 votes');

    await page.getByTestId('apply-vote-suggestion').click();
    await expect(page.getByTestId('vote-counter')).toContainText('of 6 votes', { timeout: 8000 });

    const stored = await withDb(async db => (await db.query(
      'SELECT votes_per_user FROM retro_boards WHERE id = $1', [board.id],
    )).rows[0].votes_per_user);
    expect(stored).toBe(6);

    await context.close();
  });

  test('the suggestion disappears once voting has started', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'NoSuggestAfterVotes');
    for (let i = 0; i < 18; i++) {
      const r = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
        laneKey: 'went_well', content: `Voted item ${i}`,
      });
      if (i === 0) await api(users.memberB, 'POST', `/retro/items/${r.data.data.id}/vote`, {});
    }

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, board.shareToken);
    await expect(page.getByTestId('top-picks-panel')).toBeVisible({ timeout: 15000 });
    // Changing the budget after votes are cast would invalidate them, so the
    // nudge is only offered before voting begins.
    await expect(page.getByTestId('vote-suggestion')).toHaveCount(0);

    await context.close();
  });

  test('the lead changes the budget mid-meeting and a participant sees it live', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'LiveBudget');

    const lead = await pageAs(browser, users.lead, baseURL!);
    const member = await pageAs(browser, users.memberA, baseURL!);
    await gotoBoard(lead.page, board.shareToken);
    await gotoBoard(member.page, board.shareToken);

    await expect(member.page.getByTestId('vote-counter')).toContainText('of 3 votes', { timeout: 15000 });
    await expect(member.page.getByTestId('live-indicator')).toContainText('Synced', { timeout: 20000 });

    await lead.page.getByTestId('board-settings').click();
    await lead.page.getByTestId('settings-votes').fill('7');
    await lead.page.getByTestId('settings-save').click();

    // Pushed over the socket via board_updated — no reload on the member's side.
    await expect(member.page.getByTestId('vote-counter')).toContainText('of 7 votes', { timeout: 8000 });

    await lead.context.close();
    await member.context.close();
  });

  test('a member gets no settings button', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'NoSettingsForMember');
    const { context, page } = await pageAs(browser, users.memberA, baseURL!);
    await gotoBoard(page, board.shareToken);
    await expect(page.getByTestId('retro-lane-went_well')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('board-settings')).toHaveCount(0);
    await context.close();
  });

  test('settings are gone once the retro is completed', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'SettingsFrozen');
    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, board.shareToken);

    await expect(page.getByTestId('board-settings')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('complete-board').click();
    await expect(page.getByTestId('frozen-notice')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('board-settings')).toHaveCount(0);

    await context.close();
  });

  test('a lowered budget explains the over-spend instead of showing "5 of 2"', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'OverBudget');
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await api(users.memberA, 'POST', `/retro/boards/${board.id}/items`, {
        laneKey: 'went_well', content: `Over budget item ${i}`,
      });
      ids.push(r.data.data.id);
    }
    for (const id of ids) await api(users.memberB, 'POST', `/retro/items/${id}/vote`, {});
    await api(users.lead, 'PATCH', `/retro/boards/${board.id}`, { votesPerUser: 1 });

    const { context, page } = await pageAs(browser, users.memberB, baseURL!);
    await gotoBoard(page, board.shareToken);

    const counter = page.getByTestId('vote-counter');
    await expect(counter).toBeVisible({ timeout: 15000 });
    await expect(counter).toContainText('limit is now 1');
    await expect(counter).toContainText('Remove 2');
    await expect(counter).not.toContainText('of 1 votes');

    await context.close();
  });
});

test.describe('Continuity between retros', () => {
  /**
   * Build a completed retro with three agreed points, one of which was
   * converted into an Action Item — the realistic starting state for a review.
   */
  async function completedRetroWithAgreedPoints(label: string) {
    const boardA = await createActiveBoard(users.lead, users.projectId, label);

    const p1 = await api(users.memberA, 'POST', `/retro/boards/${boardA.id}/items`,
      { laneKey: 'can_be_better', content: 'Reduce PR review turnaround' });
    const p2 = await api(users.memberA, 'POST', `/retro/boards/${boardA.id}/items`,
      { laneKey: 'can_be_better', content: 'Standups overrun' });
    const p3 = await api(users.memberA, 'POST', `/retro/boards/${boardA.id}/items`,
      { laneKey: 'went_well', content: 'Keep pairing on tricky tickets' });

    await api(users.lead, 'PUT', `/retro/items/${p1.data.data.id}/top-pick`, { rank: 1 });
    await api(users.lead, 'PUT', `/retro/items/${p2.data.data.id}/top-pick`, { rank: 2 });
    await api(users.lead, 'PUT', `/retro/items/${p3.data.data.id}/top-pick`, { rank: 3 });

    const conv = await api(users.lead, 'POST', `/retro/items/${p1.data.data.id}/convert/action-item`,
      { category: 'Task', owner: 'Dev Team' });

    await api(users.lead, 'POST', `/retro/boards/${boardA.id}/status`, { status: 'COMPLETED' });

    return {
      boardA,
      points: { p1: p1.data.data.id, p2: p2.data.data.id, p3: p3.data.data.id },
      actionItemId: conv.data.data.actionItem.id,
    };
  }

  test('a new retro opens with the previous retro\'s agreed points and live status', async ({ browser, baseURL }) => {
    const prior = await completedRetroWithAgreedPoints('Prior');
    const boardB = await createActiveBoard(users.lead, users.projectId, 'Next');

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, boardB.shareToken);

    const panel = page.getByTestId('carry-forward-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel).toContainText('Reduce PR review turnaround');
    await expect(panel).toContainText('Standups overrun');

    // The converted point shows its real Action Item status.
    await expect(page.getByTestId(`carried-linked-${prior.points.p1}`)).toContainText('Open');
    // The unconverted ones say so plainly.
    await expect(page.getByTestId(`carried-unlinked-${prior.points.p2}`)).toBeVisible();

    await context.close();
  });

  test('linked status is read live, not snapshotted at conversion', async ({ browser, baseURL }) => {
    const prior = await completedRetroWithAgreedPoints('LiveStatus');
    const boardB = await createActiveBoard(users.lead, users.projectId, 'LiveStatusNext');

    // Move the action item on via its own API, entirely outside the retro.
    await api(users.lead, 'POST', `/report/action-item/${prior.actionItemId}/transition`,
      { toStatus: 'In-Progress', note: 'picked up' });

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, boardB.shareToken);

    await expect(page.getByTestId(`carried-linked-${prior.points.p1}`))
      .toContainText('In-Progress', { timeout: 15000 });

    await context.close();
  });

  test('the facilitator records an outcome and it persists with the audit chain', async ({ browser, baseURL }) => {
    const prior = await completedRetroWithAgreedPoints('Outcome');
    const boardB = await createActiveBoard(users.lead, users.projectId, 'OutcomeNext');

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, boardB.shareToken);

    await expect(page.getByTestId('carry-forward-panel')).toBeVisible({ timeout: 15000 });

    await page.getByTestId(`carried-note-toggle-${prior.points.p2}`).click();
    await page.getByTestId(`carried-note-input-${prior.points.p2}`).fill('Superseded by the new format');
    await page.getByTestId(`set-outcome-DROPPED-${prior.points.p2}`).click();

    await expect(page.getByTestId(`carried-outcome-${prior.points.p2}`)).toContainText('Dropped', { timeout: 8000 });

    const row = await withDb(async db => (await db.query(
      `SELECT outcome, outcome_note, outcome_by_id, outcome_reviewed_in_board_id
       FROM retro_items WHERE id = $1`, [prior.points.p2],
    )).rows[0]);

    expect(row.outcome).toBe('DROPPED');
    expect(row.outcome_note).toBe('Superseded by the new format');
    expect(row.outcome_by_id).toBe(users.lead.id);
    // The audit chain: reviewed in the NEW retro, not the one that agreed it.
    expect(row.outcome_reviewed_in_board_id).toBe(boardB.id);

    await context.close();
  });

  test('the facilitator converts a carried point into tracked work', async ({ browser, baseURL }) => {
    const prior = await completedRetroWithAgreedPoints('CarriedConvert');
    const boardB = await createActiveBoard(users.lead, users.projectId, 'CarriedConvertNext');

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, boardB.shareToken);

    await expect(page.getByTestId('carry-forward-panel')).toBeVisible({ timeout: 15000 });
    // p2 was agreed last retro and nobody picked it up — the exact case the
    // panel exists to surface.
    await expect(page.getByTestId(`carried-unlinked-${prior.points.p2}`)).toBeVisible();

    await page.getByTestId(`carried-convert-${prior.points.p2}`).click();
    await page.getByTestId('convert-owner').fill('Dev Team');
    await page.getByTestId('convert-submit').click();

    // The panel swaps the "no action was created" note for the live status.
    await expect(page.getByTestId(`carried-linked-${prior.points.p2}`))
      .toContainText('Open', { timeout: 10000 });
    await expect(page.getByTestId(`carried-unlinked-${prior.points.p2}`)).toHaveCount(0);

    const row = await withDb(async db => (await db.query(
      `SELECT converted_type, converted_ref_id, board_id, top_pick_rank FROM retro_items WHERE id = $1`,
      [prior.points.p2],
    )).rows[0]);

    expect(row.converted_type).toBe('ACTION_ITEM');
    expect(row.converted_ref_id).toBeGreaterThan(0);
    // Provenance stays with the retro that agreed the point, not the one
    // reviewing it, and the agreement itself is untouched.
    expect(row.board_id).toBe(prior.boardA.id);
    expect(row.top_pick_rank).toBe(2);

    // The previous board is still frozen — converting did not reopen it.
    const priorStatus = await withDb(async db => (await db.query(
      `SELECT status FROM retro_boards WHERE id = $1`, [prior.boardA.id],
    )).rows[0].status);
    expect(priorStatus).toBe('COMPLETED');

    await context.close();
  });

  test('a different lead can convert a carried point that the old route refuses', async () => {
    const prior = await completedRetroWithAgreedPoints('OtherLead');

    const otherLead = await findOtherLead(users.lead.id);
    test.skip(!otherLead, 'no second lead in the database');

    await withExtraProjectAccess(otherLead!.id, users.projectId, async () => {
      // This lead runs the NEXT retro; they did not create the previous one.
      const boardB = await createActiveBoard(otherLead!, users.projectId, 'OtherLeadNext');

      // The item-scoped route authorises against the board that OWNS the item —
      // the previous retro, which this lead does not facilitate.
      const viaItem = await api(otherLead!, 'POST',
        `/retro/items/${prior.points.p2}/convert/action-item`, { category: 'Task', owner: 'Dev Team' });
      expect(viaItem.status).toBe(403);

      // The carry-forward route authorises against the board they ARE running.
      const viaCarry = await api(otherLead!, 'POST',
        `/retro/boards/${boardB.id}/carry-forward/${prior.points.p2}/convert/action-item`,
        { category: 'Task', owner: 'Dev Team' });
      expect(viaCarry.status).toBe(201);

      const linked = viaCarry.data.data.points.find((p: any) => p.id === prior.points.p2);
      expect(linked.linked).not.toBeNull();
      expect(linked.linked.type).toBe('ACTION_ITEM');
    });
  });

  test('a member sees the review read-only', async ({ browser, baseURL }) => {
    const prior = await completedRetroWithAgreedPoints('MemberRO');
    const boardB = await createActiveBoard(users.lead, users.projectId, 'MemberRONext');

    const { context, page } = await pageAs(browser, users.memberA, baseURL!);
    await gotoBoard(page, boardB.shareToken);

    await expect(page.getByTestId('carry-forward-panel')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`set-outcome-DONE-${prior.points.p2}`)).toHaveCount(0);

    await context.close();
  });

  test('a project\'s first retro shows no carry-forward panel', async ({ browser, baseURL }) => {
    // Guarantee a project with no prior completed retro by using a fresh one.
    await cleanupRetroData();
    const board = await createActiveBoard(users.lead, users.projectId, 'FirstEver');

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, board.shareToken);

    await expect(page.getByTestId('retro-lane-went_well')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('carry-forward-panel')).toHaveCount(0);

    await context.close();
  });

  test('an outcome cannot be recorded against another project\'s retro', async () => {
    const prior = await completedRetroWithAgreedPoints('CrossProject');

    // Find a project the lead can reach that is NOT the one above.
    const otherProjectId = await withDb(async db => (await db.query(
      `SELECT unnest(project_ids) AS pid FROM user_permissions
       WHERE user_id = $1 AND project_ids IS NOT NULL`, [users.lead.id],
    )).rows.map((r: any) => r.pid).find((pid: number) => pid !== users.projectId));

    test.skip(!otherProjectId, 'lead only has one project');

    const otherBoard = await createActiveBoard(users.lead, otherProjectId as number, 'OtherProject');
    const res = await api(users.lead, 'PUT',
      `/retro/boards/${otherBoard.id}/carry-forward/${prior.points.p2}/outcome`, { outcome: 'DONE' });

    expect(res.status).toBe(403);
  });

  test('a repeated agreed point is flagged in the project history', async ({ browser, baseURL }) => {
    await cleanupRetroData();

    // Same concern raised in two separate completed retros.
    for (const label of ['RepeatOne', 'RepeatTwo']) {
      const b = await createActiveBoard(users.lead, users.projectId, label);
      const item = await api(users.memberA, 'POST', `/retro/boards/${b.id}/items`,
        { laneKey: 'can_be_better', content: 'Standups overrun every day' });
      await api(users.lead, 'PUT', `/retro/items/${item.data.data.id}/top-pick`, { rank: 1 });
      await api(users.lead, 'POST', `/retro/boards/${b.id}/status`, { status: 'COMPLETED' });
    }

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await page.goto('/retro');
    await page.getByTestId('tab-agreed-points').click();

    await expect(page.getByTestId('agreed-theme-0')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('repeat-badge-0')).toContainText('2 retros');
    // Raised twice, never actioned — the case worth surfacing.
    await expect(page.getByTestId('unresolved-badge-0')).toBeVisible();

    await context.close();
  });
});

test.describe('Connection indicator', () => {
  test('shows "Live" only while the retro is active, never beside "Completed"', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'LiveChip');
    const { context, page } = await pageAs(browser, users.lead, baseURL!);

    await gotoBoard(page, board.shareToken);

    // While the retro is running, connection state is real information.
    await expect(page.getByTestId('board-status')).toHaveText('Live', { timeout: 15000 });
    await expect(page.getByTestId('live-indicator')).toContainText('Synced', { timeout: 20000 });
    // The two chips must never say the same word — that collision was the bug.
    await expect(page.getByTestId('live-indicator')).not.toContainText('Live');

    await page.getByTestId('complete-board').click();

    // Once frozen, the chip must be gone — "Completed · Live" reads as a
    // contradiction even though the two describe different things.
    await expect(page.getByTestId('board-status')).toHaveText('Completed', { timeout: 10000 });
    await expect(page.getByTestId('live-indicator')).toHaveCount(0);

    await context.close();
  });

  test('a draft board shows no connection chip', async ({ browser, baseURL }) => {
    // Drafts are a solo setup phase, so there is nothing to be live about.
    const created = await api(users.lead, 'POST', '/retro/boards', {
      projectId: users.projectId,
      title: `${RETRO_TITLE_PREFIX} DraftChip`,
      meetingDate: new Date().toISOString().slice(0, 10),
      meetingTime: '10:00',
      laneTemplate: 'WENT_WELL',
    });

    const { context, page } = await pageAs(browser, users.lead, baseURL!);
    await gotoBoard(page, created.data.data.shareToken);

    await expect(page.getByTestId('board-status')).toHaveText('Draft', { timeout: 15000 });
    await expect(page.getByTestId('live-indicator')).toHaveCount(0);

    await context.close();
  });
});

/**
 * Header controls across EVERY board state.
 *
 * Added after a shipped bug ("Completed · Live") that 29 passing tests missed,
 * because each existing test only exercised the state it was written for. This
 * sweeps all four states and asserts what is shown AND what is not, so a
 * control that renders unconditionally cannot pass unnoticed again.
 */
test.describe('Header controls in every board state', () => {
  async function boardInState(label: string, status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED') {
    const created = await api(users.lead, 'POST', '/retro/boards', {
      projectId: users.projectId,
      title: `${RETRO_TITLE_PREFIX} ${label}`,
      meetingDate: new Date().toISOString().slice(0, 10),
      meetingTime: '10:00',
      laneTemplate: 'WENT_WELL',
    });
    const board = created.data.data;

    if (status !== 'DRAFT') {
      await api(users.lead, 'POST', `/retro/boards/${board.id}/status`, { status: 'ACTIVE' });
    }
    if (status === 'COMPLETED' || status === 'ARCHIVED') {
      await api(users.lead, 'POST', `/retro/boards/${board.id}/status`, { status: 'COMPLETED' });
    }
    if (status === 'ARCHIVED') {
      await api(users.lead, 'POST', `/retro/boards/${board.id}/status`, { status: 'ARCHIVED' });
    }
    return board;
  }

  const EXPECTATIONS = [
    { status: 'DRAFT' as const, statusLabel: 'Draft', sync: false, frozen: false, canAdd: true, shareEnabled: false },
    { status: 'ACTIVE' as const, statusLabel: 'Live', sync: true, frozen: false, canAdd: true, shareEnabled: true },
    { status: 'COMPLETED' as const, statusLabel: 'Completed', sync: false, frozen: true, canAdd: false, shareEnabled: true },
    { status: 'ARCHIVED' as const, statusLabel: 'Archived', sync: false, frozen: true, canAdd: false, shareEnabled: true },
  ];

  for (const exp of EXPECTATIONS) {
    test(`${exp.status}: shows the right controls and hides the wrong ones`, async ({ browser, baseURL }) => {
      const board = await boardInState(`State-${exp.status}`, exp.status);
      const { context, page } = await pageAs(browser, users.lead, baseURL!);
      await gotoBoard(page, board.shareToken);

      await expect(page.getByTestId('board-status')).toHaveText(exp.statusLabel, { timeout: 15000 });

      // The connection chip is transport state and must appear only while live.
      await expect(page.getByTestId('live-indicator')).toHaveCount(exp.sync ? 1 : 0);

      // A frozen board must explain itself rather than just losing its controls.
      await expect(page.getByTestId('frozen-notice')).toHaveCount(exp.frozen ? 1 : 0);

      // Composer presence must track writability.
      await expect(page.getByTestId('add-item-went_well')).toHaveCount(exp.canAdd ? 1 : 0);

      // Sharing a draft link would 403 everyone it is sent to.
      const share = page.getByTestId('copy-link');
      await expect(share).toHaveCount(1);
      if (exp.shareEnabled) await expect(share).toBeEnabled();
      else await expect(share).toBeDisabled();

      // Whatever the state, no two header chips may claim the same word.
      const statusText = await page.getByTestId('board-status').textContent();
      if (exp.sync) {
        const syncText = await page.getByTestId('live-indicator').textContent();
        expect(syncText?.trim()).not.toBe(statusText?.trim());
      }

      await context.close();
    });
  }
});

/**
 * Who can reach the board list.
 *
 * The backend has always scoped retros per project via getAccessibleProjectIds,
 * but the list ROUTE was guarded to lead-and-above while the nav entry was shown
 * to members — so a member clicked a menu item they could see and was redirected
 * away. These tests pin nav visibility and route access together.
 */
test.describe('List access for the project team', () => {
  test('a member can open the retro list and sees their project\'s boards', async ({ browser, baseURL }) => {
    const board = await createActiveBoard(users.lead, users.projectId, 'MemberList');
    const { context, page } = await pageAs(browser, users.memberA, baseURL!);

    await page.goto('/retro');

    // Must NOT be redirected away — this is the regression that must not return.
    await expect(page).toHaveURL(/\/retro$/);
    await expect(page.getByRole('heading', { name: 'Retro Boards' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`board-card-${board.id}`)).toBeVisible();

    await context.close();
  });

  test('the nav entry a member sees actually navigates to the list', async ({ browser, baseURL }) => {
    await createActiveBoard(users.lead, users.projectId, 'MemberNav');
    const { context, page } = await pageAs(browser, users.memberA, baseURL!);

    await page.goto('/dashboard');

    // The rail renders icon-only buttons whose name comes from a MUI Tooltip
    // (an aria-label), so getByText cannot match them. Clicking a section
    // navigates to its first visible item — and for a member the only
    // Management item is Retro Boards, so this is a single click in practice.
    await page.getByLabel('Management').first().click();

    await expect(page).toHaveURL(/\/retro$/);
    await expect(page.getByRole('heading', { name: 'Retro Boards' })).toBeVisible({ timeout: 15000 });

    await context.close();
  });

  test('a member\'s list is scoped — no boards from projects they cannot reach', async ({ browser, baseURL }) => {
    const mine = await createActiveBoard(users.lead, users.projectId, 'ScopedMine');

    // A board on a project this member has no permission for.
    const otherProjectId = await withDb(async db => (await db.query(
      `SELECT unnest(project_ids) AS pid FROM user_permissions
       WHERE user_id = $1 AND project_ids IS NOT NULL`, [users.outsider.id],
    )).rows.map((r: any) => r.pid).find((pid: number) => pid !== users.projectId));

    test.skip(!otherProjectId, 'no second project available in seed data');

    const theirs = await createActiveBoard(users.outsider, otherProjectId as number, 'ScopedTheirs')
      .catch(() => null);
    test.skip(!theirs, 'outsider cannot create a board (not lead+)');

    const { context, page } = await pageAs(browser, users.memberA, baseURL!);
    await page.goto('/retro');

    await expect(page.getByTestId(`board-card-${mine.id}`)).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`board-card-${theirs!.id}`)).toHaveCount(0);

    await context.close();
  });

  test('a draft board still does not appear in a member\'s list', async ({ browser, baseURL }) => {
    const draft = await api(users.lead, 'POST', '/retro/boards', {
      projectId: users.projectId,
      title: `${RETRO_TITLE_PREFIX} HiddenDraft`,
      meetingDate: new Date().toISOString().slice(0, 10),
      meetingTime: '10:00', laneTemplate: 'WENT_WELL',
    });

    const { context, page } = await pageAs(browser, users.memberA, baseURL!);
    await page.goto('/retro');
    await expect(page.getByRole('heading', { name: 'Retro Boards' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(`board-card-${draft.data.data.id}`)).toHaveCount(0);

    await context.close();
  });
});

test.describe('Multi-project list rendering', () => {
  test('a single-project user sees no filter or project headings', async ({ browser, baseURL }) => {
    await cleanupRetroData();
    await createActiveBoard(users.lead, users.projectId, 'SoloProject');

    const { context, page } = await pageAs(browser, users.memberA, baseURL!);
    await page.goto('/retro');

    await expect(page.getByTestId(`project-group-${users.projectId}`)).toBeVisible({ timeout: 15000 });
    // Chrome that would be pure noise for the common case.
    await expect(page.getByTestId('board-project-filter')).toHaveCount(0);
    await expect(page.getByTestId(`project-heading-${users.projectId}`)).toHaveCount(0);

    await context.close();
  });

  test('a multi-project user gets headings, and the filter narrows to one project', async ({ browser, baseURL }) => {
    await cleanupRetroData();

    const second = await findSecondProject(users.projectId);
    expect(second, 'seed data must contain a second project in the same account').toBeTruthy();

    // Provision rather than skip: this is the feature under test.
    await withExtraProjectAccess(users.lead.id, second as number, async () => {
      const a = await createActiveBoard(users.lead, users.projectId, 'ProjA');
      const b = await createActiveBoard(users.lead, second as number, 'ProjB');

      const { context, page } = await pageAs(browser, users.lead, baseURL!);
      await page.goto('/retro');

      // Both projects present, each under its own heading.
      await expect(page.getByTestId(`project-heading-${users.projectId}`)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`project-heading-${second as number}`)).toBeVisible();
      await expect(page.getByTestId(`board-card-${a.id}`)).toBeVisible();
      await expect(page.getByTestId(`board-card-${b.id}`)).toBeVisible();

      // Filtering to the second project hides the first project's boards.
      await page.getByRole('combobox', { name: 'Project' }).click();
      await page.getByRole('option', { name: /\(\d+\)/ }).nth(1).click();

      await expect(page.getByTestId(`board-card-${b.id}`)).toBeVisible();
      await expect(page.getByTestId(`board-card-${a.id}`)).toHaveCount(0);

      await context.close();
    });
  });
});

