'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // notification_events
    await queryInterface.createTable('notification_events', {
      code: {
        type: Sequelize.STRING(100),
        primaryKey: true,
        allowNull: false,
      },
      description: { type: Sequelize.TEXT, allowNull: true },
      payload_schema: { type: Sequelize.JSONB, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    // notification_templates
    await queryInterface.createTable('notification_templates', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      code: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(255), allowNull: false },
      transport: { type: Sequelize.STRING(32), allowNull: false },
      subject_template: { type: Sequelize.TEXT, allowNull: true },
      body_template: { type: Sequelize.TEXT, allowNull: false },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    // notification_rules
    await queryInterface.createTable('notification_rules', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      event_code: {
        type: Sequelize.STRING(100),
        allowNull: false,
        references: { model: 'notification_events', key: 'code' },
        onDelete: 'CASCADE',
      },
      template_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'notification_templates', key: 'id' },
        onDelete: 'RESTRICT',
      },
      transport: { type: Sequelize.STRING(32), allowNull: false },
      recipients_config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      cc_config: { type: Sequelize.JSONB, allowNull: true },
      scope_config: { type: Sequelize.JSONB, allowNull: true },
      coalesce_window_seconds: { type: Sequelize.INTEGER, allowNull: true },
      coalesce_key_config: { type: Sequelize.JSONB, allowNull: true },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('notification_rules', ['event_code', 'is_active']);

    // notification_pending_aggregates
    await queryInterface.createTable('notification_pending_aggregates', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      rule_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'notification_rules', key: 'id' },
        onDelete: 'CASCADE',
      },
      coalesce_key: { type: Sequelize.STRING(255), allowNull: false },
      events: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      flush_at: { type: Sequelize.DATE, allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'PENDING' },
      job_id: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('notification_pending_aggregates', ['rule_id', 'coalesce_key', 'status'], {
      name: 'idx_pending_rule_key_status',
    });

    // notification_logs
    await queryInterface.createTable('notification_logs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      event_code: { type: Sequelize.STRING(100), allowNull: false },
      rule_id: { type: Sequelize.INTEGER, allowNull: true },
      template_id: { type: Sequelize.INTEGER, allowNull: true },
      transport: { type: Sequelize.STRING(32), allowNull: false },
      recipients: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      cc: { type: Sequelize.JSONB, allowNull: true },
      subject: { type: Sequelize.TEXT, allowNull: true },
      body: { type: Sequelize.TEXT, allowNull: true },
      payload_snapshot: { type: Sequelize.JSONB, allowNull: true },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'QUEUED' },
      error: { type: Sequelize.TEXT, allowNull: true },
      project_id: { type: Sequelize.INTEGER, allowNull: true },
      account_id: { type: Sequelize.INTEGER, allowNull: true },
      job_id: { type: Sequelize.STRING(255), allowNull: true },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });
    await queryInterface.addIndex('notification_logs', ['event_code']);
    await queryInterface.addIndex('notification_logs', ['status']);
    await queryInterface.addIndex('notification_logs', ['project_id']);
    await queryInterface.addIndex('notification_logs', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('notification_logs');
    await queryInterface.dropTable('notification_pending_aggregates');
    await queryInterface.dropTable('notification_rules');
    await queryInterface.dropTable('notification_templates');
    await queryInterface.dropTable('notification_events');
  },
};
