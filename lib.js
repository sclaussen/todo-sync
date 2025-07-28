import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import { FILE_PATHS, TODOIST } from './src/config/constants.js';
import {
    extractCorrelationId,
    stripCorrelationId,
    addCorrelationId,
    logSyncOperation
} from './taskLog.js';

// Load environment variables from .env file
// Temporarily suppress all dotenv console output
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};
dotenv.config();
console.log = originalConsoleLog;
console.error = originalConsoleError;
console.warn = originalConsoleWarn;
console.info = originalConsoleInfo;


// Shared API client for Todoist requests
class TodoistAPI {
    constructor(apiToken) {
        this.apiToken = apiToken;
        this.baseURL = 'https://api.todoist.com';
    }

    async request(endpoint, options = {}) {
        if (!this.apiToken) {
            throw new Error('No Todoist API token configured');
        }

        const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    async getProjects() {
        return this.request('/rest/v2/projects');
    }

    async createProject(name) {
        return this.request('/rest/v2/projects', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
    }

    async getTasks(projectId) {
        return this.request(`/rest/v2/tasks?project_id=${projectId}`);
    }

    async getCompletedTasks() {
        return this.request('https://api.todoist.com/sync/v9/completed/get_all', {
            method: 'POST',
            body: JSON.stringify({})
        });
    }

    async createTask(taskData) {
        return this.request('/rest/v2/tasks', {
            method: 'POST',
            body: JSON.stringify(taskData)
        });
    }

    async updateTask(taskId, updateData) {
        return this.request(`/rest/v2/tasks/${taskId}`, {
            method: 'POST',
            body: JSON.stringify(updateData)
        });
    }

    async closeTask(taskId) {
        return this.request(`/rest/v2/tasks/${taskId}/close`, {
            method: 'POST'
        });
    }

    async reopenTask(taskId) {
        return this.request(`/rest/v2/tasks/${taskId}/reopen`, {
            method: 'POST'
        });
    }
}

const todoistAPI = new TodoistAPI(TODOIST.API_TOKEN);

// Error handling utilities
function createErrorResult(error, context = '') {
    const message = context ? `${context}: ${error.message}` : error.message;
    console.error(`❌ ${message}`);
    return { tasks: [], error: message };
}

function handleAsyncError(error, context = '') {
    const message = context ? `${context}: ${error.message}` : error.message;
    console.error(`❌ ${message}`);
    return false;
}


export async function getTasks(source) {
    if (source === 'local') {
        return getLocalTasks();
    } else if (source === 'remote') {
        return await getRemoteTasks();
    } else {
        throw new Error('Source must be either "local" or "remote"');
    }
}

export async function findDuplicates(source) {
    if (source === 'local') {
        return findLocalDuplicates();
    } else if (source === 'remote') {
        return await findRemoteDuplicates();
    } else {
        throw new Error('Source must be either "local" or "remote"');
    }
}

function getPriorityLabel(priority) {
    return priority === 'unknown' ? 'Unknown Priority' : `Priority ${priority}`;
}

function getLocalTasks() {
    const current = parseLocalTasks('.tasks');
    const completed = parseLocalTasks('.tasks.completed');

    return {
        current: current.error ? { tasks: [], error: current.error } : current,
        completed: completed.error ? { tasks: [], error: completed.error } : completed
    };
}

// Helper functions for parsing tasks
function shouldSkipLine(line) {
    const trimmed = line.trim();
    return !trimmed || trimmed.includes('---');
}

function parsePriorityHeader(line) {
    const match = line.trim().match(/Priority (\d+)/);
    return match ? parseInt(match[1]) : null;
}

function createSubtask(line, content, currentPriority, currentParentTask, filename, lineNumber) {
    const subtaskContent = content.substring(2).trim(); // Remove "- " prefix
    const cleanContent = cleanTaskContent(subtaskContent);
    const todoistId = extractCorrelationId(subtaskContent);
    const taskName = stripCorrelationId(cleanContent);

    return {
        content: taskName,
        todoistId: todoistId,
        priority: currentPriority !== null ? currentPriority : 'unknown',
        lineNumber: lineNumber,
        file: filename,
        isSubtask: true,
        parentTaskId: currentParentTask.todoistId || `line-${currentParentTask.lineNumber}`,
        parentContent: currentParentTask.content,
        originalLine: line
    };
}

function createOrphanedSubtask(line, content, currentPriority, filename, lineNumber) {
    const cleanContent = cleanTaskContent(content);
    const todoistId = extractCorrelationId(content);
    const taskName = stripCorrelationId(cleanContent);

    return {
        content: taskName,
        todoistId: todoistId,
        priority: currentPriority !== null ? currentPriority : 'unknown',
        lineNumber: lineNumber,
        file: filename,
        isOrphanedSubtask: true,
        originalLine: line
    };
}

function createMainTask(line, content, currentPriority, filename, lineNumber) {
    const cleanContent = cleanTaskContent(content);
    const todoistId = extractCorrelationId(content);
    const taskName = stripCorrelationId(cleanContent);

    return {
        content: taskName,
        todoistId: todoistId,
        priority: currentPriority !== null ? currentPriority : 'unknown',
        lineNumber: lineNumber,
        file: filename,
        subtasks: [],
        originalLine: line
    };
}

function parseLocalTasks(filename = '.tasks') {
    const filepath = filename === '.tasks' ? FILE_PATHS.TASK : 
                     filename === '.tasks.completed' ? FILE_PATHS.COMPLETED : 
                     FILE_PATHS.TASK;

    if (!existsSync(filepath)) {
        return { tasks: [], error: `File ${filepath} does not exist` };
    }

    try {
        const content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        const tasks = [];
        let currentPriority = null;
        let currentParentTask = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            if (shouldSkipLine(line)) {
                continue;
            }

            // Check for priority section headers
            if (trimmedLine.startsWith('Priority ')) {
                const priority = parsePriorityHeader(trimmedLine);
                if (priority !== null) {
                    currentPriority = priority;
                    currentParentTask = null;
                }
                continue;
            }

            // Handle subtasks
            if (trimmedLine.startsWith('- ')) {
                if (currentParentTask) {
                    const subtask = createSubtask(line, trimmedLine, currentPriority, currentParentTask, filename, i + 1);

                    if (!currentParentTask.subtasks) {
                        currentParentTask.subtasks = [];
                    }
                    currentParentTask.subtasks.push(subtask);
                    tasks.push(subtask);
                } else {
                    console.warn(`Warning: Orphaned subtask found at line ${i + 1}: ${trimmedLine}`);
                    const orphanedTask = createOrphanedSubtask(line, trimmedLine, currentPriority, filename, i + 1);
                    tasks.push(orphanedTask);
                }
            } else {
                // Main task
                const task = createMainTask(line, trimmedLine, currentPriority, filename, i + 1);
                tasks.push(task);
                currentParentTask = task;
            }
        }

        return { tasks };
    } catch (error) {
        return createErrorResult(error, 'Failed to parse local tasks');
    }
}

function cleanTaskContent(content) {
    // Remove date prefixes like "07/20 " from the beginning
    content = content.replace(/^\d{2}\/\d{2}\s+/, '');

    // Remove comment suffixes like "(comments: comment here)" from the end
    content = content.replace(/\s*\(comments?:\s*.*?\)$/, '');

    return content.trim();
}

function removeDuplicateCompletionDates(content) {
    // Remove duplicate (completed: date) patterns, keep only the first one
    const completedPattern = /\(completed: \d{1,2}\/\d{1,2}\/\d{4}\)/g;
    const matches = content.match(completedPattern);

    if (matches && matches.length > 1) {
        // Keep only the first completion date
        const firstMatch = matches[0];
        const cleanedContent = content.replace(completedPattern, '').trim();
        return `${cleanedContent} ${firstMatch}`;
    }

    return content;
}


async function getRemoteTasks() {
    if (!TODOIST.API_TOKEN) {
        return {
            current: { tasks: [], message: 'No Todoist API token configured' },
            completed: { tasks: [], message: 'No Todoist API token configured' }
        };
    }

    try {
        // Get projects and find sync project
        const projects = await todoistAPI.getProjects();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);

        if (!syncProject) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        // Fetch active and completed tasks
        const [ activeTasks, completedData ] = await Promise.all([
            todoistAPI.getTasks(syncProject.id),
            todoistAPI.getCompletedTasks().catch(() => ({ items: [] }))
        ]);

        // Filter completed tasks by project and last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const completedTasks = (completedData.items || []).filter(task => {
            if (task.project_id !== syncProject.id) {
                return false;
            }
            const completedDate = new Date(task.completed_at);
            return completedDate > thirtyDaysAgo;
        });

        // Group tasks by parent relationship and format
        const taskMap = new Map();
        const parentTasks = [];

        // First pass: create task objects and identify relationships
        activeTasks.forEach(task => {
            const formattedTask = {
                content: task.content,
                id: task.id,
                priority: task.priority,
                created: task.created_at,
                due: task.due ? task.due.date : null,
                projectId: task.project_id,
                labels: task.labels || [],
                parentId: task.parent_id || null,
                isSubtask: !!task.parent_id,
                subtasks: []
            };

            taskMap.set(task.id, formattedTask);

            if (!task.parent_id) {
                parentTasks.push(formattedTask);
            }
        });

        // Second pass: build subtask relationships
        activeTasks.forEach(task => {
            if (task.parent_id) {
                const parentTask = taskMap.get(task.parent_id);
                const subtask = taskMap.get(task.id);

                if (parentTask && subtask) {
                    parentTask.subtasks.push(subtask);
                    subtask.parentContent = parentTask.content;
                }
            }
        });

        // Create flat list for sync purposes while preserving hierarchy
        const formattedActiveTasks = Array.from(taskMap.values());

        // Deduplicate completed tasks by content (Remote can have duplicates)
        const uniqueCompletedTasks = [];
        const seenContent = new Set();

        for (const task of completedTasks) {
            const normalizedContent = task.content.toLowerCase().trim();
            if (!seenContent.has(normalizedContent)) {
                seenContent.add(normalizedContent);
                uniqueCompletedTasks.push(task);
            }
        }

        // Format completed tasks
        const formattedCompletedTasks = uniqueCompletedTasks.map(task => ({
            content: task.content,
            id: task.id,
            priority: task.priority || 1,
            created: task.added_at,
            completed: task.completed_at,
            projectId: task.project_id
        }));

        return {
            current: { tasks: formattedActiveTasks },
            completed: { tasks: formattedCompletedTasks }
        };

    } catch (error) {
        const errorResult = createErrorResult(error, 'Failed to fetch remote tasks');
        return {
            current: errorResult,
            completed: errorResult
        };
    }
}

function findLocalDuplicates() {
    const localFiles = [ '.tasks' ]; // Only check current tasks
    const results = [];

    for (const filename of localFiles) {
        const result = findDuplicatesInFile(filename);
        if (result.duplicates.length > 0 || result.error || result.message) {
            results.push(result);
        }
    }

    return results;
}

function findDuplicatesInFile(filename) {
    const filepath = filename === '.tasks' ? FILE_PATHS.TASK : 
                     filename === '.tasks.completed' ? FILE_PATHS.COMPLETED : 
                     FILE_PATHS.TASK;

    if (!existsSync(filepath)) {
        return {
            file: filename,
            duplicates: [],
            message: `File ${filepath} does not exist`
        };
    }

    try {
        const content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        const contentCounts = new Map();

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines and priority section headers
            if (!line || line.startsWith('Priority') || line.includes('---')) {
                continue;
            }

            const normalizedContent = line.toLowerCase().trim();

            if (contentCounts.has(normalizedContent)) {
                contentCounts.set(normalizedContent, {
                    ...contentCounts.get(normalizedContent),
                    count: contentCounts.get(normalizedContent).count + 1
                });
            } else {
                contentCounts.set(normalizedContent, {
                    originalContent: line,
                    count: 1
                });
            }
        }

        // Extract duplicates (items with count > 1)
        const duplicates = [];
        for (const [ normalizedContent, data ] of contentCounts.entries()) {
            if (data.count > 1) {
                duplicates.push({
                    content: data.originalContent,
                    count: data.count
                });
            }
        }

        return {
            file: filename,
            duplicates,
            totalTasks: Array.from(contentCounts.values()).reduce((sum, data) => sum + data.count, 0)
        };
    } catch (error) {
        return {
            file: filename,
            duplicates: [],
            error: error.message
        };
    }
}

async function findRemoteDuplicates() {
    if (!TODOIST.API_TOKEN) {
        return [ {
            source: 'remote',
            duplicates: [],
            message: 'No Todoist API token configured'
        } ];
    }

    try {
        // First, get the project ID for the "Sync" project
        const projectsResponse = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (!projectsResponse.ok) {
            throw new Error(`Todoist API error: ${projectsResponse.status} ${projectsResponse.statusText}`);
        }

        const projects = await projectsResponse.json();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);

        if (!syncProject) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        // Fetch tasks from the "Sync" project only
        const response = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${syncProject.id}`, {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (!response.ok) {
            throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
        }

        const tasks = await response.json();
        const contentCounts = new Map();

        for (const task of tasks) {
            const normalizedContent = task.content.toLowerCase().trim();

            if (contentCounts.has(normalizedContent)) {
                contentCounts.set(normalizedContent, {
                    ...contentCounts.get(normalizedContent),
                    count: contentCounts.get(normalizedContent).count + 1
                });
            } else {
                contentCounts.set(normalizedContent, {
                    originalContent: task.content,
                    count: 1
                });
            }
        }

        // Extract duplicates (items with count > 1)
        const duplicates = [];
        for (const [ normalizedContent, data ] of contentCounts.entries()) {
            if (data.count > 1) {
                duplicates.push({
                    content: data.originalContent,
                    count: data.count
                });
            }
        }

        return [ {
            source: 'remote',
            duplicates,
            totalTasks: tasks.length
        } ];
    } catch (error) {
        return [ {
            source: 'remote',
            duplicates: [],
            error: error.message
        } ];
    }
}

// Priority mapping utilities
const PRIORITY_MAPPING = {
    LOCAL_TO_REMOTE: {
        0: 4, // Priority 0 -> Remote Priority 4 (highest/red)
        1: 4, // Priority 1 -> Remote Priority 4 (highest/red)
        2: 3, // Priority 2 -> Remote Priority 3 (orange)
        3: 2, // Priority 3 -> Remote Priority 2 (blue)
        4: 1  // Priority 4 -> Remote Priority 1 (lowest/no flag)
    },
    REMOTE_TO_LOCAL: {
        4: 4, // Remote Priority 4 (highest) -> Local Priority 4
        3: 3, // Remote Priority 3 -> Local Priority 3
        2: 2, // Remote Priority 2 -> Local Priority 2
        1: 1, // Remote Priority 1 (lowest) -> Local Priority 1
        0: 0  // Remote Priority 0 (urgent) -> Local Priority 0
    }
};

function mapRemotePriority(task) {
    // Remote Priority 0 tasks should always map to Local Priority 0
    if (task.priority === 0) {
        return 0;
    }

    // Check if task is Priority 4 and due today or in the past
    if (task.priority === 4 && task.due) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueDate = new Date(task.due + 'T00:00:00');
        dueDate.setHours(0, 0, 0, 0);

        // If due today or in the past, make it Priority 0
        if (dueDate <= today) {
            return 0;
        }
    }

    return PRIORITY_MAPPING.REMOTE_TO_LOCAL[task.priority] || 4;
}


export function displayDuplicates(results, source) {
    const isLocal = source === 'local';
    const title = isLocal ? '🔍 LOCAL DUPLICATES' : '🔍 TODOIST DUPLICATES';

    console.log(`\n${title}`);
    console.log('='.repeat(79));

    // Handle remote results (single item array) vs local results (multiple files)
    const resultsToProcess = isLocal ? results : [ results[0] ];

    let foundAnyDuplicates = false;

    for (const result of resultsToProcess) {

        if (result.error) {
            console.log(`❌ Error: ${result.error}`);
            continue;
        }

        if (result.message) {
            console.log(`ℹ️  ${result.message}`);
            continue;
        }

        if (result.duplicates.length === 0) {
            console.log('✅ No duplicates found');
        } else {
            foundAnyDuplicates = true;
            for (const dup of result.duplicates) {
                console.log(`   ${dup.count}x: ${dup.content}`);
            }
        }
    }

    if (!foundAnyDuplicates) {
        console.log(`\n🎉 No duplicates found in ${isLocal ? 'local files' : 'Remote'}!`);
    }
}

export async function removeDuplicates(source) {
    if (source === 'local') {
        return removeLocalDuplicates();
    } else if (source === 'remote') {
        return await removeRemoteDuplicates();
    } else {
        throw new Error('Source must be either "local" or "remote"');
    }
}

function removeLocalDuplicates() {
    const filename = '.tasks';
    const filepath = FILE_PATHS.TASK;

    try {
        const content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        const contentCounts = new Map();
        const uniqueLines = [];
        const duplicateGroups = new Map();

        // First pass: count all content and identify duplicates
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Always keep empty lines, priority headers, and separators
            if (!trimmedLine || trimmedLine.startsWith('Priority ') || trimmedLine.includes('---')) {
                continue;
            }

            const normalizedContent = trimmedLine.toLowerCase();
            if (contentCounts.has(normalizedContent)) {
                const existing = contentCounts.get(normalizedContent);
                contentCounts.set(normalizedContent, {
                    ...existing,
                    count: existing.count + 1
                });
            } else {
                contentCounts.set(normalizedContent, {
                    originalContent: trimmedLine,
                    count: 1
                });
            }
        }

        // Identify which content has duplicates
        for (const [ normalizedContent, data ] of contentCounts.entries()) {
            if (data.count > 1) {
                duplicateGroups.set(normalizedContent, {
                    content: data.originalContent,
                    duplicatesRemoved: data.count - 1 // Keep one, remove the rest
                });
            }
        }

        // Second pass: build unique lines, keeping only first occurrence of each content
        const seenContent = new Set();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Always keep empty lines, priority headers, and separators
            if (!trimmedLine || trimmedLine.startsWith('Priority ') || trimmedLine.includes('---')) {
                uniqueLines.push(line);
                continue;
            }

            const normalizedContent = trimmedLine.toLowerCase();
            if (!seenContent.has(normalizedContent)) {
                seenContent.add(normalizedContent);
                uniqueLines.push(line);
            }
            // Skip duplicates (don't add to uniqueLines)
        }

        // Output results
        if (duplicateGroups.size > 0) {
            for (const [ , data ] of duplicateGroups) {
                const duplicateCount = data.duplicatesRemoved;
                const plural = duplicateCount === 1 ? 'duplicate' : 'duplicates';
                console.log(`Removed ${duplicateCount} ${plural} of: ${data.content}`);
            }

            const totalRemoved = Array.from(duplicateGroups.values()).reduce((sum, data) => sum + data.duplicatesRemoved, 0);
            writeFileSync(filepath, uniqueLines.join('\n'), 'utf8');
            console.log(`\n✅ Removed ${totalRemoved} duplicate(s) from ${filename}`);
        } else {
            console.log(`\n✅ No duplicates found in ${filename}`);
        }
    } catch (error) {
        console.error(`❌ Error removing duplicates from ${filename}: ${error.message}`);
    }
}

async function removeRemoteDuplicates() {
    if (!TODOIST.API_TOKEN) {
        console.error('❌ No Todoist API token configured');
        return;
    }

    try {
        // First, get the project ID for the "Sync" project
        const projectsResponse = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (!projectsResponse.ok) {
            throw new Error(`Todoist API error: ${projectsResponse.status} ${projectsResponse.statusText}`);
        }

        const projects = await projectsResponse.json();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);

        if (!syncProject) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        // Fetch tasks from the "Sync" project only
        const response = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${syncProject.id}`, {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (!response.ok) {
            throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
        }

        const tasks = await response.json();
        const contentGroups = new Map();
        const duplicateGroups = new Map();

        // Group tasks by normalized content
        for (const task of tasks) {
            const normalizedContent = task.content.toLowerCase().trim();

            if (contentGroups.has(normalizedContent)) {
                contentGroups.get(normalizedContent).push(task);
            } else {
                contentGroups.set(normalizedContent, [ task ]);
            }
        }

        // Identify duplicate groups and tasks to delete
        const tasksToDelete = [];
        for (const [ normalizedContent, taskGroup ] of contentGroups.entries()) {
            if (taskGroup.length > 1) {
                // Keep the first task, mark the rest for deletion
                const originalContent = taskGroup[0].content;
                const duplicatesToDelete = taskGroup.slice(1);

                duplicateGroups.set(normalizedContent, {
                    content: originalContent,
                    duplicatesRemoved: duplicatesToDelete.length
                });

                tasksToDelete.push(...duplicatesToDelete);
            }
        }

        if (tasksToDelete.length === 0) {
            console.log('\n✅ No duplicates found in Remote');
            return;
        }

        // Delete duplicate tasks and track results by content
        const deletionResults = new Map();
        for (const task of tasksToDelete) {
            const normalizedContent = task.content.toLowerCase().trim();

            try {
                const deleteResponse = await fetch(`https://api.todoist.com/rest/v2/tasks/${task.id}`, {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Bearer ${TODOIST.API_TOKEN}`
                    }
                });

                if (deleteResponse.ok) {
                    if (!deletionResults.has(normalizedContent)) {
                        deletionResults.set(normalizedContent, {
                            content: task.content,
                            deletedCount: 0,
                            errors: []
                        });
                    }
                    deletionResults.get(normalizedContent).deletedCount++;
                } else {
                    if (!deletionResults.has(normalizedContent)) {
                        deletionResults.set(normalizedContent, {
                            content: task.content,
                            deletedCount: 0,
                            errors: []
                        });
                    }
                    deletionResults.get(normalizedContent).errors.push(`Failed with status ${deleteResponse.status}`);
                }

                // Add small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                if (!deletionResults.has(normalizedContent)) {
                    deletionResults.set(normalizedContent, {
                        content: task.content,
                        deletedCount: 0,
                        errors: []
                    });
                }
                deletionResults.get(normalizedContent).errors.push(error.message);
            }
        }

        // Output results grouped by content
        let totalDeleted = 0;
        for (const [ , result ] of deletionResults) {
            if (result.deletedCount > 0) {
                const plural = result.deletedCount === 1 ? 'duplicate' : 'duplicates';
                console.log(`Removed ${result.deletedCount} ${plural} of: ${result.content}`);
                totalDeleted += result.deletedCount;
            }

            if (result.errors.length > 0) {
                console.error(`❌ Errors deleting "${result.content}": ${result.errors.join(', ')}`);
            }
        }

        console.log(`\n✅ Removed ${totalDeleted} duplicate(s) from Remote`);
    } catch (error) {
        console.error(`❌ Error removing duplicates from Remote: ${error.message}`);
    }
}

export async function executeSync(changes, showLocal, showRemote) {
    const results = {
        success: true,
        summary: '',
        errors: []
    };

    try {
        // Collect all changes for organized output
        const allChanges = [];
        
        // Execute local changes (from Remote to local)
        if (showLocal || (!showLocal && !showRemote)) {
            const localResults = await executeLocalChanges(changes.local, allChanges);
            if (localResults.errors.length > 0) {
                results.errors.push(...localResults.errors);
            }
        }

        // Execute Remote changes (from local to Remote)
        if (showRemote || (!showLocal && !showRemote)) {
            const remoteResults = await executeRemoteChanges(changes.todoist, allChanges);
            if (remoteResults.errors.length > 0) {
                results.errors.push(...remoteResults.errors);
            }
        }

        // Display organized output
        displaySyncResults(allChanges);

        // Check for conflicts
        if (changes.conflicts.length > 0) {
            results.errors.push(`${changes.conflicts.length} conflicts require manual resolution`);
        }

        results.success = results.errors.length === 0;

    } catch (error) {
        results.success = false;
        results.error = error.message;
    }

    return results;
}

function displaySyncResults(allChanges) {
    if (allChanges.length === 0) return;
    
    // Sort changes: Local first, then Remote; New, Updated, Completed, Removed; by priority then task name
    const sortedChanges = allChanges.sort((a, b) => {
        // Sort by location (local first)
        if (a.location !== b.location) {
            return a.location === 'local' ? -1 : 1;
        }
        
        // Sort by action type
        const actionOrder = { 'New': 0, 'Updated': 1, 'Completed': 2, 'Removed': 3 };
        if (a.action !== b.action) {
            return actionOrder[a.action] - actionOrder[b.action];
        }
        
        // Sort by priority
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        
        // Sort by task name
        return a.taskName.localeCompare(b.taskName);
    });
    
    // Display sorted changes
    sortedChanges.forEach(change => {
        const location = change.location === 'local' ? 'local' : 'remote';
        const priority = `P${change.metadata?.priority !== undefined ? change.metadata.priority : change.priority}`;
        const idInfo = change.todoistId ? `, ${change.todoistId}` : '';
        const priorityAndId = `(${priority}${idInfo})`;
        
        if (change.action === 'Updated' && change.oldPriority !== undefined) {
            console.log(`Updated ${location} task: ${change.taskName} ${priorityAndId} -> old priority P${change.oldPriority}`);
        } else if (change.action === 'Updated' && change.updateType === 'id-added') {
            console.log(`Updated ${location} task with ID: ${change.taskName} ${priorityAndId}`);
        } else {
            console.log(`${change.action} ${location} task: ${change.taskName} ${priorityAndId}`);
        }
    });
}

async function executeLocalChanges(localChanges, allChanges = []) {
    const results = {
        totalChanges: 0,
        errors: []
    };

    const localChangeList = [
        ...localChanges.noneToCurrent,
        ...localChanges.noneToCompleted,
        ...localChanges.currentToCompleted,
        ...localChanges.renames
    ];

    if (localChangeList.length === 0) {
        return results;
    }

    try {
        // Apply new current tasks from Remote
        for (const change of localChanges.noneToCurrent) {
            await addTaskToLocalFile(change);
            logSyncOperation('create', 'local', {
                todoistId: change.todoistId,
                content: change.content,
                priority: change.metadata?.priority,
                source: 'todoist'
            });
            const localPriority = change.metadata?.priority !== undefined ? change.metadata.priority : 4;
            allChanges.push({
                action: 'New',
                location: 'local',
                taskName: change.content,
                priority: localPriority,
                todoistId: change.todoistId
            });
            results.totalChanges++;
        }

        // Apply new completed tasks from Remote
        for (const change of localChanges.noneToCompleted) {
            await addCompletedTaskToLocalFile(change);
            allChanges.push({
                action: 'Completed',
                location: 'local',
                taskName: change.content,
                priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                todoistId: change.todoistId
            });
            results.totalChanges++;
        }

        // Mark current tasks as completed
        for (const change of localChanges.currentToCompleted) {
            await markTaskCompletedInLocalFile(change);
            allChanges.push({
                action: 'Completed',
                location: 'local',
                taskName: change.content,
                priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                todoistId: change.todoistId
            });
            results.totalChanges++;
        }

        // Apply renames/priority changes
        for (const change of localChanges.renames) {
            await updateTaskInLocalFile(change);
            if (change.changeType === 'priority_update') {
                allChanges.push({
                    action: 'Updated',
                    location: 'local',
                    taskName: change.content,
                    priority: change.newPriority,
                    oldPriority: change.oldPriority,
                    todoistId: change.todoistId
                });
            } else {
                allChanges.push({
                    action: 'Updated',
                    location: 'local',
                    taskName: change.newContent,
                    priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                    todoistId: change.todoistId
                });
            }
            results.totalChanges++;
        }

    } catch (error) {
        results.errors.push(`Local file update error: ${error.message}`);
    }

    return results;
}

async function executeRemoteChanges(todoistChanges, allChanges = []) {
    const results = {
        totalChanges: 0,
        errors: []
    };

    if (!TODOIST.API_TOKEN) {
        results.errors.push('No Todoist API token configured');
        return results;
    }

    const remoteChangeList = [
        ...todoistChanges.noneToCurrent,
        ...todoistChanges.noneToCompleted,
        ...todoistChanges.currentToCompleted,
        ...todoistChanges.renames
    ];

    if (remoteChangeList.length === 0) {
        return results;
    }

    try {
        // Get project ID first
        const projectId = await getRemoteProjectId();
        if (!projectId) {
            results.errors.push(`Project "${TODOIST.PROJECT_NAME}" not found`);
            return results;
        }

        // Apply new current tasks from local
        for (const change of todoistChanges.noneToCurrent) {
            const result = await createRemoteTask(change, projectId);
            if (result) {
                logSyncOperation('create', 'todoist', {
                    todoistId: result.taskId,
                    content: change.content,
                    priority: change.metadata?.priority,
                    source: 'local'
                });

                await updateLocalTaskWithCorrelationId(change.content, result.taskId);

                allChanges.push({
                    action: 'Updated',
                    location: 'local',
                    taskName: change.content,
                    priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                    todoistId: result.taskId,
                    updateType: 'id-added'
                });

                allChanges.push({
                    action: 'New',
                    location: 'remote',
                    taskName: change.content,
                    priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                    todoistId: result.taskId
                });
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to create task: ${change.content}`);
            }
        }

        // Apply new completed tasks from local
        for (const change of todoistChanges.noneToCompleted) {
            const result = await createRemoteTask(change, projectId, true);
            if (result) {
                allChanges.push({
                    action: 'Completed',
                    location: 'remote',
                    taskName: change.content,
                    priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                    todoistId: result.taskId
                });
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to create completed task: ${change.content}`);
            }
        }

        // Mark current tasks as completed
        for (const change of todoistChanges.currentToCompleted) {
            const success = await completeRemoteTask(change.metadata?.todoistId);
            if (success) {
                allChanges.push({
                    action: 'Completed',
                    location: 'remote',
                    taskName: change.content,
                    priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                    todoistId: change.metadata?.todoistId
                });
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to complete task: ${change.content}`);
            }
        }

        // Apply renames/priority changes
        for (const change of todoistChanges.renames) {
            const success = await updateRemoteTask(change);
            if (success) {
                if (change.changeType === 'priority_update') {
                    logSyncOperation('update', 'todoist', {
                        todoistId: change.todoistId,
                        content: change.content,
                        priority: change.newPriority,
                        oldPriority: change.oldPriority,
                        source: 'local'
                    });
                    allChanges.push({
                        action: 'Updated',
                        location: 'remote',
                        taskName: change.content,
                        priority: change.newPriority,
                        oldPriority: change.oldPriority,
                        todoistId: change.todoistId
                    });
                } else {
                    logSyncOperation('update', 'todoist', {
                        todoistId: change.todoistId,
                        oldContent: change.oldContent,
                        content: change.newContent,
                        source: 'local'
                    });
                    allChanges.push({
                        action: 'Updated',
                        location: 'remote',
                        taskName: change.newContent,
                        priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                        todoistId: change.todoistId
                    });
                }
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to update task: ${change.content}`);
            }
        }

    } catch (error) {
        results.errors.push(`Todoist API error: ${error.message}`);
    }

    return results;
}


async function getRemoteProjectId() {
    try {
        const response = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (!response.ok) {
            throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
        }

        const projects = await response.json();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);
        return syncProject?.id || null;
    } catch (error) {
        console.error('Error getting project ID:', error.message);
        return null;
    }
}

async function updateLocalTaskWithCorrelationId(taskContent, todoistId) {
    const filepath = FILE_PATHS.TASK;

    try {
        // Read the current task file
        const content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');

        // Find the line with the task content (without Todoist ID)
        const cleanTaskContent = stripCorrelationId(taskContent);
        const targetLineIndex = lines.findIndex(line => {
            const cleanLine = stripCorrelationId(line.trim());
            return cleanLine === cleanTaskContent;
        });

        if (targetLineIndex !== -1) {
            // Add Todoist ID to the found line
            const updatedLine = addCorrelationId(lines[targetLineIndex], todoistId);
            lines[targetLineIndex] = updatedLine;

            // Write the updated content back to the file
            writeFileSync(filepath, lines.join('\n'), 'utf8');
        } else {
            console.warn(`  ⚠️  Could not find local task to update with Todoist ID: ${cleanTaskContent}`);
        }
    } catch (error) {
        console.error(`  ❌ Failed to update local task with Todoist ID: ${error.message}`);
        throw error;
    }
}

async function createRemoteTask(task, projectId, isCompleted = false) {
    try {
        const localPriority = task.metadata?.priority !== undefined ? task.metadata.priority : (task.priority !== undefined ? task.priority : 4);
        const priority = mapLocalPriorityToRemote(localPriority);
        const cleanContent = task.content; // Should already be clean

        // Debug logging
        const taskData = {
            content: cleanContent,
            project_id: projectId,
            priority: priority
        };

        // Add due date for priority 0 tasks
        if (localPriority === 0) {
            taskData.due_string = 'today';
        }


        const response = await fetch('https://api.todoist.com/rest/v2/tasks', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });

        if (!response.ok) {
            console.error(`Failed to create task: ${response.status} ${response.statusText}`);
            return null;
        }

        const createdTask = await response.json();

        // If task should be completed, complete it immediately
        if (isCompleted) {
            await completeRemoteTask(createdTask.id);
        }

        return {
            taskId: createdTask.id
        };
    } catch (error) {
        console.error('Error creating Remote task:', error.message);
        return null;
    }
}

async function completeRemoteTask(taskId) {
    try {
        const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}/close`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        return response.ok;
    } catch (error) {
        console.error('Error completing Remote task:', error.message);
        return false;
    }
}

async function updateRemoteTask(change) {
    try {
        const updateData = {};

        if (change.changeType === 'priority_update') {
            updateData.priority = mapLocalPriorityToRemote(change.newPriority);
            // Add/remove due date based on priority
            if (change.newPriority === 0) {
                updateData.due_string = 'today';
            } else if (change.oldPriority === 0 && change.newPriority !== 0) {
                // Remove due date when moving from Priority 0 to any other priority
                updateData.due_string = 'no date';
            }
        } else if (change.newContent) {
            updateData.content = change.newContent;
        }


        const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${change.todoistId}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`❌ API Error: ${response.status} ${response.statusText}`, errorBody);
            return false;
        }

        // Verify the update by fetching the task
        console.log('✅ Update API returned OK, verifying...');
        const verifyResponse = await fetch(`https://api.todoist.com/rest/v2/tasks/${change.todoistId}`, {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (verifyResponse.ok) {
            const updatedTask = await verifyResponse.json();
            console.log(`🔍 Verification: Task priority is now ${updatedTask.priority}`);
            if (change.changeType === 'priority_update') {
                const expectedPriority = mapLocalPriorityToRemote(change.newPriority);
                if (updatedTask.priority === expectedPriority) {
                    console.log('✅ Priority update verified successfully');
                    return true;
                } else {
                    console.error(`❌ Priority verification failed: expected ${expectedPriority}, got ${updatedTask.priority}`);
                    return false;
                }
            }
        } else {
            console.error(`❌ Could not verify update: ${verifyResponse.status}`);
        }

        return true;
    } catch (error) {
        console.error('Error updating Remote task:', error.message);
        return false;
    }
}

function mapLocalPriorityToRemote(localPriority) {
    return PRIORITY_MAPPING.LOCAL_TO_REMOTE[localPriority] || 1;
}

async function addTaskToLocalFile(task) {
    const filepath = FILE_PATHS.TASK;
    const priority = task.metadata?.priority !== undefined ? task.metadata.priority : 4;

    try {
        let content = '';
        if (existsSync(filepath)) {
            content = readFileSync(filepath, 'utf8');
        }

        // Add Todoist ID for new task if it's from Remote
        let taskContentWithCorr = task.content;

        // Check both task.id and task.todoistId (the actual field used)
        const todoistId = task.id || task.todoistId;
        if (todoistId) {
            taskContentWithCorr = addCorrelationId(task.content, todoistId);
        }

        const newTaskLine = `${taskContentWithCorr}\n`;
        const priorityHeader = `Priority ${priority}`;

        if (content.includes(priorityHeader)) {
            // Find the priority section and add the task
            const lines = content.split('\n');
            const newLines = [];
            let inCorrectSection = false;
            let sectionEnded = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.startsWith('Priority ')) {
                    if (line.startsWith(priorityHeader)) {
                        inCorrectSection = true;
                        sectionEnded = false;
                    } else if (inCorrectSection) {
                        // We've hit a different priority section, add our task before this
                        newLines.push(newTaskLine.trim());
                        inCorrectSection = false;
                        sectionEnded = true;
                    }
                }

                newLines.push(line);

                // If we're in the correct section and hit the separator, add after it
                if (inCorrectSection && line.includes('---')) {
                    newLines.push(newTaskLine.trim());
                    inCorrectSection = false;
                    sectionEnded = true;
                }
            }

            // If we were still in the section at the end, add the task
            if (inCorrectSection && !sectionEnded) {
                newLines.push(newTaskLine.trim());
            }

            content = newLines.join('\n');
        } else {
            // Create new priority section
            if (content && !content.endsWith('\n')) {
                content += '\n';
            }
            content += `\n${priorityHeader}\n`;
            content += '-------------------------------------------------------------------------------\n';
            content += newTaskLine;
        }

        writeFileSync(filepath, content, 'utf8');
        return task.id || null;
    } catch (error) {
        throw new Error(`Failed to add task to local file: ${error.message}`);
    }
}

async function addCompletedTaskToLocalFile(task) {
    const filepath = FILE_PATHS.COMPLETED;

    try {
        let content = '';
        if (existsSync(filepath)) {
            content = readFileSync(filepath, 'utf8');
        }

        let taskContent = task.content;

        // Check if the task content already has a completion date
        if (!taskContent.includes('(completed:')) {
            const completedDate = task.metadata?.completed ?
                new Date(task.metadata.completed).toLocaleDateString() :
                new Date().toLocaleDateString();

            taskContent = `${taskContent} (completed: ${completedDate})`;
        } else {
            // Task already has completion date(s), clean up any duplicates
            taskContent = removeDuplicateCompletionDates(taskContent);
        }

        // Check if this exact completed task already exists to prevent duplicates
        const normalizedContent = taskContent.toLowerCase().trim();
        const existingLines = content.split('\n');
        const alreadyExists = existingLines.some(line =>
            line.toLowerCase().trim() === normalizedContent
        );

        if (alreadyExists) {
            // Task already exists in completed file, skip adding
            return;
        }

        const newTaskLine = `${taskContent}\n`;

        if (content && !content.endsWith('\n')) {
            content += '\n';
        }
        content += newTaskLine;

        writeFileSync(filepath, content, 'utf8');
    } catch (error) {
        throw new Error(`Failed to add completed task to local file: ${error.message}`);
    }
}

async function markTaskCompletedInLocalFile(task) {
    const currentFilepath = FILE_PATHS.TASK;
    const completedFilepath = FILE_PATHS.COMPLETED;

    try {
        // Remove from current file
        if (existsSync(currentFilepath)) {
            const content = readFileSync(currentFilepath, 'utf8');
            const lines = content.split('\n');
            const filteredLines = lines.filter(line => {
                const cleanLine = line.trim().toLowerCase();
                const cleanTaskContent = task.content.toLowerCase().trim();
                return !cleanLine.includes(cleanTaskContent);
            });
            writeFileSync(currentFilepath, filteredLines.join('\n'), 'utf8');
        }

        // Add to completed file
        await addCompletedTaskToLocalFile(task);
    } catch (error) {
        throw new Error(`Failed to mark task completed in local file: ${error.message}`);
    }
}

async function updateTaskInLocalFile(change) {
    const filepath = FILE_PATHS.TASK;

    try {
        if (!existsSync(filepath)) {
            throw new Error('Local task file does not exist');
        }

        const content = readFileSync(filepath, 'utf8');
        let newContent = content;

        if (change.changeType === 'priority_update') {
            // Move task to different priority section and add correlation ID
            const lines = content.split('\n');
            const taskContent = change.content;
            let taskLine = null;
            let taskLineIndex = -1;

            // Find and remove the task from current location
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.toLowerCase().includes(taskContent.toLowerCase())) {
                    taskLine = lines[i];
                    taskLineIndex = i;
                    break;
                }
            }

            if (taskLine && taskLineIndex >= 0) {
                // Remove from current location
                lines.splice(taskLineIndex, 1);

                // Add Todoist ID if not present and we have one
                let updatedTaskLine = taskLine;
                if (change.corrId && !extractCorrelationId(taskLine)) {
                    const cleanContent = stripCorrelationId(taskLine.trim());
                    updatedTaskLine = addCorrelationId(cleanContent, change.corrId);
                }

                // Add to new priority section
                const newPriorityHeader = `Priority ${change.newPriority}`;
                let inserted = false;

                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith(newPriorityHeader)) {
                        // Find the separator line and insert after it
                        for (let j = i + 1; j < lines.length; j++) {
                            if (lines[j].includes('---')) {
                                lines.splice(j + 1, 0, updatedTaskLine);
                                inserted = true;
                                break;
                            }
                        }
                        break;
                    }
                }

                // If priority section doesn't exist, create it
                if (!inserted) {
                    lines.push('');
                    lines.push(newPriorityHeader);
                    lines.push('-------------------------------------------------------------------------------');
                    lines.push(updatedTaskLine);
                }

                newContent = lines.join('\n');
            }
        } else {
            // Content rename
            newContent = content.replace(change.oldContent, change.newContent);
        }

        writeFileSync(filepath, newContent, 'utf8');
    } catch (error) {
        throw new Error(`Failed to update task in local file: ${error.message}`);
    }
}


export async function createBackup() {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
                     (now.getMonth() + 1).toString().padStart(2, '0') +
                     now.getDate().toString().padStart(2, '0') + '.' +
                     now.getHours().toString().padStart(2, '0') +
                     now.getMinutes().toString().padStart(2, '0') +
                     now.getSeconds().toString().padStart(2, '0');
    const backupDir = join(dirname(FILE_PATHS.TASK), '.tasks', 'backups', timestamp);

    try {
        // Create backup directory
        mkdirSync(backupDir, { recursive: true });

        // Backup local files
        await backupLocalFiles(backupDir);

        // Backup remote data
        await backupRemoteData(backupDir);

        console.log(`Created backup ${backupDir.split('/').slice(-2).join('/')}`);
        return { success: true, backupDir, timestamp };

    } catch (error) {
        console.error(`❌ Backup failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function backupLocalFiles(backupDir) {
    // Import FILE_PATHS from constants
    const { FILE_PATHS } = await import('./src/config/constants.js');

    // Backup current tasks
    const currentTaskPath = FILE_PATHS.TASK;
    if (existsSync(currentTaskPath)) {
        const currentContent = readFileSync(currentTaskPath, 'utf8');
        const currentData = parseLocalTaskContent(currentContent);
        const yamlContent = yaml.dump(currentData, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'local.current.yaml'), yamlContent);
        
        // Also backup the raw current.tasks file
        const rawTasksBackupPath = join(backupDir, 'current.tasks');
        writeFileSync(rawTasksBackupPath, currentContent);
    }

    // Backup completed tasks
    const completedTaskPath = FILE_PATHS.COMPLETED;
    if (existsSync(completedTaskPath)) {
        const completedContent = readFileSync(completedTaskPath, 'utf8');
        const completedData = parseLocalTaskContent(completedContent);
        const yamlContent = yaml.dump(completedData, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'local.completed.yaml'), yamlContent);
    }

}

function parseLocalTaskContent(content) {
    const sections = [];
    const lines = content.split('\n');
    let currentSection = null;

    for (const line of lines) {
        if (line.startsWith('Priority ')) {
            if (currentSection) {
                sections.push(currentSection);
            }
            currentSection = {
                priority: line.replace('Priority ', ''),
                tasks: []
            };
        } else if (line.startsWith('-----')) {
            // Skip separator lines
            continue;
        } else if (line.trim() && currentSection) {
            currentSection.tasks.push(line);
        }
    }

    if (currentSection) {
        sections.push(currentSection);
    }

    return { sections, raw: content };
}

async function backupRemoteData(backupDir) {
    if (!TODOIST.API_TOKEN) {
        console.log('⚠️  No Todoist API token - skipping remote backup');
        return;
    }

    try {
        // Get project info
        const projectsResponse = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (!projectsResponse.ok) {
            throw new Error(`Failed to fetch projects: ${projectsResponse.status}`);
        }

        const projects = await projectsResponse.json();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);

        if (!syncProject) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        // Save project info as YAML
        const projectYaml = yaml.dump(syncProject, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'remote.project-info.yaml'), projectYaml);

        // Backup current tasks
        const tasksResponse = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${syncProject.id}`, {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (tasksResponse.ok) {
            const tasks = await tasksResponse.json();
            const todoFormatData = convertRemoteToTaskFormat(tasks);
            const yamlContent = yaml.dump(todoFormatData, { indent: 2, lineWidth: 120 });
            writeFileSync(join(backupDir, 'remote.current.yaml'), yamlContent);
        }

        // Backup completed tasks
        const completedResponse = await fetch('https://api.todoist.com/sync/v9/completed/get_all', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `project_id=${syncProject.id}&limit=200`
        });

        if (completedResponse.ok) {
            const completedData = await completedResponse.json();
            const completedYaml = yaml.dump(completedData, { indent: 2, lineWidth: 120 });
            writeFileSync(join(backupDir, 'remote.completed.yaml'), completedYaml);
        }

    } catch (error) {
        throw new Error(`Remote backup failed: ${error.message}`);
    }
}

function convertRemoteToTaskFormat(todoistTasks) {
    // Map Remote priorities to local priorities
    function mapRemotePriorityToLocal(todoistPriority) {
        return PRIORITY_MAPPING.REMOTE_TO_LOCAL[todoistPriority] || 4;
    }

    // Group tasks by priority
    const tasksByPriority = {};

    for (const task of todoistTasks) {
        const localPriority = mapRemotePriorityToLocal(task.priority);

        if (!tasksByPriority[localPriority]) {
            tasksByPriority[localPriority] = [];
        }

        // Format task content (include Todoist ID for correlation)
        const taskContent = `${task.content} (${task.id})`;
        tasksByPriority[localPriority].push(taskContent);
    }

    // Create sections in priority order
    const sections = [];
    const priorities = Object.keys(tasksByPriority).sort((a, b) => parseInt(a) - parseInt(b));

    for (const priority of priorities) {
        sections.push({
            priority: priority,
            tasks: tasksByPriority[priority]
        });
    }

    // Also create a raw format that matches .tasks file structure
    let rawContent = '';
    for (const priority of priorities) {
        rawContent += `Priority ${priority}\n`;
        rawContent += '-------------------------------------------------------------------------------\n';
        for (const task of tasksByPriority[priority]) {
            rawContent += `${task}\n`;
        }
        rawContent += '\n';
    }

    return {
        sections,
        raw: rawContent.trim(),
        totalTasks: todoistTasks.length,
        source: 'todoist'
    };
}

// Task creation functions
export async function createLocalTask(content, priority = 4) {
    try {
        const filepath = FILE_PATHS.TASK;
        let fileContent = '';

        // Read existing content if file exists
        if (existsSync(filepath)) {
            fileContent = readFileSync(filepath, 'utf8');
        }

        // Find the appropriate priority section
        const lines = fileContent.split('\n');
        const prioritySection = `Priority ${priority}`;
        const separator = '-------------------------------------------------------------------------------';

        let insertIndex = -1;
        let foundPrioritySection = false;

        // Look for the priority section
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === prioritySection) {
                foundPrioritySection = true;
                // Find where to insert after the separator
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].includes('---')) {
                        insertIndex = j + 1;
                        break;
                    }
                }
                break;
            }
        }

        if (!foundPrioritySection) {
            // Need to create the priority section
            if (fileContent.trim()) {
                fileContent += '\n\n';
            }
            fileContent += `${prioritySection}\n${separator}\n${content}\n`;
        } else {
            // Insert into existing section
            lines.splice(insertIndex, 0, content);
            fileContent = lines.join('\n');
        }

        writeFileSync(filepath, fileContent);
        console.log(`✅ Created local task: "${content}" (Priority ${priority})`);
        return true;
    } catch (error) {
        console.error('❌ Failed to create local task:', error.message);
        return false;
    }
}

// Shared task operations using TodoistAPI
async function getProjectId() {
    const projects = await todoistAPI.getProjects();
    const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);

    if (!syncProject) {
        throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
    }

    return syncProject.id;
}

async function ensureProjectExists(projectName, apiToken) {
    const api = new TodoistAPI(apiToken);
    const projects = await api.getProjects();
    const existingProject = projects.find(p => p.name === projectName);

    if (existingProject) {
        return existingProject;
    }

    console.log(`📋 Creating Todoist project: ${projectName}`);
    const newProject = await api.createProject(projectName);
    console.log(`✅ Created project: ${projectName} (ID: ${newProject.id})`);
    return newProject;
}

function buildTaskData(content, priority, projectId) {
    const taskData = {
        content: content,
        project_id: projectId,
        priority: mapLocalPriorityToRemote(priority)
    };

    // Add due date for priority 0 tasks
    if (priority === 0) {
        taskData.due_string = 'today';
    }

    return taskData;
}

export async function createRemoteTaskByContent(content, priority = 4) {
    try {
        if (!TODOIST.API_TOKEN) {
            console.error('❌ No Todoist API token configured');
            return false;
        }

        const projectId = await getProjectId();
        const taskData = buildTaskData(content, priority, projectId);

        const newTask = await todoistAPI.createTask(taskData);
        console.log(`✅ Created remote task: "${content}" (Priority ${priority}, Todoist ID: ${newTask.id})`);
        return true;
    } catch (error) {
        console.error('❌ Failed to create remote task:', error.message);
        return false;
    }
}

// Task update functions
export async function updateLocalTask(taskName, options) {
    try {
        const filepath = FILE_PATHS.TASK;

        if (!existsSync(filepath)) {
            console.error('❌ Local task file not found');
            return false;
        }

        let content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        let taskFound = false;
        let currentPriority = null;

        // Find the task
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Track current priority section
            if (line.startsWith('Priority ')) {
                const match = line.match(/Priority (\d+)/);
                if (match) {
                    currentPriority = parseInt(match[1]);
                }
                continue;
            }

            // Skip separators and empty lines
            if (line.includes('---') || !line) {
                continue;
            }

            // Check if this line contains our task
            const cleanLine = stripCorrelationId(line).trim();
            if (cleanLine.toLowerCase().includes(taskName.toLowerCase())) {
                taskFound = true;

                if (options.priority !== undefined) {
                    const newPriority = parseInt(options.priority);

                    // If changing priority, need to move task
                    if (newPriority !== currentPriority) {
                        // Remove from current location
                        lines.splice(i, 1);

                        // Add to new priority section
                        const corrId = extractCorrelationId(lines[i] || line);
                        const taskContent = corrId ? addCorrelationId(cleanLine, corrId) : cleanLine;

                        // Insert into new priority section
                        await insertTaskIntoPrioritySection(lines, taskContent, newPriority);
                        console.log(`✅ Moved local task "${taskName}" from Priority ${currentPriority} to Priority ${newPriority}`);
                    } else {
                        console.log(`ℹ️  Local task "${taskName}" already at Priority ${newPriority}`);
                    }
                }

                if (options.dueDate) {
                    // Toggle due date for local means toggle between P0 and P1
                    if (currentPriority === 0) {
                        // Move from P0 to P1 (remove due date)
                        lines.splice(i, 1);
                        const corrId = extractCorrelationId(line);
                        const taskContent = corrId ? addCorrelationId(cleanLine, corrId) : cleanLine;
                        await insertTaskIntoPrioritySection(lines, taskContent, 1);
                        console.log(`✅ Removed due date from local task "${taskName}" (moved from P0 to P1)`);
                    } else {
                        // Move to P0 (add due date)
                        lines.splice(i, 1);
                        const corrId = extractCorrelationId(line);
                        const taskContent = corrId ? addCorrelationId(cleanLine, corrId) : cleanLine;
                        await insertTaskIntoPrioritySection(lines, taskContent, 0);
                        console.log(`✅ Added due date to local task "${taskName}" (moved to P0)`);
                    }
                }

                break;
            }
        }

        if (!taskFound) {
            console.error(`❌ Local task "${taskName}" not found`);
            return false;
        }

        writeFileSync(filepath, lines.join('\n'));
        return true;

    } catch (error) {
        console.error('❌ Failed to update local task:', error.message);
        return false;
    }
}

export async function updateRemoteTaskByName(taskName, options) {
    try {
        if (!TODOIST.API_TOKEN) {
            console.error('❌ No Todoist API token configured');
            return false;
        }

        // Find the task first
        const remoteData = await getTasks('remote');
        let targetTask = null;

        for (const task of remoteData.current.tasks) {
            if (task.content.toLowerCase().includes(taskName.toLowerCase())) {
                targetTask = task;
                break;
            }
        }

        if (!targetTask) {
            console.error(`❌ Remote task "${taskName}" not found`);
            return false;
        }

        let updateData = {};

        if (options.priority !== undefined) {
            const newPriority = parseInt(options.priority);
            const todoistPriority = mapLocalPriorityToRemote(newPriority);
            updateData.priority = todoistPriority;

            // Handle due date for P0
            if (newPriority === 0) {
                updateData.due_string = 'today';
            } else if (targetTask.due && newPriority !== 0) {
                // Remove due date if not P0
                updateData.due_string = null;
            }
        }

        if (options.dueDate) {
            // Toggle due date for remote
            if (targetTask.due) {
                // Remove due date (P1 with due -> P1 without due)
                updateData.due_string = null;
                if (targetTask.priority === 4) { // If it was P0/P1, keep as P1
                    updateData.priority = 4; // Todoist P4 = Local P1
                }
                console.log(`✅ Removing due date from remote task "${taskName}"`);
            } else {
                // Add due date (P1 -> P1 with due date)
                updateData.due_string = 'today';
                updateData.priority = 4; // Ensure it's P1 priority
                console.log(`✅ Adding due date to remote task "${taskName}"`);
            }
        }

        const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${targetTask.id}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateData)
        });

        if (response.ok) {
            console.log(`✅ Updated remote task: "${taskName}"`);
            return true;
        } else {
            console.error(`❌ Failed to update remote task: ${response.status} ${response.statusText}`);
            return false;
        }

    } catch (error) {
        console.error('❌ Failed to update remote task:', error.message);
        return false;
    }
}

// Task completion functions
export async function completeLocalTask(taskName) {
    try {
        const filepath = FILE_PATHS.TASK;
        const completedFilepath = FILE_PATHS.COMPLETED;

        if (!existsSync(filepath)) {
            console.error('❌ Local task file not found');
            return false;
        }

        let content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        let taskFound = false;
        let taskLine = '';

        // Find and remove the task
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip headers and separators
            if (line.startsWith('Priority ') || line.includes('---') || !line) {
                continue;
            }

            const cleanLine = stripCorrelationId(line).trim();
            if (cleanLine.toLowerCase().includes(taskName.toLowerCase())) {
                taskFound = true;
                taskLine = line;
                lines.splice(i, 1);
                break;
            }
        }

        if (!taskFound) {
            console.error(`❌ Local task "${taskName}" not found`);
            return false;
        }

        // Write updated task file
        writeFileSync(filepath, lines.join('\n'));

        // Add to completed file with timestamp
        const completedDate = new Date().toISOString().split('T')[0];
        const completedTask = `${taskLine.trim()} (completed: ${completedDate})`;

        let completedContent = '';
        if (existsSync(completedFilepath)) {
            completedContent = readFileSync(completedFilepath, 'utf8');
        }

        // Add to completed section
        if (completedContent.includes('Completed')) {
            completedContent += `\n${completedTask}`;
        } else {
            completedContent = `Completed\n-------------------------------------------------------------------------------\n${completedTask}${completedContent ? '\n' + completedContent : ''}`;
        }

        writeFileSync(completedFilepath, completedContent);
        console.log(`✅ Completed local task: "${taskName}"`);
        return true;

    } catch (error) {
        console.error('❌ Failed to complete local task:', error.message);
        return false;
    }
}

export async function completeRemoteTaskByName(taskName) {
    try {
        if (!TODOIST.API_TOKEN) {
            console.error('❌ No Todoist API token configured');
            return false;
        }

        // Find the task first
        const remoteData = await getTasks('remote');
        let targetTask = null;

        for (const task of remoteData.current.tasks) {
            if (task.content.toLowerCase().includes(taskName.toLowerCase())) {
                targetTask = task;
                break;
            }
        }

        if (!targetTask) {
            console.error(`❌ Remote task "${taskName}" not found`);
            return false;
        }

        const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${targetTask.id}/close`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (response.ok) {
            console.log(`✅ Completed remote task: "${taskName}"`);
            return true;
        } else {
            console.error(`❌ Failed to complete remote task: ${response.status} ${response.statusText}`);
            return false;
        }

    } catch (error) {
        console.error('❌ Failed to complete remote task:', error.message);
        return false;
    }
}

// Task cancellation functions
export async function cancelLocalTask(taskName) {
    try {
        const filepath = FILE_PATHS.TASK;

        if (!existsSync(filepath)) {
            console.error('❌ Local task file not found');
            return false;
        }

        let content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        let taskFound = false;

        // Find and remove the task
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip headers and separators
            if (line.startsWith('Priority ') || line.includes('---') || !line) {
                continue;
            }

            const cleanLine = stripCorrelationId(line).trim();
            if (cleanLine.toLowerCase().includes(taskName.toLowerCase())) {
                taskFound = true;
                lines.splice(i, 1);
                console.log(`✅ Cancelled local task: "${taskName}"`);
                break;
            }
        }

        if (!taskFound) {
            console.error(`❌ Local task "${taskName}" not found`);
            return false;
        }

        // Write updated file
        writeFileSync(filepath, lines.join('\n'));
        return true;

    } catch (error) {
        console.error('❌ Failed to cancel local task:', error.message);
        return false;
    }
}

export async function cancelRemoteTask(taskName) {
    try {
        if (!TODOIST.API_TOKEN) {
            console.error('❌ No Todoist API token configured');
            return false;
        }

        // Find the task first
        const remoteData = await getTasks('remote');
        let targetTask = null;

        for (const task of remoteData.current.tasks) {
            if (task.content.toLowerCase().includes(taskName.toLowerCase())) {
                targetTask = task;
                break;
            }
        }

        if (!targetTask) {
            console.error(`❌ Remote task "${taskName}" not found`);
            return false;
        }

        const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${targetTask.id}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (response.ok) {
            console.log(`✅ Cancelled remote task: "${taskName}"`);
            return true;
        } else {
            console.error(`❌ Failed to cancel remote task: ${response.status} ${response.statusText}`);
            return false;
        }

    } catch (error) {
        console.error('❌ Failed to cancel remote task:', error.message);
        return false;
    }
}

// Helper function to insert task into priority section
async function insertTaskIntoPrioritySection(lines, taskContent, priority) {
    const prioritySection = `Priority ${priority}`;
    const separator = '-------------------------------------------------------------------------------';

    let insertIndex = -1;
    let foundPrioritySection = false;

    // Look for the priority section
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === prioritySection) {
            foundPrioritySection = true;
            // Find where to insert after the separator
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].includes('---')) {
                    insertIndex = j + 1;
                    break;
                }
            }
            break;
        }
    }

    if (!foundPrioritySection) {
        // Need to create the priority section
        lines.push('', prioritySection, separator, taskContent);
    } else {
        // Insert into existing section
        lines.splice(insertIndex, 0, taskContent);
    }
}

export function categorizeChanges(localTasks, todoistTasks, legacySyncState = null, previewMode = false) {
    // Simplified logic using direct Todoist IDs
    const changes = {
        local: {
            noneToCurrent: [],
            noneToCompleted: [],
            currentToCompleted: [],
            currentToNone: [],
            completedToCurrent: [],
            renames: []
        },
        todoist: {
            noneToCurrent: [],
            noneToCompleted: [],
            currentToCompleted: [],
            currentToNone: [],
            completedToCurrent: [],
            renames: []
        },
        conflicts: [],
        potentialRenames: []
    };

    const processedTodoistIds = new Set();
    const uncorrelatedLocal = [];
    const uncorrelatedTodoist = [];

    for (const localTask of localTasks.current.tasks) {
        const todoistId = extractCorrelationId(localTask.content);

        if (todoistId) {
            const todoistTask = todoistTasks.current.tasks.find(t => t.id === parseInt(todoistId));

            if (todoistTask) {
                const cleanLocalContent = stripCorrelationId(localTask.content);

                // Simple content comparison - if different, it's a conflict to resolve
                if (cleanLocalContent.toLowerCase().trim() !== todoistTask.content.toLowerCase().trim()) {
                    // Content changed - check priority too
                    const localPriority = localTask.priority !== undefined ? localTask.priority : 'unknown';
                    const todoistPriority = mapRemotePriority(todoistTask);

                    if (localPriority !== todoistPriority) {
                        // Both content and priority differ - conflict
                        changes.conflicts.push({
                            corrId: todoistId,
                            localTask: { ...localTask, content: cleanLocalContent },
                            todoistTask,
                            correlation: { todoistId: parseInt(todoistId) }
                        });
                    } else {
                        // Content differs but priority same - update Todoist content
                        changes.todoist.renames.push({
                            corrId: todoistId,
                            oldContent: todoistTask.content,
                            newContent: cleanLocalContent,
                            todoistId: parseInt(todoistId)
                        });
                    }
                } else {
                    // Content same - check priority
                    const localPriority = localTask.priority !== undefined ? localTask.priority : 'unknown';
                    const todoistPriority = mapRemotePriority(todoistTask);

                    if (localPriority !== todoistPriority) {
                        // Priority mismatch - local wins
                        changes.todoist.renames.push({
                            content: cleanLocalContent,
                            oldPriority: todoistPriority,
                            newPriority: localPriority,
                            changeType: 'priority_update',
                            todoistId: parseInt(todoistId),
                            corrId: todoistId
                        });
                    }
                }

                processedTodoistIds.add(parseInt(todoistId));
            } else {
                // Local task has Todoist ID but Todoist task not found (deleted remotely)
                uncorrelatedLocal.push(localTask); // Content is already clean
            }
        } else {
            uncorrelatedLocal.push(localTask);
        }
    }

    for (const todoistTask of todoistTasks.current.tasks) {
        if (!processedTodoistIds.has(todoistTask.id)) {
            uncorrelatedTodoist.push(todoistTask);
        }
    }

    // Cross-match uncorrelated tasks to find exact content matches (potential priority changes)
    const localTasksToSync = [];
    const todoistTasksToSync = [];
    const exactMatches = [];

    for (const localTask of uncorrelatedLocal) {
        const cleanLocalContent = localTask.content; // Already clean from parsing

        // Look for exact content match in uncorrelated Todoist tasks
        const exactMatch = uncorrelatedTodoist.find(todoistTask => {
            const cleanTodoistContent = todoistTask.content.trim();
            return cleanLocalContent.toLowerCase().trim() === cleanTodoistContent.toLowerCase().trim();
        });

        if (exactMatch) {
            const localPriority = localTask.priority !== undefined ? localTask.priority : 'unknown';
            const todoistPriority = mapRemotePriority(exactMatch);

            if (localPriority !== todoistPriority) {
                // Priority mismatch - treat as priority change
                exactMatches.push({
                    localTask,
                    todoistTask: exactMatch,
                    type: 'priority_change',
                    localPriority,
                    todoistPriority
                });
            } else {
                // Same content and priority - likely a sync correlation issue, treat as already synced
                exactMatches.push({
                    localTask,
                    todoistTask: exactMatch,
                    type: 'already_synced'
                });
            }
        } else {
            localTasksToSync.push(localTask);
        }
    }

    for (const todoistTask of uncorrelatedTodoist) {
        const cleanTodoistContent = todoistTask.content.trim();

        // Check if this task was already matched
        const alreadyMatched = exactMatches.some(match =>
            match.todoistTask.content.toLowerCase().trim() === cleanTodoistContent.toLowerCase().trim()
        );

        if (!alreadyMatched) {
            todoistTasksToSync.push(todoistTask);
        }
    }

    // Handle exact matches
    for (const match of exactMatches) {
        if (match.type === 'priority_change') {
            // Always favor local priority over remote
            const resolution = { winner: 'local', reason: 'local_always_wins' };

            // Use Todoist ID directly as correlation ID
            const corrId = match.todoistTask?.id?.toString() || 'unknown';

            // Local priority always wins - update Todoist
            changes.todoist.renames.push({
                content: match.localTask.content, // Already clean from parsing
                oldPriority: match.todoistPriority,
                newPriority: match.localPriority,
                changeType: 'priority_update',
                reason: resolution.reason,
                todoistId: match.todoistTask.id,
                corrId: corrId,
                metadata: {
                    priority: match.localPriority,
                    source: 'local',
                    isAutomaticResolution: true,
                    resolutionReason: resolution.reason
                }
            });
        }
        // For 'already_synced', we don't add them to changes (no action needed)
    }

    // Process remaining unmatched tasks - no content similarity matching needed
    for (const localTask of localTasksToSync) {
        changes.todoist.noneToCurrent.push({
            ...localTask,
            stateTransition: 'none→current',
            metadata: {
                priority: localTask.priority !== undefined ? localTask.priority : 'unknown',
                source: 'local',
                isNew: true
            }
        });
    }

    for (const todoistTask of todoistTasksToSync) {
        changes.local.noneToCurrent.push({
            ...todoistTask,
            stateTransition: 'none→current',
            metadata: {
                priority: mapRemotePriority(todoistTask),
                source: 'todoist',
                isNew: true,
                created: todoistTask.created
            }
        });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Track processed local completed tasks to avoid duplicates
    const processedLocalContent = new Set();

    for (const localCompleted of localTasks.completed.tasks) {
        // Skip invalid entries (separators, empty content, etc.)
        let cleanContent = localCompleted.content ? localCompleted.content.trim() : '';

        // Skip entries that are separators, empty, or contain only dashes
        if (!cleanContent ||
            cleanContent.includes('---') ||
            cleanContent.match(/^-+$/) ||
            cleanContent.length < 3) {
            continue;
        }

        // Remove the "- " prefix if it exists (these shouldn't be in completed file)
        cleanContent = cleanContent.replace(/^-\s+/, '').trim();

        // Skip if still empty after cleaning
        if (!cleanContent) {
            continue;
        }

        // Skip if we've already processed this content
        const normalizedLocalContent = cleanContent.toLowerCase().trim();
        if (processedLocalContent.has(normalizedLocalContent)) {
            continue;
        }
        processedLocalContent.add(normalizedLocalContent);

        const todoistId = localCompleted.todoistId;

        if (!todoistId) {
            // Check if this completion already exists in Todoist completed tasks
            const alreadyExistsInTodoist = todoistTasks.completed.tasks.some(todoistTask => {
                const todoistCleanContent = stripCorrelationId(todoistTask.content).toLowerCase().trim();
                return todoistCleanContent === normalizedLocalContent;
            });

            if (!alreadyExistsInTodoist) {
                changes.todoist.noneToCompleted.push({
                    content: cleanContent,
                    priority: localCompleted.priority,
                    stateTransition: 'none→completed',
                    metadata: {
                        priority: localCompleted.priority || 'unknown',
                        source: 'local',
                        isNew: true,
                        wasDirectlyCompleted: true
                    }
                });
            }
        } else {
            // Task was previously current, now completed
            changes.todoist.currentToCompleted.push({
                content: cleanContent,
                corrId: todoistId,
                stateTransition: 'current→completed',
                metadata: {
                    priority: localCompleted.priority || 'unknown',
                    source: 'local',
                    wasCurrentTask: true,
                    todoistId: parseInt(todoistId)
                }
            });
        }
    }

    // Track processed Todoist completed tasks to avoid duplicates
    const processedTodoistContent = new Set();

    for (const todoistCompleted of todoistTasks.completed.tasks) {
        if (new Date(todoistCompleted.completed) > thirtyDaysAgo) {
            // Clean the content and check for duplicates
            let cleanContent = stripCorrelationId(todoistCompleted.content);
            cleanContent = cleanContent.replace(/\s*\(completed:.*?\)$/, '').trim();

            // Skip invalid entries (separators, empty content, etc.)
            if (!cleanContent ||
                cleanContent.includes('---') ||
                cleanContent.match(/^-+$/) ||
                cleanContent.length < 3) {
                continue;
            }

            // Remove the "- " prefix if it exists
            cleanContent = cleanContent.replace(/^-\s+/, '').trim();

            // Skip if still empty after cleaning
            if (!cleanContent) {
                continue;
            }

            // Skip if we've already processed this content
            const normalizedContent = cleanContent.toLowerCase().trim();
            if (processedTodoistContent.has(normalizedContent)) {
                continue;
            }
            processedTodoistContent.add(normalizedContent);

            // Check if this task exists in local todos with the same Todoist ID
            const hasLocalCorrelation = localTasks.current.tasks.some(localTask => {
                return localTask.todoistId && parseInt(localTask.todoistId) === todoistCompleted.id;
            });

            if (!hasLocalCorrelation) {
                // Check if this completion already exists in local completed tasks
                const alreadyExistsInLocal = localTasks.completed.tasks.some(localTask => {
                    // Remove completion date from local task (content is already clean)
                    let localCleanContent = localTask.content || '';
                    localCleanContent = localCleanContent.replace(/\s*\(completed:.*?\)$/, '').replace(/^-\s+/, '').toLowerCase().trim();
                    return localCleanContent === normalizedContent;
                });

                if (!alreadyExistsInLocal) {
                    changes.local.noneToCompleted.push({
                        ...todoistCompleted,
                        content: cleanContent,
                        stateTransition: 'none→completed',
                        metadata: {
                            priority: mapRemotePriority(todoistCompleted),
                            source: 'todoist',
                            isNew: true,
                            wasDirectlyCompleted: true,
                            completed: todoistCompleted.completed
                        }
                    });
                }
            } else {
                // Task was previously current, now completed
                changes.local.currentToCompleted.push({
                    ...todoistCompleted,
                    content: cleanContent,
                    stateTransition: 'current→completed',
                    metadata: {
                        priority: mapRemotePriority(todoistCompleted),
                        source: 'todoist',
                        wasCurrentTask: true,
                        completed: todoistCompleted.completed,
                        corrId: todoistCompleted?.id?.toString() || 'unknown'
                    }
                });
            }
        }
    }

    return changes;
}

export { ensureProjectExists };
