import sequelize from '../config/connection';
import { AccountWeeklyReport } from '../models/AccountWeeklyReport';
import { Account } from '../models/Account';

async function verifyAccountReports() {
    try {
        await sequelize.authenticate();

        const account = await Account.findOne({ where: { id: 1 } }); // CCMH
        if (!account) {
            console.log('Account not found');
            process.exit(1);
        }

        const reports = await AccountWeeklyReport.findAll({
            where: { accountId: account.id },
            order: [['createdAt', 'DESC']]
        });

        console.log(`Account Reports Count for CCMH: ${reports.length}`);
        reports.forEach(r => {
            console.log(`ID: ${r.id}, Week: ${r.weekNumber}, Range: ${r.startDate} to ${r.endDate}, UpdatedAt: ${r.updatedAt}`);
        });

        process.exit(0);
    } catch (error) {
        console.error('Error verifying reports:', error);
        process.exit(1);
    }
}

verifyAccountReports();
