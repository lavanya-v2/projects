import axios from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// DEPRECATED: This script uses environment variables JIRA_EMAIL and JIRA_API_TOKEN
// which have been moved to project-specific database fields.
// To use this script, you must:
// 1. Temporarily add JIRA_EMAIL and JIRA_API_TOKEN to your .env file, OR
// 2. Modify this script to fetch credentials from a specific project in the database

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    console.error('Missing Jira credentials.');
    console.error('JIRA_EMAIL and JIRA_API_TOKEN are now project-specific and stored in the database.');
    console.error('Please add them temporarily to .env or modify this script to use database credentials.');
    process.exit(1);
}

const targetNames = [
    'Karan',
    'Vamshi',
    'Mahesh',
    'Shubham',
    'Dinesh',
    'Revati',
    'Pravin Kambari'
];

interface JiraUser {
    accountId: string;
    displayName: string;
    emailAddress: string;
    active: boolean;
}

async function fetchJiraUsers() {
    try {
        console.log(`Fetching users for project SC from ${JIRA_BASE_URL}...`);

        // Using user/assignable/search to find users assignable to project 'SC'
        // This is a common way to get project members/interested parties
        const response = await axios.get(`${JIRA_BASE_URL}/rest/api/3/user/assignable/search`, {
            params: {
                project: 'SC',
                maxResults: 1000 // Get as many as possible
            },
            headers: {
                'Authorization': `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
                'Accept': 'application/json'
            }
        });

        const users: JiraUser[] = response.data;
        console.log(`Found ${users.length} total assignable users.`);

        const matchedUsers = users.filter(user => {
            return targetNames.some(name =>
                user.displayName.toLowerCase().includes(name.toLowerCase()) ||
                (user.emailAddress && user.emailAddress.toLowerCase().includes(name.toLowerCase()))
            );
        });

        console.log('\nMatched Users:');
        console.log('--------------------------------------------------');
        matchedUsers.forEach(user => {
            console.log(`Name: ${user.displayName}`);
            console.log(`Email: ${user.emailAddress}`);
            console.log('--------------------------------------------------');
        });

        if (matchedUsers.length === 0) {
            console.log('No matching users found.');
        }

    } catch (error: any) {
        console.error('Error fetching Jira users:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

fetchJiraUsers();
