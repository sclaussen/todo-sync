#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import { ConfigManager } from './config.js';
import { SyncEngine } from './syncEngine.debug.js';
import { ConflictResolution } from './types.js';
import logger from './logger.js';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Ensure log directory exists
const logDir = join(homedir(), '.todo-sync');
mkdirSync(logDir, { recursive: true });

const program = new Command();
const configManager = new ConfigManager();

program
  .name('todo-sync')
  .description('Bidirectional sync between ~/.todo file and Todoist')
  .version('1.0.0');

program
  .command('sync')
  .description('Run synchronization')
  .option('-d, --dry-run', 'Preview changes without applying them')
  .action(async (options) => {
    const config = configManager.get();
    
    if (!config.todoist.apiToken) {
      console.error('No API token configured. Run "todo-sync setup" first.');
      process.exit(1);
    }

    try {
      const syncEngine = new SyncEngine(configManager);
      
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
  .description('Configure todo-sync')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiToken',
        message: 'Enter your Todoist API token:',
        validate: (input) => input.length > 0 || 'API token is required'
      },
      {
        type: 'input',
        name: 'projectName',
        message: 'Enter the Todoist project name for sync:',
        default: 'Synced Tasks'
      },
      {
        type: 'list',
        name: 'conflictResolution',
        message: 'How should conflicts be resolved?',
        choices: [
          { name: 'Ask me each time', value: ConflictResolution.INTERACTIVE },
          { name: 'Local file wins', value: ConflictResolution.LOCAL_WINS },
          { name: 'Todoist wins', value: ConflictResolution.REMOTE_WINS },
          { name: 'Newest change wins', value: ConflictResolution.NEWEST_WINS }
        ],
        default: ConflictResolution.INTERACTIVE
      },
      {
        type: 'confirm',
        name: 'backupBeforeSync',
        message: 'Backup ~/.todo before each sync?',
        default: true
      }
    ]);

    configManager.setApiToken(answers.apiToken);
    configManager.setProjectName(answers.projectName);
    configManager.setConflictResolution(answers.conflictResolution);
    configManager.set({
      sync: {
        ...configManager.get().sync,
        backupBeforeSync: answers.backupBeforeSync
      }
    });

    console.log('\nConfiguration saved successfully!');
    console.log('You can now run "todo-sync" to synchronize your todos.');
  });

program
  .command('status')
  .description('Show sync status and configuration')
  .action(() => {
    const config = configManager.get();
    
    console.log('Todo Sync Status\n');
    console.log('Configuration:');
    console.log(`- API Token: ${config.todoist.apiToken ? '***configured***' : 'not configured'}`);
    console.log(`- Project Name: ${config.todoist.projectName}`);
    console.log(`- Conflict Resolution: ${config.sync.conflictResolution}`);
    console.log(`- Backup Before Sync: ${config.sync.backupBeforeSync}`);
    
    if (config.sync.lastSync) {
      console.log(`\nLast sync: ${new Date(config.sync.lastSync).toLocaleString()}`);
    } else {
      console.log('\nNever synced');
    }
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
        const syncEngine = new SyncEngine(configManager);
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