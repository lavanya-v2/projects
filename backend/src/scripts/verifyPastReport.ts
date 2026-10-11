
import sequelize from '../config/connection';
import { reportService } from '../modules/reports/services/reportService';
import { DailyBoardSnapshot } from '../models/DailyBoardSnapshot';
import { Project } from '../models/Project';

async function verifyPastReport() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        const projectCode = 'LOT'; // Existing project
        const pastDate = '2025-01-01'; // Future relative to 2020, but past relative to now (2026)
        // Wait, the user system time says 2026. So 2025 is past.

        // 1. Setup Data
        const project = await Project.findOne({ where: { code: projectCode } });
        if (!project) {
            console.error('Project LOT not found. Cannot verify.');
            return;
        }

        console.log(`Setting up test snapshot for ${projectCode} on ${pastDate}`);
        await DailyBoardSnapshot.create({
            date: pastDate,
            boardId: project.jiraBoardId,
            boardName: 'Test Board',
            projectId: project.id,
            accountId: project.accountId,
            workSummary: 'Test Summary from DB',
            overallHealth: 'green',
            executiveSummary: 'Exec Summary',
            executiveRisks: 'Exec Risks',
            executivePlan: 'Exec Plan'
        });

        // 2. Test Success Case
        console.log('\n--- Test 1: Fetching existing past report ---');
        try {
            const result = await reportService.processBoard(projectCode, pastDate);
            console.log('Result:', JSON.stringify(result.data, null, 2));

            if (result.data.workSummary === 'Test Summary from DB') {
                console.log('✅ Success: Fetched from DB');
            } else {
                console.error('❌ Failure: Did not fetch expected data from DB');
            }
        } catch (err: any) {
            console.error('❌ Failure: Check threw error unexpectedly:', err.message);
        }

        // 3. Test Error Case
        console.log('\n--- Test 2: Fetching missing past report ---');
        const missingDate = '2024-01-01';
        try {
            await reportService.processBoard(projectCode, missingDate);
            console.error('❌ Failure: Should have thrown error for missing date');
        } catch (err: any) {
            console.log('✅ Success: Threw error as expected:', err.message);
        }

        // 4. Test Future Date Case
        console.log('\n--- Test 3: Fetching future report ---');
        const futureDate = '2030-01-01';
        try {
            await reportService.processBoard(projectCode, futureDate);
            console.error('❌ Failure: Should have thrown error for future date');
        } catch (err: any) {
            if (err.message.includes('future date')) {
                console.log('✅ Success: Threw future date error as expected:', err.message);
            } else {
                console.error('❌ Failure: Threw unexpected error:', err.message);
            }
        }

        // Cleanup
        await DailyBoardSnapshot.destroy({ where: { date: pastDate, projectId: project.id } });
        console.log('\nCleanup complete.');

    } catch (error) {
        console.error('Error verifying:', error);
    } finally {
        process.exit(0);
    }
}

verifyPastReport();
