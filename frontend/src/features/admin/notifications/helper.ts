import axios from 'axios';

/**
 * Extracts a human-readable error message from an API failure.
 */
export const getApiErrorMessage = (error: unknown): string => {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 502) {
            return 'Server is temporarily unavailable. Please try again.';
        }
        if (status === 500) {
            return 'Internal Server Error.';
        }
        return error.message || 'An unexpected server error occurred.';
    }
    return 'A network error occurred. Please try again.';
};
