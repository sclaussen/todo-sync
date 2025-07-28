import yaml from 'js-yaml';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { FILE_PATHS, PRIORITIES } from '../config/constants.js';
import { Task } from '../models/Task.js';
import { extractCorrelationId, stripCorrelationId, addCorrelationId } from '../utils/correlationId.js';

/**
 * Retrieves all local tasks from both the current tasks file and completed tasks file
 * @returns {Promise<{current: {tasks: Array, error?: string}, completed: {tasks: Array, error?: string}}>}
 */
export async function getLocalTasks() {
    return {
        current: parseLocalFile(FILE_PATHS.TASK),
        completed: parseLocalFile(FILE_PATHS.COMPLETED)
    };
}

/**
 * Parses a local task file (either .tasks format or .yaml format)
 * @param {string} filepath - Path to the file to parse
 * @returns {{tasks: Array<Task>, error?: string}} Parsed tasks and any error
 */
function parseLocalFile(filepath) {
    if (!existsSync(filepath)) {
        return { tasks: [], error: `File ${filepath} does not exist` };
    }

    try {
        const content = readFileSync(filepath, 'utf8');

        // Handle YAML completed file format
        if (filepath.endsWith('.yaml')) {
            if (!content.trim()) {
                return { tasks: [] };
            }
            const yamlData = yaml.load(content);
            if (yamlData && yamlData.completed && Array.isArray(yamlData.completed)) {
                const tasks = yamlData.completed.map(item => {
                    const task = new Task(item.name, PRIORITIES.LOWEST, null, {
                        completed: item.date
                    });
                    return task;
                });
                return { tasks };
            }
            return { tasks: [] };
        }

        // Handle regular task file format
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

/**
 * Cleans task content by removing date prefixes and comment suffixes
 * @param {string} content - Raw task content
 * @returns {string} Cleaned task content
 * @example
 *
 * // Input: "12/25 Buy Christmas gifts (comment: for family)"
 * // Output: "Buy Christmas gifts"
 *
 * // Input: "01/30 Schedule dentist appointment (comments: check insurance first)"
 * // Output: "Schedule dentist appointment"
 *
 * // Input: "Review project proposal"
 * // Output: "Review project proposal"
 */
function cleanTaskContent(content) {
    // Remove date prefixes and comment suffixes
    return content
        .replace(/^\d{2}\/\d{2}\s+/, '')
        .replace(/\s*\(comments?:\s*.*?\)$/, '')
        .trim();
}

/**
 * Adds a new task to the local tasks file under the specified priority section
 * @param {Task} task - Task object to add
 * @param {number} priority - Priority level (0-4, default is 4)
 */
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

/**
 * Adds a task to the completed tasks YAML file
 * @param {Task} task - Task object to mark as completed
 */
export async function addCompletedTaskToLocal(task) {
    const filepath = FILE_PATHS.COMPLETED;

    // Load existing YAML data or create new structure
    let yamlData = { completed: [] };
    if (existsSync(filepath)) {
        const content = readFileSync(filepath, 'utf8');
        if (content.trim()) {
            try {
                yamlData = yaml.load(content) || { completed: [] };
            } catch (error) {
                console.warn(`Warning: Could not parse existing completed file, creating new one`);
                yamlData = { completed: [] };
            }
        }
    }

    // Ensure completed array exists
    if (!yamlData.completed) {
        yamlData.completed = [];
    }

    const completedDate = task.completed
          ? new Date(task.completed).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

    // Clean task content of old completion markers
    const taskName = task.content.replace(/\s*\(completed:.*?\)$/, '').trim();

    // Add to completed array
    yamlData.completed.push({
        name: taskName,
        date: completedDate
    });

    // Write YAML file
    const yamlContent = yaml.dump(yamlData, { indent: 2, lineWidth: 120 });
    writeFileSync(filepath, yamlContent, 'utf8');
}

/**
 * Removes a task from the local tasks file by matching content
 * @param {string} taskContent - Content of the task to remove
 * @returns {Promise<boolean>} True if successful
 */
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

/**
 * Updates an existing task in the local tasks file
 * @param {string} oldContent - Original task content to find
 * @param {Task} newTask - Updated task object
 * @returns {Promise<boolean>} True if successful
 */
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

/**
 * Finds the correct line index to insert a new task within a priority section
 * @param {Array<string>} lines - Array of file lines
 * @param {number} priority - Priority level to find
 * @returns {number} Line index for insertion
 */
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
