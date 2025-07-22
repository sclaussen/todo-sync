import { TODOIST } from '../config/constants.js';
import { Task } from '../models/Task.js';

export async function getTodoistTasks() {
    if (!TODOIST.API_TOKEN) {
        return {
            current: { tasks: [], message: 'No Todoist API token configured' },
            completed: { tasks: [], message: 'No Todoist API token configured' }
        };
    }

    try {
        const projectId = await getProjectId();
        if (!projectId) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        const [activeTasks, completedTasks] = await Promise.all([
            fetchActiveTasks(projectId),
            fetchCompletedTasks(projectId)
        ]);

        return {
            current: { tasks: activeTasks.map(Task.fromTodoist) },
            completed: { tasks: completedTasks.map(Task.fromTodoist) }
        };
    } catch (error) {
        return {
            current: { tasks: [], error: error.message },
            completed: { tasks: [], error: error.message }
        };
    }
}

async function getProjectId() {
    const response = await fetch(`${TODOIST.BASE_URL}/projects`, {
        headers: { Authorization: `Bearer ${TODOIST.API_TOKEN}` }
    });

    if (!response.ok) {
        throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
    }

    const projects = await response.json();
    const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);
    return syncProject?.id || null;
}

async function fetchActiveTasks(projectId) {
    const response = await fetch(`${TODOIST.BASE_URL}/tasks?project_id=${projectId}`, {
        headers: { Authorization: `Bearer ${TODOIST.API_TOKEN}` }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch active tasks: ${response.status}`);
    }

    const tasks = await response.json();
    return formatTasks(tasks);
}

async function fetchCompletedTasks(projectId) {
    const response = await fetch(`${TODOIST.SYNC_URL}/completed/get_all`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TODOIST.API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
    });

    if (!response.ok) {
        return []; // Don't fail if completed tasks can't be fetched
    }

    const data = await response.json();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentTasks = (data.items || []).filter(task => {
        if (task.project_id !== projectId) return false;
        const completedDate = new Date(task.completed_at);
        return completedDate > thirtyDaysAgo;
    });

    return removeDuplicates(recentTasks);
}

function formatTasks(tasks) {
    const taskMap = new Map();
    
    // Create task objects and build hierarchy
    tasks.forEach(task => {
        const formattedTask = {
            content: task.content,
            id: task.id,
            priority: task.priority,
            created: task.created_at,
            due: task.due,
            projectId: task.project_id,
            parentId: task.parent_id,
            isSubtask: !!task.parent_id,
            subtasks: []
        };
        
        taskMap.set(task.id, formattedTask);
    });

    // Build subtask relationships
    tasks.forEach(task => {
        if (task.parent_id) {
            const parent = taskMap.get(task.parent_id);
            const subtask = taskMap.get(task.id);
            if (parent && subtask) {
                parent.subtasks.push(subtask);
                subtask.parentContent = parent.content;
            }
        }
    });

    return Array.from(taskMap.values());
}

function removeDuplicates(tasks) {
    const seen = new Set();
    return tasks.filter(task => {
        const key = task.content.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export async function createTodoistTask(task, projectId) {
    if (!projectId) {
        projectId = await getProjectId();
        if (!projectId) throw new Error('Project not found');
    }

    const taskData = {
        ...task.toTodoistFormat(),
        project_id: projectId
    };

    const response = await fetch(`${TODOIST.BASE_URL}/tasks`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TODOIST.API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(taskData)
    });

    if (!response.ok) {
        throw new Error(`Failed to create task: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

export async function updateTodoistTask(todoistId, updates) {
    const response = await fetch(`${TODOIST.BASE_URL}/tasks/${todoistId}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TODOIST.API_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
    });

    if (!response.ok) {
        throw new Error(`Failed to update task: ${response.status} ${response.statusText}`);
    }

    return response.ok;
}

export async function completeTodoistTask(todoistId) {
    const response = await fetch(`${TODOIST.BASE_URL}/tasks/${todoistId}/close`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TODOIST.API_TOKEN}` }
    });

    return response.ok;
}

export async function deleteTodoistTask(todoistId) {
    const response = await fetch(`${TODOIST.BASE_URL}/tasks/${todoistId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${TODOIST.API_TOKEN}` }
    });

    return response.ok;
}