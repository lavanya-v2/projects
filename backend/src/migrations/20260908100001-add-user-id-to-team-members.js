'use strict';

/**
 * Gives team_members a real FK to users.
 *
 * Today the only bridge from a logged-in user to their delivery roster row is an
 * iLike email comparison in memberDashboardService.resolveMember(). That is fine
 * for a dashboard read; it is not something a performance review that reaches HR
 * should depend on. The column is backfilled from that same email match so the
 * existing behaviour is preserved exactly, then becomes the fast, explicit path.
 *
 * Nullable on purpose: not every team member has an app login.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.addColumn('team_members', 'user_id', {
            type: Sequelize.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL'
        });

        // Backfill using the same precedence memberDashboardService uses:
        // users.user_id (the V2 email login) first, then users.email, then the
        // contractor fallback team_members.partner_email_id.
        //
        // Only MUTUALLY UNIQUE pairings are written: the team member must match
        // exactly one user AND that user must match exactly one team member.
        // Anything ambiguous is deliberately left NULL for a superuser to resolve
        // rather than guessed at.
        //
        // The mutual check has to be done in a CTE, not with correlated NOT EXISTS
        // against team_members.user_id: inside a single UPDATE ... FROM every row
        // sees the pre-update snapshot, so a "nobody else has claimed this user"
        // guard cannot see the assignments the same statement is making. This DB
        // has real case-variant duplicate roster rows (two "Dinesh Kumar", two
        // "Revati More") that both resolve to one user and would both be written.
        await queryInterface.sequelize.query(`
            WITH candidate AS (
                SELECT tm.id AS tm_id, u.id AS u_id
                  FROM team_members tm
                  JOIN users u
                    ON LOWER(u.user_id) = LOWER(tm.email)
                    OR LOWER(u.email)   = LOWER(tm.email)
                    OR (tm.partner_email_id IS NOT NULL AND LOWER(u.user_id) = LOWER(tm.partner_email_id))
                    OR (tm.partner_email_id IS NOT NULL AND LOWER(u.email)   = LOWER(tm.partner_email_id))
                 WHERE tm.user_id IS NULL
            ),
            tm_unique AS (
                SELECT tm_id FROM candidate GROUP BY tm_id HAVING COUNT(DISTINCT u_id) = 1
            ),
            user_unique AS (
                SELECT u_id FROM candidate GROUP BY u_id HAVING COUNT(DISTINCT tm_id) = 1
            )
            UPDATE team_members tm
               SET user_id = c.u_id
              FROM candidate c
             WHERE tm.id = c.tm_id
               AND c.tm_id IN (SELECT tm_id FROM tm_unique)
               AND c.u_id  IN (SELECT u_id  FROM user_unique);
        `);

        // Unique rather than a plain index: one app login maps to at most one
        // roster row. Postgres permits many NULLs, which is what we want.
        await queryInterface.addIndex('team_members', ['user_id'], {
            name: 'team_members_user_id_unique',
            unique: true
        });
    },

    async down(queryInterface) {
        await queryInterface.removeIndex('team_members', 'team_members_user_id_unique');
        await queryInterface.removeColumn('team_members', 'user_id');
    }
};
