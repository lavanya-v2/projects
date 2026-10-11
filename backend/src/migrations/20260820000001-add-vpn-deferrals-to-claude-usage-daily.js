'use strict';

/**
 * How many runs a reporting machine suppressed because it detected a VPN.
 *
 * The collector now sends nothing at all while a VPN is connected — engineers
 * work inside customer networks, and a request made from there (including the DNS
 * lookup preceding it) is visible to the customer's monitoring. Suppressed days
 * are queued locally and sent once the machine is off VPN.
 *
 * That creates a blind spot this column closes. Someone who is on a customer VPN
 * every working day may never report at all, and a missing row looks identical
 * whether the cause is a customer network, a broken agent, or annual leave. The
 * count arrives on the first run that does get through, so it is a record of a
 * silence, reported after the fact.
 *
 * Purely additive. NULL means "collector too old to have an opinion", which is
 * the correct state for every row that exists today.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('claude_usage_daily', 'vpn_deferrals', {
            type: Sequelize.INTEGER,
            allowNull: true,
        });
    },

    async down(queryInterface) {
        await queryInterface.removeColumn('claude_usage_daily', 'vpn_deferrals');
    },
};
