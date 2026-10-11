import sequelize from '../config/connection';
import { ProjectWeeklyReport } from '../models/ProjectWeeklyReport';
import { AccountWeeklyReport } from '../models/AccountWeeklyReport';
import { Project } from '../models/Project';
// import { bootstrap } from '../server'; // Bootstrap might not be exported or needed if we just connect DB

async function verifyReports() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        const losaiProject = await Project.findOne({ where: { code: 'LOSAI' } });
        if (!losaiProject) {
            console.log('LOSAI Project not found');
            process.exit(1);
        }

        const weeklyReports = await ProjectWeeklyReport.findAll({
            where: { projectId: losaiProject.id }
        });

        console.log(`Weekly Reports Count for LOSAI: ${weeklyReports.length}`);
        weeklyReports.forEach((r: any) => {
            console.log(`ID: ${r.id}, Week: ${r.weekNumber}, Valid: ${r.startDate} - ${r.endDate}, UpdatedAt: ${r.updatedAt} `);
        });

        process.exit(0);
    } catch (error) {
        console.error('Error verifying reports:', error);
        process.exit(1);
    }
}

verifyReports();
