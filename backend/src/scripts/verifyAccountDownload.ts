import sequelize from '../config/connection';
import { Account } from '../models/Account';
import { accountReportService } from '../modules/reports/services/accountReportService';
import fs from 'fs';
import path from 'path';

async function verifyAccountDownload() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        // 1. Get an account
        const account = await Account.findOne();
        if (!account) {
            console.log('No account found. Skipping.');
            process.exit(0);
        }

        console.log(`Using Account: ${account.name} (ID: ${account.id})`);

        // 2. Generate Report (Force refresh to ensure file generation)
        const report = await accountReportService.generateAccountWeeklyReport(account.id, undefined, undefined, true);
        console.log('Report generated ID:', report.id);
        console.log('File path:', report.filePath);

        // 3. Verify File Exists
        if (report.filePath && fs.existsSync(report.filePath)) {
            console.log('✅ File exists on disk.');
        } else {
            console.error('❌ File missing on disk.');
            process.exit(1);
        }

        process.exit(0);
    } catch (error) {
        console.error('Error verifying account download:', error);
        process.exit(1);
    }
}

verifyAccountDownload();
