import { join } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';

// Load environment variables (suppress all output by temporarily silencing console)
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
console.log = () => {};
console.warn = () => {};

// Transaction logging functionality
import { promises as fs } from 'fs';
import { dirname } from 'path';

async function ensureDirectoryExists(filePath) {
    const dir = dirname(filePath);
    try {
        await fs.access(dir);
    } catch {
        await fs.mkdir(dir, { recursive: true });
    }
}

async function logTransaction(entry) {
    const filePath = FILE_PATHS.TRANSACTIONS;
    await ensureDirectoryExists(filePath);

    try {
        let content = '';
        try {
            content = await fs.readFile(filePath, 'utf8');
        } catch {
            // File doesn't exist, create header
            content = '# Entries are append-only, ordered chronologically\nentries:\n\n';
        }

        // Format the entry as YAML
        let yamlEntry = `  - type: ${entry.type}
    timestamp: ${entry.timestamp}`;
        
        // Add fields based on entry type
        if (entry.type === 'sync') {
            yamlEntry += `
    source: cli${entry.summary ? `
    summary: "${entry.summary}"` : ''}${entry.local_changes !== undefined ? `
    local_changes: ${entry.local_changes}` : ''}${entry.remote_changes !== undefined ? `
    remote_changes: ${entry.remote_changes}` : ''}
`;
        } else {
            // Handle other entry types (create, update, complete, remove)
            yamlEntry += `
    name: "${entry.name}"${entry.oldPriority !== undefined ? `
    old-priority: ${entry.oldPriority}` : ''}${entry.newPriority !== undefined ? `
    new-priority: ${entry.newPriority}` : ''}${entry.newName !== undefined ? `
    new-name: "${entry.newName}"` : ''}${entry.priority !== undefined ? `
    priority: ${entry.priority}` : ''}
    source: cli
`;
        }

        content += yamlEntry;
        await fs.writeFile(filePath, content, 'utf8');
    } catch (error) {
        console.error('Error logging transaction:', error);
    }
}

function getCurrentTimestamp() {
    return new Date().toISOString().replace('Z', new Date().toTimeString().slice(9, 14));
}

export { logTransaction, getCurrentTimestamp };
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
    TASK: 'current.tasks',
    COMPLETED: 'completed.yaml',
    LOG: '.tasks.yaml',
    TRANSACTIONS: 'transactions.yaml'
};;

// Dynamic file paths that respect TASKS_DIR environment variable
export const FILE_PATHS = {
    get TASK() {
        return join(process.env.TASKS_DIR || join(homedir(), '.tasks'), FILES.TASK);
    },
    get COMPLETED() {
        return join(process.env.TASKS_DIR || join(homedir(), '.tasks'), FILES.COMPLETED);
    },
    get LOG() {
        return join(process.env.TASKS_DIR || join(homedir(), '.tasks'), FILES.LOG);
    },
    get TRANSACTIONS() {
        return join(process.env.TASKS_DIR || join(homedir(), '.tasks'), FILES.TRANSACTIONS);
    },
    get BACKUP_BASE() {
        return join(process.env.TASKS_DIR || join(homedir(), '.tasks'), 'backups');
    }
};;

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
