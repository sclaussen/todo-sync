import { join } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';

// Load environment variables (suppress all output by temporarily silencing console)
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};
dotenv.config();
console.log = originalLog;
console.warn = originalWarn;
console.error = originalError;

export const PRIORITIES = {
    HIGHEST: 0,
    HIGH: 1, 
    MEDIUM: 2,
    LOW: 3,
    LOWEST: 4
};

export const PRIORITY_LABELS = {
    0: 'Priority 0',
    1: 'Priority 1', 
    2: 'Priority 2',
    3: 'Priority 3',
    4: 'Priority 4',
    'unknown': 'Unknown Priority'
};

export const FILES = {
    TASK: '.tasks',
    COMPLETED: '.tasks.completed',
    LOG: '.tasks.yaml'
};

// Dynamic file paths that respect TODO_DIR environment variable
export const FILE_PATHS = {
    get TASK() {
        return join(process.env.TODO_DIR || homedir(), FILES.TASK);
    },
    get COMPLETED() {
        return join(process.env.TODO_DIR || homedir(), FILES.COMPLETED);
    },
    get LOG() {
        return join(process.env.TODO_DIR || homedir(), FILES.LOG);
    }
};

export const TODOIST = {
    API_TOKEN: process.env.TODOIST_API_TOKEN || '',
    PROJECT_NAME: process.env.TODOIST_PROJECT_NAME || 'Sync',
    BASE_URL: 'https://api.todoist.com/rest/v2',
    SYNC_URL: 'https://api.todoist.com/sync/v9'
};

export const TODOIST_PRIORITY_MAP = {
    // Local to Todoist
    0: 4, // Priority 0 → Todoist Priority 4 (highest/red)
    1: 4, // Priority 1 → Todoist Priority 4 (highest/red) 
    2: 3, // Priority 2 → Todoist Priority 3 (orange)
    3: 2, // Priority 3 → Todoist Priority 2 (blue)
    4: 1  // Priority 4 → Todoist Priority 1 (lowest/no flag)
};

export const LOCAL_PRIORITY_MAP = {
    // Todoist to Local
    4: 1, // Todoist Priority 4 (highest) → Local Priority 1
    3: 2, // Todoist Priority 3 → Local Priority 2
    2: 3, // Todoist Priority 2 → Local Priority 3
    1: 4  // Todoist Priority 1 (lowest) → Local Priority 4
};

export const DISPLAY_ICONS = {
    LOCAL: '📁',
    REMOTE: '☁️',
    SUCCESS: '✅',
    ERROR: '❌',
    WARNING: '⚠️',
    INFO: 'ℹ️',
    BACKUP: '💾',
    SYNC: '🔄'
};