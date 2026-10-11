import * as path from 'path';
import * as fs from 'fs';

interface BoardReport {
    boardName: string;
    data: any;
}

export class JSONGenerator {
    private reportsDir: string;

    constructor() {
        this.reportsDir = path.join(__dirname, '../../../../reports');
        if (!fs.existsSync(this.reportsDir)) {
            fs.mkdirSync(this.reportsDir, { recursive: true });
        }
    }

    async generateDailyReport(dateStr: string, boardReports: BoardReport[], projectName: string | null = null): Promise<string> {
        const prefix = projectName ? `Daily_Status_${projectName}_` : 'Daily_Status_';
        const filename = `${prefix}${dateStr.replace(/\//g, '_')}.json`;
        const filepath = path.join(this.reportsDir, filename);

        const reportData = {
            date: dateStr,
            projectName: projectName,
            boards: boardReports.map(r => ({
                boardName: r.boardName,
                ...r.data
            }))
        };

        fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2));
        console.log(`JSON report saved: ${filepath}`);
        return filepath;
    }
}

export const jsonGenerator = new JSONGenerator();
