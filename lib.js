import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import {
    extractCorrelationId,
    stripCorrelationId,
    addCorrelationId,
    logSyncOperation
} from './taskLog.js';

// Load environment variables from .env file
// Temporarily suppress dotenv console output
const originalConsoleLog = console.log;
console.log = () => {};
dotenv.config();
console.log = originalConsoleLog;

// Configuration
const config = {
    todoist: {
        apiToken: process.env.TODOIST_API_TOKEN || '',
        projectName: process.env.TODOIST_PROJECT_NAME || 'Sync'
    },
    local: {
        todoDir: process.env.TODO_DIR || homedir()
    }
};

// Helper function to get todo file path
function getTodoFilePath(filename = '.tasks') {
    return join(config.local.todoDir, filename);
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

function parseLocalTasks(filename = '.tasks') {
    const filepath = getTodoFilePath(filename);

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

            // Skip empty lines
            if (!trimmedLine) {
                continue;
            }

            // Check for priority section headers
            if (trimmedLine.startsWith('Priority ')) {
                const match = trimmedLine.match(/Priority (\d+)/);
                if (match) {
                    currentPriority = parseInt(match[1]);
                    currentParentTask = null; // Reset parent when entering new priority section
                }
                continue;
            }

            // Skip separator lines
            if (trimmedLine.includes('---')) {
                continue;
            }

            // Check if this is a subtask (starts with -)
            if (trimmedLine.startsWith('- ')) {
                if (currentParentTask) {
                    // This is a subtask
                    const subtaskContent = trimmedLine.substring(2).trim(); // Remove "- " prefix
                    const cleanSubtaskContent = cleanTaskContent(subtaskContent);
                    const subtaskTodoistId = extractCorrelationId(subtaskContent);
                    const subtaskName = stripCorrelationId(cleanSubtaskContent);
                    const subtask = {
                        content: subtaskName, // Clean subtask name without ID
                        todoistId: subtaskTodoistId, // Separate Todoist ID property
                        priority: currentPriority !== null ? currentPriority : 'unknown',
                        lineNumber: i + 1,
                        file: filename,
                        isSubtask: true,
                        parentTaskId: currentParentTask.taskId,
                        parentContent: currentParentTask.content, // Use clean parent content
                        originalLine: line // Preserve original formatting
                    };

                    // Add subtask to parent's subtasks array
                    if (!currentParentTask.subtasks) {
                        currentParentTask.subtasks = [];
                    }
                    currentParentTask.subtasks.push(subtask);

                    // Also add to main tasks array for sync purposes
                    tasks.push(subtask);
                } else {
                    // Orphaned subtask (no parent) - treat as regular task but warn
                    console.warn(`Warning: Orphaned subtask found at line ${i + 1}: ${trimmedLine}`);
                    const cleanOrphanContent = cleanTaskContent(trimmedLine);
                    const orphanTodoistId = extractCorrelationId(trimmedLine);
                    const orphanName = stripCorrelationId(cleanOrphanContent);
                    tasks.push({
                        content: orphanName, // Clean task name without ID
                        todoistId: orphanTodoistId, // Separate Todoist ID property
                        priority: currentPriority !== null ? currentPriority : 'unknown',
                        lineNumber: i + 1,
                        file: filename,
                        isOrphanedSubtask: true,
                        originalLine: line
                    });
                }
            } else {
                // This is a main task
                const cleanContent = cleanTaskContent(trimmedLine);
                const todoistId = extractCorrelationId(trimmedLine);
                const taskName = stripCorrelationId(cleanContent);
                const taskId = generateTaskId(taskName, i);
                const task = {
                    content: taskName, // Clean task name without ID
                    todoistId: todoistId, // Separate Todoist ID property
                    priority: currentPriority !== null ? currentPriority : 'unknown',
                    lineNumber: i + 1,
                    file: filename,
                    taskId: taskId,
                    subtasks: [],
                    originalLine: line
                };

                tasks.push(task);
                currentParentTask = task; // Set as potential parent for following subtasks
            }
        }

        return { tasks };
    } catch (error) {
        return { tasks: [], error: error.message };
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

function generateTaskId(content, lineNumber) {
    // Generate a simple ID based on content and line number
    const hash = createHash('md5').update(content + lineNumber).digest('hex');
    return hash.substring(0, 8);
}

async function getRemoteTasks() {
    if (!config.todoist.apiToken) {
        return {
            current: { tasks: [], message: 'No Todoist API token configured' },
            completed: { tasks: [], message: 'No Todoist API token configured' }
        };
    }

    try {
        // First, get the project ID for the "Sync" project
        const projectsResponse = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        if (!projectsResponse.ok) {
            throw new Error(`Todoist API error: ${projectsResponse.status} ${projectsResponse.statusText}`);
        }

        const projects = await projectsResponse.json();
        const syncProject = projects.find(p => p.name === config.todoist.projectName);

        if (!syncProject) {
            throw new Error(`Project "${config.todoist.projectName}" not found`);
        }

        // Fetch active tasks filtered by project
        const activeResponse = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${syncProject.id}`, {
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        if (!activeResponse.ok) {
            throw new Error(`Todoist API error: ${activeResponse.status} ${activeResponse.statusText}`);
        }

        const activeTasks = await activeResponse.json();

        // Fetch completed tasks (using sync API for completed tasks)
        const completedResponse = await fetch('https://api.todoist.com/sync/v9/completed/get_all', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        let completedTasks = [];
        if (completedResponse.ok) {
            const completedData = await completedResponse.json();

            // Filter completed tasks by the sync project and last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            completedTasks = (completedData.items || []).filter(task => {
                if (task.project_id !== syncProject.id) {
                    return false;
                }

                // Check if completed within last 30 days
                const completedDate = new Date(task.completed_at);
                return completedDate > thirtyDaysAgo;
            });
        }

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
        return {
            current: { tasks: [], error: error.message },
            completed: { tasks: [], error: error.message }
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
    const filepath = getTodoFilePath(filename);

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
    if (!config.todoist.apiToken) {
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
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        if (!projectsResponse.ok) {
            throw new Error(`Todoist API error: ${projectsResponse.status} ${projectsResponse.statusText}`);
        }

        const projects = await projectsResponse.json();
        const syncProject = projects.find(p => p.name === config.todoist.projectName);

        if (!syncProject) {
            throw new Error(`Project "${config.todoist.projectName}" not found`);
        }

        // Fetch tasks from the "Sync" project only
        const response = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${syncProject.id}`, {
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
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

function mapRemotePriority(task) {
    // Check if task is Priority 4 and due today or in the past
    if (task.priority === 4 && task.due) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of day for comparison

        // Parse the due date (now simplified to just the date string)
        const dueDate = new Date(task.due + 'T00:00:00');

        dueDate.setHours(0, 0, 0, 0); // Set to start of day for comparison

        // If due today or in the past, make it Priority 0
        if (dueDate <= today) {
            return 0;
        }
    }

    // Map Remote priorities to local priorities
    const priorityMap = {
        4: 1, // Remote Priority 4 (highest) -> Local Priority 1 (unless overdue, then Priority 0 above)
        3: 2, // Remote Priority 3 -> Local Priority 2
        2: 3, // Remote Priority 2 -> Local Priority 3
        1: 4  // Remote Priority 1 (lowest) -> Local Priority 4
    };

    return priorityMap[task.priority] || 4;
}

export function displayTasks(data, source) {
    const isLocal = source === 'local';
    const title = isLocal ? '📁 LOCAL TASKS (.tasks)' : '☁️  TODOIST TASKS';
    const separator = isLocal ? '-' : '=';

    console.log(`\n${title}`);
    console.log(separator.repeat(70));

    if (data.current.error) {
        console.log(`❌ Error: ${data.current.error}`);
    } else if (data.current.message) {
        console.log(`ℹ️  ${data.current.message}`);
    } else if (data.current.tasks.length === 0) {
        console.log('✅ No current tasks found');
    } else {
        // Group by priority
        const groupedByPriority = data.current.tasks.reduce((groups, task) => {
            let priority;

            if (isLocal) {
                priority = task.priority;
            } else {
                // Map Remote priorities to 0-4 scale
                priority = mapRemotePriority(task);
            }

            if (!groups[priority]) {
                groups[priority] = [];
            }
            groups[priority].push(task);
            return groups;
        }, {});

        // Both local and remote now use 0-4 priority system
        const priorities = Object.keys(groupedByPriority).sort((a, b) =>
            a === 'unknown' ? 1 : b === 'unknown' ? -1 : parseInt(a) - parseInt(b)
        );
        for (const priority of priorities) {
            const priorityLabel = getPriorityLabel(priority);
            console.log(`\n  ${priorityLabel} (${groupedByPriority[priority].length} tasks):`);
            // Filter out subtasks for main display (they'll be shown under their parents)
            const mainTasks = groupedByPriority[priority].filter(task => !task.isSubtask);

            mainTasks.forEach((task, index) => {
                const dueInfo = !isLocal && task.due ? ` (due: ${task.due})` : '';
                console.log(`    ${index + 1}. ${task.content}${dueInfo}`);

                // Display subtasks if they exist
                if (task.subtasks && task.subtasks.length > 0) {
                    task.subtasks.forEach((subtask, subIndex) => {
                        const subDueInfo = !isLocal && subtask.due ? ` (due: ${subtask.due})` : '';
                        console.log(`       ${String.fromCharCode(97 + subIndex)}. ${subtask.content}${subDueInfo}`);
                    });
                }
            });
        }
    }

    // Completed todos - only show if there's actual data or real errors
    const shouldShowCompleted = data.completed.tasks.length > 0 ||
                               (data.completed.error && !data.completed.message) ||
                               (data.completed.message && !data.completed.message.includes('Use --all'));

    if (shouldShowCompleted) {
        console.log(`\n✅ COMPLETED TASKS${isLocal ? ' (.tasks.completed)' : ''}`);
        console.log('-'.repeat(50));

        if (data.completed.error) {
            console.log(`❌ Error: ${data.completed.error}`);
        } else if (data.completed.message) {
            console.log(`ℹ️  ${data.completed.message}`);
        } else if (data.completed.tasks.length === 0) {
            console.log('📭 No completed tasks found');
        } else {
            data.completed.tasks.forEach((task, index) => {
                if (!isLocal && task.completed) {
                    const completedDate = new Date(task.completed).toLocaleDateString();
                    console.log(`  ${index + 1}. ${task.content} (completed: ${completedDate})`);
                } else {
                    console.log(`  ${index + 1}. ${task.content}`);
                }
            });
        }
    }

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
    const filepath = getTodoFilePath(filename);

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
    if (!config.todoist.apiToken) {
        console.error('❌ No Todoist API token configured');
        return;
    }

    try {
        // First, get the project ID for the "Sync" project
        const projectsResponse = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        if (!projectsResponse.ok) {
            throw new Error(`Todoist API error: ${projectsResponse.status} ${projectsResponse.statusText}`);
        }

        const projects = await projectsResponse.json();
        const syncProject = projects.find(p => p.name === config.todoist.projectName);

        if (!syncProject) {
            throw new Error(`Project "${config.todoist.projectName}" not found`);
        }

        // Fetch tasks from the "Sync" project only
        const response = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${syncProject.id}`, {
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
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
                        Authorization: `Bearer ${config.todoist.apiToken}`
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

    let localChanges = 0;
    let todoistChanges = 0;

    try {
        // Execute local changes (from Remote to local)
        if (showLocal || (!showLocal && !showRemote)) {
            const localResults = await executeLocalChanges(changes.local);
            localChanges = localResults.totalChanges;
            if (localResults.errors.length > 0) {
                results.errors.push(...localResults.errors);
            }
        }

        // Execute Remote changes (from local to Remote)
        if (showRemote || (!showLocal && !showRemote)) {
            const todoistResults = await executeRemoteChanges(changes.todoist);
            todoistChanges = todoistResults.totalChanges;
            if (todoistResults.errors.length > 0) {
                results.errors.push(...todoistResults.errors);
            }
        }

        // Check for conflicts
        if (changes.conflicts.length > 0) {
            results.errors.push(`${changes.conflicts.length} conflicts require manual resolution`);
            console.log('\n⚠️  Conflicts detected that require manual resolution:');
            changes.conflicts.forEach((conflict, index) => {
                console.log(`  ${index + 1}. Correlation ID: ${conflict.corrId}`);
                console.log(`     Local:   "${conflict.localTask.content}"`);
                console.log(`     Remote: "${conflict.todoistTask.content}"`);
            });
        }

        // Summary
        const summary = [];
        if (localChanges > 0) {
            summary.push(`${localChanges} local changes applied`);
        }
        if (todoistChanges > 0) {
            summary.push(`${todoistChanges} Remote changes applied`);
        }
        if (summary.length === 0) {
            summary.push('No changes needed - everything is in sync');
        }

        results.summary = summary.join(', ');
        results.success = results.errors.length === 0;

    } catch (error) {
        results.success = false;
        results.error = error.message;
    }

    return results;
}

async function executeLocalChanges(localChanges) {
    const results = {
        totalChanges: 0,
        errors: []
    };

    const allChanges = [
        ...localChanges.noneToCurrent,
        ...localChanges.noneToCompleted,
        ...localChanges.currentToCompleted,
        ...localChanges.renames
    ];

    if (allChanges.length === 0) {
        return results;
    }

    console.log(`\n📝 Applying ${allChanges.length} local changes...`);

    try {
        // Apply new current tasks from Remote
        for (const change of localChanges.noneToCurrent) {
            await addTaskToLocalFile(change);
            // Log the new sync operation
            logSyncOperation('create', 'local', {
                todoistId: change.id,
                content: change.content, // Should already be clean
                priority: change.metadata?.priority,
                source: 'todoist'
            });
            console.log(`  ✓ Added new task: ${change.content}`);
            results.totalChanges++;
        }

        // Apply new completed tasks from Remote
        for (const change of localChanges.noneToCompleted) {
            await addCompletedTaskToLocalFile(change);
            console.log(`  ✓ Added completed task: ${change.content}`);
            results.totalChanges++;
        }

        // Mark current tasks as completed
        for (const change of localChanges.currentToCompleted) {
            await markTaskCompletedInLocalFile(change);
            console.log(`  ✓ Marked completed: ${change.content}`);
            results.totalChanges++;
        }

        // Apply renames/priority changes
        for (const change of localChanges.renames) {
            await updateTaskInLocalFile(change);
            if (change.changeType === 'priority_update') {
                console.log(`  ✓ Updated priority: ${change.content} (${change.oldPriority}→${change.newPriority})`);
            } else {
                console.log(`  ✓ Renamed task: ${change.oldContent} → ${change.newContent}`);
            }
            results.totalChanges++;
        }

    } catch (error) {
        results.errors.push(`Local file update error: ${error.message}`);
    }

    return results;
}

async function executeRemoteChanges(todoistChanges) {
    const results = {
        totalChanges: 0,
        errors: []
    };

    if (!config.todoist.apiToken) {
        results.errors.push('No Todoist API token configured');
        return results;
    }

    const allChanges = [
        ...todoistChanges.noneToCurrent,
        ...todoistChanges.noneToCompleted,
        ...todoistChanges.currentToCompleted,
        ...todoistChanges.renames
    ];

    if (allChanges.length === 0) {
        return results;
    }

    console.log(`\n☁️  Applying ${allChanges.length} Remote changes...`);

    try {
        // Get project ID first
        const projectId = await getRemoteProjectId();
        if (!projectId) {
            results.errors.push(`Project "${config.todoist.projectName}" not found`);
            return results;
        }

        // Apply new current tasks from local
        for (const change of todoistChanges.noneToCurrent) {
            const result = await createRemoteTask(change, projectId);
            if (result) {
                // Log the new sync operation
                logSyncOperation('create', 'todoist', {
                    todoistId: result.taskId,
                    content: change.content, // Should already be clean
                    priority: change.metadata?.priority,
                    source: 'local'
                });

                // Add Todoist ID to the local task file
                await updateLocalTaskWithCorrelationId(change.content, result.taskId);

                console.log(`  ✓ Created task: ${change.content}`);
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to create task: ${change.content}`);
            }
        }

        // Apply new completed tasks from local
        for (const change of todoistChanges.noneToCompleted) {
            const result = await createRemoteTask(change, projectId, true);
            if (result) {
                console.log(`  ✓ Created completed task: ${change.content}`);
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to create completed task: ${change.content}`);
            }
        }

        // Mark current tasks as completed
        for (const change of todoistChanges.currentToCompleted) {
            const success = await completeRemoteTask(change.metadata?.todoistId);
            if (success) {
                console.log(`  ✓ Marked completed: ${change.content}`);
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to complete task: ${change.content}`);
            }
        }

        // Apply renames/priority changes
        for (const change of todoistChanges.renames) {
            const success = await updateRemoteTask(change);
            if (success) {
                // Log the update
                if (change.changeType === 'priority_update') {
                    logSyncOperation('update', 'todoist', {
                        todoistId: change.todoistId,
                        content: change.content,
                        priority: change.newPriority,
                        oldPriority: change.oldPriority,
                        source: 'local'
                    });
                    console.log(`  ✓ Updated priority: ${change.content} (${change.oldPriority}→${change.newPriority})`);
                } else {
                    logSyncOperation('update', 'todoist', {
                        todoistId: change.todoistId,
                        oldContent: change.oldContent,
                        content: change.newContent,
                        source: 'local'
                    });
                    console.log(`  ✓ Renamed task: ${change.oldContent} → ${change.newContent}`);
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
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
        }

        const projects = await response.json();
        const syncProject = projects.find(p => p.name === config.todoist.projectName);
        return syncProject?.id || null;
    } catch (error) {
        console.error('Error getting project ID:', error.message);
        return null;
    }
}

async function updateLocalTaskWithCorrelationId(taskContent, todoistId) {
    const filepath = getTodoFilePath('.tasks');

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
            console.log(`  📎 Added Todoist ID (${todoistId}) to local task: ${cleanTaskContent}`);
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
        const localPriority = task.metadata?.priority || task.priority || 4;
        const priority = mapLocalPriorityToRemote(localPriority);
        const cleanContent = task.content; // Should already be clean
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
                Authorization: `Bearer ${config.todoist.apiToken}`,
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
                Authorization: `Bearer ${config.todoist.apiToken}`
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
            console.log(`🔧 Updating task ${change.todoistId}: priority ${change.oldPriority} → ${change.newPriority} (Remote: ${updateData.priority})`);
        } else if (change.newContent) {
            updateData.content = change.newContent;
            console.log(`🔧 Updating task ${change.todoistId}: content "${change.oldContent}" → "${change.newContent}"`);
        }

        console.log(`🚀 API Call: PUT /tasks/${change.todoistId}`, JSON.stringify(updateData));

        const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${change.todoistId}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`,
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
                Authorization: `Bearer ${config.todoist.apiToken}`
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
    const priorityMap = {
        0: 4, // Priority 0 -> Remote Priority 4 (highest/red)
        1: 4, // Priority 1 -> Remote Priority 4 (highest/red)
        2: 3, // Priority 2 -> Remote Priority 3 (orange)
        3: 2, // Priority 3 -> Remote Priority 2 (blue)
        4: 1  // Priority 4 -> Remote Priority 1 (lowest/no flag)
    };

    return priorityMap[localPriority] || 1;
}

async function addTaskToLocalFile(task) {
    const filepath = getTodoFilePath('.tasks');
    const priority = task.metadata?.priority !== undefined ? task.metadata.priority : 4;

    try {
        let content = '';
        if (existsSync(filepath)) {
            content = readFileSync(filepath, 'utf8');
        }

        // Add Todoist ID for new task if it's from Remote
        let taskContentWithCorr = task.content;

        if (task.metadata?.source === 'todoist' && task.id) {
            taskContentWithCorr = addCorrelationId(task.content, task.id);
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
    const filepath = getTodoFilePath('.tasks.completed');

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
    const currentFilepath = getTodoFilePath('.tasks');
    const completedFilepath = getTodoFilePath('.tasks.completed');

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
    const filepath = getTodoFilePath('.tasks');

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

export async function cleanDuplicateCompletionDates() {
    console.log('🧹 Cleaning duplicate completion dates in completed tasks...');

    const filepath = getTodoFilePath('.tasks.completed');

    try {
        if (!existsSync(filepath)) {
            console.log('✨ No completed tasks file found - nothing to clean');
            return { success: true };
        }

        const content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        const cleanedLines = [];

        for (const line of lines) {
            if (!line.trim()) {
                cleanedLines.push(line);
                continue;
            }

            // Remove duplicate (completed: date) patterns
            // Match pattern: (completed: MM/DD/YYYY) and keep only the first occurrence
            let cleanedLine = line;
            const completedPattern = /\(completed: \d{1,2}\/\d{1,2}\/\d{4}\)/g;
            const matches = line.match(completedPattern);

            if (matches && matches.length > 1) {
                // Keep only the first completion date
                const firstMatch = matches[0];
                cleanedLine = line.replace(completedPattern, '');
                cleanedLine = cleanedLine.trim() + ' ' + firstMatch;
                console.log(`  ✓ Cleaned: ${line.substring(0, 50)}...`);
            }

            cleanedLines.push(cleanedLine);
        }

        writeFileSync(filepath, cleanedLines.join('\n'), 'utf8');
        console.log('\n✅ Cleanup completed! Removed duplicate completion dates.');

        return { success: true };

    } catch (error) {
        console.error(`❌ Cleanup failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

export async function bootstrapCorrelations() {
    console.log('🔗 Bootstrapping correlations between local and Remote tasks...');

    try {
        const localData = await getTasks('local');
        const todoistData = await getTasks('remote');

        if (!localData.current.tasks || !todoistData.current.tasks) {
            throw new Error('Unable to load local or Remote tasks');
        }

        const filepath = getTodoFilePath('.tasks');
        const content = readFileSync(filepath, 'utf8');
        const lines = content.split('\n');
        let updated = false;

        // Match tasks by content
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines, headers, separators
            if (!line || line.startsWith('Priority ') || line.includes('---')) {
                continue;
            }

            // Check if task has old format correlation ID
            const oldCorrId = line.match(/# \[([a-f0-9]{8})\]/);
            const newTodoistId = line.match(/\((\d+)\)/);

            // Skip tasks that already have new format Todoist IDs
            if (newTodoistId) {
                continue;
            }

            // Find matching Remote task by content
            const cleanLocalContent = stripCorrelationId(line).toLowerCase().trim();
            const matchingRemoteTask = todoistData.current.tasks.find(task =>
                task.content.toLowerCase().trim() === cleanLocalContent
            );

            if (matchingRemoteTask) {
                // Replace old format with new Todoist ID format
                let taskWithId;
                if (oldCorrId) {
                    // Replace old correlation ID with new Todoist ID
                    taskWithId = line.replace(/# \[[a-f0-9]{8}\]/, `(${matchingRemoteTask.id})`);
                    console.log(`  ✓ Migrated: ${cleanLocalContent} # [${oldCorrId[1]}] → (${matchingRemoteTask.id})`);
                } else {
                    // Add new Todoist ID
                    taskWithId = addCorrelationId(line, matchingRemoteTask.id);
                    console.log(`  ✓ Added: ${cleanLocalContent} (${matchingRemoteTask.id})`);
                }

                lines[i] = taskWithId;

                // Log the bootstrap operation
                logSyncOperation('bootstrap', 'correlation', {
                    todoistId: matchingRemoteTask.id,
                    content: cleanLocalContent,
                    source: 'bootstrap',
                    migration: !!oldCorrId
                });

                updated = true;
            }
        }

        if (updated) {
            writeFileSync(filepath, lines.join('\n'), 'utf8');
            console.log('\n✅ Bootstrap completed! Added Todoist IDs to matched tasks.');
        } else {
            console.log('\n✨ No new correlations needed - all tasks already have Todoist IDs.');
        }

        return { success: true };

    } catch (error) {
        console.error(`❌ Bootstrap failed: ${error.message}`);
        return { success: false, error: error.message };
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
    const backupDir = join(config.local.todoDir, '.tasks.backups', timestamp);

    try {
        // Create backup directory
        mkdirSync(backupDir, { recursive: true });

        // Backup local files
        await backupLocalFiles(backupDir);

        // Backup remote data
        await backupRemoteData(backupDir);

        console.log(`\n💾 Backup created at: ${backupDir}`);
        return { success: true, backupDir, timestamp };

    } catch (error) {
        console.error(`❌ Backup failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function backupLocalFiles(backupDir) {
    const homeDir = homedir();

    // Backup current tasks
    const currentTaskPath = join(homeDir, '.tasks');
    if (existsSync(currentTaskPath)) {
        const currentContent = readFileSync(currentTaskPath, 'utf8');
        const currentData = parseLocalTaskContent(currentContent);
        const yamlContent = yaml.dump(currentData, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'local.current.yaml'), yamlContent);
        console.log('📄 Backed up: local.current.yaml');
    }

    // Backup completed tasks
    const completedTaskPath = join(homeDir, '.tasks.completed');
    if (existsSync(completedTaskPath)) {
        const completedContent = readFileSync(completedTaskPath, 'utf8');
        const completedData = parseLocalTaskContent(completedContent);
        const yamlContent = yaml.dump(completedData, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'local.completed.yaml'), yamlContent);
        console.log('📄 Backed up: local.completed.yaml');
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
    if (!config.todoist.apiToken) {
        console.log('⚠️  No Todoist API token - skipping remote backup');
        return;
    }

    try {
        // Get project info
        const projectsResponse = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        if (!projectsResponse.ok) {
            throw new Error(`Failed to fetch projects: ${projectsResponse.status}`);
        }

        const projects = await projectsResponse.json();
        const syncProject = projects.find(p => p.name === config.todoist.projectName);

        if (!syncProject) {
            throw new Error(`Project "${config.todoist.projectName}" not found`);
        }

        // Save project info as YAML
        const projectYaml = yaml.dump(syncProject, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'remote.project-info.yaml'), projectYaml);

        // Backup current tasks
        const tasksResponse = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${syncProject.id}`, {
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        if (tasksResponse.ok) {
            const tasks = await tasksResponse.json();
            const todoFormatData = convertRemoteToTaskFormat(tasks);
            const yamlContent = yaml.dump(todoFormatData, { indent: 2, lineWidth: 120 });
            writeFileSync(join(backupDir, 'remote.current.yaml'), yamlContent);
            console.log(`☁️  Backed up ${tasks.length} current tasks`);
        }

        // Backup completed tasks
        const completedResponse = await fetch('https://api.todoist.com/sync/v9/completed/get_all', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `project_id=${syncProject.id}&limit=200`
        });

        if (completedResponse.ok) {
            const completedData = await completedResponse.json();
            const completedYaml = yaml.dump(completedData, { indent: 2, lineWidth: 120 });
            writeFileSync(join(backupDir, 'remote.completed.yaml'), completedYaml);
            console.log(`☁️  Backed up ${completedData.items?.length || 0} completed tasks`);
        }

    } catch (error) {
        throw new Error(`Remote backup failed: ${error.message}`);
    }
}

function convertRemoteToTaskFormat(todoistTasks) {
    // Map Remote priorities to local priorities
    function mapRemotePriorityToLocal(todoistPriority) {
        const priorityMap = {
            4: 1, // Remote Priority 4 (highest) -> Local Priority 1
            3: 2, // Remote Priority 3 -> Local Priority 2
            2: 3, // Remote Priority 2 -> Local Priority 3
            1: 4  // Remote Priority 1 (lowest) -> Local Priority 4
        };
        return priorityMap[todoistPriority] || 4; // Default to Priority 4
    }

    // Group tasks by priority
    const tasksByPriority = {};

    for (const task of todoistTasks) {
        const localPriority = mapRemotePriorityToLocal(task.priority);

        if (!tasksByPriority[localPriority]) {
            tasksByPriority[localPriority] = [];
        }

        // Format task content (include Remote ID for reference)
        const taskContent = `${task.content} # [Remote ID: ${task.id}]`;
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
        const filepath = getTodoFilePath('.tasks');
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

export async function createRemoteTaskByContent(content, priority = 4) {
    try {
        if (!config.todoist.apiToken) {
            console.error('❌ No Todoist API token configured');
            return false;
        }

        // Get project ID
        const projectsResponse = await fetch('https://api.todoist.com/rest/v2/projects', {
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        if (!projectsResponse.ok) {
            console.error('❌ Failed to fetch projects');
            return false;
        }

        const projects = await projectsResponse.json();
        const syncProject = projects.find(p => p.name === config.todoist.projectName);

        if (!syncProject) {
            console.error(`❌ Project "${config.todoist.projectName}" not found`);
            return false;
        }

        // Map local priority to Todoist priority
        const todoistPriority = mapLocalPriorityToRemote(priority);

        const taskData = {
            content: content,
            project_id: syncProject.id,
            priority: todoistPriority
        };

        // Add due date for priority 0 tasks
        if (priority === 0) {
            taskData.due_string = 'today';
        }

        const response = await fetch('https://api.todoist.com/rest/v2/tasks', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });

        if (response.ok) {
            const newTask = await response.json();
            console.log(`✅ Created remote task: "${content}" (Priority ${priority}, Todoist ID: ${newTask.id})`);
            return true;
        } else {
            console.error(`❌ Failed to create remote task: ${response.status} ${response.statusText}`);
            return false;
        }
    } catch (error) {
        console.error('❌ Failed to create remote task:', error.message);
        return false;
    }
}

// Task update functions
export async function updateLocalTask(taskName, options) {
    try {
        const filepath = getTodoFilePath('.tasks');

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
        if (!config.todoist.apiToken) {
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
                Authorization: `Bearer ${config.todoist.apiToken}`,
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
        const filepath = getTodoFilePath('.tasks');
        const completedFilepath = getTodoFilePath('.tasks.completed');

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
        if (!config.todoist.apiToken) {
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
                Authorization: `Bearer ${config.todoist.apiToken}`
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
        const filepath = getTodoFilePath('.tasks');

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
        if (!config.todoist.apiToken) {
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
                Authorization: `Bearer ${config.todoist.apiToken}`
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
