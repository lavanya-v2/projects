'use strict';

/**
 * Weekly report rows are keyed by ISO-8601 (week_number, year) today -- a Monday-Sunday,
 * Thursday-anchored standard that only coincidentally aligns with the hardcoded Friday-Thursday
 * window every account has used until now. Once the week's start day is configurable per account
 * (see the sibling migration adding accounts.week_start_day), ISO week numbers no longer reliably
 * identify a given account's actual configured window -- switching the real uniqueness key to the
 * literal (start_date, end_date) the report actually covers.
 *
 * project_weekly_reports already has the correct index sitting unused (added by its original
 * creation migration, 20260204000002, and never removed) -- this migration only needs to drop the
 * now-redundant week/year index there. account_weekly_reports and program_weekly_reports need the
 * date-range index added fresh, then their week/year index dropped.
 */
module.exports = {
    async up(queryInterface) {
        // project_weekly_reports: date-range unique index already exists
        // ('unique_weekly_project_date_range', from the table's creation migration) -- just drop
        // the redundant week/year one so the app's upsert conflictFields target the real key.
        await queryInterface.removeIndex('project_weekly_reports', 'unique_weekly_project_week_year');

        // account_weekly_reports: add the date-range index, then drop the old one.
        await queryInterface.addIndex('account_weekly_reports', ['account_id', 'start_date', 'end_date'], {
            unique: true,
            name: 'unique_account_weekly_date_range',
        });
        await queryInterface.removeIndex('account_weekly_reports', 'unique_account_weekly_report');

        // program_weekly_reports: same treatment.
        await queryInterface.addIndex('program_weekly_reports', ['program_id', 'start_date', 'end_date'], {
            unique: true,
            name: 'unique_program_weekly_date_range',
        });
        await queryInterface.removeIndex('program_weekly_reports', 'unique_program_weekly_report');
    },

    async down(queryInterface) {
        await queryInterface.addIndex('project_weekly_reports', ['project_id', 'week_number', 'year'], {
            unique: true,
            name: 'unique_weekly_project_week_year',
        });

        await queryInterface.addIndex('account_weekly_reports', ['account_id', 'week_number', 'year'], {
            unique: true,
            name: 'unique_account_weekly_report',
        });
        await queryInterface.removeIndex('account_weekly_reports', 'unique_account_weekly_date_range');

        await queryInterface.addIndex('program_weekly_reports', ['program_id', 'week_number', 'year'], {
            unique: true,
            name: 'unique_program_weekly_report',
        });
        await queryInterface.removeIndex('program_weekly_reports', 'unique_program_weekly_date_range');
    },
};
