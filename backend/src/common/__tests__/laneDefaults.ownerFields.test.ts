import { describe, it, expect } from 'vitest';
import { DEFAULT_OWNER_FIELDS, getOwnerFields, getOwnerFieldNames, type LaneConfig } from '../laneDefaults';
import { buildIssueFieldList } from '../../modules/jira/services/jiraFields';

const project = (jiraLaneConfig: LaneConfig | null) => ({ jiraLaneConfig });

describe('getOwnerFields', () => {
  // The whole CCM-safety argument rests on this: an unconfigured project must
  // behave exactly as it did before the setting existed.
  it("returns today's hardcoded behaviour when nothing is configured", () => {
    for (const p of [undefined, project(null), project({}), project({ ownerFields: {} })]) {
      expect(getOwnerFields(p)).toEqual({
        developer: ['assignee'],
        qa: ['QA Assignee', 'Assigned QA', 'QA Owner', 'QA'],
        uat: ['UAT Assignee', 'Assigned UAT', 'UAT Owner', 'UAT'],
        creditChangelogAuthor: false,
      });
    }
  });

  it('falls back per role, so overriding developer keeps the standard QA/UAT lists', () => {
    const resolved = getOwnerFields(project({ ownerFields: { developer: ['Developer'] } }));
    expect(resolved.developer).toEqual(['Developer']);
    expect(resolved.qa).toEqual(DEFAULT_OWNER_FIELDS.qa);
    expect(resolved.uat).toEqual(DEFAULT_OWNER_FIELDS.uat);
  });

  // Thrive has no UAT field at all. An explicit [] must mean "no field here",
  // not "unset" — otherwise the default list comes back and we read fields that
  // do not exist on that instance.
  it('preserves an explicit empty array rather than substituting the default', () => {
    const resolved = getOwnerFields(project({ ownerFields: { uat: [] } }));
    expect(resolved.uat).toEqual([]);
  });

  it('keeps the changelog-author credit off unless a project opts in', () => {
    expect(getOwnerFields(project({ ownerFields: {} })).creditChangelogAuthor).toBe(false);
    expect(getOwnerFields(project({ ownerFields: { creditChangelogAuthor: true } })).creditChangelogAuthor).toBe(true);
  });

  it('reads alongside other lane config without disturbing it', () => {
    const cfg: LaneConfig = {
      assigneeMode: 'shared',
      done: ['Closed'],
      ownerFields: { developer: ['Developer', 'assignee'] },
    };
    expect(getOwnerFields(project(cfg)).developer).toEqual(['Developer', 'assignee']);
    expect(cfg.assigneeMode).toBe('shared');
    expect(cfg.done).toEqual(['Closed']);
  });
});

describe('getOwnerFieldNames', () => {
  // These names drive the Jira fetch allowlist. 'assignee' is built in and always
  // requested, so including it would be a no-op at best and a bogus custom-field
  // lookup at worst.
  it('excludes the built-in assignee and de-duplicates', () => {
    const names = getOwnerFieldNames(
      project({ ownerFields: { developer: ['Developer', 'assignee'], qa: ['Developer', 'QA Owner'], uat: [] } })
    );
    expect(names).toEqual(['Developer', 'QA Owner']);
  });

  it('is case-insensitive about the assignee literal', () => {
    expect(getOwnerFieldNames(project({ ownerFields: { developer: ['Assignee'], qa: [], uat: [] } }))).toEqual([]);
  });

  it('returns the default QA/UAT names for an unconfigured project', () => {
    // Unconfigured projects must still fetch the QA/UAT custom fields they
    // always fetched — this list is what keeps CCM working.
    const names = getOwnerFieldNames(undefined);
    expect(names).toContain('Assigned QA');
    expect(names).toContain('Assigned UAT');
    expect(names).not.toContain('assignee');
  });
});

describe('owner fields reach the Jira fetch allowlist', () => {
  // Regression guard. getOwnerFieldNames() existing is not enough: the value has to be
  // threaded through JiraService.fieldList() -> buildIssueFieldList(). It was not, and the
  // failure is silent — the configured field is simply never requested, so every read of it
  // returns empty and the report looks like nobody owns anything.
  const jiraWithFields = (names: Record<string, string>) => ({
    getFields: async () => Object.entries(names).map(([name, id]) => ({ id, name })),
  });

  it('requests a declared custom owner field', async () => {
    const fields = await buildIssueFieldList(jiraWithFields({ Developer: 'customfield_10343' }), {
      jiraLaneConfig: { ownerFields: { developer: ['Developer'] } },
    });
    expect(fields).toContain('customfield_10343');
  });

  it('does not request it when the project has not declared it', async () => {
    const fields = await buildIssueFieldList(jiraWithFields({ Developer: 'customfield_10343' }), {});
    expect(fields).not.toContain('customfield_10343');
  });

  it('collects every id behind a duplicated display name', async () => {
    // Thrive carries two "QA Owner" fields and only one holds data; requesting a field the
    // issue does not carry is harmless, whereas picking one id risks reading the empty twin.
    const jira = {
      getFields: async () => [
        { id: 'customfield_10344', name: 'QA Owner' },
        { id: 'customfield_10349', name: 'QA Owner' },
      ],
    };
    const fields = await buildIssueFieldList(jira, { jiraLaneConfig: { ownerFields: { qa: ['QA Owner'] } } });
    expect(fields).toContain('customfield_10344');
    expect(fields).toContain('customfield_10349');
  });
});
