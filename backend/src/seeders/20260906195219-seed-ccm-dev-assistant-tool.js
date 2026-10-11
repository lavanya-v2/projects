'use strict';

/**
 * Seeds `dev_assistant_ai_tool = 'claude'` for every project under the CCM
 * account. Matches the account by PREFIX (code/name starting with 'CCM'), not
 * a hardcoded id, per explicit request — verified against the real DB at
 * write time: exactly one match (id=3, code='CCMH', name='CCM'), 20 projects.
 * Idempotent: only touches rows that aren't already 'claude', safe to re-run.
 */
module.exports = {
    up: async (queryInterface) => {
        const accounts = await queryInterface.sequelize.query(
            "SELECT id, code, name FROM accounts WHERE code ILIKE 'CCM%' OR name ILIKE 'CCM%'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );

        if (!accounts || accounts.length === 0) {
            console.log('No account with code/name starting with CCM found — skipping.');
            return;
        }

        const accountIds = accounts.map(a => a.id);
        console.log(`Found ${accounts.length} CCM-prefixed account(s): ${accounts.map(a => `${a.name} (${a.code}, id=${a.id})`).join(', ')}`);

        const [, result] = await queryInterface.sequelize.query(
            `UPDATE projects SET dev_assistant_ai_tool = 'claude', updated_at = NOW()
             WHERE account_id IN (:accountIds) AND dev_assistant_ai_tool <> 'claude'`,
            { replacements: { accountIds } }
        );
        console.log(`Set dev_assistant_ai_tool='claude' on ${result.rowCount ?? 'some'} project(s).`);
    },

    down: async (queryInterface) => {
        const accounts = await queryInterface.sequelize.query(
            "SELECT id FROM accounts WHERE code ILIKE 'CCM%' OR name ILIKE 'CCM%'",
            { type: queryInterface.sequelize.QueryTypes.SELECT }
        );
        if (!accounts || accounts.length === 0) return;
        const accountIds = accounts.map(a => a.id);
        await queryInterface.sequelize.query(
            `UPDATE projects SET dev_assistant_ai_tool = 'none', updated_at = NOW()
             WHERE account_id IN (:accountIds)`,
            { replacements: { accountIds } }
        );
    },
};
