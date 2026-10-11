'use strict';

const DEFAULT_SUBJECT_RISK = '[Lens] {{count}} new risk(s) on {{project.name}}';
const DEFAULT_BODY_RISK = `Hi team,

{{count}} new risk(s) have been logged on project {{project.name}}.

{{#each events}}
- {{this.risk.title}} (Priority: {{this.risk.priority}}) by {{this.actor.name}}
{{/each}}

Please review and take action.

-- Lens`;

const DEFAULT_SUBJECT_AI = '[Lens] {{count}} new action item(s) on {{project.name}}';
const DEFAULT_BODY_AI = `Hi team,

{{count}} new action item(s) have been added on project {{project.name}}.

{{#each events}}
- {{this.actionItem.title}} (Category: {{this.actionItem.category}}, Owner: {{this.actionItem.owner}}) by {{this.actor.name}}
{{/each}}

Please review and take action.

-- Lens`;

module.exports = {
  async up(queryInterface) {
    // Seed events
    await queryInterface.bulkInsert('notification_events', [
      {
        code: 'risk.created',
        description: 'Fired when a new risk is created',
        payload_schema: JSON.stringify({
          risk: { id: 'number', title: 'string', priority: 'string', description: 'string' },
          project: { id: 'number', name: 'string', accountId: 'number' },
          actor: { id: 'number', name: 'string' },
        }),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        code: 'action_item.created',
        description: 'Fired when a new project action item is created',
        payload_schema: JSON.stringify({
          actionItem: { id: 'number', title: 'string', category: 'string', owner: 'string' },
          project: { id: 'number', name: 'string', accountId: 'number' },
          actor: { id: 'number', name: 'string' },
        }),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    // Seed templates
    const [templates] = await queryInterface.bulkInsert(
      'notification_templates',
      [
        {
          code: 'risk_created_default',
          name: 'Risk Created — Default Email',
          transport: 'email',
          subject_template: DEFAULT_SUBJECT_RISK,
          body_template: DEFAULT_BODY_RISK,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          code: 'action_item_created_default',
          name: 'Action Item Created — Default Email',
          transport: 'email',
          subject_template: DEFAULT_SUBJECT_AI,
          body_template: DEFAULT_BODY_AI,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      { returning: true }
    );

    // Resolve IDs (bulkInsert may not return ids on all dialects; do a select instead)
    const [rows] = await queryInterface.sequelize.query(
      `SELECT id, code FROM notification_templates WHERE code IN ('risk_created_default', 'action_item_created_default')`
    );
    const byCode = {};
    for (const row of rows) byCode[row.code] = row.id;

    await queryInterface.bulkInsert('notification_rules', [
      {
        event_code: 'risk.created',
        template_id: byCode.risk_created_default,
        transport: 'email',
        recipients_config: JSON.stringify({ roles: ['manager', 'lead'], scope: 'project' }),
        cc_config: JSON.stringify({ emails: ['gameplan.ccm@v2solutions.com'] }),
        scope_config: null,
        coalesce_window_seconds: 300,
        coalesce_key_config: JSON.stringify(['projectId']),
        is_active: true,
        priority: 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        event_code: 'action_item.created',
        template_id: byCode.action_item_created_default,
        transport: 'email',
        recipients_config: JSON.stringify({ roles: ['manager', 'lead'], scope: 'project' }),
        cc_config: JSON.stringify({ emails: ['gameplan.ccm@v2solutions.com'] }),
        scope_config: null,
        coalesce_window_seconds: 300,
        coalesce_key_config: JSON.stringify(['projectId']),
        is_active: true,
        priority: 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('notification_rules', {
      event_code: ['risk.created', 'action_item.created'],
    });
    await queryInterface.bulkDelete('notification_templates', {
      code: ['risk_created_default', 'action_item_created_default'],
    });
    await queryInterface.bulkDelete('notification_events', {
      code: ['risk.created', 'action_item.created'],
    });
  },
};
