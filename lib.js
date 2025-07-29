import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import { FILE_PATHS, TODOIST, logTransaction, getCurrentTimestamp } from './src/config/constants.js';
import {
    extractCorrelationId,
    stripCorrelationId,
    addCorrelationId
} from './src/utils/correlationId.js';
import { todoistAPI } from './src/api/todoist.js';
import { executeSync as syncEngineExecuteSync, categorizeChanges as syncEngineCategorizeChanges } from './src/sync/engine.js';

// Load environment variables from .env file
// Temporarily suppress all dotenv console output
const originalLog = console.log;
const originalError = console.error;
console.log = () => {};
console.error = () => {};

try {
    dotenv.config({ path: '.env' });
} catch (error) {
    // Silently fail if .env doesn't exist
}

// Restore console methods
console.log = originalLog;
console.error = originalError;

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

export async function getTasks(source) {
    return source === 'local' ? await getLocalTasks() : await getRemoteTasks();
}

export async function findDuplicates(source) {
    if (source === 'local') {
        return await findLocalDuplicates();
    } else if (source === 'remote') {
        return await findRemoteDuplicates();
    }
}

async function getLocalTasks() {
    const currentTasks = await getTasksFromFile(FILE_PATHS.TASK);
    const completedTasks = await getTasksFromFile(FILE_PATHS.COMPLETED);

    return {
        current: currentTasks,
        completed: completedTasks
    };
}

async function getTasksFromFile(filepath) {
    try {
        if (!existsSync(filepath)) {
            return { tasks: [], message: `File not found: ${filepath}` };
        }

        const content = readFileSync(filepath, 'utf8');
        if (!content.trim()) {
            return { tasks: [], message: `File is empty: ${filepath}` };
        }

        const lines = content.split('\n').map(line => line.trim()).filter(line => line);
        const tasks = [];
        let currentPriority = 4;

        for (const line of lines) {
            if (line.startsWith('Priority ')) {
                currentPriority = parseInt(line.replace('Priority ', ''));
                continue;
            }

            if (line.includes('---') || line === '') {
                continue;
            }

            // Extract Todoist ID if present
            const todoistId = extractCorrelationId(line);
            const content = stripCorrelationId(line);

            if (content.trim()) {
                const task = {
                    content: content.trim(),
                    priority: currentPriority
                };
                
                if (todoistId) {
                    task.todoistId = todoistId;
                }

                tasks.push(task);
            }
        }

        return { tasks };
    } catch (error) {
        return { tasks: [], error: error.message };
    }
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
            return {
                current: { tasks: [], message: `Project "${TODOIST.PROJECT_NAME}" not found` },
                completed: { tasks: [], message: `Project "${TODOIST.PROJECT_NAME}" not found` }
            };
        }

        // Get active and completed tasks
        const activeTasks = await todoistAPI.getActiveTasks(syncProject.id);
        const completedTasks = await todoistAPI.getCompletedTasks(syncProject.id);

        return {
            current: {
                tasks: activeTasks.map(task => ({
                    id: task.id,
                    todoistId: task.id,
                    content: task.content,
                    priority: task.priority,
                    due: task.due ? task.due.date : null,
                    created: task.created_at
                }))
            },
            completed: {
                tasks: completedTasks.items.map(task => ({
                    id: task.id,
                    todoistId: task.id,
                    content: task.content,
                    priority: task.priority,
                    completed: task.completed_at
                }))
            }
        };
    } catch (error) {
        return {
            current: { tasks: [], error: error.message },
            completed: { tasks: [], error: error.message }
        };
    }
}

async function findLocalDuplicates() {
    const currentResult = await findDuplicatesInFile(FILE_PATHS.TASK, 'current');
    const completedResult = await findDuplicatesInFile(FILE_PATHS.COMPLETED, 'completed');

    return [currentResult, completedResult];
}

async function findDuplicatesInFile(filepath, taskType) {
    try {
        if (!existsSync(filepath)) {
            return {
                file: filepath,
                taskType,
                duplicates: [],
                message: `File not found: ${filepath}`
            };
        }

        const content = readFileSync(filepath, 'utf8');
        if (!content.trim()) {
            return {
                file: filepath,
                taskType,
                duplicates: [],
                message: `File is empty: ${filepath}`
            };
        }

        const lines = content.split('\n').map(line => line.trim()).filter(line => line);
        const taskContents = new Map();
        const duplicates = [];

        for (const line of lines) {
            if (line.startsWith('Priority ') || line.includes('---') || line === '') {
                continue;
            }

            const cleanContent = stripCorrelationId(line.trim()).toLowerCase();
            if (!cleanContent) continue;

            if (taskContents.has(cleanContent)) {
                duplicates.push({
                    content: cleanContent,
                    instances: [taskContents.get(cleanContent), line]
                });
            } else {
                taskContents.set(cleanContent, line);
            }
        }

        return {
            file: filepath,
            taskType,
            duplicates
        };
    } catch (error) {
        return {
            file: filepath,
            taskType,
            duplicates: [],
            error: error.message
        };
    }
}

async function findRemoteDuplicates() {
    if (!TODOIST.API_TOKEN) {
        return [{
            source: 'remote',
            duplicates: [],
            message: 'No Todoist API token configured'
        }];
    }

    try {
        const projects = await todoistAPI.getProjects();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);

        if (!syncProject) {
            return [{
                source: 'remote',
                duplicates: [],
                message: `Project "${TODOIST.PROJECT_NAME}" not found`
            }];
        }

        const tasks = await todoistAPI.getActiveTasks(syncProject.id);
        const taskContents = new Map();
        const duplicates = [];

        for (const task of tasks) {
            const cleanContent = task.content.trim().toLowerCase();
            if (!cleanContent) continue;

            if (taskContents.has(cleanContent)) {
                duplicates.push({
                    content: cleanContent,
                    instances: [taskContents.get(cleanContent), task]
                });
            } else {
                taskContents.set(cleanContent, task);
            }
        }

        return [{
            source: 'remote',
            duplicates
        }];
    } catch (error) {
        return [{
            source: 'remote',
            duplicates: [],
            error: error.message
        }];
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
            console.log(`Found ${result.duplicates.length} duplicate groups:`);
            
            result.duplicates.forEach((duplicate, index) => {
                console.log(`\n${index + 1}. "${duplicate.content}"`);
                duplicate.instances.forEach((instance, i) => {
                    if (isLocal) {
                        console.log(`   ${i + 1}. ${instance}`);
                    } else {
                        console.log(`   ${i + 1}. [ID: ${instance.id}] ${instance.content}`);
                    }
                });
            });
        }
    }

    return foundAnyDuplicates;
}

export async function removeDuplicates(source) {
    if (source === 'local') {
        console.log('🗑️  Removing local duplicates...');
        await removeLocalDuplicates();
    } else if (source === 'remote') {
        console.log('🗑️  Removing remote duplicates...');
        await removeRemoteDuplicates();
    }
}

async function removeLocalDuplicates() {
    try {
        const files = [FILE_PATHS.TASK, FILE_PATHS.COMPLETED];
        
        for (const filepath of files) {
            if (!existsSync(filepath)) continue;
            
            const content = readFileSync(filepath, 'utf8');
            const lines = content.split('\n');
            const seenTasks = new Set();
            const uniqueLines = [];
            
            for (const line of lines) {
                if (line.startsWith('Priority ') || line.includes('---') || line.trim() === '') {
                    uniqueLines.push(line);
                    continue;
                }
                
                const cleanContent = stripCorrelationId(line.trim()).toLowerCase();
                if (!cleanContent) {
                    uniqueLines.push(line);
                    continue;
                }
                
                if (!seenTasks.has(cleanContent)) {
                    seenTasks.add(cleanContent);
                    uniqueLines.push(line);
                } else {
                    console.log(`  Removed duplicate: ${line.trim()}`);
                }
            }
            
            writeFileSync(filepath, uniqueLines.join('\n'), 'utf8');
        }
        
        console.log('✅ Local duplicates removed');
    } catch (error) {
        console.error(`❌ Error removing local duplicates: ${error.message}`);
    }
}

async function removeRemoteDuplicates() {
    try {
        if (!TODOIST.API_TOKEN) {
            console.log('❌ No Todoist API token configured');
            return;
        }

        const projects = await todoistAPI.getProjects();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);

        if (!syncProject) {
            console.log(`❌ Project "${TODOIST.PROJECT_NAME}" not found`);
            return;
        }

        const tasks = await todoistAPI.getActiveTasks(syncProject.id);
        const seenTasks = new Map();
        const duplicatesToRemove = [];

        for (const task of tasks) {
            const cleanContent = task.content.trim().toLowerCase();
            if (!cleanContent) continue;

            if (seenTasks.has(cleanContent)) {
                // Keep the older task, remove the newer one
                const existingTask = seenTasks.get(cleanContent);
                const existingDate = new Date(existingTask.created_at);
                const currentDate = new Date(task.created_at);
                
                if (currentDate > existingDate) {
                    duplicatesToRemove.push(task);
                } else {
                    duplicatesToRemove.push(existingTask);
                    seenTasks.set(cleanContent, task);
                }
            } else {
                seenTasks.set(cleanContent, task);
            }
        }

        for (const task of duplicatesToRemove) {
            try {
                await todoistAPI.deleteTask(task.id);
                console.log(`  Removed duplicate: ${task.content}`);
            } catch (error) {
                console.error(`  Failed to remove task ${task.id}: ${error.message}`);
            }
        }

        console.log('✅ Remote duplicates removed');
    } catch (error) {
        console.error(`❌ Error removing duplicates from Remote: ${error.message}`);
    }
}

export async function executeSync(changes, showLocal, showRemote) {
    // Delegate to sync engine
    return await syncEngineExecuteSync(changes, showLocal, showRemote);
}

export async function createBackup() {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
                     (now.getMonth() + 1).toString().padStart(2, '0') +
                     now.getDate().toString().padStart(2, '0') + '.' +
                     now.getHours().toString().padStart(2, '0') +
                     now.getMinutes().toString().padStart(2, '0') +
                     now.getSeconds().toString().padStart(2, '0');
    const backupDir = join(FILE_PATHS.BACKUP_BASE, timestamp);

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
            console.log(`⚠️  Project "${TODOIST.PROJECT_NAME}" not found - skipping remote backup`);
            return;
        }

        // Get active tasks
        const tasksResponse = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${syncProject.id}`, {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        if (!tasksResponse.ok) {
            throw new Error(`Failed to fetch tasks: ${tasksResponse.status}`);
        }

        const tasks = await tasksResponse.json();

        // Get completed tasks (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const since = thirtyDaysAgo.toISOString();

        const completedResponse = await fetch(`https://api.todoist.com/sync/v9/completed/get_all?project_id=${syncProject.id}&since=${since}`, {
            headers: {
                Authorization: `Bearer ${TODOIST.API_TOKEN}`
            }
        });

        let completedTasks = [];
        if (completedResponse.ok) {
            const completedData = await completedResponse.json();
            completedTasks = completedData.items || [];
        }

        // Save remote data
        const remoteData = {
            project: syncProject,
            activeTasks: tasks,
            completedTasks: completedTasks,
            backupDate: new Date().toISOString()
        };

        const yamlContent = yaml.dump(remoteData, { indent: 2, lineWidth: 120 });
        writeFileSync(join(backupDir, 'remote.yaml'), yamlContent);

    } catch (error) {
        console.error(`⚠️  Remote backup failed: ${error.message}`);
    }
}

export async function createLocalTask(content, priority = 4) {
    try {
        const newTask = {
            content: content.trim(),
            priority: priority,
            isNew: true
        };

        const taskId = await addTaskToLocalFileSimple(newTask);
        
        await logTransaction({
            type: 'create',
            source: 'cli',
            timestamp: getCurrentTimestamp(),
            task: content.trim(),
            priority: priority,
            local_id: taskId
        });

        console.log(`✅ Created local task: ${content} (Priority ${priority})`);
        return { success: true, taskId };
    } catch (error) {
        console.error(`❌ Failed to create local task: ${error.message}`);
        return { success: false, error: error.message };
    }
}

export async function createRemoteTaskByContent(content, priority = 4) {
    try {
        if (!TODOIST.API_TOKEN) {
            throw new Error('No Todoist API token configured');
        }

        const projects = await todoistAPI.getProjects();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);
        
        if (!syncProject) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        const task = await todoistAPI.createTask({
            content: content.trim(),
            project_id: syncProject.id,
            priority: PRIORITY_MAPPING.LOCAL_TO_REMOTE[priority] || 1
        });

        console.log(`✅ Created remote task: ${content} (Priority ${priority}, ID: ${task.id})`);
        return { success: true, taskId: task.id };
    } catch (error) {
        console.error(`❌ Failed to create remote task: ${error.message}`);
        return { success: false, error: error.message };
    }
}

export async function updateLocalTask(taskName, options) {
    try {
        const tasks = await getTasksFromFile(FILE_PATHS.TASK);
        const targetTask = tasks.tasks.find(task => 
            task.content.toLowerCase().includes(taskName.toLowerCase())
        );

        if (!targetTask) {
            throw new Error(`Task not found: ${taskName}`);
        }

        // Update task in file
        const result = await updateTaskInFile(targetTask, options);
        
        await logTransaction({
            type: 'update',
            source: 'cli',
            timestamp: getCurrentTimestamp(),
            task: targetTask.content,
            changes: options
        });

        console.log(`✅ Updated local task: ${targetTask.content}`);
        return { success: true, task: result };
    } catch (error) {
        console.error(`❌ Failed to update local task: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function updateTaskInFile(task, options) {
    const filepath = FILE_PATHS.TASK;
    const content = readFileSync(filepath, 'utf8');
    let newContent = content;

    // Update task content
    if (options.content) {
        newContent = newContent.replace(task.content, options.content.trim());
        task.content = options.content.trim();
    }

    // Update priority (move to different section)
    if (options.priority !== undefined && options.priority !== task.priority) {
        // Remove from current section
        const lines = newContent.split('\n');
        const taskLineIndex = lines.findIndex(line => 
            line.trim().toLowerCase().includes(task.content.toLowerCase())
        );
        
        if (taskLineIndex >= 0) {
            const taskLine = lines[taskLineIndex];
            lines.splice(taskLineIndex, 1);

            // Add to new priority section
            const newPriorityHeader = `Priority ${options.priority}`;
            let inserted = false;

            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith(newPriorityHeader)) {
                    // Find the separator line and insert after it
                    for (let j = i + 1; j < lines.length; j++) {
                        if (lines[j].includes('---')) {
                            lines.splice(j + 1, 0, taskLine);
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
                lines.push(taskLine);
            }

            newContent = lines.join('\n');
            task.priority = options.priority;
        }
    }

    writeFileSync(filepath, newContent, 'utf8');
    return task;
}

export async function updateRemoteTaskByName(taskName, options) {
    try {
        if (!TODOIST.API_TOKEN) {
            throw new Error('No Todoist API token configured');
        }

        const projects = await todoistAPI.getProjects();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);
        
        if (!syncProject) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        const tasks = await todoistAPI.getActiveTasks(syncProject.id);
        const targetTask = tasks.find(task => 
            task.content.toLowerCase().includes(taskName.toLowerCase())
        );

        if (!targetTask) {
            throw new Error(`Task not found: ${taskName}`);
        }

        const updateData = {};
        if (options.content) {
            updateData.content = options.content.trim();
        }
        if (options.priority !== undefined) {
            updateData.priority = PRIORITY_MAPPING.LOCAL_TO_REMOTE[options.priority] || 1;
        }

        await todoistAPI.updateTask(targetTask.id, updateData);

        console.log(`✅ Updated remote task: ${targetTask.content} (ID: ${targetTask.id})`);
        return { success: true, taskId: targetTask.id };
    } catch (error) {
        console.error(`❌ Failed to update remote task: ${error.message}`);
        return { success: false, error: error.message };
    }
}

export async function completeLocalTask(taskName) {
    try {
        const tasks = await getTasksFromFile(FILE_PATHS.TASK);
        const targetTask = tasks.tasks.find(task => 
            task.content.toLowerCase().includes(taskName.toLowerCase())
        );

        if (!targetTask) {
            throw new Error(`Task not found: ${taskName}`);
        }

        // Move task from current to completed
        await moveTaskToCompleted(targetTask);
        
        await logTransaction({
            type: 'complete',
            source: 'cli',
            timestamp: getCurrentTimestamp(),
            task: targetTask.content,
            priority: targetTask.priority
        });

        console.log(`✅ Completed local task: ${targetTask.content}`);
        return { success: true, taskId: targetTask.todoistId };
    } catch (error) {
        console.error(`❌ Failed to complete local task: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function moveTaskToCompleted(task) {
    const currentFilepath = FILE_PATHS.TASK;
    const completedFilepath = FILE_PATHS.COMPLETED;

    // Remove from current file
    const currentContent = readFileSync(currentFilepath, 'utf8');
    const currentLines = currentContent.split('\n');
    const filteredLines = currentLines.filter(line => {
        const cleanLine = line.trim().toLowerCase();
        const cleanTaskContent = task.content.toLowerCase();
        return !cleanLine.includes(cleanTaskContent);
    });
    writeFileSync(currentFilepath, filteredLines.join('\n'), 'utf8');

    // Add to completed file
    let completedContent = '';
    if (existsSync(completedFilepath)) {
        completedContent = readFileSync(completedFilepath, 'utf8');
    }

    const completedDate = new Date().toLocaleDateString();
    const taskContent = `${task.content} (completed: ${completedDate})`;
    
    if (completedContent && !completedContent.endsWith('\n')) {
        completedContent += '\n';
    }
    completedContent += taskContent + '\n';

    writeFileSync(completedFilepath, completedContent, 'utf8');
}

export async function completeRemoteTaskByName(taskName) {
    try {
        if (!TODOIST.API_TOKEN) {
            throw new Error('No Todoist API token configured');
        }

        const projects = await todoistAPI.getProjects();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);
        
        if (!syncProject) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        const tasks = await todoistAPI.getActiveTasks(syncProject.id);
        const targetTask = tasks.find(task => 
            task.content.toLowerCase().includes(taskName.toLowerCase())
        );

        if (!targetTask) {
            throw new Error(`Task not found: ${taskName}`);
        }

        await todoistAPI.completeTask(targetTask.id);

        console.log(`✅ Completed remote task: ${targetTask.content} (ID: ${targetTask.id})`);
        return { success: true, taskId: targetTask.id };
    } catch (error) {
        console.error(`❌ Failed to complete remote task: ${error.message}`);
        return { success: false, error: error.message };
    }
}

export async function cancelLocalTask(taskName) {
    try {
        const tasks = await getTasksFromFile(FILE_PATHS.TASK);
        const targetTask = tasks.tasks.find(task => 
            task.content.toLowerCase().includes(taskName.toLowerCase())
        );

        if (!targetTask) {
            throw new Error(`Task not found: ${taskName}`);
        }

        // Remove task from file
        await removeTaskFromFile(targetTask);
        
        await logTransaction({
            type: 'cancel',
            source: 'cli',
            timestamp: getCurrentTimestamp(),
            task: targetTask.content,
            priority: targetTask.priority
        });

        console.log(`✅ Cancelled local task: ${targetTask.content}`);
        return { success: true, taskId: targetTask.todoistId };
    } catch (error) {
        console.error(`❌ Failed to cancel local task: ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function removeTaskFromFile(task) {
    const filepath = FILE_PATHS.TASK;
    const content = readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    const filteredLines = lines.filter(line => {
        const cleanLine = line.trim().toLowerCase();
        const cleanTaskContent = task.content.toLowerCase();
        return !cleanLine.includes(cleanTaskContent);
    });
    writeFileSync(filepath, filteredLines.join('\n'), 'utf8');
}

export async function cancelRemoteTask(taskName) {
    try {
        if (!TODOIST.API_TOKEN) {
            throw new Error('No Todoist API token configured');
        }

        const projects = await todoistAPI.getProjects();
        const syncProject = projects.find(p => p.name === TODOIST.PROJECT_NAME);
        
        if (!syncProject) {
            throw new Error(`Project "${TODOIST.PROJECT_NAME}" not found`);
        }

        const tasks = await todoistAPI.getActiveTasks(syncProject.id);
        const targetTask = tasks.find(task => 
            task.content.toLowerCase().includes(taskName.toLowerCase())
        );

        if (!targetTask) {
            throw new Error(`Task not found: ${taskName}`);
        }

        await todoistAPI.deleteTask(targetTask.id);

        console.log(`✅ Cancelled remote task: ${targetTask.content} (ID: ${targetTask.id})`);
        return { success: true, taskId: targetTask.id };
    } catch (error) {
        console.error(`❌ Failed to cancel remote task: ${error.message}`);
        return { success: false, error: error.message };
    }
}

export function categorizeChanges(localTasks, todoistTasks, legacySyncState = null, previewMode = false) {
    // Delegate to sync engine
    return syncEngineCategorizeChanges(localTasks, todoistTasks, legacySyncState, previewMode);
}

async function addTaskToLocalFileSimple(task) {
    const filepath = FILE_PATHS.TASK;
    const priority = task.priority;

    try {
        let content = '';
        if (existsSync(filepath)) {
            content = readFileSync(filepath, 'utf8');
        }

        const newTaskLine = `${task.content}\n`;
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
        return null; // Simple version doesn't return an ID
    } catch (error) {
        throw new Error(`Failed to add task to local file: ${error.message}`);
    }
}

async function ensureProjectExists(projectName, apiToken) {
    const projects = await todoistAPI.getProjects();
    const existingProject = projects.find(p => p.name === projectName);

    if (existingProject) {
        return existingProject;
    }

    console.log(`📋 Creating Todoist project: ${projectName}`);
    const newProject = await todoistAPI.createProject(projectName);
    console.log(`✅ Created project: ${projectName} (ID: ${newProject.id})`);
    return newProject;
}

export { ensureProjectExists };