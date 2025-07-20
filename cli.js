#!/usr/bin/env node

import { Command } from 'commander';
import { SyncEngine } from './syncEngine.js';
import logger from './logger.js';
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

// Ensure log directory exists
const logDir = join(homedir(), '.todo-sync');
mkdirSync(logDir, { recursive: true });

const program = new Command();

program
    .name('todo-sync')
    .description('Bidirectional sync between ~/.todo file and Todoist')
    .version('1.0.0');

program
    .command('sync')
    .description('Run synchronization')
    .option('-d, --dry-run', 'Preview changes without applying them')
    .action(async (options) => {
        const config = getConfig();

        if (!config.todoist.apiToken) {
            console.error('No API token configured. Set TODOIST_API_TOKEN environment variable.');
            process.exit(1);
        }

        try {
            const syncEngine = new SyncEngine(config);

            if (options.dryRun) {
                console.log('Dry run mode - no changes will be made');
                // TODO: Implement dry run logic
                return;
            }

            console.log('Starting synchronization...');
            const result = await syncEngine.sync();

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
        } catch (error) {
            console.error('Sync failed:', error);
            logger.error('Sync failed', error);
            process.exit(1);
        }
    });

program
    .command('setup')
    .description('Show environment variable setup instructions')
    .action(() => {
        console.log('Todo Sync Setup Instructions\n');
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
        console.log('After setting TODOIST_API_TOKEN, run "todo-sync sync" to start syncing.');
    });

program
    .command('status')
    .description('Show sync status and configuration')
    .action(() => {
        const config = getConfig();

        console.log('Todo Sync Status\n');
        console.log('Configuration:');
        console.log(`- API Token: ${config.todoist.apiToken ? '***configured***' : 'not configured'}`);
        console.log(`- Project Name: ${config.todoist.projectName}`);
        console.log(`- Conflict Resolution: ${config.sync.conflictResolution}`);
        console.log(`- Backup Before Sync: ${config.sync.backupBeforeSync}`);
        console.log(`- Duplicate Detection: ${config.duplicateDetection.enabled}`);
        console.log(`- Similarity Threshold: ${config.duplicateDetection.similarityThreshold}`);
        console.log('\nNote: Configuration is read from environment variables.');
        console.log('Run "todo-sync setup" to see all available options.');
    });

program
    .command('daemon')
    .description('Run in daemon mode with automatic sync')
    .option('-i, --interval <minutes>', 'Sync interval in minutes', '30')
    .action((options) => {
        const interval = parseInt(options.interval) * 60 * 1000;

        console.log(`Starting daemon mode with ${options.interval} minute interval...`);
        console.log('Press Ctrl+C to stop');

        const runSync = async () => {
            try {
                const syncEngine = new SyncEngine(getConfig());
                const result = await syncEngine.sync();
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
    });

program.parse();