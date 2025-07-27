import { Task } from '../models/Task.js';
import { getLocalTasks, removeTaskFromLocal } from '../data/local.js';
import { getTodoistTasks, deleteTodoistTask } from '../data/todoist.js';
import { DISPLAY_ICONS, logTransaction, getCurrentTimestamp } from '../config/constants.js';
import { stripCorrelationId, extractCorrelationId } from '../../taskLog.js';

async function findLocalTask(id) {
    const { current } = await getLocalTasks();
    const { tasks } = current;
    
    // Try to find by correlation ID first
    for (const task of tasks) {
        const correlationId = extractCorrelationId(task.content);
        if (correlationId === id) {
            return task;
        }
    }
    
    // Try to find by content match
    for (const task of tasks) {
        const cleanContent = stripCorrelationId(task.content);
        if (cleanContent.includes(id) || task.content.includes(id)) {
            return task;
        }
    }
    
    return null;
}

async function findRemoteTask(id) {
    const { current } = await getTodoistTasks();
    const { tasks } = current;
    
    // Try to find by Todoist ID
    const task = tasks.find(t => t.id === id || t.id.toString() === id);
    if (task) {
        return task;
    }
    
    // Try to find by content match
    return tasks.find(t => t.content.includes(id));
}

function validateOptions(options) {
    // No specific validation needed for remove command
}

export async function execute(id, options) {
    validateOptions(options);
    
    const removeLocal = options.local || (!options.local && !options.remote);
    const removeRemote = options.remote || (!options.local && !options.remote);
    
    let localTask = null;
    let remoteTask = null;
    
    // Find the task to remove
    if (removeLocal) {
        localTask = await findLocalTask(id);
        if (!localTask) {
            throw new Error(`Local task not found: ${id}`);
        }
    }
    
    if (removeRemote) {
        remoteTask = await findRemoteTask(id);
        if (!remoteTask) {
            throw new Error(`Remote task not found: ${id}`);
        }
    }
    
    // Remove local task
    if (removeLocal && localTask) {
        const taskName = stripCorrelationId(localTask.content);
        await removeTaskFromLocal(localTask);
        console.log(`${DISPLAY_ICONS.SUCCESS} Removed local task: "${taskName}"`);
        
        // Log transaction
        await logTransaction({
            type: 'remove',
            timestamp: getCurrentTimestamp(),
            name: taskName
        });
    }
    
    // Remove remote task
    if (removeRemote && remoteTask) {
        await deleteTodoistTask(remoteTask.id);
        console.log(`${DISPLAY_ICONS.SUCCESS} Removed remote task: "${remoteTask.content}" (ID: ${remoteTask.id})`);
        
        // Log transaction (only if not already logged locally)
        if (!removeLocal) {
            await logTransaction({
                type: 'remove',
                timestamp: getCurrentTimestamp(),
                name: remoteTask.content
            });
        }
    }
}