'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('risks', 'project_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'projects', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });

        await queryInterface.addIndex('risks', ['project_id']);
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('risks', ['project_id']);
        await queryInterface.removeColumn('risks', 'project_id');
    }
};
