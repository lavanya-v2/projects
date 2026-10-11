'use strict';

/**
 * Persists the raw QA accumulators that computeMemberScores currently throws away.
 *
 * Today only the DERIVED `quality_rate` is stored:
 *   quality_rate = (1 − (0.7·passRate + 0.3·inSprintCatch)) × 100,  −1 if tested < 5
 *
 * Correct cycle-level QA aggregation is impossible from that number alone —
 * averaging per-sprint rates across a cycle weights a 3-ticket sprint the same as
 * a 40-ticket one, and the −1 sentinel poisons any mean that fails to exclude it.
 * Storing the numerators and denominators lets a cycle re-derive the rate from
 * summed counters, which is the only correct way.
 *
 * Nullable and unpopulated until the next sync: existing rows keep using the
 * documented interim proxy (tickets-tested-weighted mean of non-sentinel rates),
 * recorded in review_member_scores.breakdown.approximations.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const cols = {
            // UAT pass rate numerator/denominator
            cleared_sp: 'Story points this member cleared through QA in the sync',
            uat_failed_sp: 'Of those, story points later rejected in UAT',
            // In-sprint defect catch rate numerator/denominator
            in_sprint_bug_count: 'Bugs this member caught within the sprint',
            in_sprint_eligible_count: 'Bugs that were eligible to be caught in-sprint'
        };

        for (const [name, comment] of Object.entries(cols)) {
            await queryInterface.addColumn('perf_member_scores', name, {
                type: Sequelize.FLOAT,
                allowNull: true,
                comment
            });
        }
    },

    async down(queryInterface) {
        for (const name of ['cleared_sp', 'uat_failed_sp', 'in_sprint_bug_count', 'in_sprint_eligible_count']) {
            await queryInterface.removeColumn('perf_member_scores', name);
        }
    }
};
