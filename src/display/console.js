import { DISPLAY_ICONS, PRIORITY_LABELS } from '../config/constants.js';

export function displayTasks(tasks, prefix, showCompleted) {
    if (tasks.length === 0) {
        return;
    }

    if (showCompleted) {
        displayCompletedTasksList(tasks, prefix);
    } else {
        displayTasksByPriority(tasks, prefix);
    }
}

function displayTasksByPriority(tasks, prefix) {
    const groupedByPriority = groupTasksByPriority(tasks);
    const priorities = Object.keys(groupedByPriority).sort((a, b) =>
        a === 'unknown' ? 1 : b === 'unknown' ? -1 : parseInt(a) - parseInt(b)
    );

    for (const priority of priorities) {
        const priorityTasks = groupedByPriority[priority];
        const priorityLabel = prefix ? `${prefix} Priority ${priority}:` : `Priority ${priority}:`;
        
        console.log(priorityLabel);
        
        const mainTasks = priorityTasks.filter(task => !task.isSubtask);
        mainTasks.forEach((task, index) => {
            const idInfo = task.todoistId ? ` (${task.todoistId})` : '';
            console.log(`${index + 1}. ${task.content}${idInfo}`);

            if (task.subtasks && task.subtasks.length > 0) {
                task.subtasks.forEach((subtask, subIndex) => {
                    const subIdInfo = subtask.todoistId ? ` (${subtask.todoistId})` : '';
                    console.log(`   ${String.fromCharCode(97 + subIndex)}. ${subtask.content}${subIdInfo}`);
                });
            }
        });
        
        // Add blank line between priority sections if there are more priorities
        if (priorities.indexOf(priority) < priorities.length - 1) {
            console.log('');
        }
    }
}

function displayCompletedTasks(tasks, isLocal) {
    console.log(`\n${DISPLAY_ICONS.SUCCESS} COMPLETED TASKS${isLocal ? ' (completed.yaml)' : ''}`);
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

function displayCompletedTasksList(tasks, prefix) {
    if (tasks.length === 0) {
        return;
    }

    const label = prefix ? `${prefix}:` : 'Completed:';
    console.log(label);
    
    tasks.forEach((task, index) => {
        const idInfo = task.todoistId ? ` (${task.todoistId})` : '';
        console.log(`${index + 1}. ${task.content}${idInfo}`);
    });
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