/**
 * Seeds a single Delivery Presentation for CCMH (LOT / LOWA / Secondary LO ONE)
 * using the real WSR data already synced in the database. Prefill logic is
 * delegated to the production service so whatever the UI would derive, this
 * script derives.
 *
 * Run with:
 *   cd backend && node scripts/seed-sample-delivery-presentation.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { portfolioPresentationService } = require('../dist/modules/reports/services/portfolioPresentationService');
const { PortfolioPresentation } = require('../dist/models/PortfolioPresentation');

const ACCOUNT_ID = 3;              // CCMH
const PROJECT_IDS = [9, 7, 11];    // LOT, LOWA, Secondary (LO ONE)
const START_DATE = '2026-03-16';   // matches the user's latest window
const END_DATE = '2026-03-31';
const MEETING_DATE = '2026-04-02';
const TITLE = 'CCMH Delivery Review — Mar 16 to Mar 31, 2026';

async function main() {
    console.log('Authenticating DB…');
    await sequelize.authenticate();

    console.log('Deleting any existing seed with the same title for this account…');
    await PortfolioPresentation.destroy({ where: { accountId: ACCOUNT_ID, title: TITLE } });

    console.log('Building prefill payload from live data…');
    const prefill = await portfolioPresentationService.buildPrefillPayload(
        ACCOUNT_ID, PROJECT_IDS, START_DATE, END_DATE
    );

    console.log('Prefill sanity check:');
    console.log('  drilldown projects:', prefill.perProjectDrilldown.map(d => d.projectName));
    console.log('  drilldown metrics  :', prefill.perProjectDrilldown.map(d => ({
        p: d.projectName,
        src: d.sprintMetrics?.dataSource,
        ticketsCompleted: d.sprintMetrics?.ticketsCompleted,
        avgActive: d.sprintMetrics?.avgActiveTickets,
        maxBlocked: d.sprintMetrics?.maxBlockedTickets,
        weeks: d.sprintMetrics?.weeksCovered,
    })));
    console.log('  trend series sizes :', Object.fromEntries(
        Object.entries(prefill.trendData).map(([pid, v]) => [v.projectName, v.sprints.length])
    ));
    console.log('  achievements found :', prefill.keyHighlights.achievements.length);
    console.log('  blockers found     :', prefill.keyHighlights.blockers.length);
    console.log('  risks              :', prefill.risks.length, '| action items:', prefill.actionItemsSnapshot.length);
    console.log('  overall health     :', prefill.health);

    console.log('Creating presentation…');
    const saved = await portfolioPresentationService.createPresentation(
        ACCOUNT_ID,
        {
            title: TITLE,
            meetingDate: MEETING_DATE,
            startDate: START_DATE,
            endDate: END_DATE,
            health: prefill.health,
            selectedProjectIds: PROJECT_IDS,
            selectedSprintMap: prefill.selectedSprintMap,
            keyHighlights: prefill.keyHighlights,
            milestones: prefill.milestones,
            risks: prefill.risks,
            actionItemsSnapshot: prefill.actionItemsSnapshot,
            techRecommendations: prefill.techRecommendations,
            discussionPoints: prefill.discussionPoints,
            perProjectDrilldown: prefill.perProjectDrilldown,
            trendData: prefill.trendData,
        },
        null
    );

    console.log('Saved presentation id:', saved.id, 'title:', saved.title);
    console.log('Open the UI → Presentation → Delivery Presentation to view.');

    await sequelize.close();
}

main().catch(err => {
    console.error('FAILED:', err);
    process.exit(1);
});
