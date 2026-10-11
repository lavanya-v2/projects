
import { monthlyReportService } from '../modules/reports/services/monthlyReportService';
import sequelize from '../config/connection';

async function generateReports() {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        const projects = [
            { id: 1, name: 'LOSAI' },
            { id: 2, name: 'LOWA' }
        ];

        const month = 2; // February
        const year = 2026;

        for (const p of projects) {
            console.log(`\nGenerating Monthly Report for ${p.name} (${month}/${year})...`);
            try {
                const report = await monthlyReportService.generateProjectMonthlyReport(p.id, month, year, true);
                console.log(`Success! Report ID: ${report.id}, Status: ${report.status}`);
                console.log(`Summary: ${report.workSummary.substring(0, 100)}...`);
            } catch (err: any) {
                console.error(`Failed to generate for ${p.name}:`, err.message);
            }
        }

    } catch (error) {
        console.error('Script Error:', error);
    } finally {
        await sequelize.close();
    }
}

generateReports();
