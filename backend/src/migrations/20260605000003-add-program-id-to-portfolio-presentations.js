'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('portfolio_presentations', 'program_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'programs', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('portfolio_presentations', 'program_id');
    },
};
