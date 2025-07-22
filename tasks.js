#!/usr/bin/env node

import { Command } from 'commander';
import { withErrorHandler } from './src/config/errorHandler.js';

// Dynamic command imports
const commands = {
    list: () => import('./src/commands/list.js'),
    create: () => import('./src/commands/create.js'),
    sync: () => import('./src/commands/sync.js'),
    update: () => import('./src/commands/update.js'),
    complete: () => import('./src/commands/complete.js'),
    remove: () => import('./src/commands/remove.js'),
    dups: () => import('./src/commands/dups.js')
};

async function main() {
    const program = new Command();

    program
        .name('tasks')
        .description('Manage tasks from local files and/or Todoist')
        .version('1.0.0');

    // Create command
    program
        .command('create <content>')
        .description('Create a new task')
        .option('-l, --local', 'Create task locally only')
        .option('-r, --remote', 'Create task on Todoist only')
        .option('-P, --priority <number>', 'Set priority level (0-4)')
        .action(withErrorHandler(async(content, options) => {
            const { execute } = await commands.create();
            await execute(content, options);
        }));

    // List command
    program
        .command('list')
        .description('Show current or completed tasks')
        .option('-l, --local', 'Show only local tasks')
        .option('-r, --remote', 'Show only remote tasks')
        .option('-c, --completed', 'Show completed tasks instead of current')
        .option('-y, --yaml', 'Output in YAML format')
        .action(withErrorHandler(async(options) => {
            const { execute } = await commands.list();
            await execute(options);
        }));

    // Sync command
    program
        .command('sync')
        .description('Synchronize tasks between local and remote')
        .option('-p, --preview', 'Show preview of changes without executing')
        .option('-b, --backup', 'Create backup only')
        .action(withErrorHandler(async(options) => {
            const { execute } = await commands.sync();
            await execute(options);
        }));

    // Update command
    program
        .command('update <id> [content]')
        .description('Update an existing task')
        .option('-l, --local', 'Update local task only')
        .option('-r, --remote', 'Update remote task only')
        .option('-P, --priority <number>', 'Update priority level (0-4)')
        .action(withErrorHandler(async(id, content, options) => {
            const { execute } = await commands.update();
            await execute(id, content, options);
        }));

    // Complete command
    program
        .command('complete <id>')
        .description('Mark a task as completed')
        .option('-l, --local', 'Complete local task only')
        .option('-r, --remote', 'Complete remote task only')
        .action(withErrorHandler(async(id, options) => {
            const { execute } = await commands.complete();
            await execute(id, options);
        }));

    // Remove command
    program
        .command('remove <id>')
        .description('Remove/delete a task')
        .option('-l, --local', 'Remove local task only')
        .option('-r, --remote', 'Remove remote task only')
        .action(withErrorHandler(async(id, options) => {
            const { execute } = await commands.remove();
            await execute(id, options);
        }));

    // Dups command
    program
        .command('dups')
        .description('Find and remove duplicate tasks')
        .option('-p, --preview', 'Show duplicates without removing them')
        .option('-l, --local', 'Process local duplicates only')
        .option('-r, --remote', 'Process remote duplicates only')
        .action(withErrorHandler(async(options) => {
            const { execute } = await commands.dups();
            await execute(options);
        }));

    // Legacy commands (import from old system)
    const legacyCommands = [
        'bootstrap', 'clean-dates'
    ];

    for (const cmd of legacyCommands) {
        program
            .command(`${cmd} [args...]`)
            .description(`Legacy ${cmd} command`)
            .allowUnknownOption()
            .action(withErrorHandler(async(...args) => {
                // Import and execute from original lib.js for now
                console.log(`⚠️  Using legacy command: ${cmd}`);
                const originalTasks = await import('./tasks.js');
                // This is a placeholder - would need proper legacy handling
            }));
    }

    // Default to list
    program.action(withErrorHandler(async() => {
        const { execute } = await commands.list();
        await execute({ local: false, remote: false, completed: false, yaml: false });
    }));

    program.addHelpText('after', `
Examples:
  tasks                         # Show current tasks
  tasks list -l -y              # Show local tasks in YAML
  tasks create "New task"       # Create task locally
  tasks update 123 "Updated"    # Update task content
  tasks update 123 "Updated" -P 1  # Update task content and priority
  tasks update 123 -P 2            # Update priority only
  tasks complete 123            # Mark task as completed
  tasks remove 123              # Remove/delete task
  tasks dups -p                 # Preview duplicate removal
  tasks sync -p                 # Preview sync changes
  tasks sync                    # Execute full sync
    `);

    program.parse();
}

main();
