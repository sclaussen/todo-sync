import { DISPLAY_ICONS, PRIORITY_LABELS } from '../config/constants.js';

export function displayTasks(data, source) {
    const isLocal = source === 'local';
    const title = isLocal ? `${DISPLAY_ICONS.LOCAL} LOCAL TASKS (.tasks)` : `${DISPLAY_ICONS.REMOTE} TODOIST TASKS`;
    const separator = isLocal ? '-' : '=';

    console.log(`\n${title}`);
    console.log(separator.repeat(70));

    if (data.current.error) {
        console.log(`${DISPLAY_ICONS.ERROR} Error: ${data.current.error}`);
    } else if (data.current.message) {
        console.log(`${DISPLAY_ICONS.INFO} ${data.current.message}`);
    } else if (data.current.tasks.length === 0) {
        console.log(`${DISPLAY_ICONS.SUCCESS} No current tasks found`);
    } else {
        displayTasksByPriority(data.current.tasks, isLocal);
    }

    if (shouldShowCompleted(data)) {
        displayCompletedTasks(data.completed.tasks, isLocal);
    }
}

function displayTasksByPriority(tasks, isLocal) {
    const groupedByPriority = groupTasksByPriority(tasks);
    const priorities = Object.keys(groupedByPriority).sort((a, b) =>
        a === 'unknown' ? 1 : b === 'unknown' ? -1 : parseInt(a) - parseInt(b)
    );

    for (const priority of priorities) {
        const priorityLabel = PRIORITY_LABELS[priority] || `Priority ${priority}`;
        const priorityTasks = groupedByPriority[priority];
        
        console.log(`\n  ${priorityLabel} (${priorityTasks.length} tasks):`);
        
        const mainTasks = priorityTasks.filter(task => !task.isSubtask);
        mainTasks.forEach((task, index) => {
            const dueInfo = !isLocal && task.due ? formatDueDate(task.due) : '';
            console.log(`    ${index + 1}. ${task.content}${dueInfo}`);

            if (task.subtasks && task.subtasks.length > 0) {
                task.subtasks.forEach((subtask, subIndex) => {
                    const subDueInfo = !isLocal && subtask.due ? formatDueDate(subtask.due) : '';
                    console.log(`       ${String.fromCharCode(97 + subIndex)}. ${subtask.content}${subDueInfo}`);
                });
            }
        });
    }
}

function displayCompletedTasks(tasks, isLocal) {
    console.log(`\n${DISPLAY_ICONS.SUCCESS} COMPLETED TASKS${isLocal ? ' (.tasks.completed)' : ''}`);
    console.log('-'.repeat(50));

    if (tasks.length === 0) {
        console.log('📭 No completed tasks found');
    } else {
        tasks.forEach((task, index) => {
            const completedDate = !isLocal && task.completed 
                ? ` (completed: ${new Date(task.completed).toLocaleDateString()})`
                : '';
            console.log(`  ${index + 1}. ${task.content}${completedDate}`);
        });
    }
}

function groupTasksByPriority(tasks) {
    return tasks.reduce((groups, task) => {
        const priority = task.priority !== undefined ? task.priority : 'unknown';
        if (!groups[priority]) groups[priority] = [];
        groups[priority].push(task);
        return groups;
    }, {});
}

function formatDueDate(due) {
    if (!due) return '';
    return ` (due: ${due.string || due.date || due})`;
}

function shouldShowCompleted(data) {
    return data.completed.tasks.length > 0 ||
           (data.completed.error && !data.completed.message) ||
           (data.completed.message && !data.completed.message.includes('Use --all'));
}

export function displaySyncChanges(changes, showLocal, showRemote) {
    if (showLocal || (!showLocal && !showRemote)) {
        displayChangesForSource(changes.local, 'local');
    }

    if (showRemote || (!showLocal && !showRemote)) {
        displayChangesForSource(changes.todoist, 'remote');
    }

    if (changes.conflicts.length > 0) {
        displayConflicts(changes.conflicts);
    }
}

function displayChangesForSource(changes, source) {
    const icon = source === 'local' ? DISPLAY_ICONS.LOCAL : DISPLAY_ICONS.REMOTE;
    const hasChanges = Object.values(changes).some(arr => arr.length > 0);
    
    if (!hasChanges) {
        console.log(`${DISPLAY_ICONS.SUCCESS} No ${source} changes needed`);
        return;
    }

    // Display new tasks
    if (changes.noneToCurrent.length > 0) {
        console.log(`\n${icon} New Tasks:`);
        changes.noneToCurrent.forEach(task => {
            console.log(`   • ${task.content}`);
        });
    }

    // Display completed tasks  
    if (changes.currentToCompleted.length > 0 || changes.noneToCompleted.length > 0) {
        console.log(`\n${icon} Completed Tasks:`);
        [...changes.currentToCompleted, ...changes.noneToCompleted].forEach(task => {
            console.log(`   • ${task.content}`);
        });
    }

    // Display renames/updates
    if (changes.renames.length > 0) {
        console.log(`\n${icon} Updates:`);
        changes.renames.forEach(change => {
            if (change.changeType === 'priority_update') {
                console.log(`   • ${change.content} (${change.oldPriority}→${change.newPriority})`);
            } else {
                console.log(`   • ${change.oldContent} → ${change.newContent}`);
            }
        });
    }
}

function displayConflicts(conflicts) {
    console.log(`\n${DISPLAY_ICONS.WARNING} CONFLICTS (Require Resolution):`);
    console.log('-'.repeat(50));

    conflicts.forEach((conflict, index) => {
        console.log(`  ${index + 1}. Task ID: ${conflict.corrId}`);
        console.log(`     Local:   "${conflict.localTask.content}"`);
        console.log(`     Todoist: "${conflict.todoistTask.content}"`);
        console.log();
    });
}