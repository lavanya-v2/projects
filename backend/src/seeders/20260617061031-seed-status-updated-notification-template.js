'use strict';

const DEFAULT_SUBJECT_RISK = '[Lens] Risk Status Changed: {{this.risk.title}} {{plural count "risk" "risks"}} on {{project.name}}';
const DEFAULT_BODY_RISK = `Hi team,

{{numWord count}} new {{plural count "risk" "risks"}} {{plural count "has" "have"}} been updated on project {{project.name}}.

{{#each events}}
- {{this.risk.title}} risk has been updated. Status changed from {{this.risk.fromStatus}} to {{this.risk.toStatus}} by {{this.actor.name}}
{{/each}}


Please review and take action.

-- Lens`;
const DEFAULT_SUBJECT_AI = '[Lens] Project Action Item Status Changed: {{this.actionItem.title}} {{plural count "item" "items"}} on {{project.name}}';
const DEFAULT_BODY_AI = `Hi team,

{{numWord count}} action {{plural count "item" "items"}} have been updated on project {{project.name}}.

{{#each events}}
- {{this.actionItem.title}} program action has been updated. Status from {{this.actionItem.fromStatus}} to {{this.actionItem.toStatus}} by {{this.actor.name}}
{{/each}}

Please review and take action.

-- Lens`;
module.exports = {
  async up (queryInterface, Sequelize) {
    // 1. Insert notification events
    await queryInterface.bulkInsert('notification_events', [
      {
        code: 'risk.status.updated',
        description: 'Fired when a risk status is updated',
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
        code: 'action_item.status.updated',
        description: 'Fired when a project action item status is updated',
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

    // 2. Seed templates
    await queryInterface.bulkInsert(
      'notification_templates',
      [
        {
          code: 'risk_status_updated_default',
          name: 'Risk Status Updated — Default Email',
          transport: 'email',
          subject_template: DEFAULT_SUBJECT_RISK,
          body_template: DEFAULT_BODY_RISK,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          code: 'action_item_status_updated_default',
          name: 'Action Item Status Updated — Default Email',
          transport: 'email',
          subject_template: DEFAULT_SUBJECT_AI,
          body_template: DEFAULT_BODY_AI,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]
    );

    // 3. Dialect-safe raw query execution to fetch template IDs
    const results = await queryInterface.sequelize.query(
      `SELECT id, code FROM notification_templates WHERE code IN ('risk_status_updated_default', 'action_item_status_updated_default')`,
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    
    const byCode = {};
    for (const row of results) {
      byCode[row.code] = row.id;
    }

    // 4. Insert notification rules
    await queryInterface.bulkInsert('notification_rules', [
      {
        event_code: 'risk.status.updated',
        template_id: byCode.risk_status_updated_default,
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
        event_code: 'action_item.status.updated',
        template_id: byCode.action_item_status_updated_default,
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

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('notification_rules', {
      event_code: ['risk.status.updated', 'action_item.status.updated']
    });
    await queryInterface.bulkDelete('notification_templates', {
      code: ['risk_status_updated_default', 'action_item_status_updated_default']
    });
    await queryInterface.bulkDelete('notification_events', {
      code: ['risk.status.updated', 'action_item.status.updated']
    });
  }
}