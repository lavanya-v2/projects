'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('team_members', 'v2_member', {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true, // all existing members belong to V2 (internal org)
        });
    },
    async down(queryInterface) {
        await queryInterface.removeColumn('team_members', 'v2_member');
    },
};
