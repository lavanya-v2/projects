
import axios from 'axios';
import { config } from '../config';

async function verifyApi() {
    const port = config.server.port || 3000;
    const url = `http://localhost:${port}/api/accounts`;

    console.log(`Testing API at: ${url}`);

    try {
        const response = await axios.get(url);
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));
    } catch (error: any) {
        console.error('Error fetching API:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', error.response.data);
        }
    }
}

verifyApi();
