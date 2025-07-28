import { Task } from '../models/Task.js';
import { getLocalTasks, updateTaskInLocal, removeTaskFromLocal, addTaskToLocal } from '../data/local.js';
import { getTodoistTasks, updateTodoistTask } from '../data/todoist.js';
import { PRIORITIES, DISPLAY_ICONS, logTransaction, getCurrentTimestamp } from '../config/constants.js';
import { stripCorrelationId, extractCorrelationId } from '../utils/correlationId.js';

export async function execute(id, content, options) {
    validateOptions(options, content);

    const updateLocal = options.local || (!options.local && !options.remote);
    const updateRemote = options.remote || (!options.local && !options.remote);
    const newPriority = options.priority !== undefined ? parseInt(options.priority) : undefined;

    let localTask = null;
    let remoteTask = null;

    // Find the task to update
    if (updateLocal) {
        localTask = await findLocalTask(id);
        if (!localTask) {
            throw new Error(`Local task not found: ${id}`);
        }
    }

    if (updateRemote) {
        remoteTask = await findRemoteTask(id);
        if (!remoteTask) {
            throw new Error(`Remote task not found: ${id}`);
        }
    }

    // Update local task
    if (updateLocal && localTask) {
        const originalContent = localTask.content;
        const originalPriority = localTask.priority;
        const finalContent = content || localTask.content;
        
        await updateLocalTask(localTask, finalContent, newPriority);
        
        const changes = [];
        if (content) changes.push(`content: "${finalContent}"`);
        if (newPriority !== undefined) changes.push(`priority: ${newPriority}`);
        
        console.log(`Updated local task${changes.length > 0 ? ` (${changes.join(', ')})` : ''}`);
        
        // Log transactions for changes
        if (content && content !== originalContent) {
            await logTransaction({
                type: 'update-name',
                timestamp: getCurrentTimestamp(),
                name: originalContent,
                newName: finalContent
            });
        }
        
        if (newPriority !== undefined && newPriority !== originalPriority) {
            await logTransaction({
                type: 'update-priority',
                timestamp: getCurrentTimestamp(),
                name: finalContent,
                oldPriority: originalPriority,
                newPriority: newPriority
            });
        }
    }

    // Update remote task
    if (updateRemote && remoteTask) {
        const originalContent = remoteTask.content;
        const originalPriority = remoteTask.priority;
        const finalContent = content || remoteTask.content;
        
        await updateRemoteTask(remoteTask, finalContent, newPriority);
        
        const changes = [];
        if (content) changes.push(`content: "${finalContent}"`);
        if (newPriority !== undefined) changes.push(`priority: ${newPriority}`);
        
        console.log(`Updated remote task${changes.length > 0 ? ` (${changes.join(', ')})` : ''}`);
        
        // Log transactions for changes (only if not already logged locally)
        if (!updateLocal) {
            if (content && content !== originalContent) {
                await logTransaction({
                    type: 'update-name',
                    timestamp: getCurrentTimestamp(),
                    name: originalContent,
                    newName: finalContent
                });
            }
            
            if (newPriority !== undefined && newPriority !== originalPriority) {
                await logTransaction({
                    type: 'update-priority',
                    timestamp: getCurrentTimestamp(),
                    name: finalContent,
                    oldPriority: originalPriority,
                    newPriority: newPriority
                });
            }
        }
    }
}

async function findLocalTask(identifier) {
    const { current } = await getLocalTasks();
    
    // Try to find by content match (partial or full)
    const task = current.tasks.find(t => {
        const cleanContent = stripCorrelationId(t.content).toLowerCase();
        return cleanContent.includes(identifier.toLowerCase()) || 
               t.content.toLowerCase().includes(identifier.toLowerCase());
    });

    return task;
}

async function findRemoteTask(identifier) {
    const { current } = await getTodoistTasks();
    
    // Try to find by ID first, then by content
    let task = current.tasks.find(t => t.todoistId === identifier || t.id === identifier);
    
    if (!task) {
        // Try content match
        task = current.tasks.find(t => {
            return t.content.toLowerCase().includes(identifier.toLowerCase());
        });
    }

    return task;
}

async function updateLocalTask(task, newContent, newPriority) {
    const oldContent = task.content;
    const oldPriority = task.priority;
    
    // Update task object
    task.content = newContent;
    if (newPriority !== undefined) {
        task.priority = newPriority;
    }

    // If priority changed, remove from old location and add to new location
    if (newPriority !== undefined && newPriority !== oldPriority) {
        // Remove from current location
        await removeTaskFromLocal(stripCorrelationId(oldContent));
        
        // Add to new priority section (at the top)
        await addTaskToLocal(task, newPriority);
    } else {
        // Just update content in place
        await updateTaskInLocal(oldContent, task);
    }
}

async function updateRemoteTask(task, newContent, newPriority) {
    const updates = {};
    
    // Only update content if it changed
    if (newContent !== task.content) {
        updates.content = newContent;
    }
    
    if (newPriority !== undefined) {
        // Map local priority to Todoist priority
        const todoistPriority = mapLocalPriorityToTodoist(newPriority);
        updates.priority = todoistPriority;
        
        // Handle due date for priority 0 tasks
        if (newPriority === 0) {
            updates.due_string = 'today';
        } else if (task.priority === 0 && newPriority !== 0) {
            // Remove due date when moving away from priority 0
            updates.due_string = 'no date';
        }
    }

    const todoistId = task.todoistId || task.id;
    await updateTodoistTask(todoistId, updates);
}

function mapLocalPriorityToTodoist(localPriority) {
    // Based on CLAUDE.md mapping:
    // Local P0 -> Todoist P4 (highest/red) + due date "today"
    // Local P1 -> Todoist P4 (highest/red) 
    // Local P2 -> Todoist P3 (orange)
    // Local P3 -> Todoist P2 (blue)
    // Local P4 -> Todoist P1 (lowest/no flag)
    const mapping = {
        0: 4, // Urgent -> P4 with due date
        1: 4, // High -> P4 
        2: 3, // Medium -> P3
        3: 2, // Low -> P2
        4: 1  // Lowest -> P1
    };
    
    return mapping[localPriority] || 1;
}

function validateOptions(options, content) {
    if (options.local && options.remote) {
        throw new Error('Cannot specify both --local and --remote options');
    }
    
    if (options.priority !== undefined) {
        const priority = parseInt(options.priority);
        if (isNaN(priority) || priority < 0 || priority > 4) {
            throw new Error('Priority must be a number between 0 and 4');
        }
    }
    
    // Must provide either content or priority
    if (!content && options.priority === undefined) {
        throw new Error('Must provide either new content or priority (-P) to update');
    }
}