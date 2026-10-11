
import { monthlyReportService } from '../modules/reports/services/monthlyReportService';
import sequelize from '../config/connection';
import { Project } from '../models/Project';

async function verifyMonthlyReport() {
    try {
        console.log('Connecting to database...');
        await sequelize.authenticate();
        console.log('Database connected.');

        // Get a project
        const project = await Project.findOne();
        if (!project) {
            console.error('No project found to test.');
            return;
        }

        console.log(`Testing Monthly Report for Project: ${project.name} (ID: ${project.id})`);

        // Generate for current month
        const now = new Date();
        const month = now.getMonth() + 1; // 1-12
        const year = now.getFullYear();

        console.log(`Generating report for ${month}/${year}...`);

        // Force refresh to ensure logic runs
        const report = await monthlyReportService.generateProjectMonthlyReport(project.id, month, year, true);

        console.log('Report Generated Successfully!');
        console.log(JSON.stringify(report.toJSON(), null, 2));

    } catch (error) {
        console.error('Verification Failed:', error);
    } finally {
        await sequelize.close();
    }
}

verifyMonthlyReport();
