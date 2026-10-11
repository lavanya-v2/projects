'use strict';

module.exports = {
    async up(queryInterface) {
        const SELECT = queryInterface.sequelize.QueryTypes.SELECT;

        // Get superuser account
        const [superuser] = await queryInterface.sequelize.query(
            "SELECT id FROM users WHERE user_id = 'superuser' LIMIT 1",
            { type: SELECT }
        );
        if (!superuser) throw new Error('Superuser not found. Run seed-superuser first.');
        const suId = superuser.id;

        // Get a few projects for linking
        const projects = await queryInterface.sequelize.query(
            'SELECT id, name FROM projects ORDER BY id LIMIT 8',
            { type: SELECT }
        );

        const pid = (i) => projects[i]?.id || null;

        const now = new Date();
        const daysAgo = (d) => new Date(now - d * 86400000);

        // Check if demo risks already exist
        const existing = await queryInterface.sequelize.query(
            "SELECT id FROM risks WHERE title LIKE '[DEMO]%' LIMIT 1",
            { type: SELECT }
        );
        if (existing.length > 0) return; // already seeded

        // ----- INSERT RISKS -----
        await queryInterface.bulkInsert('risks', [
            // NEW lane
            {
                source: 'CLIENT',
                notified_date: daysAgo(1),
                title: '[DEMO] Production outage risk during Q2 release',
                description: 'Client has flagged that the upcoming Q2 release window overlaps with their peak business season. Any deployment issues could cause significant revenue impact. Need to establish rollback procedures and a communication plan before the deployment date.',
                priority: 'CRITICAL',
                status: 'NEW',
                creator_id: suId,
                assignee_id: suId,
                project_id: pid(0),
                created_at: daysAgo(1),
                updated_at: daysAgo(1)
            },
            {
                source: 'INTERNAL',
                notified_date: daysAgo(3),
                title: '[DEMO] Key developer leaving team next month',
                description: 'Senior backend developer has submitted resignation effective end of month. Knowledge transfer has not been initiated. Critical modules owned by this developer have no documented architecture.',
                priority: 'HIGH',
                status: 'NEW',
                creator_id: suId,
                assignee_id: suId,
                project_id: pid(1),
                created_at: daysAgo(3),
                updated_at: daysAgo(3)
            },
            {
                source: 'CLIENT',
                notified_date: daysAgo(5),
                title: '[DEMO] Third-party API deprecation notice received',
                description: 'Payment gateway provider has announced v1 API deprecation in 90 days. Our integration uses v1 endpoints exclusively. Migration to v2 requires significant refactoring and re-certification.',
                priority: 'HIGH',
                status: 'NEW',
                creator_id: suId,
                assignee_id: null,
                project_id: pid(2),
                created_at: daysAgo(5),
                updated_at: daysAgo(5)
            },
            {
                source: 'INTERNAL',
                notified_date: daysAgo(7),
                title: '[DEMO] Test coverage below threshold for new module',
                description: 'The newly developed reporting module has less than 40% test coverage. Team velocity pressures have led to skipped unit tests. This increases regression risk significantly.',
                priority: 'MEDIUM',
                status: 'NEW',
                creator_id: suId,
                assignee_id: null,
                project_id: pid(3),
                created_at: daysAgo(7),
                updated_at: daysAgo(7)
            },

            // WORK_IN_PROGRESS lane
            {
                source: 'CLIENT',
                notified_date: daysAgo(10),
                title: '[DEMO] Data migration performance concern',
                description: 'Historical data migration job estimated to take 48+ hours in staging environment. Production dataset is 3x larger. Business cannot afford extended downtime window. Exploring parallel processing strategies.',
                priority: 'CRITICAL',
                status: 'WORK_IN_PROGRESS',
                creator_id: suId,
                assignee_id: suId,
                project_id: pid(0),
                created_at: daysAgo(10),
                updated_at: daysAgo(2)
            },
            {
                source: 'INTERNAL',
                notified_date: daysAgo(12),
                title: '[DEMO] Security audit findings pending remediation',
                description: 'External security audit identified 3 medium-severity vulnerabilities in the authentication module. Patches have been developed and are in QA review. Target remediation date is next Friday.',
                priority: 'HIGH',
                status: 'WORK_IN_PROGRESS',
                creator_id: suId,
                assignee_id: suId,
                project_id: pid(1),
                created_at: daysAgo(12),
                updated_at: daysAgo(1)
            },
            {
                source: 'CLIENT',
                notified_date: daysAgo(15),
                title: '[DEMO] Scope creep impacting sprint velocity',
                description: 'Client has been adding ad-hoc feature requests mid-sprint consistently for 3 sprints. Sprint velocity has dropped 25%. Team morale affected. Change request process needs enforcement.',
                priority: 'MEDIUM',
                status: 'WORK_IN_PROGRESS',
                creator_id: suId,
                assignee_id: suId,
                project_id: pid(2),
                created_at: daysAgo(15),
                updated_at: daysAgo(4)
            },
            {
                source: 'INTERNAL',
                notified_date: daysAgo(8),
                title: '[DEMO] Cloud infrastructure cost exceeding budget',
                description: 'Monthly cloud spend is 40% over projected budget due to unoptimized resource allocation in staging environments. Finance team has flagged this as a priority to resolve.',
                priority: 'LOW',
                status: 'WORK_IN_PROGRESS',
                creator_id: suId,
                assignee_id: null,
                project_id: null,
                created_at: daysAgo(8),
                updated_at: daysAgo(3)
            },

            // STALE lane
            {
                source: 'CLIENT',
                notified_date: daysAgo(30),
                title: '[DEMO] Delayed client sign-off on UI designs',
                description: 'UI/UX designs for the customer portal redesign have been pending client approval for 3 weeks. Development cannot proceed without sign-off. Multiple follow-ups have received no response.',
                priority: 'HIGH',
                status: 'STALE',
                creator_id: suId,
                assignee_id: suId,
                project_id: pid(3),
                created_at: daysAgo(30),
                updated_at: daysAgo(20)
            },
            {
                source: 'INTERNAL',
                notified_date: daysAgo(25),
                title: '[DEMO] Legacy code refactoring deferred twice',
                description: 'The legacy payment processing module refactoring has been pushed from Q4 and Q1 roadmaps. Technical debt is accumulating and causing increasing maintenance overhead. No owner assigned.',
                priority: 'MEDIUM',
                status: 'STALE',
                creator_id: suId,
                assignee_id: null,
                project_id: pid(0),
                created_at: daysAgo(25),
                updated_at: daysAgo(18)
            },
            {
                source: 'CLIENT',
                notified_date: daysAgo(45),
                title: '[DEMO] SLA breach risk for support tier 1',
                description: 'Support ticket response times have been trending upward. Last month 12% of Tier 1 tickets breached the 4-hour SLA. Client contract review is in 2 months. No staffing plan in place.',
                priority: 'HIGH',
                status: 'STALE',
                creator_id: suId,
                assignee_id: suId,
                project_id: null,
                created_at: daysAgo(45),
                updated_at: daysAgo(30)
            },

            // DONE lane
            {
                source: 'INTERNAL',
                notified_date: daysAgo(60),
                title: '[DEMO] CI/CD pipeline flakiness resolved',
                description: 'Intermittent test failures in the CI pipeline were causing false negatives and delaying deployments. Root cause identified as race conditions in integration tests. Fixed with proper test isolation.',
                priority: 'MEDIUM',
                status: 'DONE',
                creator_id: suId,
                assignee_id: suId,
                project_id: pid(1),
                created_at: daysAgo(60),
                updated_at: daysAgo(20)
            },
            {
                source: 'CLIENT',
                notified_date: daysAgo(90),
                title: '[DEMO] GDPR compliance gap closed',
                description: 'Compliance review identified missing data retention policies and incomplete user data deletion workflows. All gaps have been remediated, documented, and verified by legal team.',
                priority: 'CRITICAL',
                status: 'DONE',
                creator_id: suId,
                assignee_id: suId,
                project_id: pid(2),
                created_at: daysAgo(90),
                updated_at: daysAgo(10)
            }
        ]);
    },

    async down(queryInterface) {
        await queryInterface.bulkDelete('risks', {}, {});
    }
};
