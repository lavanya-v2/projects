'use strict';

/**
 * ADDENDUM 17 item 6 — drop ip_address from claude_ingest_audit_log. It never
 * reflected a real client address (no `trust proxy` config behind this app's
 * reverse proxy, and unreliable behind a VPN regardless), so it added no
 * actionable signal — removing it rather than trying to fix the capture.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface) {
        await queryInterface.removeColumn('claude_ingest_audit_log', 'ip_address');
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.addColumn('claude_ingest_audit_log', 'ip_address', {
            type: Sequelize.STRING(64),
            allowNull: true,
        });
    },
};
