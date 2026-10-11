'use strict';

const RISK_SUBJECT = '[Lens] {{numWord count}} new {{plural count "risk" "risks"}} on {{project.name}}';
const RISK_BODY = `Hi team,

{{numWord count}} new {{plural count "risk" "risks"}} {{plural count "has" "have"}} been logged on project {{project.name}}.

{{#each events}}
- {{this.risk.title}} (Priority: {{this.risk.priority}}) by {{this.actor.name}}
{{/each}}

Please review and take action.

-- Lens`;

const AI_SUBJECT = '[Lens] {{numWord count}} new {{plural count "action item" "action items"}} on {{project.name}}';
const AI_BODY = `Hi team,

{{numWord count}} new {{plural count "action item" "action items"}} {{plural count "has" "have"}} been added on project {{project.name}}.

{{#each events}}
- {{this.actionItem.title}} (Category: {{this.actionItem.category}}, Owner: {{this.actionItem.owner}}) by {{this.actor.name}}
{{/each}}

Please review and take action.

-- Lens`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkUpdate(
      'notification_templates',
      { subject_template: RISK_SUBJECT, body_template: RISK_BODY, updated_at: new Date() },
      { code: 'risk_created_default' }
    );
    await queryInterface.bulkUpdate(
      'notification_templates',
      { subject_template: AI_SUBJECT, body_template: AI_BODY, updated_at: new Date() },
      { code: 'action_item_created_default' }
    );
  },

  async down() {
    // No-op; previous templates were strict-numeric and not worth restoring.
  },
};
