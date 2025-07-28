#!/usr/bin/env node

import { Command } from 'commander';
import { getTodos, displayTodos, findDuplicates, displayDuplicates, removeDuplicates, executeSync, createBackup, bootstrapCorrelations, cleanDuplicateCompletionDates, createLocalTask, createRemoteTaskByContent, updateLocalTask, updateRemoteTaskByName, completeLocalTask, completeRemoteTaskByName, cancelLocalTask, cancelRemoteTask } from './lib.js';
import { loadSyncState, categorizeChanges } from './syncState.js';
import { logSyncOperation as _logSyncOperation, getCurrentCorrelations as _getCurrentCorrelations } from './todoLog.js';
import yaml from 'js-yaml';

function main() {
    const program = new Command();

    program
        .name('tasks')
        .description('Manage todos from local files and/or Todoist')
        .version('1.0.0');

    // List subcommand (default behavior)
    program
        .command('list')
        .description('Show current or completed tasks')
        .option('-l, --local', 'Show only local tasks')
        .option('-r, --remote', 'Show only remote tasks')
        .option('-c, --completed', 'Show completed tasks instead of current')
        .option('-y, --yaml', 'Output in YAML format')
        .action(listCommand);

    // Create subcommand
    program
        .command('create <content>')
        .description('Create a new task')
        .option('-l, --local', 'Create task locally only')
        .option('-r, --remote', 'Create task on Todoist only')
        .action(createCommand);

    // Update subcommand
    program
        .command('update <taskName>')
        .description('Update a task')
        .option('-l, --local', 'Update local task only')
        .option('-r, --remote', 'Update remote task only')
        .option('-P, --priority <number>', 'Set priority level (0-4, where 0 is highest)')
        .option('-D, --due-date', 'Toggle due date (today if setting, none if unsetting)')
        .action(updateCommand);

    // Complete subcommand
    program
        .command('complete <taskName>')
        .description('Mark a task as complete')
        .option('-l, --local', 'Complete local task only')
        .option('-r, --remote', 'Complete remote task only')
        .action(completeCommand);

    // Cancel subcommand
    program
        .command('cancel <taskName>')
        .description('Cancel/delete a task')
        .option('-l, --local', 'Cancel local task only')
        .option('-r, --remote', 'Cancel remote task only')
        .action(cancelCommand);

    // Sync subcommand
    program
        .command('sync')
        .description('Synchronize tasks between local and remote')
        .option('-l, --local', 'Sync local changes to remote only')
        .option('-r, --remote', 'Sync remote changes to local only')
        .option('-p, --preview', 'Show preview of changes without executing')
        .option('-b, --backup', 'Create backup only (no sync or preview)')
        .action(syncCommand);

    // Duplicates subcommand
    program
        .command('dups')
        .description('Find and remove duplicate tasks')
        .option('-l, --local', 'Process local duplicates only')
        .option('-r, --remote', 'Process remote duplicates only')
        .option('-p, --preview', 'Show duplicates without removing them')
        .action(dupsCommand);

    // Bootstrap subcommand (advanced)
    program
        .command('bootstrap')
        .description('Bootstrap correlations by matching local and Todoist tasks by content')
        .action(bootstrapCommand);

    // Clean dates subcommand (advanced)
    program
        .command('clean-dates')
        .description('Clean duplicate completion dates in completed tasks file')
        .action(cleanDatesCommand);

    // Default command when no subcommand is provided
    program
        .action(async() => {
            // Default to 'list' behavior for backward compatibility
            await listCommand({ local: false, remote: false, completed: false, yaml: false });
        });

    program.addHelpText('after', `
Examples:
  tasks                      # Show current tasks from both local and remote
  tasks list                 # Same as above
  tasks list -l              # Show only local current tasks
  tasks list -r              # Show only remote current tasks
  tasks list -c              # Show completed tasks from both sources
  tasks list -l -c           # Show only local completed tasks
  tasks list -y              # Show tasks in YAML format
  tasks list -l -y           # Show only local tasks in YAML format
  
  tasks create "New task"    # Create task locally (default)
  tasks create "New task" -r # Create task on Todoist only
  
  tasks update "Task name" -P 0     # Set task to priority 0 (both local and remote)
  tasks update "Task name" -l -P 2  # Set local task to priority 2
  tasks update "Task name" -D       # Toggle due date (both local and remote)
  
  tasks complete "Task name"        # Complete task on both local and remote
  tasks complete "Task name" -l     # Complete local task only
  
  tasks cancel "Task name"          # Cancel/delete task from both local and remote
  tasks cancel "Task name" -r       # Cancel remote task only
  
  tasks sync                 # Full bidirectional sync
  tasks sync -l              # Sync local changes to remote only
  tasks sync -r              # Sync remote changes to local only
  tasks sync -p              # Preview sync changes without executing
  tasks sync -b              # Create backup only
  
  tasks dups                 # Find and remove duplicates from both sources
  tasks dups -l              # Find and remove local duplicates only
  tasks dups -p              # Show duplicates without removing them
    `);

    program.parse();
}

// List command handler
async function listCommand(options) {
    try {
        const showLocal = options.local || (!options.remote && !options.local);
        const showRemote = options.remote || (!options.remote && !options.local);

        if (options.yaml) {
            await handleYamlOutput(showLocal, showRemote, options.completed);
        } else if (options.completed) {
            await handleCompletedTasksMode(showLocal, showRemote);
        } else {
            await handleCurrentTasksMode(showLocal, showRemote);
        }
    } catch (error) {
        console.error('List command failed:', error.message);
        process.exit(1);
    }
}

// Create command handler
async function createCommand(content, options) {
    try {
        if (options.local && options.remote) {
            console.error('Error: Cannot specify both --local and --remote options');
            process.exit(1);
        }

        const createLocal = options.local || (!options.local && !options.remote);
        const createRemote = options.remote || (!options.local && !options.remote);

        if (createLocal) {
            await createLocalTask(content);
        }

        if (createRemote) {
            await createRemoteTaskByContent(content);
        }

    } catch (error) {
        console.error('Create command failed:', error.message);
        process.exit(1);
    }
}

// Sync command handler
async function syncCommand(options) {
    try {
        if (options.backup) {
            await handleBackupMode();
            return;
        }

        const showLocal = options.local || (!options.remote && !options.local);
        const showRemote = options.remote || (!options.remote && !options.local);

        if (options.preview) {
            await handleSyncPreviewMode(showLocal, showRemote);
        } else {
            await handleSyncMode(showLocal, showRemote);
        }
    } catch (error) {
        console.error('Sync command failed:', error.message);
        process.exit(1);
    }
}

// Duplicates command handler
async function dupsCommand(options) {
    try {
        const showLocal = options.local || (!options.remote && !options.local);
        const showRemote = options.remote || (!options.remote && !options.local);
        const shouldRemove = !options.preview; // Remove by default, unless preview mode

        await handleDuplicatesMode(showLocal, showRemote, shouldRemove);
    } catch (error) {
        console.error('Duplicates command failed:', error.message);
        process.exit(1);
    }
}

// Bootstrap command handler
async function bootstrapCommand() {
    try {
        await handleBootstrapMode();
    } catch (error) {
        console.error('Bootstrap command failed:', error.message);
        process.exit(1);
    }
}

// Clean dates command handler
async function cleanDatesCommand() {
    try {
        await handleCleanDatesMode();
    } catch (error) {
        console.error('Clean dates command failed:', error.message);
        process.exit(1);
    }
}

// Update command handler
async function updateCommand(taskName, options) {
    try {
        if (options.local && options.remote) {
            console.error('Error: Cannot specify both --local and --remote options');
            process.exit(1);
        }

        if (!options.priority && !options.dueDate) {
            console.error('Error: Must specify either --priority (-P) or --due-date (-D)');
            process.exit(1);
        }

        const updateLocal = options.local || (!options.local && !options.remote);
        const updateRemote = options.remote || (!options.local && !options.remote);

        if (options.priority !== undefined) {
            const priority = parseInt(options.priority);
            if (isNaN(priority) || priority < 0 || priority > 4) {
                console.error('Error: Priority must be a number between 0 and 4');
                process.exit(1);
            }
        }

        if (updateLocal) {
            await updateLocalTask(taskName, options);
        }

        if (updateRemote) {
            await updateRemoteTaskByName(taskName, options);
        }

    } catch (error) {
        console.error('Update command failed:', error.message);
        process.exit(1);
    }
}

// Complete command handler
async function completeCommand(taskName, options) {
    try {
        if (options.local && options.remote) {
            console.error('Error: Cannot specify both --local and --remote options');
            process.exit(1);
        }

        const completeLocal = options.local || (!options.local && !options.remote);
        const completeRemote = options.remote || (!options.local && !options.remote);

        if (completeLocal) {
            await completeLocalTask(taskName);
        }

        if (completeRemote) {
            await completeRemoteTaskByName(taskName);
        }

    } catch (error) {
        console.error('Complete command failed:', error.message);
        process.exit(1);
    }
}

// Cancel command handler
async function cancelCommand(taskName, options) {
    try {
        if (options.local && options.remote) {
            console.error('Error: Cannot specify both --local and --remote options');
            process.exit(1);
        }

        const cancelLocal = options.local || (!options.local && !options.remote);
        const cancelRemote = options.remote || (!options.local && !options.remote);

        if (cancelLocal) {
            await cancelLocalTask(taskName);
        }

        if (cancelRemote) {
            await cancelRemoteTask(taskName);
        }

    } catch (error) {
        console.error('Cancel command failed:', error.message);
        process.exit(1);
    }
}

// Mode handlers (existing logic moved here)
async function handleBackupMode() {
    console.log('📦 Creating backup of current data...');

    try {
        const backupResult = await createBackup();

        if (backupResult.success) {
            console.log('✅ Backup completed successfully!');
            console.log(`📁 Backup location: ${backupResult.backupDir}`);
            console.log(`🕒 Timestamp: ${backupResult.timestamp}`);
        } else {
            console.error('❌ Backup failed:', backupResult.error);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Backup error:', error.message);
        process.exit(1);
    }
}

async function handleBootstrapMode() {
    try {
        const result = await bootstrapCorrelations();

        if (!result.success) {
            console.error('❌ Bootstrap failed:', result.error);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Bootstrap error:', error.message);
        process.exit(1);
    }
}

async function handleCleanDatesMode() {
    try {
        const result = await cleanDuplicateCompletionDates();

        if (!result.success) {
            console.error('❌ Date cleanup failed:', result.error);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Date cleanup error:', error.message);
        process.exit(1);
    }
}

async function handleSyncPreviewMode(showLocal, showRemote) {
    // Use legacy sync state for backwards compatibility during transition
    const syncState = loadSyncState();

    let localData = null;
    let todoistData = null;

    if (showLocal || showRemote) {
        if (showLocal || (!showLocal && !showRemote)) {
            localData = await getTodos('local');
        }

        if (showRemote || (!showLocal && !showRemote)) {
            todoistData = await getTodos('remote');
        }

        if (!localData && !todoistData) {
            console.error('❌ Unable to load data for sync comparison');
            return;
        }

        // Use empty data structures if one side is missing
        if (!localData) {
            localData = { current: { tasks: [] }, completed: { tasks: [] } };
        }
        if (!todoistData) {
            todoistData = { current: { tasks: [] }, completed: { tasks: [] } };
        }

        const changes = categorizeChanges(localData, todoistData, syncState, true);
        displaySyncPreview(changes, showLocal, showRemote);
    } else {
        console.error('❌ Must specify either local (-l) or remote (-r) or both for sync preview');
    }
}

async function handleSyncMode(showLocal, showRemote) {
    // Use legacy sync state for backwards compatibility during transition
    const syncState = loadSyncState();

    let localData = null;
    let todoistData = null;

    if (showLocal || showRemote) {
        if (showLocal || (!showLocal && !showRemote)) {
            localData = await getTodos('local');
        }

        if (showRemote || (!showLocal && !showRemote)) {
            todoistData = await getTodos('remote');
        }

        if (!localData && !todoistData) {
            console.error('❌ Unable to load data for sync comparison');
            return;
        }

        // Use empty data structures if one side is missing
        if (!localData) {
            localData = { current: { tasks: [] }, completed: { tasks: [] } };
        }
        if (!todoistData) {
            todoistData = { current: { tasks: [] }, completed: { tasks: [] } };
        }

        const changes = categorizeChanges(localData, todoistData, syncState, false);
        await executeSyncChanges(changes, showLocal, showRemote);
    } else {
        console.error('❌ Must specify either local (-l) or remote (-r) or both for sync');
    }
}

async function handleCurrentTasksMode(showLocal, showRemote) {
    if (showLocal) {
        const localData = await getTodos('local');
        const currentOnlyData = {
            current: localData.current,
            completed: { tasks: [], message: '' }
        };
        displayTodos(currentOnlyData, 'local');
    }

    if (showRemote) {
        const remoteData = await getTodos('remote');
        const currentOnlyData = {
            current: remoteData.current,
            completed: { tasks: [], message: '' }
        };
        displayTodos(currentOnlyData, 'remote');
    }
}

async function handleCompletedTasksMode(showLocal, showRemote) {
    if (showLocal) {
        const localData = await getTodos('local');
        const completedOnlyData = {
            current: { tasks: [], message: '' },
            completed: localData.completed
        };
        displayTodos(completedOnlyData, 'local');
    }

    if (showRemote) {
        const remoteData = await getTodos('remote');
        const completedOnlyData = {
            current: { tasks: [], message: '' },
            completed: remoteData.completed
        };
        displayTodos(completedOnlyData, 'remote');
    }
}

async function handleDuplicatesMode(showLocal, showRemote, shouldRemove) {
    // Show duplicates
    if (showLocal) {
        const localDuplicates = await findDuplicates('local');
        displayDuplicates(localDuplicates, 'local');
    }

    if (showRemote) {
        const remoteDuplicates = await findDuplicates('remote');
        displayDuplicates(remoteDuplicates, 'remote');
    }

    // Remove duplicates if requested
    if (shouldRemove) {
        if (showLocal) {
            try {
                await removeDuplicates('local');
            } catch (error) {
                console.error(`❌ ${error.message}`);
            }
        }

        if (showRemote) {
            try {
                await removeDuplicates('remote');
            } catch (error) {
                console.error(`❌ ${error.message}`);
            }
        }
    }
}

function displaySyncPreview(changes, showLocal, showRemote) {
    if (showLocal || (!showLocal && !showRemote)) {
        displayLocalChanges(changes);
    }

    if (showRemote || (!showLocal && !showRemote)) {
        displayTodoistChanges(changes);
    }

    if (changes.conflicts.length > 0) {
        displayConflicts(changes.conflicts);
    }

    if (changes.potentialRenames.length > 0) {
        displayPotentialRenames(changes.potentialRenames);
    }
}

function displayLocalChanges(changes) {
    let hasChanges = false;
    const currentTasks = [
        ...changes.local.noneToCurrent.map(t => ({ ...t, changeType: 'NEW TASKS TO CREATE (none→current)' })),
        ...changes.local.renames.map(t => ({ ...t, changeType: 'TASK RENAMES' }))
    ];
    const completedTasks = [
        ...changes.local.noneToCompleted.map(t => ({ ...t, changeType: 'NEW COMPLETED TASKS (none→completed)' })),
        ...changes.local.currentToCompleted.map(t => ({ ...t, changeType: 'CURRENT TASKS TO MARK COMPLETE (current→completed)' }))
    ];
    if (currentTasks.length > 0) {
        const groupedByPriority = {};
        currentTasks.forEach(task => {
            const priority = task.metadata?.priority !== undefined ? task.metadata.priority :
                task.priority !== undefined ? task.priority : 'unknown';
            if (!groupedByPriority[priority]) {
                groupedByPriority[priority] = {};
            }
            if (!groupedByPriority[priority][task.changeType]) {
                groupedByPriority[priority][task.changeType] = [];
            }
            groupedByPriority[priority][task.changeType].push(task);
        });
        const priorities = Object.keys(groupedByPriority).sort((a, b) =>
            a === 'unknown' ? 1 : b === 'unknown' ? -1 : parseInt(a) - parseInt(b)
        );
        for (const priority of priorities) {
            const priorityLabel = priority === 'unknown' ? 'Unknown Priority' : `Priority ${priority}`;
            const priorityTasks = groupedByPriority[priority];
            Object.entries(priorityTasks).forEach(([ changeType, tasks ]) => {
                if (changeType.includes('NEW TASKS')) {
                    console.log(`\n📁 ${priorityLabel}`);
                } else if (changeType.includes('RENAMES')) {
                    console.log(`\n📁 ${priorityLabel} (Renamed)`);
                }
                // Group tasks by parent
                const tasksByParent = {};
                const regularTasks = [];

                tasks.forEach(task => {
                    if (task.isSubtask && task.parentContent) {
                        if (!tasksByParent[task.parentContent]) {
                            tasksByParent[task.parentContent] = [];
                        }
                        tasksByParent[task.parentContent].push(task);
                    } else {
                        regularTasks.push(task);
                    }
                });

                // Display regular tasks first
                regularTasks.forEach(task => {
                    if (changeType === 'TASK RENAMES') {
                        if (task.oldPriority !== undefined && task.newPriority !== undefined) {
                            console.log(`   • ${task.content} (${task.oldPriority}->${task.newPriority})`);
                        } else {
                            console.log(`   • ${task.oldContent} → ${task.newContent}`);
                        }
                    } else {
                        const corrId = (task.metadata?.corrId || task.corrId) ? ` [${task.metadata?.corrId || task.corrId}]` : '';
                        console.log(`   • ${task.content}${corrId}`);
                    }
                });

                // Display grouped subtasks
                Object.entries(tasksByParent).forEach(([ parentContent, subtasks ]) => {
                    console.log(`   • ${parentContent}`);
                    subtasks.forEach(subtask => {
                        const corrId = (subtask.metadata?.corrId || subtask.corrId) ? ` [${subtask.metadata?.corrId || subtask.corrId}]` : '';
                        console.log(`     • ${subtask.content}${corrId}`);
                    });
                });
            });
        }
        hasChanges = true;
    }
    if (completedTasks.length > 0) {
        const groupedCompleted = {};
        completedTasks.forEach(task => {
            if (!groupedCompleted[task.changeType]) {
                groupedCompleted[task.changeType] = [];
            }
            groupedCompleted[task.changeType].push(task);
        });
        Object.entries(groupedCompleted).forEach(([ changeType, tasks ]) => {
            const uniqueTasks = [];
            const seenContent = new Set();
            tasks.forEach(task => {
                const normalizedContent = task.content.toLowerCase().trim();
                if (!seenContent.has(normalizedContent)) {
                    seenContent.add(normalizedContent);
                    uniqueTasks.push(task);
                }
            });
            const simpleType = changeType.includes('NEW COMPLETED') ? 'Completed' :
                changeType.includes('CURRENT TASKS TO MARK COMPLETE') ? 'Completed (Mark Complete)' : changeType;
            console.log(`\n📁 ${simpleType}`);
            // Group tasks by parent for completed tasks too
            const tasksByParent = {};
            const regularTasks = [];

            uniqueTasks.forEach(task => {
                if (task.isSubtask && task.parentContent) {
                    if (!tasksByParent[task.parentContent]) {
                        tasksByParent[task.parentContent] = [];
                    }
                    tasksByParent[task.parentContent].push(task);
                } else {
                    regularTasks.push(task);
                }
            });

            // Display regular tasks first
            regularTasks.forEach(task => {
                const completedDate = (task.metadata?.completed && !task.content.includes('(completed:')) ? ` (completed: ${new Date(task.metadata.completed).toLocaleDateString()})` : '';
                const corrId = (task.metadata?.corrId || task.corrId) ? ` [${task.metadata?.corrId || task.corrId}]` : '';
                console.log(`   • ${task.content}${completedDate}${corrId}`);
            });

            // Display grouped subtasks
            Object.entries(tasksByParent).forEach(([ parentContent, subtasks ]) => {
                console.log(`   • ${parentContent}`);
                subtasks.forEach(subtask => {
                    const completedDate = (subtask.metadata?.completed && !subtask.content.includes('(completed:')) ? ` (completed: ${new Date(subtask.metadata.completed).toLocaleDateString()})` : '';
                    const corrId = (subtask.metadata?.corrId || subtask.corrId) ? ` [${subtask.metadata?.corrId || subtask.corrId}]` : '';
                    console.log(`     • ${subtask.content}${completedDate}${corrId}`);
                });
            });
        });
        hasChanges = true;
    }
    if (!hasChanges) {
        console.log('✨ No local changes needed');
    }
}

function displayTodoistChanges(changes) {
    let hasChanges = false;
    const currentTasks = [
        ...changes.todoist.noneToCurrent.map(t => ({ ...t, changeType: 'NEW TASKS TO CREATE (none→current)' })),
        ...changes.todoist.renames.map(t => ({ ...t, changeType: 'TASK RENAMES' }))
    ];
    const completedTasks = [
        ...changes.todoist.noneToCompleted.map(t => ({ ...t, changeType: 'NEW COMPLETED TASKS (none→completed)' })),
        ...changes.todoist.currentToCompleted.map(t => ({ ...t, changeType: 'CURRENT TASKS TO MARK COMPLETE (current→completed)' }))
    ];
    if (currentTasks.length > 0) {
        const groupedByPriority = {};
        currentTasks.forEach(task => {
            const priority = task.metadata?.priority !== undefined ? task.metadata.priority :
                task.priority !== undefined ? task.priority : 'unknown';
            if (!groupedByPriority[priority]) {
                groupedByPriority[priority] = {};
            }
            if (!groupedByPriority[priority][task.changeType]) {
                groupedByPriority[priority][task.changeType] = [];
            }
            groupedByPriority[priority][task.changeType].push(task);
        });
        const priorities = Object.keys(groupedByPriority).sort((a, b) =>
            a === 'unknown' ? 1 : b === 'unknown' ? -1 : parseInt(a) - parseInt(b)
        );
        for (const priority of priorities) {
            const priorityLabel = priority === 'unknown' ? 'Unknown Priority' : `Priority ${priority}`;
            const priorityTasks = groupedByPriority[priority];
            Object.entries(priorityTasks).forEach(([ changeType, tasks ]) => {
                if (changeType.includes('NEW TASKS')) {
                    console.log(`\n☁️ ${priorityLabel}`);
                } else if (changeType.includes('RENAMES')) {
                    console.log(`\n☁️ ${priorityLabel} (Renamed)`);
                }
                // Group tasks by parent
                const tasksByParent = {};
                const regularTasks = [];

                tasks.forEach(task => {
                    if (task.isSubtask && task.parentContent) {
                        if (!tasksByParent[task.parentContent]) {
                            tasksByParent[task.parentContent] = [];
                        }
                        tasksByParent[task.parentContent].push(task);
                    } else {
                        regularTasks.push(task);
                    }
                });

                // Display regular tasks first
                regularTasks.forEach(task => {
                    if (changeType === 'TASK RENAMES') {
                        if (task.oldPriority !== undefined && task.newPriority !== undefined) {
                            console.log(`   • ${task.content} (${task.oldPriority}->${task.newPriority})`);
                        } else {
                            console.log(`   • ${task.oldContent} → ${task.newContent}`);
                        }
                    } else {
                        const corrId = (task.metadata?.corrId || task.corrId) ? ` [${task.metadata?.corrId || task.corrId}]` : '';
                        const todoistId = task.metadata?.todoistId ? ` (Todoist ID: ${task.metadata.todoistId})` : '';
                        console.log(`   • ${task.content}${corrId}${todoistId}`);
                    }
                });

                // Display grouped subtasks
                Object.entries(tasksByParent).forEach(([ parentContent, subtasks ]) => {
                    console.log(`   • ${parentContent}`);
                    subtasks.forEach(subtask => {
                        const corrId = (subtask.metadata?.corrId || subtask.corrId) ? ` [${subtask.metadata?.corrId || subtask.corrId}]` : '';
                        const todoistId = subtask.metadata?.todoistId ? ` (Todoist ID: ${subtask.metadata.todoistId})` : '';
                        console.log(`     • ${subtask.content}${corrId}${todoistId}`);
                    });
                });
            });
        }
        hasChanges = true;
    }
    if (completedTasks.length > 0) {
        const groupedCompleted = {};
        completedTasks.forEach(task => {
            if (!groupedCompleted[task.changeType]) {
                groupedCompleted[task.changeType] = [];
            }
            groupedCompleted[task.changeType].push(task);
        });
        Object.entries(groupedCompleted).forEach(([ changeType, tasks ]) => {
            const uniqueTasks = [];
            const seenContent = new Set();
            tasks.forEach(task => {
                const normalizedContent = task.content.toLowerCase().trim();
                if (!seenContent.has(normalizedContent)) {
                    seenContent.add(normalizedContent);
                    uniqueTasks.push(task);
                }
            });
            const simpleType = changeType.includes('NEW COMPLETED') ? 'Completed' :
                changeType.includes('CURRENT TASKS TO MARK COMPLETE') ? 'Completed (Mark Complete)' : changeType;
            console.log(`\n☁️ ${simpleType}`);
            // Group tasks by parent for completed tasks too
            const tasksByParent = {};
            const regularTasks = [];

            uniqueTasks.forEach(task => {
                if (task.isSubtask && task.parentContent) {
                    if (!tasksByParent[task.parentContent]) {
                        tasksByParent[task.parentContent] = [];
                    }
                    tasksByParent[task.parentContent].push(task);
                } else {
                    regularTasks.push(task);
                }
            });

            // Display regular tasks first
            regularTasks.forEach(task => {
                const completedDate = (task.metadata?.completed && !task.content.includes('(completed:')) ? ` (completed: ${new Date(task.metadata.completed).toLocaleDateString()})` : '';
                const corrId = (task.metadata?.corrId || task.corrId) ? ` [${task.metadata?.corrId || task.corrId}]` : '';
                const todoistId = task.metadata?.todoistId ? ` (Todoist ID: ${task.metadata.todoistId})` : '';
                console.log(`   • ${task.content}${completedDate}${corrId}${todoistId}`);
            });

            // Display grouped subtasks
            Object.entries(tasksByParent).forEach(([ parentContent, subtasks ]) => {
                console.log(`   • ${parentContent}`);
                subtasks.forEach(subtask => {
                    const completedDate = (subtask.metadata?.completed && !subtask.content.includes('(completed:')) ? ` (completed: ${new Date(subtask.metadata.completed).toLocaleDateString()})` : '';
                    const corrId = (subtask.metadata?.corrId || subtask.corrId) ? ` [${subtask.metadata?.corrId || subtask.corrId}]` : '';
                    const todoistId = subtask.metadata?.todoistId ? ` (Todoist ID: ${subtask.metadata.todoistId})` : '';
                    console.log(`     • ${subtask.content}${completedDate}${corrId}${todoistId}`);
                });
            });
        });
        hasChanges = true;
    }
    if (!hasChanges) {
        console.log('✨ No Todoist changes needed');
    }
}

function displayConflicts(conflicts) {
    console.log('\n⚠️  CONFLICTS (Require Resolution):');
    console.log('-'.repeat(50));

    conflicts.forEach((conflict, index) => {
        console.log(`  ${index + 1}. Correlation ID: ${conflict.corrId}`);
        console.log(`     Local:   "${conflict.localTask.content}"`);
        console.log(`     Todoist: "${conflict.todoistTask.content}"`);
        console.log();
    });
}

function displayPotentialRenames(potentialRenames) {
    console.log('\n🤔 POTENTIAL RENAMES (Need Confirmation):');
    console.log('-'.repeat(50));

    const priorityMismatches = potentialRenames.filter(r => r.type === 'priority_mismatch');
    const otherRenames = potentialRenames.filter(r => r.type !== 'priority_mismatch');

    if (priorityMismatches.length > 0) {
        console.log('\n📊 PRIORITY MISMATCHES (Same content, different priorities):');
        priorityMismatches.forEach((mismatch, index) => {
            console.log(`  ${index + 1}. "${mismatch.content}"`);
            console.log(`     Local: Priority ${mismatch.localPriority}`);
            console.log(`     Todoist: Priority ${mismatch.todoistPriority}`);
            console.log('     → This appears to be the same task with different priorities');
            console.log();
        });
    }

    if (otherRenames.length > 0) {
        if (priorityMismatches.length > 0) {
            console.log('\n📝 CONTENT SIMILARITIES:');
        }

        otherRenames.forEach((rename, index) => {
            const similarity = Math.round(rename.similarity * 100);
            console.log(`  ${index + 1}. ${similarity}% similarity`);

            if (rename.type === 'local_new_similar_to_existing') {
                console.log(`     New local: "${rename.localTask.content}"`);
                console.log(`     Existing:  "${rename.existingCorrelation.localContent}"`);
            } else {
                console.log(`     New Todoist: "${rename.todoistTask.content}"`);
                console.log(`     Existing:    "${rename.existingCorrelation.todoistContent}"`);
            }
            console.log();
        });
    }
}

async function executeSyncChanges(changes, showLocal, showRemote) {
    console.log('🔄 Executing synchronization...');

    // Create backup before making any changes
    console.log('\n📦 Creating backup before sync...');
    const backupResult = await createBackup();

    if (!backupResult.success) {
        console.error('\n❌ Failed to create backup - aborting sync for safety');
        console.error('Error:', backupResult.error);
        return;
    }

    try {
        const results = await executeSync(changes, showLocal, showRemote);

        if (results.success) {
            console.log('\n✅ Synchronization completed successfully!');

            if (results.summary) {
                console.log('\n📊 Summary:');
                console.log(results.summary);
            }
        } else {
            console.error('\n❌ Synchronization failed:', results.error || results.errors.join(', '));
        }
    } catch (error) {
        console.error('\n❌ Synchronization error:', error.message);
    }
}

// YAML output handler
async function handleYamlOutput(showLocal, showRemote, showCompleted) {
    const allTasks = [];

    if (showLocal) {
        const localData = await getTodos('local');
        const localTasks = showCompleted ? localData.completed.tasks : localData.current.tasks;

        localTasks.forEach(task => {
            const yamlTask = convertToYamlFormat(task, 'local');
            allTasks.push(yamlTask);
        });
    }

    if (showRemote) {
        const remoteData = await getTodos('remote');
        const remoteTasks = showCompleted ? remoteData.completed.tasks : remoteData.current.tasks;

        remoteTasks.forEach(task => {
            const yamlTask = convertToYamlFormat(task, 'remote');
            allTasks.push(yamlTask);
        });
    }

    const yamlOutput = yaml.dump(allTasks, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: false
    });

    console.log(yamlOutput);
}

// Convert task to YAML format with required fields
function convertToYamlFormat(task, location) {
    // Convert Todoist priority to logical 0-4 priority model
    let priority = task.priority;
    if (location === 'remote' && task.metadata && task.metadata.priority !== undefined) {
        // Use metadata priority if available for remote tasks
        priority = task.metadata.priority;
    } else if (location === 'remote' && task.priority !== undefined) {
        // Convert Todoist priority (1-4) to logical priority (4-0 then map to 0-4)
        // Todoist: 1=lowest, 4=highest
        // Our logical: 0=highest, 4=lowest
        switch (task.priority) {
        case 4: priority = 0; break; // highest
        case 3: priority = 1; break;
        case 2: priority = 2; break;
        case 1: priority = 3; break; // lowest
        default: priority = 4; break;
        }
    }

    // Task name is already clean from parsing
    let taskName = task.content;

    // Get task ID from the appropriate property
    let taskId = null;
    if (location === 'remote') {
        taskId = task.id; // Todoist tasks have their ID in the id property
    } else {
        taskId = task.todoistId; // Local tasks have Todoist ID in todoistId property
    }

    // Simplify due date format
    let dueDate = null;
    if (task.due) {
        if (location === 'remote' && task.due.date) {
            // For remote tasks, just use the date string
            dueDate = task.due.date;
        } else if (typeof task.due === 'string') {
            // For local tasks or simple string dates
            dueDate = task.due;
        } else {
            // Fallback for other formats
            dueDate = task.due;
        }
    }

    return {
        name: taskName,
        priority: priority !== undefined ? priority : 4,
        due: dueDate,
        id: taskId,
        location: location
    };
}

main();
