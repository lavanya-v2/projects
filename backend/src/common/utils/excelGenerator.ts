import ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

interface BoardReport {
    boardName: string;
    data: {
        workSummary: string;
        planForTomorrow: string;
        risks: string;
        notes: string;
        executiveSummary?: string;
        keyRisks?: string;
        executivePlan?: string;
        health?: string;
    };
}

import { config } from '../../config';

// ... interface BoardReport ... (keeping existing interface if needed, but adding AccountReport interface)

interface AccountReportData {
    accountName: string;
    weekNumber: number;
    year: number;
    startDate: string;
    endDate: string;
    summary: string;
    risks: { summary: string; items: string[] } | string[] | string;
    actionItems?: string[];
    health: string;
    projects: {
        name: string;
        summary: string;
        risks: string;
        status: string;
        achievements: string;
    }[];
    projectsMissing: string[];
}

export class ExcelGenerator {
    private reportsDir: string;

    constructor() {
        this.reportsDir = config.reports.path;
        if (!fs.existsSync(this.reportsDir)) {
            fs.mkdirSync(this.reportsDir, { recursive: true });
        }
    }

    // ... generateDailyReport (keep existing, update if needed for path) ...
    async generateDailyReport(dateStr: string, boardReports: BoardReport[], projectName: string | null = null): Promise<string> {
        // ... implementation using this.reportsDir which is now from config ...
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Jira Daily Reporter';

        // 1. Create Executive Summary Sheet
        // "Executive Plan" intentionally dropped -- matches the on-screen daily report,
        // which no longer shows a plan-for-tomorrow section for any project.
        const execSheet = workbook.addWorksheet('Executive Summary');
        execSheet.columns = [
            { header: 'Board Name', key: 'boardName', width: 30 },
            { header: 'Executive Summary', key: 'execSummary', width: 60 },
            { header: 'Key Risks', key: 'execRisks', width: 40 }
        ];
        this.styleHeaderRow(execSheet);

        for (const report of boardReports) {
            const row = execSheet.addRow({
                boardName: report.boardName,
                execSummary: report.data.executiveSummary || 'N/A',
                execRisks: report.data.keyRisks || 'N/A'
            });
            row.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        }

        // 2. Create Individual Sheets for each Board
        for (const report of boardReports) {
            const sheetName = report.boardName.replace(/[\/\\?*:\[\]]/g, '').substring(0, 30) || 'Board';
            const sheet = workbook.addWorksheet(sheetName);

            // "Plan for tomorrow" intentionally dropped -- matches the on-screen daily
            // report, which no longer shows this section for any project (not Thrive-specific).
            sheet.columns = [
                { header: 'Work Summary', key: 'workSummary', width: 50 },
                { header: 'Roadblock / Risks (if any)', key: 'risks', width: 50 },
                { header: 'Notes', key: 'notes', width: 50 }
            ];
            this.styleHeaderRow(sheet);

            const row = sheet.addRow({
                workSummary: report.data.workSummary || '',
                risks: report.data.risks || '',
                notes: report.data.notes || ''
            });
            row.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        }

        const prefix = projectName ? `Daily_Status_${projectName}_` : 'Daily_Status_';
        const filename = `${prefix}${dateStr.replace(/\//g, '_')}.xlsx`;
        const filepath = path.join(this.reportsDir, filename);

        await workbook.xlsx.writeFile(filepath);
        console.log(`Excel report saved: ${filepath}`);
        return filepath;
    }




    private styleHeaderRow(sheet: ExcelJS.Worksheet): void {
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 25;
    }

    async generateAccountWeeklyReport(data: AccountReportData): Promise<string> {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Account Weekly Reporter';

        // 1. Executive Summary Sheet
        const summarySheet = workbook.addWorksheet('Executive Summary');

        // Account Info Header
        summarySheet.mergeCells('A1:B1');
        summarySheet.getCell('A1').value = `Account: ${data.accountName}`;
        summarySheet.getCell('A1').font = { size: 14, bold: true };

        summarySheet.mergeCells('A2:B2');
        summarySheet.getCell('A2').value = `Week: ${data.startDate} to ${data.endDate}`;
        summarySheet.getCell('A2').font = { size: 12, bold: true };

        summarySheet.getCell('A4').value = 'Overall Health';
        summarySheet.getCell('B4').value = data.health;

        // Style Health Check
        const healthCell = summarySheet.getCell('B4');
        healthCell.font = { bold: true };
        if (data.health === 'Green') healthCell.font.color = { argb: 'FF00B050' };
        else if (data.health === 'Amber') healthCell.font.color = { argb: 'FFFFC000' };
        else if (data.health === 'Red') healthCell.font.color = { argb: 'FFFF0000' };

        summarySheet.mergeCells('A6:B6');
        summarySheet.getCell('A6').value = 'Executive Summary';
        summarySheet.getCell('A6').font = { bold: true, size: 12 };
        summarySheet.getCell('A6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

        summarySheet.mergeCells('A7:B12');
        const summaryCell = summarySheet.getCell('A7');
        summaryCell.value = data.summary;
        summaryCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

        summarySheet.mergeCells('A14:B14');
        summarySheet.getCell('A14').value = 'Top Risks & Attention Items';
        summarySheet.getCell('A14').font = { bold: true, size: 12 };
        summarySheet.getCell('A14').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };

        summarySheet.mergeCells('A15:B20');
        const risksCell = summarySheet.getCell('A15');

        let risksText = '';
        if (data.risks && typeof data.risks === 'object' && !Array.isArray(data.risks)) {
            const r = data.risks as any;
            risksText = (r.summary ? `Summary: ${r.summary}\n` : '') +
                (Array.isArray(r.items) ? r.items.map((i: string) => `• ${i}`).join('\n') : '');
        } else if (Array.isArray(data.risks)) {
            risksText = data.risks.map(r => `• ${r}`).join('\n');
        } else {
            risksText = data.risks || '';
        }

        risksCell.value = risksText;
        risksCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

        // Action Items
        if (data.actionItems && data.actionItems.length > 0) {
            summarySheet.mergeCells('A22:B22');
            summarySheet.getCell('A22').value = 'Recommended Action Items';
            summarySheet.getCell('A22').font = { bold: true, size: 12 };
            summarySheet.getCell('A22').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

            summarySheet.mergeCells('A23:B28');
            const actionCell = summarySheet.getCell('A23');
            actionCell.value = data.actionItems.map(a => `• ${a}`).join('\n');
            actionCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        }

        summarySheet.getColumn('A').width = 20;
        summarySheet.getColumn('B').width = 80;

        // 2. Project Status Sheet
        const projectSheet = workbook.addWorksheet('Project Status');
        projectSheet.columns = [
            { header: 'Project', key: 'name', width: 20 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Key Achievement / Summary', key: 'summary', width: 60 },
            { header: 'Risks / Blockers', key: 'risks', width: 50 },
            { header: 'Key Achievements', key: 'achievements', width: 50 }
        ];
        this.styleHeaderRow(projectSheet);

        for (const proj of data.projects) {
            const row = projectSheet.addRow({
                name: proj.name,
                status: proj.status || 'N/A',
                summary: proj.summary || '',
                risks: proj.risks || '',
                achievements: proj.achievements || ''
            });
            row.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

            // Color code status
            const statusCell = row.getCell('status');
            if (proj.status === 'Green') statusCell.font = { color: { argb: 'FF00B050' }, bold: true };
            else if (proj.status === 'Amber') statusCell.font = { color: { argb: 'FFFFC000' }, bold: true };
            else if (proj.status === 'Red') statusCell.font = { color: { argb: 'FFFF0000' }, bold: true };
        }

        // Add missing projects section 
        if (data.projectsMissing.length > 0) {
            projectSheet.addRow({});
            const row = projectSheet.addRow({ name: 'MISSING DATA', summary: `No reports found for: ${data.projectsMissing.join(', ')}` });
            row.font = { color: { argb: 'FFFF0000' }, italic: true };
        }

        const filename = `Account_Weekly_Status_${data.accountName}_${data.startDate}_${data.endDate}.xlsx`;
        const filepath = path.join(this.reportsDir, filename);

        await workbook.xlsx.writeFile(filepath);
        console.log(`Account Export saved: ${filepath}`);
        return filepath;
    }
}

export const excelGenerator = new ExcelGenerator();
