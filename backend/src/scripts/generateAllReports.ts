
import sequelize from '../config/connection';
import { reportService } from '../modules/reports/services/reportService';
import { Project } from '../models/Project';

async function generateAllReports() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to Database.');

        const projects = ['LOWA', 'LS', 'EXP', 'LOSAI', 'LOT'];

        for (const projectCode of projects) {
            console.log(`\n================================`);
            console.log(`🚀 Starting Report Generation for: ${projectCode}`);
            console.log(`================================`);

            try {
                // Verify project exists first mainly to avoid confusing error logs if seed data missing
                const project = await Project.findOne({ where: { code: projectCode } });
                if (!project) {
                    console.error(`❌ Project ${projectCode} not found in DB. Skipping.`);
                    continue;
                }

                const result = await reportService.processBoard(projectCode);

                if (result) {
                    console.log(`✅ Report Generated Successfully for ${projectCode}`);
                    // console.log(JSON.stringify(result.data, null, 2)); // Optional: Print full output
                    console.log(`   Health: ${result.data.health}`);
                    console.log(`   Plan: ${result.data.planForTomorrow}`);
                } else {
                    console.warn(`⚠️ No data returned for ${projectCode} (Optimization: No Active Team Issues?)`);
                }

            } catch (err: any) {
                console.error(`❌ Error generating report for ${projectCode}:`, err.message);
            }
        }

    } catch (error) {
        console.error('Fatal Script Error:', error);
    } finally {
        // Allow time for logs to flush if needed
        setTimeout(() => process.exit(0), 1000);
    }
}

// Execute
generateAllReports();
