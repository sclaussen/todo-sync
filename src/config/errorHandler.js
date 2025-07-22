import { DISPLAY_ICONS } from './constants.js';

export function withErrorHandler(fn) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            console.error(`${DISPLAY_ICONS.ERROR} ${error.message}`);
            process.exit(1);
        }
    };
}