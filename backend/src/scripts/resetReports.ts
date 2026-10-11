import sequelize from '../config/connection';
import { ProjectWeeklyReport } from '../models/ProjectWeeklyReport';
import { AccountWeeklyReport } from '../models/AccountWeeklyReport';
import { MonthlyProjectReport } from '../models/MonthlyProjectReport';

async function resetReports() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        await AccountWeeklyReport.destroy({ truncate: true, cascade: false });
        console.log('Cleared AccountWeeklyReport');

        await ProjectWeeklyReport.destroy({ truncate: true, cascade: false });
        console.log('Cleared ProjectWeeklyReport');

        await MonthlyProjectReport.destroy({ truncate: true, cascade: false });
        console.log('Cleared MonthlyProjectReport');

        process.exit(0);
    } catch (error) {
        console.error('Error clearing data:', error);
        process.exit(1);
    }
}

resetReports();
