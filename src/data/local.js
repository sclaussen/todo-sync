import { readFileSync, writeFileSync, existsSync } from 'fs';
import { FILE_PATHS, PRIORITIES } from '../config/constants.js';
import { Task } from '../models/Task.js';
import { extractCorrelationId, stripCorrelationId, addCorrelationId } from '../../taskLog.js';

export async function getLocalTasks() {
    return {
        current: parseLocalFile(FILE_PATHS.TASK),
        completed: parseLocalFile(FILE_PATHS.COMPLETED)
    };
}

function parseLocalFile(filepath) {
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

            if (!trimmedLine || trimmedLine.includes('---')) continue;

            // Check for priority section headers
            if (trimmedLine.startsWith('Priority ')) {
                const match = trimmedLine.match(/Priority (\d+)/);
                if (match) {
                    currentPriority = parseInt(match[1]);
                    currentParentTask = null;
                }
                continue;
            }

            // Parse task
            const todoistId = extractCorrelationId(trimmedLine);
            const cleanContent = cleanTaskContent(stripCorrelationId(trimmedLine));
            const priority = currentPriority !== null ? currentPriority : PRIORITIES.LOWEST;

            if (trimmedLine.startsWith('- ')) {
                // Subtask
                const task = new Task(cleanContent, priority, todoistId, {
                    isSubtask: true,
                    parentContent: currentParentTask?.content
                });
                
                if (currentParentTask) {
                    if (!currentParentTask.subtasks) currentParentTask.subtasks = [];
                    currentParentTask.subtasks.push(task);
                }
                tasks.push(task);
            } else {
                // Main task
                const task = new Task(cleanContent, priority, todoistId);
                tasks.push(task);
                currentParentTask = task;
            }
        }

        return { tasks };
    } catch (error) {
        return { tasks: [], error: error.message };
    }
}

function cleanTaskContent(content) {
    // Remove date prefixes and comment suffixes
    return content
        .replace(/^\d{2}\/\d{2}\s+/, '')
        .replace(/\s*\(comments?:\s*.*?\)$/, '')
        .trim();
}

export async function addTaskToLocal(task, priority = PRIORITIES.LOWEST) {
    const filepath = FILE_PATHS.TASK;
    let content = existsSync(filepath) ? readFileSync(filepath, 'utf8') : '';
    
    const taskContent = task.hasCorrelation() 
        ? addCorrelationId(task.content, task.todoistId)
        : task.content;
    
    const priorityHeader = `Priority ${priority}`;
    const separator = '-------------------------------------------------------------------------------';

    if (content.includes(priorityHeader)) {
        // Add to existing section
        const lines = content.split('\n');
        const insertIndex = findInsertionPoint(lines, priority);
        lines.splice(insertIndex, 0, taskContent);
        content = lines.join('\n');
    } else {
        // Create new section
        if (content && !content.endsWith('\n')) content += '\n';
        content += `\n${priorityHeader}\n${separator}\n${taskContent}\n`;
    }

    writeFileSync(filepath, content, 'utf8');
}

export async function addCompletedTaskToLocal(task) {
    const filepath = FILE_PATHS.COMPLETED;
    let content = existsSync(filepath) ? readFileSync(filepath, 'utf8') : '';
    
    const completedDate = task.completed 
        ? new Date(task.completed).toLocaleDateString()
        : new Date().toLocaleDateString();
    
    const taskContent = task.content.includes('(completed:')
        ? task.content
        : `${task.content} (completed: ${completedDate})`;

    if (content && !content.endsWith('\n')) content += '\n';
    content += `${taskContent}\n`;

    writeFileSync(filepath, content, 'utf8');
}

export async function removeTaskFromLocal(taskContent) {
    const filepath = FILE_PATHS.TASK;
    if (!existsSync(filepath)) return false;

    const content = readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    
    const filteredLines = lines.filter(line => {
        const cleanLine = stripCorrelationId(line.trim()).toLowerCase();
        return !cleanLine.includes(taskContent.toLowerCase().trim());
    });

    writeFileSync(filepath, filteredLines.join('\n'), 'utf8');
    return true;
}

export async function updateTaskInLocal(oldContent, newTask) {
    const filepath = FILE_PATHS.TASK;
    if (!existsSync(filepath)) return false;

    const content = readFileSync(filepath, 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const cleanLine = stripCorrelationId(line).toLowerCase();
        
        if (cleanLine.includes(oldContent.toLowerCase())) {
            const updatedContent = newTask.hasCorrelation()
                ? addCorrelationId(newTask.content, newTask.todoistId)
                : newTask.content;
            lines[i] = lines[i].replace(line, updatedContent);
            break;
        }
    }

    writeFileSync(filepath, lines.join('\n'), 'utf8');
    return true;
}

function findInsertionPoint(lines, priority) {
    const priorityHeader = `Priority ${priority}`;
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === priorityHeader) {
            // Find the separator and return the line after it
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].includes('---')) {
                    return j + 1;
                }
            }
        }
    }
    return lines.length;
}