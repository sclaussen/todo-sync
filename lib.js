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
} from './todoLog.js';
import { generateCorrelationId } from './syncState.js';

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
    }
};

export async function getTodos(source) {
    if (source === 'local') {
        return getLocalTodos();
    } else if (source === 'remote') {
        return await getRemoteTodos();
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

function getLocalTodos() {
    const current = parseLocalTodos('.todo');
    const completed = parseLocalTodos('.todo.completed');

    return {
        current: current.error ? { tasks: [], error: current.error } : current,
        completed: completed.error ? { tasks: [], error: completed.error } : completed
    };
}

function parseLocalTodos(filename = '.todo') {
    const filepath = join(homedir(), filename);

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
                    const subtask = {
                        content: cleanTaskContent(subtaskContent),
                        priority: currentPriority !== null ? currentPriority : 'unknown',
                        lineNumber: i + 1,
                        file: filename,
                        isSubtask: true,
                        parentTaskId: currentParentTask.taskId,
                        parentContent: cleanTaskContent(currentParentTask.content),
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
                    tasks.push({
                        content: cleanTaskContent(trimmedLine),
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
                const taskId = generateTaskId(cleanContent, i);
                const task = {
                    content: cleanContent,
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

async function getRemoteTodos() {
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
                due: task.due ? {
                    date: task.due.date,
                    string: task.due.string,
                    datetime: task.due.datetime
                } : null,
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

        // Deduplicate completed tasks by content (Todoist can have duplicates)
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
    const localFiles = [ '.todo' ]; // Only check current todos
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
    const filepath = join(homedir(), filename);

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

function mapTodoistPriority(task) {
    // Check if task is Priority 4 and due today or in the past
    if (task.priority === 4 && task.due) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of day for comparison

        // Parse the due date from Todoist format
        let dueDate;
        if (task.due.date) {
            // Use the date field (YYYY-MM-DD format)
            dueDate = new Date(task.due.date + 'T00:00:00');
        } else if (task.due.datetime) {
            // Use datetime field if available
            dueDate = new Date(task.due.datetime);
        } else if (typeof task.due === 'string') {
            // Fallback to string parsing
            dueDate = new Date(task.due);
        } else {
            // Last resort
            dueDate = new Date(task.due);
        }

        dueDate.setHours(0, 0, 0, 0); // Set to start of day for comparison

        // If due today or in the past, make it Priority 0
        if (dueDate <= today) {
            return 0;
        }
    }

    // Map Todoist priorities to local priorities
    const priorityMap = {
        4: 1, // Todoist Priority 4 (highest) -> Local Priority 1 (unless overdue, then Priority 0 above)
        3: 2, // Todoist Priority 3 -> Local Priority 2
        2: 3, // Todoist Priority 2 -> Local Priority 3
        1: 4  // Todoist Priority 1 (lowest) -> Local Priority 4
    };

    return priorityMap[task.priority] || 4;
}

export function displayTodos(data, source) {
    const isLocal = source === 'local';
    const title = isLocal ? '📁 LOCAL TODOS (.todo)' : '☁️  TODOIST TODOS';
    const separator = isLocal ? '-' : '=';

    console.log(`\n${title}`);
    console.log(separator.repeat(70));

    if (data.current.error) {
        console.log(`❌ Error: ${data.current.error}`);
    } else if (data.current.message) {
        console.log(`ℹ️  ${data.current.message}`);
    } else if (data.current.tasks.length === 0) {
        console.log('✅ No current todos found');
    } else {
        // Group by priority
        const groupedByPriority = data.current.tasks.reduce((groups, task) => {
            let priority;

            if (isLocal) {
                priority = task.priority;
            } else {
                // Map Todoist priorities to 0-4 scale
                priority = mapTodoistPriority(task);
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
        const priorityLabels = (priority) => priority === 'unknown' ? 'Unknown Priority' : `Priority ${priority}`;

        for (const priority of priorities) {
            const priorityLabel = priorityLabels(priority);
            console.log(`\n  ${priorityLabel} (${groupedByPriority[priority].length} tasks):`);
            // Filter out subtasks for main display (they'll be shown under their parents)
            const mainTasks = groupedByPriority[priority].filter(task => !task.isSubtask);

            mainTasks.forEach((task, index) => {
                const dueInfo = !isLocal && task.due ? ` (due: ${task.due.string || task.due.date || task.due})` : '';
                console.log(`    ${index + 1}. ${task.content}${dueInfo}`);

                // Display subtasks if they exist
                if (task.subtasks && task.subtasks.length > 0) {
                    task.subtasks.forEach((subtask, subIndex) => {
                        const subDueInfo = !isLocal && subtask.due ? ` (due: ${subtask.due.string || subtask.due.date || subtask.due})` : '';
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
        console.log(`\n✅ COMPLETED TODOS${isLocal ? ' (.todo.completed)' : ''}`);
        console.log('-'.repeat(50));

        if (data.completed.error) {
            console.log(`❌ Error: ${data.completed.error}`);
        } else if (data.completed.message) {
            console.log(`ℹ️  ${data.completed.message}`);
        } else if (data.completed.tasks.length === 0) {
            console.log('📭 No completed todos found');
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
        console.log(`\n🎉 No duplicates found in ${isLocal ? 'local files' : 'Todoist'}!`);
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
    const filename = '.todo';
    const filepath = join(homedir(), filename);

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
            console.log('\n✅ No duplicates found in Todoist');
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

        console.log(`\n✅ Removed ${totalDeleted} duplicate(s) from Todoist`);
    } catch (error) {
        console.error(`❌ Error removing duplicates from Todoist: ${error.message}`);
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
        // Execute local changes (from Todoist to local)
        if (showLocal || (!showLocal && !showRemote)) {
            const localResults = await executeLocalChanges(changes.local);
            localChanges = localResults.totalChanges;
            if (localResults.errors.length > 0) {
                results.errors.push(...localResults.errors);
            }
        }

        // Execute Todoist changes (from local to Todoist)
        if (showRemote || (!showLocal && !showRemote)) {
            const todoistResults = await executeTodoistChanges(changes.todoist);
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
                console.log(`     Todoist: "${conflict.todoistTask.content}"`);
            });
        }

        // Summary
        const summary = [];
        if (localChanges > 0) {
            summary.push(`${localChanges} local changes applied`);
        }
        if (todoistChanges > 0) {
            summary.push(`${todoistChanges} Todoist changes applied`);
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
        // Apply new current tasks from Todoist
        for (const change of localChanges.noneToCurrent) {
            const corrId = await addTaskToLocalFile(change);
            if (corrId && change.id) {
                // Log the new correlation
                logSyncOperation('create', 'local', {
                    corrId,
                    todoistId: change.id,
                    content: stripCorrelationId(change.content),
                    priority: change.metadata?.priority,
                    source: 'todoist'
                });
            }
            console.log(`  ✓ Added new task: ${change.content}`);
            results.totalChanges++;
        }

        // Apply new completed tasks from Todoist
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

async function executeTodoistChanges(todoistChanges) {
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

    console.log(`\n☁️  Applying ${allChanges.length} Todoist changes...`);

    try {
        // Get project ID first
        const projectId = await getTodoistProjectId();
        if (!projectId) {
            results.errors.push(`Project "${config.todoist.projectName}" not found`);
            return results;
        }

        // Apply new current tasks from local
        for (const change of todoistChanges.noneToCurrent) {
            const result = await createTodoistTask(change, projectId);
            if (result) {
                // Log the new correlation
                logSyncOperation('create', 'todoist', {
                    corrId: result.corrId,
                    todoistId: result.taskId,
                    content: stripCorrelationId(change.content),
                    priority: change.metadata?.priority,
                    source: 'local'
                });
                console.log(`  ✓ Created task: ${change.content}`);
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to create task: ${change.content}`);
            }
        }

        // Apply new completed tasks from local
        for (const change of todoistChanges.noneToCompleted) {
            const result = await createTodoistTask(change, projectId, true);
            if (result) {
                console.log(`  ✓ Created completed task: ${change.content}`);
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to create completed task: ${change.content}`);
            }
        }

        // Mark current tasks as completed
        for (const change of todoistChanges.currentToCompleted) {
            const success = await completeTodoistTask(change.metadata?.todoistId);
            if (success) {
                console.log(`  ✓ Marked completed: ${change.content}`);
                results.totalChanges++;
            } else {
                results.errors.push(`Failed to complete task: ${change.content}`);
            }
        }

        // Apply renames/priority changes
        for (const change of todoistChanges.renames) {
            const success = await updateTodoistTask(change);
            if (success) {
                // Log the update
                if (change.changeType === 'priority_update') {
                    logSyncOperation('update', 'todoist', {
                        corrId: change.corrId,
                        todoistId: change.todoistId,
                        content: change.content,
                        priority: change.newPriority,
                        oldPriority: change.oldPriority,
                        source: 'local'
                    });
                    console.log(`  ✓ Updated priority: ${change.content} (${change.oldPriority}→${change.newPriority})`);
                } else {
                    logSyncOperation('update', 'todoist', {
                        corrId: change.corrId,
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


async function getTodoistProjectId() {
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

async function createTodoistTask(task, projectId, isCompleted = false) {
    try {
        const priority = mapLocalPriorityToTodoist(task.metadata?.priority || task.priority || 4);
        const cleanContent = stripCorrelationId(task.content);
        const taskData = {
            content: cleanContent,
            project_id: projectId,
            priority: priority
        };

        // Add due date for priority 0 tasks
        if ((task.metadata?.priority || task.priority) === 0) {
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

        // Generate correlation ID for tracking
        const corrId = generateCorrelationId(cleanContent);

        // If task should be completed, complete it immediately
        if (isCompleted) {
            await completeTodoistTask(createdTask.id);
        }

        return {
            taskId: createdTask.id,
            corrId: corrId
        };
    } catch (error) {
        console.error('Error creating Todoist task:', error.message);
        return null;
    }
}

async function completeTodoistTask(taskId) {
    try {
        const response = await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}/close`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.todoist.apiToken}`
            }
        });

        return response.ok;
    } catch (error) {
        console.error('Error completing Todoist task:', error.message);
        return false;
    }
}

async function updateTodoistTask(change) {
    try {
        const updateData = {};

        if (change.changeType === 'priority_update') {
            updateData.priority = mapLocalPriorityToTodoist(change.newPriority);
            // Add/remove due date based on priority
            if (change.newPriority === 0) {
                updateData.due_string = 'today';
            } else if (change.oldPriority === 0 && change.newPriority !== 0) {
                // Remove due date when moving from Priority 0 to any other priority
                updateData.due_string = 'no date';
            }
            console.log(`🔧 Updating task ${change.todoistId}: priority ${change.oldPriority} → ${change.newPriority} (Todoist: ${updateData.priority})`);
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
                const expectedPriority = mapLocalPriorityToTodoist(change.newPriority);
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
        console.error('Error updating Todoist task:', error.message);
        return false;
    }
}

function mapLocalPriorityToTodoist(localPriority) {
    const priorityMap = {
        0: 4, // Priority 0 -> Todoist Priority 4 (highest/red)
        1: 4, // Priority 1 -> Todoist Priority 4 (highest/red)
        2: 3, // Priority 2 -> Todoist Priority 3 (orange)
        3: 2, // Priority 3 -> Todoist Priority 2 (blue)
        4: 1  // Priority 4 -> Todoist Priority 1 (lowest/no flag)
    };

    return priorityMap[localPriority] || 1;
}

async function addTaskToLocalFile(task) {
    const filepath = join(homedir(), '.todo');
    const priority = task.metadata?.priority !== undefined ? task.metadata.priority : 4;

    try {
        let content = '';
        if (existsSync(filepath)) {
            content = readFileSync(filepath, 'utf8');
        }

        // Generate correlation ID for new task if it's from Todoist
        let corrId = null;
        let taskContentWithCorr = task.content;

        if (task.metadata?.source === 'todoist' && task.id) {
            corrId = generateCorrelationId(task.content);
            taskContentWithCorr = addCorrelationId(task.content, corrId);
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
        return corrId;
    } catch (error) {
        throw new Error(`Failed to add task to local file: ${error.message}`);
    }
}

async function addCompletedTaskToLocalFile(task) {
    const filepath = join(homedir(), '.todo.completed');

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
    const currentFilepath = join(homedir(), '.todo');
    const completedFilepath = join(homedir(), '.todo.completed');

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
    const filepath = join(homedir(), '.todo');

    try {
        if (!existsSync(filepath)) {
            throw new Error('Local todo file does not exist');
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

                // Add correlation ID if not present and we have one
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

    const filepath = join(homedir(), '.todo.completed');

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
    console.log('🔗 Bootstrapping correlations between local and Todoist tasks...');

    try {
        const localData = await getTodos('local');
        const todoistData = await getTodos('remote');

        if (!localData.current.tasks || !todoistData.current.tasks) {
            throw new Error('Unable to load local or Todoist tasks');
        }

        const filepath = join(homedir(), '.todo');
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

            // Skip tasks that already have correlation IDs
            if (extractCorrelationId(line)) {
                continue;
            }

            // Find matching Todoist task by content
            const cleanLocalContent = stripCorrelationId(line).toLowerCase().trim();
            const matchingTodoistTask = todoistData.current.tasks.find(task =>
                task.content.toLowerCase().trim() === cleanLocalContent
            );

            if (matchingTodoistTask) {
                // Generate correlation ID and add it to the local task
                const corrId = generateCorrelationId(cleanLocalContent);
                const taskWithCorr = addCorrelationId(line, corrId);
                lines[i] = taskWithCorr;

                // Log the correlation
                logSyncOperation('bootstrap', 'correlation', {
                    corrId,
                    todoistId: matchingTodoistTask.id,
                    content: cleanLocalContent,
                    source: 'bootstrap'
                });

                updated = true;
                console.log(`  ✓ Correlated: ${cleanLocalContent}`);
            }
        }

        if (updated) {
            writeFileSync(filepath, lines.join('\n'), 'utf8');
            console.log('\n✅ Bootstrap completed! Added correlation IDs to matched tasks.');
        } else {
            console.log('\n✨ No new correlations needed - all tasks already have correlation IDs.');
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
    const backupDir = join(homedir(), '.todos', timestamp);

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

    // Backup current todos
    const currentTodoPath = join(homeDir, '.todo');
    if (existsSync(currentTodoPath)) {
        const currentContent = readFileSync(currentTodoPath, 'utf8');
        const currentData = parseLocalTodoContent(currentContent);
        const yamlContent = yaml.dump(currentData, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'local.current.yaml'), yamlContent);
        console.log('📄 Backed up: local.current.yaml');
    }

    // Backup completed todos
    const completedTodoPath = join(homeDir, '.todo.completed');
    if (existsSync(completedTodoPath)) {
        const completedContent = readFileSync(completedTodoPath, 'utf8');
        const completedData = parseLocalTodoContent(completedContent);
        const yamlContent = yaml.dump(completedData, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'local.completed.yaml'), yamlContent);
        console.log('📄 Backed up: local.completed.yaml');
    }

    // Backup sync state
    const syncStatePath = join(homeDir, '.todo-sync-state.yaml');
    if (existsSync(syncStatePath)) {
        copyFileSync(syncStatePath, join(backupDir, 'local.sync-state.yaml'));
        console.log('📄 Backed up: local.sync-state.yaml');
    }
}

function parseLocalTodoContent(content) {
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
            const todoFormatData = convertTodoistToTodoFormat(tasks);
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

function convertTodoistToTodoFormat(todoistTasks) {
    // Map Todoist priorities to local priorities
    const mapTodoistPriorityToLocal = (todoistPriority) => {
        const priorityMap = {
            4: 1, // Todoist Priority 4 (highest) -> Local Priority 1
            3: 2, // Todoist Priority 3 -> Local Priority 2
            2: 3, // Todoist Priority 2 -> Local Priority 3
            1: 4  // Todoist Priority 1 (lowest) -> Local Priority 4
        };
        return priorityMap[todoistPriority] || 4; // Default to Priority 4
    };

    // Group tasks by priority
    const tasksByPriority = {};

    for (const task of todoistTasks) {
        const localPriority = mapTodoistPriorityToLocal(task.priority);

        if (!tasksByPriority[localPriority]) {
            tasksByPriority[localPriority] = [];
        }

        // Format task content (include Todoist ID for reference)
        const taskContent = `${task.content} # [Todoist ID: ${task.id}]`;
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

    // Also create a raw format that matches .todo file structure
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
