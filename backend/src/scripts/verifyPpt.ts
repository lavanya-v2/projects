
import { accountReportService } from '../modules/reports/services/accountReportService';
import { PptGenerator } from '../common/utils/pptGenerator';
import * as dotenv from 'dotenv';
import sequelize from '../config/connection';

dotenv.config();

const testPptIntegration = async () => {
    try {
        console.log('Connecting to database...');
        await sequelize.authenticate();
        console.log('Database connected.');
        console.log('Starting PPT Service Integration Test...');
        // Use Account ID 1 (LOSAI/LOT account from previous context)
        const accountId = 1;
        const startDate = '2026-02-02';
        const endDate = '2026-02-07';

        console.log(`Generating report for Account ${accountId}...`);
        const report = await accountReportService.generateAccountWeeklyReport(accountId, startDate, endDate, true); // Force refresh

        console.log('Report Generated Successfully!');
        console.log('ID:', report.id);
        console.log('File Path:', report.filePath);

    } catch (error) {
        console.error('Integration Test Failed:', error);
    }
};

testPptIntegration();
