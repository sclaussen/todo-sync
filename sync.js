#!/usr/bin/env node

import { Command } from 'commander';
import { logger, removeDuplicateTasks, removeDuplicateTodoistTasks } from './util.js';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ConflictResolution = {
    LOCAL_WINS: 'local',
    REMOTE_WINS: 'remote',
    MERGE: 'merge',
    INTERACTIVE: 'interactive',
    NEWEST_WINS: 'newest'
};

// Configuration with hardcoded defaults and environment variable overrides
function getConfig() {
    return {
        todoist: {
            apiToken: process.env.TODOIST_API_TOKEN || '',
            projectName: process.env.TODOIST_PROJECT_NAME || 'Synced Tasks'
        },
        sync: {
            conflictResolution: process.env.CONFLICT_RESOLUTION || ConflictResolution.INTERACTIVE,
            backupBeforeSync: process.env.BACKUP_BEFORE_SYNC !== 'false'
        },
        duplicateDetection: {
            enabled: process.env.DUPLICATE_DETECTION !== 'false',
            similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.85'),
            ignoreCase: process.env.IGNORE_CASE !== 'false',
            ignoreWhitespace: process.env.IGNORE_WHITESPACE !== 'false',
            enableFuzzyMatching: process.env.FUZZY_MATCHING !== 'false',
            strategy: process.env.DUPLICATE_STRATEGY || 'interactive'
        },
        mapping: {
            priorityMapping: {
                '0': { todoistPriority: 4, dueString: 'today' },
                '1': { todoistPriority: 3 },
                '2': { todoistPriority: 2 },
                '3': { todoistPriority: 1 },
                '4': { todoistPriority: 1 }
            }
        }
    };
}

function parseCliArguments() {
    const program = new Command();
    
    program
        .name('task-sync')
        .description('Bidirectional sync between ~/.todo file and Todoist')
        .version('1.0.0');

    program
        .command('sync')
        .description('Run synchronization')
        .option('-d, --dry-run', 'Preview changes without applying them')
        .action(async (options) => {
            const result = await handleSyncCommand(options);
            if (result.exitCode !== 0) {
                process.exit(result.exitCode);
            }
        });

    program
        .command('setup')
        .description('Show environment variable setup instructions')
        .action(() => {
            handleSetupCommand();
        });

    program
        .command('status')
        .description('Show sync status and configuration')
        .action(() => {
            handleStatusCommand();
        });

    program
        .command('daemon')
        .description('Run in daemon mode with automatic sync')
        .option('-i, --interval <minutes>', 'Sync interval in minutes', '30')
        .action((options) => {
            handleDaemonCommand(options);
        });

    program.parse();
    
    return {
        command: program.args[0] || 'sync',
        options: program.opts()
    };
}

async function handleSyncCommand(options) {
    const config = getConfig();

    if (!config.todoist.apiToken) {
        console.error('No API token configured. Set TODOIST_API_TOKEN environment variable.');
        return { exitCode: 1 };
    }

    try {
        if (options.dryRun) {
            console.log('Dry run mode - no changes will be made');
            // TODO: Implement dry run logic
            return { exitCode: 0 };
        }

        console.log('Starting synchronization...');
        const result = await sync(config);

        console.log('\nSync completed:');
        console.log(`- Added: ${result.added.local} local, ${result.added.todoist} Todoist`);
        console.log(`- Updated: ${result.updated.local} local, ${result.updated.todoist} Todoist`);
        console.log(`- Deleted: ${result.deleted.local} local, ${result.deleted.todoist} Todoist`);
        console.log(`- Conflicts: ${result.conflicts}`);
        console.log(`- Duplicates resolved: ${result.duplicatesResolved}`);

        if (result.errors.length > 0) {
            console.error('\nErrors encountered:');
            result.errors.forEach(error => console.error(`- ${error}`));
        }

        logger.info('Sync completed', result);
        return { exitCode: 0 };
    } catch (error) {
        console.error('Sync failed:', error);
        logger.error('Sync failed', error);
        return { exitCode: 1 };
    }
}

function handleSetupCommand() {
    console.log('Task Sync Setup Instructions\n');
    console.log('Set the following environment variables:');
    console.log('');
    console.log('Required:');
    console.log('  export TODOIST_API_TOKEN=your_todoist_api_token');
    console.log('');
    console.log('Optional (defaults shown):');
    console.log('  export TODOIST_PROJECT_NAME="Synced Tasks"');
    console.log('  export CONFLICT_RESOLUTION="interactive"  # local, remote, interactive, newest');
    console.log('  export BACKUP_BEFORE_SYNC="true"          # true, false');
    console.log('  export DUPLICATE_DETECTION="true"         # true, false');
    console.log('  export SIMILARITY_THRESHOLD="0.85"        # 0.0-1.0');
    console.log('');
    console.log('You can add these to your ~/.bashrc, ~/.zshrc, or create a .env file.');
    console.log('After setting TODOIST_API_TOKEN, run "task-sync sync" to start syncing.');
}

function handleStatusCommand() {
    const config = getConfig();

    console.log('Task Sync Status\n');
    console.log('Configuration:');
    console.log(`- API Token: ${config.todoist.apiToken ? '***configured***' : 'not configured'}`);
    console.log(`- Project Name: ${config.todoist.projectName}`);
    console.log(`- Conflict Resolution: ${config.sync.conflictResolution}`);
    console.log(`- Backup Before Sync: ${config.sync.backupBeforeSync}`);
    console.log(`- Duplicate Detection: ${config.duplicateDetection.enabled}`);
    console.log(`- Similarity Threshold: ${config.duplicateDetection.similarityThreshold}`);
    console.log('\nNote: Configuration is read from environment variables.');
    console.log('Run "task-sync setup" to see all available options.');
}

function handleDaemonCommand(options) {
    const interval = parseInt(options.interval) * 60 * 1000;

    console.log(`Starting daemon mode with ${options.interval} minute interval...`);
    console.log('Press Ctrl+C to stop');

    const runSync = async () => {
        try {
            const result = await sync(getConfig());
            console.log(`[${new Date().toLocaleTimeString()}] Sync completed`);
            logger.info('Daemon sync completed', result);
        } catch (error) {
            console.error(`[${new Date().toLocaleTimeString()}] Sync failed:`, error);
            logger.error('Daemon sync failed', error);
        }
    };

    // Run initial sync
    runSync();

    // Schedule periodic syncs
    setInterval(runSync, interval);
}

// Core sync function - moved from syncEngine.js
async function sync(config) {
    let duplicatesResolved = 0;
    const errors = [];
    
    try {
        // Read the .todo tasks using existing logic
        const localTasks = await readLocalTasks();
        
        // Remove duplicates from local tasks
        const uniqueLocalTasks = removeDuplicateTasks(localTasks);
        if (localTasks.length !== uniqueLocalTasks.length) {
            duplicatesResolved += localTasks.length - uniqueLocalTasks.length;
            await writeLocalTasks(uniqueLocalTasks);
        }
        
        // Do the same for .todo.completed and .todo.cancelled
        const completedTasks = await readLocalTasks('.todo.completed');
        const uniqueCompletedTasks = removeDuplicateTasks(completedTasks);
        if (completedTasks.length !== uniqueCompletedTasks.length) {
            duplicatesResolved += completedTasks.length - uniqueCompletedTasks.length;
            await writeLocalTasks(uniqueCompletedTasks, '.todo.completed');
        }
        
        const cancelledTasks = await readLocalTasks('.todo.cancelled');
        const uniqueCancelledTasks = removeDuplicateTasks(cancelledTasks);
        if (cancelledTasks.length !== uniqueCancelledTasks.length) {
            duplicatesResolved += cancelledTasks.length - uniqueCancelledTasks.length;
            await writeLocalTasks(uniqueCancelledTasks, '.todo.cancelled');
        }
        
        // Read the todoist tasks using existing logic
        const todoistTasks = await readTodoistTasks(config);
        
        // Remove duplicates from todoist tasks
        const uniqueTodoistTasks = removeDuplicateTodoistTasks(todoistTasks);
        if (todoistTasks.length !== uniqueTodoistTasks.length) {
            duplicatesResolved += todoistTasks.length - uniqueTodoistTasks.length;
            await updateTodoistTasks(uniqueTodoistTasks, config);
        }
        
        // Do the same for todoist completed and cancelled tasks
        const todoistCompletedTasks = await readTodoistCompletedTasks(config);
        const uniqueTodoistCompletedTasks = removeDuplicateTodoistTasks(todoistCompletedTasks);
        if (todoistCompletedTasks.length !== uniqueTodoistCompletedTasks.length) {
            duplicatesResolved += todoistCompletedTasks.length - uniqueTodoistCompletedTasks.length;
            await updateTodoistCompletedTasks(uniqueTodoistCompletedTasks, config);
        }
        
        const todoistCancelledTasks = await readTodoistCancelledTasks(config);
        const uniqueTodoistCancelledTasks = removeDuplicateTodoistTasks(todoistCancelledTasks);
        if (todoistCancelledTasks.length !== uniqueTodoistCancelledTasks.length) {
            duplicatesResolved += todoistCancelledTasks.length - uniqueTodoistCancelledTasks.length;
            await updateTodoistCancelledTasks(uniqueTodoistCancelledTasks, config);
        }
        
        return {
            added: { local: 0, todoist: 0 },
            updated: { local: 0, todoist: 0 },
            deleted: { local: 0, todoist: 0 },
            conflicts: 0,
            duplicatesResolved,
            errors
        };
    } catch (error) {
        errors.push(error.message);
        return {
            added: { local: 0, todoist: 0 },
            updated: { local: 0, todoist: 0 },
            deleted: { local: 0, todoist: 0 },
            conflicts: 0,
            duplicatesResolved,
            errors
        };
    }
}

// Placeholder functions for file operations
async function readLocalTasks(filename = '.todo') {
    // TODO: Implement reading local tasks from file
    return [];
}

async function writeLocalTasks(tasks, filename = '.todo') {
    // TODO: Implement writing local tasks to file
}

async function readTodoistTasks(config) {
    // TODO: Implement reading tasks from Todoist
    return [];
}

async function readTodoistCompletedTasks(config) {
    // TODO: Implement reading completed tasks from Todoist
    return [];
}

async function readTodoistCancelledTasks(config) {
    // TODO: Implement reading cancelled tasks from Todoist
    return [];
}

async function updateTodoistTasks(tasks, config) {
    // TODO: Implement updating tasks in Todoist
}

async function updateTodoistCompletedTasks(tasks, config) {
    // TODO: Implement updating completed tasks in Todoist
}

async function updateTodoistCancelledTasks(tasks, config) {
    // TODO: Implement updating cancelled tasks in Todoist
}

function main() {
    // Ensure log directory exists
    const logDir = join(homedir(), '.todo-sync');
    mkdirSync(logDir, { recursive: true });

    // Parse CLI arguments and handle commands
    const { command, options } = parseCliArguments();
}

// Entry point
main();