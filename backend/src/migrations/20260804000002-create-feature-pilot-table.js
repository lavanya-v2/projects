'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('feature_pilot', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false },
            user_id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            feature: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'claude-usage' },
            enabled_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
            revoked_at: { type: Sequelize.DATE, allowNull: true },
        });
        await queryInterface.addIndex('feature_pilot', ['user_id', 'feature'], {
            unique: true,
            name: 'feature_pilot_user_feature_unique',
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('feature_pilot');
    },
};
