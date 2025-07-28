import { Task } from '../models/Task.js';
import { getLocalTasks, removeTaskFromLocal, addCompletedTaskToLocal } from '../data/local.js';
import { getTodoistTasks, completeTodoistTask } from '../data/todoist.js';
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
    const task = tasks.find(t => t.todoistId && (t.todoistId === id || t.todoistId.toString() === id));
    if (task) {
        return task;
    }
    
    // Try to find by content match
    return tasks.find(t => t.content && t.content.includes(id));
}

async function completeLocalTask(task) {
    // Remove from current tasks
    await removeTaskFromLocal(task.content);
    
    // Add to completed tasks
    await addCompletedTaskToLocal(task);
}

async function completeRemoteTask(task) {
    await completeTodoistTask(task.todoistId);
}

function validateOptions(options) {
    // No specific validation needed for complete command
}

export async function execute(id, options) {
    validateOptions(options);
    
    const completeLocal = options.local || (!options.local && !options.remote);
    const completeRemote = options.remote || (!options.local && !options.remote);
    
    let localTask = null;
    let remoteTask = null;
    
    // Find the task to complete
    if (completeLocal) {
        localTask = await findLocalTask(id);
        if (!localTask) {
            throw new Error(`Local task not found: ${id}`);
        }
    }
    
    if (completeRemote) {
        remoteTask = await findRemoteTask(id);
        if (!remoteTask) {
            throw new Error(`Remote task not found: ${id}`);
        }
    }
    
    // Complete local task
    if (completeLocal && localTask) {
        const taskName = stripCorrelationId(localTask.content);
        await completeLocalTask(localTask);
        console.log(`Completed local task: "${taskName}"`);
        
        // Log transaction
        await logTransaction({
            type: 'complete',
            timestamp: getCurrentTimestamp(),
            name: taskName
        });
    }
    
    // Complete remote task
    if (completeRemote && remoteTask) {
        await completeRemoteTask(remoteTask);
        console.log(`Completed remote task: "${remoteTask.content}" (ID: ${remoteTask.todoistId})`);
        
        // Log transaction (only if not already logged locally)
        if (!completeLocal) {
            await logTransaction({
                type: 'complete',
                timestamp: getCurrentTimestamp(),
                name: remoteTask.content
            });
        }
    }
}