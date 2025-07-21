#!/usr/bin/env node

import { Command } from 'commander';
import { getTodos, displayTodos, findDuplicates, displayDuplicates, removeDuplicates, executeSync, createBackup, bootstrapCorrelations, cleanDuplicateCompletionDates } from './lib.js';
import { loadSyncState, categorizeChanges } from './syncState.js';
import { logSyncOperation, getCurrentCorrelations } from './todoLog.js';

function main() {
    const { options } = parseCliArguments();

    executeTaskCommand(options).catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
}

function parseCliArguments() {
    const program = new Command();

    program
        .name('tasks')
        .description('Manage todos from local files and/or Todoist')
        .version('1.0.0')
        .option('-l, --local', 'Show only local todos')
        .option('-r, --remote', 'Show only remote todos')
        .option('-c, --completed-tasks', 'Show only completed tasks')
        .option('-d, --duplicates', 'Show only duplicate detection results')
        .option('-R, --remove-duplicates', 'Show duplicates and remove them')
        .option('-s, --sync-preview', 'Show sync preview (what changes would be made)')
        .option('-S, --sync', 'Perform actual synchronization between local and Todoist')
        .option('-b, --backup', 'Create backup of current local and remote data')
        .option('--bootstrap', 'Bootstrap correlations by matching local and Todoist tasks by content')
        .option('--clean-dates', 'Clean duplicate completion dates in completed tasks file')
        .helpOption('-h, --help', 'Display help information')
        .addHelpText('after', `
Examples:
  tasks                   # Show current todos from both local and remote
  tasks -l                # Show only local current todos
  tasks -r                # Show only remote current todos
  tasks -c                # Show completed tasks from both local and remote
  tasks -l -c             # Show only local completed tasks
  tasks -r -c             # Show only remote completed tasks
  tasks -d                # Show duplicates from both local and remote
  tasks -l -d             # Show only local duplicates
  tasks -r -d             # Show only remote duplicates
  tasks -R                # Show and remove duplicates from both local and remote
  tasks -l -R             # Show and remove duplicates from local only
  tasks -r -R             # Show and remove duplicates from remote only
  tasks -s                # Show sync preview for both local and remote
  tasks -l -s             # Show what local changes would be synced to remote
  tasks -r -s             # Show what remote changes would be synced to local
  tasks -S                # Perform actual sync for both local and remote
  tasks -l -S             # Sync local changes to remote only
  tasks -r -S             # Sync remote changes to local only
  tasks -b                # Create backup of current local and remote data
        `);

    program.parse();

    const options = program.opts();

    // Validate option combinations
    if (options.local && options.remote) {
        console.error('Error: Cannot specify both --local and --remote options');
        program.help();
    }

    if (options.completedTasks && options.duplicates) {
        console.error('Error: Cannot specify both --completed-tasks and --duplicates options');
        program.help();
    }

    if (options.removeDuplicates && options.completedTasks) {
        console.error('Error: Cannot specify both --remove-duplicates and --completed-tasks options');
        program.help();
    }

    if ((options.syncPreview || options.sync) && options.completedTasks) {
        console.error('Error: Cannot specify sync options with --completed-tasks');
        program.help();
    }

    if ((options.syncPreview || options.sync) && options.duplicates) {
        console.error('Error: Cannot specify sync options with --duplicates');
        program.help();
    }

    if ((options.syncPreview || options.sync) && options.removeDuplicates) {
        console.error('Error: Cannot specify sync options with --remove-duplicates');
        program.help();
    }

    if (options.syncPreview && options.sync) {
        console.error('Error: Cannot specify both --sync-preview and --sync');
        program.help();
    }

    if (options.backup && (options.syncPreview || options.sync || options.duplicates || options.removeDuplicates || options.completedTasks)) {
        console.error('Error: Cannot specify --backup with other operation flags');
        program.help();
    }

    return {
        options: options
    };
}

async function executeTaskCommand(options) {
    const showLocal = options.local || (!options.remote && !options.local);
    const showRemote = options.remote || (!options.remote && !options.local);

    // Handle different modes
    if (options.backup) {
        // Backup only mode (-b)
        await handleBackupMode();
    } else if (options.bootstrap) {
        // Bootstrap correlations mode (--bootstrap)
        await handleBootstrapMode();
    } else if (options.cleanDates) {
        // Clean duplicate completion dates mode (--clean-dates)
        await handleCleanDatesMode();
    } else if (options.syncPreview) {
        // Sync preview mode (-s)
        await handleSyncPreviewMode(showLocal, showRemote);
    } else if (options.sync) {
        // Actual sync mode (-S)
        await handleSyncMode(showLocal, showRemote);
    } else if (options.duplicates || options.removeDuplicates) {
        // Duplicates mode (-d or -R)
        await handleDuplicatesMode(showLocal, showRemote, options.removeDuplicates);
    } else if (options.completedTasks) {
        // Completed tasks mode (-c)
        await handleCompletedTasksMode(showLocal, showRemote);
    } else {
        // Default current tasks mode
        await handleCurrentTasksMode(showLocal, showRemote);
    }
}

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

main();
