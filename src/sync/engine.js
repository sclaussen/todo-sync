import { FILE_PATHS, TODOIST, logTransaction, getCurrentTimestamp } from '../config/constants.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';
import {
    extractCorrelationId,
    stripCorrelationId,
    addCorrelationId
} from '../utils/correlationId.js';
import { todoistAPI } from '../api/todoist.js';

// Priority mapping for local to remote and vice versa
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

// Utility functions
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

function mapLocalPriorityToRemote(localPriority) {
    return PRIORITY_MAPPING.LOCAL_TO_REMOTE[localPriority] || 1;
}

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

// Remote helper functions
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
            taskId: createdTask.id,
            due: createdTask.due ? createdTask.due.date || createdTask.due.string : null
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

// Local file helper functions
async function addTaskToLocalFile(task) {
    const filepath = FILE_PATHS.TASK;
    const priority = task.metadata?.priority !== undefined ? task.metadata.priority : 4;

    try {
        let content = '';
        if (existsSync(filepath)) {
            content = readFileSync(filepath, 'utf8');
        }

        // Check both task.id and task.todoistId (the actual field used)
        const todoistId = task.id || task.todoistId;
        
        // Check if task already exists in the file (to prevent duplicates)
        if (todoistId && content.includes(`(${todoistId})`)) {
            // Task already exists, skip adding it
            return;
        }

        // Add Todoist ID for new task if it's from Remote
        let taskContentWithCorr = task.content;
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

        if (change.changeType === 'add_correlation_id') {
            // Add correlation ID to existing task without changing priority or content
            const lines = content.split('\n');
            const taskContent = change.content;
            
            // Find the task line
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                const cleanLine = stripCorrelationId(line);
                if (cleanLine.toLowerCase().trim() === taskContent.toLowerCase().trim()) {
                    // Add correlation ID to this line
                    lines[i] = addCorrelationId(cleanLine, change.corrId);
                    break;
                }
            }
            
            newContent = lines.join('\n');
        } else if (change.changeType === 'priority_update') {
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

/**
 * Main sync execution function - orchestrates bidirectional synchronization
 * @param {Object} changes - Categorized changes from categorizeChanges()
 * @param {boolean} showLocal - Whether to execute local changes
 * @param {boolean} showRemote - Whether to execute remote changes
 * @returns {Object} Sync results with success status and any errors
 */
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
        
        // Log sync transaction if successful
        if (results.success && allChanges.length > 0) {
            // Count changes by type and location
            const localChangesCount = allChanges.filter(c => c.location === 'local').length;
            const remoteChangesCount = allChanges.filter(c => c.location === 'remote').length;
            
            // Build summary counts
            const counts = {
                local: { new: 0, updated: 0, completed: 0 },
                remote: { new: 0, updated: 0, completed: 0 }
            };
            
            allChanges.forEach(change => {
                const location = change.location === 'local' ? 'local' : 'remote';
                const action = change.action.toLowerCase();
                if (action === 'new') counts[location].new++;
                else if (action === 'updated') counts[location].updated++;
                else if (action === 'completed') counts[location].completed++;
            });
            
            // Build summary string
            const summaryParts = [];
            if (counts.local.new > 0 || counts.remote.new > 0) {
                summaryParts.push(`Created: ${counts.local.new} local, ${counts.remote.new} remote`);
            }
            if (counts.local.updated > 0 || counts.remote.updated > 0) {
                summaryParts.push(`Updated: ${counts.local.updated} local, ${counts.remote.updated} remote`);
            }
            if (counts.local.completed > 0 || counts.remote.completed > 0) {
                summaryParts.push(`Completed: ${counts.local.completed} local, ${counts.remote.completed} remote`);
            }
            
            const summary = summaryParts.join(' | ');
            
            // Log the sync transaction
            await logTransaction({
                type: 'sync',
                timestamp: getCurrentTimestamp(),
                summary: summary,
                local_changes: localChangesCount,
                remote_changes: remoteChangesCount
            });
        }

    } catch (error) {
        results.success = false;
        results.error = error.message;
    }

    return results;
}

/**
 * Display sync results in organized format
 * @param {Array} allChanges - Array of change objects to display
 */
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
        const priorityNum = change.metadata?.priority !== undefined ? change.metadata.priority : change.priority;
        const priority = `P${priorityNum}`;
        const idInfo = change.todoistId ? `, ${change.todoistId}` : '';
        
        // Add date for P0 remote tasks
        let dateInfo = '';
        if (location === 'remote' && priorityNum === 0 && change.metadata?.due) {
            const dueDate = new Date(change.metadata.due + 'T00:00:00');
            dateInfo = `, ${dueDate.getMonth() + 1}/${dueDate.getDate()}/${dueDate.getFullYear().toString().slice(-2)}`;
        }
        
        const priorityAndId = `(${priority}${dateInfo}${idInfo})`;
        
        if (change.action === 'Updated' && change.oldPriority !== undefined) {
            console.log(`Updated ${location} task: ${change.taskName} ${priorityAndId} -> old priority P${change.oldPriority}`);
        } else if (change.action === 'Updated' && change.updateType === 'id-added') {
            console.log(`Updated ${location} task: ${change.taskName} ${priorityAndId}`);
        } else {
            console.log(`${change.action} ${location} task: ${change.taskName} ${priorityAndId}`);
        }
    });
}

// Note: executeLocalChanges, executeRemoteChanges, and categorizeChanges are complex functions
// that need to be extracted from lib.js. This is a partial implementation to establish the module structure.
// TODO: Complete the extraction of the remaining sync functions

/**
 * Execute local changes (remote to local sync)
 */
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
            // logSyncOperation('create', 'local', {
            //     todoistId: change.todoistId,
            //     content: change.content,
            //     priority: change.metadata?.priority,
            //     source: 'todoist'
            // });
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

/**
 * Execute remote changes (local to remote sync)
 */
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
                // logSyncOperation('create', 'todoist', {
                //     todoistId: result.taskId,
                //     content: change.content,
                //     priority: change.metadata?.priority,
                //     source: 'local'
                // });

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
                    todoistId: result.taskId,
                    metadata: {
                        priority: change.metadata?.priority !== undefined ? change.metadata.priority : 4,
                        due: result.due
                    }
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
                    // logSyncOperation('update', 'todoist', {
                    //     todoistId: change.todoistId,
                    //     content: change.content,
                    //     priority: change.newPriority,
                    //     oldPriority: change.oldPriority,
                    //     source: 'local'
                    // });
                    allChanges.push({
                        action: 'Updated',
                        location: 'remote',
                        taskName: change.content,
                        priority: change.newPriority,
                        oldPriority: change.oldPriority,
                        todoistId: change.todoistId
                    });
                } else {
                    // logSyncOperation('update', 'todoist', {
                    //     todoistId: change.todoistId,
                    //     oldContent: change.oldContent,
                    //     content: change.newContent,
                    //     source: 'local'
                    // });
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

/**
 * Categorize changes between local and remote tasks for synchronization
 * @param {Object} localData - Local tasks data structure  
 * @param {Object} todoistData - Todoist tasks data structure
 * @param {Object} legacySyncState - Legacy sync state (unused)
 * @param {boolean} previewMode - Whether in preview mode
 * @returns {Object} Categorized changes with local, todoist, and conflicts arrays
 */
export function categorizeChanges(localData, todoistData, legacySyncState = null, previewMode = false) {
    const changes = {
        local: {
            noneToCurrent: [],
            noneToCompleted: [],
            currentToCompleted: [],
            renames: []
        },
        todoist: {
            noneToCurrent: [],
            noneToCompleted: [],
            currentToCompleted: [],
            renames: []
        },
        conflicts: []
    };

    // Extract tasks from data structures
    const localTasks = localData?.current?.tasks || [];
    const localCompleted = localData?.completed?.tasks || [];
    const todoistTasks = todoistData?.current?.tasks || [];
    const todoistCompleted = todoistData?.completed?.tasks || [];

    // Create maps for easier lookup
    const localTaskMap = new Map();
    const todoistTaskMap = new Map();
    
    // Build local task map
    localTasks.forEach(task => {
        if (task && task.content) {
            const correlationId = extractCorrelationId(task.content);
            if (correlationId) {
                localTaskMap.set(correlationId, task);
            }
        }
    });
    
    // Build todoist task map  
    todoistTasks.forEach(task => {
        if (task && task.todoistId) {
            todoistTaskMap.set(task.todoistId.toString(), {
                ...task,
                metadata: {
                    priority: mapRemotePriority(task),
                    todoistId: task.todoistId,
                    due: task.due
                }
            });
        }
    });

    // Find tasks that exist in Todoist but not locally (todoist → local)
    todoistTasks.forEach(task => {
        if (task && task.todoistId) {
            const taskId = task.todoistId.toString();
            if (!localTaskMap.has(taskId)) {
                changes.local.noneToCurrent.push({
                    content: stripCorrelationId(task.content || ''),
                    todoistId: taskId,
                    metadata: {
                        priority: mapRemotePriority(task),
                        todoistId: taskId,
                        due: task.due
                    }
                });
            }
        }
    });

    // Find tasks that exist locally but not in Todoist (local → todoist)
    localTasks.forEach(task => {
        if (task && task.content) {
            const correlationId = extractCorrelationId(task.content);
            if (!correlationId || !todoistTaskMap.has(correlationId)) {
                changes.todoist.noneToCurrent.push({
                    content: stripCorrelationId(task.content),
                    metadata: {
                        priority: task.priority
                    }
                });
            }
        }
    });

    return changes;
}