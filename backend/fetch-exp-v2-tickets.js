/**
 * Fetch Jira tickets: filter=20850 AND project="EXP"
 * Filter by V2 team members (from local DB)
 * Export to Excel
 */

const axios = require('axios');
const { Client } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');

const JIRA_BASE_URL = 'https://myccmortgage.atlassian.net';
const JIRA_EMAIL = 'ganeshan.a@ccm.com';
const JIRA_API_TOKEN = 'ATATT3xFfGF01qbgxRwMBSkT_VXcKyUpLKO96xObR6si_MQkj9II4Purkb3s7nfYsGGwfLm77XvEHfmTuH_20oj8RSu_ZAynPzSMYPCDOO7EXly6e5uB4YrEL2FEs62FyV2bpeB59QII-7_VyhsyX5owLYg6TqQAFWWPWrJpJaOEPtyRsm6Gzlk=914882CD';

const authHeader = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;

const jiraClient = axios.create({
  baseURL: JIRA_BASE_URL,
  headers: {
    Authorization: authHeader,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

async function getV2TeamMembers() {
  const db = new Client({
    user: 'postgres',
    password: 'password',
    database: 'status_report_mar222026',
    host: 'localhost',
    port: 5432,
  });
  await db.connect();
  const res = await db.query('SELECT first_name, last_name, email, jira_login_id FROM team_members');
  await db.end();
  return res.rows;
}

async function fetchAllJiraTickets(jql) {
  const allIssues = [];
  let nextPageToken = null;
  let isLast = false;

  while (!isLast) {
    const body = { jql, maxResults: 100, fields: ['*all'] };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const response = await jiraClient.post('/rest/api/3/search/jql', body);
    const data = response.data;

    if (data.issues && data.issues.length > 0) {
      allIssues.push(...data.issues);
    }
    console.log(`  Fetched ${allIssues.length} tickets so far...`);

    if (data.nextPageToken) {
      nextPageToken = data.nextPageToken;
    } else {
      isLast = true;
    }
    if (data.isLast) isLast = true;
  }

  return allIssues;
}

function normalizeEmail(email) {
  return (email || '').toLowerCase().trim();
}

async function main() {
  console.log('Fetching V2 team members from DB...');
  const v2Members = await getV2TeamMembers();
  console.log(`Found ${v2Members.length} V2 team members`);

  // Build a Set of normalized jira_login_ids and emails for fast lookup
  const v2JiraIds = new Set(v2Members.map(m => normalizeEmail(m.jira_login_id)));
  const v2Emails = new Set(v2Members.map(m => normalizeEmail(m.email)));

  // Build lookup map: normalized jira_login_id -> member info
  const memberByJiraId = {};
  v2Members.forEach(m => {
    memberByJiraId[normalizeEmail(m.jira_login_id)] = m;
    memberByJiraId[normalizeEmail(m.email)] = m;
  });

  console.log('\nFetching Jira tickets (filter=20850 AND project="EXP")...');
  const jql = 'filter=20850 AND project="EXP"';
  const issues = await fetchAllJiraTickets(jql);
  console.log(`\nTotal tickets fetched: ${issues.length}`);

  // Filter tickets assigned to V2 team members
  const v2Tickets = issues.filter(issue => {
    const assignee = issue.fields.assignee;
    if (!assignee) return false;
    const assigneeEmail = normalizeEmail(assignee.emailAddress);
    const displayName = (assignee.displayName || '').toLowerCase();
    return v2JiraIds.has(assigneeEmail) || v2Emails.has(assigneeEmail);
  });

  console.log(`\nTickets assigned to V2 team: ${v2Tickets.length}`);

  // Build Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('EXP V2 Tickets');

  sheet.columns = [
    { header: 'Key', key: 'key', width: 15 },
    { header: 'Summary', key: 'summary', width: 60 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Assignee', key: 'assignee', width: 30 },
    { header: 'Assignee Email', key: 'assigneeEmail', width: 40 },
    { header: 'V2 Member Name', key: 'v2Name', width: 30 },
    { header: 'Reporter', key: 'reporter', width: 30 },
    { header: 'Created', key: 'created', width: 20 },
    { header: 'Updated', key: 'updated', width: 20 },
    { header: 'Due Date', key: 'duedate', width: 15 },
    { header: 'Labels', key: 'labels', width: 25 },
    { header: 'Components', key: 'components', width: 25 },
    { header: 'Fix Versions', key: 'fixVersions', width: 20 },
    { header: 'Story Points', key: 'storyPoints', width: 14 },
    { header: 'Parent', key: 'parent', width: 15 },
    { header: 'Jira Link', key: 'jiraLink', width: 45 },
  ];

  // Header style
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0052CC' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  v2Tickets.forEach(issue => {
    const f = issue.fields;
    const assigneeEmail = normalizeEmail(f.assignee?.emailAddress);
    const member = memberByJiraId[assigneeEmail];
    const v2Name = member ? `${member.first_name} ${member.last_name}` : '';

    const storyPoints = f.customfield_10016 || f.customfield_10028 || '';

    const row = sheet.addRow({
      key: issue.key,
      summary: f.summary || '',
      type: f.issuetype?.name || '',
      status: f.status?.name || '',
      priority: f.priority?.name || '',
      assignee: f.assignee?.displayName || '',
      assigneeEmail: f.assignee?.emailAddress || '',
      v2Name,
      reporter: f.reporter?.displayName || '',
      created: f.created ? new Date(f.created).toLocaleDateString('en-IN') : '',
      updated: f.updated ? new Date(f.updated).toLocaleDateString('en-IN') : '',
      duedate: f.duedate || '',
      labels: (f.labels || []).join(', '),
      components: (f.components || []).map(c => c.name).join(', '),
      fixVersions: (f.fixVersions || []).map(v => v.name).join(', '),
      storyPoints,
      parent: f.parent?.key || '',
      jiraLink: `${JIRA_BASE_URL}/browse/${issue.key}`,
    });

    // Alternate row coloring
    if (row.number % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
      });
    }

    // Color code by status
    const statusCell = row.getCell('status');
    const status = (f.status?.name || '').toLowerCase();
    if (status.includes('done') || status.includes('closed') || status.includes('complete')) {
      statusCell.font = { color: { argb: 'FF2E7D32' } };
    } else if (status.includes('progress') || status.includes('review')) {
      statusCell.font = { color: { argb: 'FF1565C0' } };
    } else if (status.includes('blocked') || status.includes('impede')) {
      statusCell.font = { color: { argb: 'FFFF0000' }, bold: true };
    }
  });

  // Auto-filter
  sheet.autoFilter = {
    from: 'A1',
    to: `R${v2Tickets.length + 1}`,
  };

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Add summary sheet
  const summarySheet = workbook.addWorksheet('Summary by Assignee');
  summarySheet.columns = [
    { header: 'V2 Member', key: 'member', width: 30 },
    { header: 'Assignee (Jira)', key: 'jira', width: 35 },
    { header: 'Email', key: 'email', width: 40 },
    { header: 'Total Tickets', key: 'total', width: 14 },
    { header: 'To Do', key: 'todo', width: 12 },
    { header: 'In Progress', key: 'inprogress', width: 14 },
    { header: 'Done', key: 'done', width: 12 },
  ];
  summarySheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0052CC' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // Group by assignee
  const byAssignee = {};
  v2Tickets.forEach(issue => {
    const f = issue.fields;
    const key = f.assignee?.emailAddress || 'Unassigned';
    if (!byAssignee[key]) {
      byAssignee[key] = { tickets: [], displayName: f.assignee?.displayName || '', email: key };
    }
    byAssignee[key].tickets.push(issue);
  });

  Object.entries(byAssignee)
    .sort((a, b) => b[1].tickets.length - a[1].tickets.length)
    .forEach(([email, data]) => {
      const member = memberByJiraId[normalizeEmail(email)];
      const statuses = data.tickets.map(t => (t.fields.status?.name || '').toLowerCase());
      summarySheet.addRow({
        member: member ? `${member.first_name} ${member.last_name}` : '',
        jira: data.displayName,
        email: data.email,
        total: data.tickets.length,
        todo: statuses.filter(s => s.includes('to do') || s === 'open' || s === 'new' || s === 'backlog').length,
        inprogress: statuses.filter(s => s.includes('progress') || s.includes('review')).length,
        done: statuses.filter(s => s.includes('done') || s.includes('closed') || s.includes('complete')).length,
      });
    });

  const outputPath = path.join('/Users/ganeshana/projects/dsr-generator', `EXP_V2_Tickets_${new Date().toISOString().slice(0,10)}.xlsx`);
  await workbook.xlsx.writeFile(outputPath);
  console.log(`\nExcel exported to: ${outputPath}`);
  console.log(`\nSummary:`);
  console.log(`  Total tickets in filter: ${issues.length}`);
  console.log(`  Tickets assigned to V2 team: ${v2Tickets.length}`);
  console.log(`  V2 assignees: ${Object.keys(byAssignee).length}`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  if (err.response) {
    console.error('Jira API error:', err.response.status, JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
