import axios from 'axios';

export const client = axios.create({
    baseURL: '/api',
});

// Request interceptor to add auth token
client.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor to handle auth errors
client.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Token expired or invalid
            localStorage.removeItem('token');
            localStorage.removeItem('user');

            // Check if it's a token expiration
            const errorMsg = error.response?.data?.error;
            if (errorMsg === 'Token expired') {
                // Redirect to login with message
                window.location.href = '/login?expired=true';
            } else {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);

