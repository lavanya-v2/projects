'use strict';

/**
 * VPN gate Stage 2 — surface the gate's own status directly in the audit log, not
 * just in Data Quality's aggregated per-day flags. `vpn_gate` mirrors the enum
 * already stored on claude_usage_daily's payload (enforced / disabled /
 * allowed-after-failed-check), null when unknown (rows rejected before the
 * payload validated, or pushed by a collector that predates the gate).
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('claude_ingest_audit_log', 'vpn_gate', {
            type: Sequelize.STRING(30),
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('claude_ingest_audit_log', 'vpn_gate');
    },
};
