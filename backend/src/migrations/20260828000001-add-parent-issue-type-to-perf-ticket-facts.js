'use strict';

/**
 * Jira issue type of the fact's parent (e.g. 'Epic', 'Story').
 *
 * The QA "in-cycle catch" metric asks whether a raised bug's parent is part of
 * this cycle. In LS, standalone Bugs are parented to an EPIC (e.g. LS-2633),
 * and Epics never appear in a cycle's fact rows -- so the catch rate was
 * structurally 0 for any QA who raised bugs, costing them the full 30% of their
 * quality score. Storing the parent's type lets scoring tell "parent is an Epic,
 * question not applicable" apart from "parent is a Story that wasn't in this
 * cycle, genuinely a miss".
 *
 * Nullable with no backfill: existing rows stay null and are treated as not
 * applicable, so missing data never penalises a QA. The value populates on the
 * next re-sync.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('perf_ticket_facts', 'parent_issue_type', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('perf_ticket_facts', 'parent_issue_type');
  },
};
