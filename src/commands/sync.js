import { getLocalTasks } from '../data/local.js';
import { getTodoistTasks } from '../data/todoist.js';
import { displaySyncChanges } from '../display/console.js';
import { executeSync, categorizeChanges } from '../../lib.js';
import { DISPLAY_ICONS } from '../config/constants.js';

export async function execute(options) {
    if (options.backup) {
        await handleBackup();
        return;
    }

    const [localData, todoistData] = await Promise.all([
        getLocalTasks(),
        getTodoistTasks()
    ]);

    const changes = categorizeChanges(localData, todoistData, null, options.preview);

    if (options.preview) {
        displaySyncChanges(changes, true, true);
    } else {
        await executeSyncChanges(changes);
    }
}

async function handleBackup() {
    console.log(`${DISPLAY_ICONS.BACKUP} Creating backup...`);
    // Import and use backup functionality from lib.js
    const { createBackup } = await import('../../lib.js');
    const result = await createBackup();
    
    if (result.success) {
        console.log(`${DISPLAY_ICONS.SUCCESS} Backup created: ${result.backupDir}`);
    } else {
        throw new Error(result.error);
    }
}

async function executeSyncChanges(changes) {
    console.log(`${DISPLAY_ICONS.SYNC} Executing synchronization...`);
    
    // Create backup first
    await handleBackup();
    
    const results = await executeSync(changes);
    
    if (results.success) {
        console.log(`\n${DISPLAY_ICONS.SUCCESS} Synchronization completed!`);
        if (results.summary) {
            console.log(`\n${DISPLAY_ICONS.INFO} Summary: ${results.summary}`);
        }
    } else {
        throw new Error(results.error || results.errors.join(', '));
    }
}