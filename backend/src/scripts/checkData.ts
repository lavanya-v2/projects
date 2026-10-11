
import sequelize from '../config/connection';
import { Project } from '../models/Project';
import { ProjectWeeklyReport } from '../models/ProjectWeeklyReport';
import { Op } from 'sequelize';
import * as dotenv from 'dotenv';
dotenv.config();

async function checkData() {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        const projects = await Project.findAll({
            where: {
                code: ['LOSAI', 'LOWA']
            }
        });

        if (projects.length === 0) {
            console.log('Projects LOSAI and LOWA not found.');
            // List all projects to see what we have
            const allProjects = await Project.findAll();
            console.log('Available projects:', allProjects.map(p => `${p.name} (${p.code})`).join(', '));
            return;
        }

        for (const project of projects) {
            console.log(`\nChecking Project: ${project.name} (ID: ${project.id}, Code: ${project.code})`);

            // Check for weekly reports in Feb 2026
            const startDateStr = '2026-02-01';
            const endDateStr = '2026-02-28';

            const weeklyReports = await ProjectWeeklyReport.findAll({
                where: {
                    projectId: project.id,
                    startDate: {
                        [Op.between]: [startDateStr, endDateStr]
                    }
                }
            });

            console.log(`Found ${weeklyReports.length} weekly reports for Feb 2026.`);
            weeklyReports.forEach(r => console.log(` - Week ${r.weekNumber}: ${r.startDate} to ${r.endDate}`));
        }

    } catch (error) {
        console.error('Error checking data:', error);
    } finally {
        await sequelize.close();
    }
}

checkData();
