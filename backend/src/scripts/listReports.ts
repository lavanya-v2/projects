
import { ProjectWeeklyReport } from '../models/ProjectWeeklyReport';
import sequelize from '../config/connection';

async function listReports() {
    try {
        await sequelize.authenticate();
        const reports = await ProjectWeeklyReport.findAll({ limit: 5 });
        console.log('Existing Weekly Reports:', JSON.stringify(reports, null, 2));
    } finally {
        await sequelize.close();
    }
}

listReports();
