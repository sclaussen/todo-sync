import { DISPLAY_ICONS } from '../config/constants.js';
import { init, cleanup } from '../../test/util.js';
import dotenv from 'dotenv';

export async function execute(options) {
    // Load environment variables with suppressed output
    const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info
    };
    Object.assign(console, { log: () => {}, error: () => {}, warn: () => {}, info: () => {} });
    dotenv.config();
    Object.assign(console, originalConsole);
    
    // Check if we're in test mode
    if (process.env.TEST !== 'true') {
        console.error(`${DISPLAY_ICONS.ERROR} Init command is only available in TEST mode`);
        console.error(`${DISPLAY_ICONS.INFO} Add 'TEST=true' to your .env file to enable this command`);
        process.exit(1);
    }

    try {
        // Use the same init function from test/util.js
        await init();
        
    } catch (error) {
        console.error(`${DISPLAY_ICONS.ERROR} Failed to initialize test environment:`, error.message);
        process.exit(1);
    }
}