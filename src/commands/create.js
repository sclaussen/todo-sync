import { Task } from '../models/Task.js';
import { addTaskToLocal } from '../data/local.js';
import { createTodoistTask } from '../data/todoist.js';
import { PRIORITIES, DISPLAY_ICONS, logTransaction, getCurrentTimestamp } from '../config/constants.js';

export async function execute(content, options) {
    validateOptions(options);

    const createLocal = options.local || (!options.local && !options.remote);
    const createRemote = options.remote || (!options.local && !options.remote);
    const priority = options.priority !== undefined ? parseInt(options.priority) : PRIORITIES.HIGH;

    const task = new Task(content, priority);

    if (createLocal) {
        await addTaskToLocal(task, priority);
        console.log(`${DISPLAY_ICONS.SUCCESS} Created local task: "${content}" (Priority ${priority})`);
        // Log transaction
        await logTransaction({
            type: 'create',
            timestamp: getCurrentTimestamp(),
            name: content,
            priority: priority
        });
    }
    if (createRemote) {
        const result = await createTodoistTask(task);
        task.todoistId = result.id.toString();
        
        // If also creating locally, update with Todoist ID
        if (createLocal) {
            task.todoistId = result.id.toString();
            // Update the local task to include the Todoist ID
        }
        console.log(`${DISPLAY_ICONS.SUCCESS} Created remote task: "${content}" (Priority ${priority}, ID: ${result.id})`);
        // Log transaction (only if not already logged locally)
        if (!createLocal) {
            await logTransaction({
                type: 'create',
                timestamp: getCurrentTimestamp(),
                name: content,
                priority: priority
            });
        }
    }
}

function validateOptions(options) {
    if (options.local && options.remote) {
        throw new Error('Cannot specify both --local and --remote options');
    }
    
    if (options.priority !== undefined) {
        const priority = parseInt(options.priority);
        if (isNaN(priority) || priority < 0 || priority > 4) {
            throw new Error('Priority must be a number between 0 and 4');
        }
    }
}