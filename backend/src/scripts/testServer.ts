
import { createApp } from '../app';
import sequelize from '../config/connection';

async function startTestServer() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to DB');

        const app = createApp();
        const port = 3001; // Use a different port for testing

        const server = app.listen(port, () => {
            console.log(`🚀 Test Server running on port ${port}`);
        });

        // Keep it running for a bit then exit (or just let it run if we want to curl it)
        // For this script, we want to run it, let it listen, and then maybe we can hit it from another script?
        // Actually, better to make a script that starts app, hits endpoint, then closes.

        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 1000));

        const axios = require('axios');
        try {
            const response = await axios.get(`http://localhost:${port}/api/accounts`);
            console.log('Status:', response.status);
            console.log('Data:', JSON.stringify(response.data, null, 2));
        } catch (err: any) {
            console.error('Error hitting test server:', err.message);
            if (err.response) {
                console.error('Response:', err.response.status, err.response.data);
            }
        } finally {
            server.close();
            console.log('Test Server closed');
            await sequelize.close();
        }

    } catch (error) {
        console.error('Failed to start test server:', error);
        process.exit(1);
    }
}

startTestServer();
