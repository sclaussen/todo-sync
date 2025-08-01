#!/usr/bin/env node

import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ensureProjectExists, getTasks } from '../lib.js';
import dotenv from 'dotenv';
import _ from 'lodash';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from parent directory (suppress output)
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};
dotenv.config({ path: join(__dirname, '..', '.env') });
console.log = originalConsoleLog;
console.error = originalConsoleError;
console.warn = originalConsoleWarn;
console.info = originalConsoleInfo;

// Test configuration - use a subdirectory inside test
const TEST_DIR = join(__dirname, '.tasks');
const TASKS_CLI = join(__dirname, '..', 'tasks.js');

// Test environment
const testEnv = {
    ...process.env,
    TASKS_DIR: TEST_DIR,
    TODOIST_PROJECT_NAME: 'Test',
    TODOIST_API_TOKEN: process.env.TODOIST_API_TOKEN,
    DOTENV_CONFIG_SILENT: 'true'  // Suppress dotenv output
};

/**
 * Test utility - sh() function for running CLI commands
 */
function sh(command, options = {}) {
    const { echo = true, output = true, rc = 0, exp = null, errmsg = null } = options;
    
    try {
        // Replace 'node tasks.js' with the full path to tasks.js
        const processedCommand = command.replace(/node tasks\.js/g, `node ${TASKS_CLI}`);
        
        if (echo) {
            console.log(`$ ${processedCommand}`);
        }
        
        const result = execSync(processedCommand, { 
            env: testEnv, 
            encoding: 'utf8',
            stdio: 'pipe',
            cwd: join(__dirname, '..')
        });
        
        // Check expected return code if specified
        if (rc !== 0) {
            throw new Error(`Expected non-zero return code ${rc}, but command succeeded`);
        }
        
        const commandOutput = result.trim();
        
        // Print command output if enabled
        if (output && commandOutput) {
            console.log(commandOutput);
        }
        
        // Validate YAML output if expression provided
        if (exp) {
            let data;
            try {
                data = yaml.load(commandOutput) || [];
            } catch (yamlError) {
                throw new Error(`Failed to parse YAML output: ${yamlError.message}`);
            }
            
            // Create evaluation context
            const count = Array.isArray(data) ? data.length : (data ? 1 : 0);
            const length = count;  // alias for count
            
            // Evaluate the validation expression
            let isValid;
            try {
                // Create a safe evaluation context
                const evalContext = { count, length, data };
                const func = new Function('count', 'length', 'data', `return ${exp}`);
                isValid = func(count, length, data);
            } catch (evalError) {
                throw new Error(`Invalid validation expression "${exp}": ${evalError.message}`);
            }
            
            if (!isValid) {
                const defaultMsg = `Validation failed: ${exp} (count=${count})`;
                throw new Error(errmsg || defaultMsg);
            }
        }
        
        return commandOutput;
    } catch (error) {
        if (rc !== 0) {
            // Expected failure - silent
            return error.stdout ? error.stdout.trim() : '';
        } else {
            const processedCommand = command.replace(/node tasks\.js/g, `node ${TASKS_CLI}`);
            console.error(`❌ Command failed: ${processedCommand}`);
            console.error(`Error: ${error.message}`);
            if (error.stdout) console.error(`STDOUT: ${error.stdout}`);
            if (error.stderr) console.error(`STDERR: ${error.stderr}`);
            throw error;
        }
    }
}

/**
 * Set up test project in Todoist if needed
 */
async function setupTestProject() {
    const apiToken = process.env.TODOIST_API_TOKEN;
    const projectName = testEnv.TODOIST_PROJECT_NAME;
    
    if (!apiToken) {
        return null;
    }
    
    try {
        const project = await ensureProjectExists(projectName, apiToken);
        return project;
    } catch (error) {
        return null;
    }
}

/**
 * Clear all tasks from the test Todoist project
 */
async function clearTodoistProject() {
    const apiToken = process.env.TODOIST_API_TOKEN;
    const projectName = testEnv.TODOIST_PROJECT_NAME;
    
    if (!apiToken) {
        return;
    }
    
    try {
        // Get the project ID
        const project = await ensureProjectExists(projectName, apiToken);
        
        // Fetch current tasks directly from the Test project using Todoist API
        const tasksResponse = await fetch(`https://api.todoist.com/rest/v2/tasks?project_id=${project.id}`, {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!tasksResponse.ok) {
            throw new Error(`Failed to fetch tasks: ${tasksResponse.status}`);
        }
        
        const tasks = await tasksResponse.json();
        
        // Delete all current tasks in the project
        for (const task of tasks) {
            try {
                await fetch(`https://api.todoist.com/rest/v2/tasks/${task.id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${apiToken}`,
                        'Content-Type': 'application/json'
                    }
                });
            } catch (error) {
                // Silent failure - continue with other deletions
            }
        }
        
        // Fetch and delete completed tasks from the Test project
        const completedResponse = await fetch(`https://api.todoist.com/sync/v9/completed/get_all?project_id=${project.id}`, {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (completedResponse.ok) {
            const completedData = await completedResponse.json();
            const completedTasks = completedData.items || [];
            
            // Delete all completed tasks using the task_id field and REST API v2
            for (const completedTask of completedTasks) {
                try {
                    // Use task_id for REST API v2 deletion
                    const taskId = completedTask.task_id;
                    
                    await fetch(`https://api.todoist.com/rest/v2/tasks/${taskId}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${apiToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                } catch (error) {
                    // Silent failure - continue with other deletions
                }
            }
        }
        
    } catch (error) {
        // Silent failure
    }
}

/**
 * Test utility - init function to set up clean test environment
 * Creates test project if needed, clears all tasks, and sets up local files
 */
async function init(option = null) {
    const initLocal = !option || option === '-l';
    const initRemote = !option || option === '-r';
    
    if (initRemote) {
        // Ensure test project exists (create if needed)
        await setupTestProject();
        
        // Clear all tasks from the test project if it exists
        await clearTodoistProject();
    }
    
    if (initLocal) {
        // Ensure test directory exists
        mkdirSync(TEST_DIR, { recursive: true });
        
        // Clean up backups directory but keep the directory itself
        const backupsDir = join(TEST_DIR, 'backups');
        if (existsSync(backupsDir)) {
            rmSync(backupsDir, { recursive: true, force: true });
        }
        mkdirSync(backupsDir, { recursive: true });
        
        // Create empty current.tasks file (overwrite existing)
        const emptyTasksContent = `Priority 0
-------------------------------------------------------------------------------

Priority 1
-------------------------------------------------------------------------------

Priority 2
-------------------------------------------------------------------------------

Priority 3
-------------------------------------------------------------------------------

Priority 4
-------------------------------------------------------------------------------

`;
        
        writeFileSync(join(TEST_DIR, 'current.tasks'), emptyTasksContent);
        
        // Create empty completed.yaml file (overwrite existing)
        writeFileSync(join(TEST_DIR, 'completed.yaml'), 'completed: []\n');
        
        // Create empty transactions.yaml file (overwrite existing)
        const emptyTransactionsContent = `# Entries are append-only, ordered chronologically
entries:
`;
        writeFileSync(join(TEST_DIR, 'transactions.yaml'), emptyTransactionsContent);
    }
}

/**
 * Simple diff function for comparing task outputs
 */
function diff(local, remote) {
    // Simple comparison - in real implementation you might want more sophisticated diff
    if (local === remote) {
        return null;
    }
    
    return {
        local: local.split('\n').filter(line => line.trim()),
        remote: remote.split('\n').filter(line => line.trim()),
        message: 'Tasks differ between local and remote'
    };
}

/**
 * Clean up test files and Todoist project (call at end of tests)
 */
async function cleanup() {
    // Clear remote Todoist project
    await clearTodoistProject();
    
    // Clean up test task files (but keep the directory)
    const tasksFile = join(TEST_DIR, 'current.tasks');
    const completedFile = join(TEST_DIR, 'completed');
    const transactionsFile = join(TEST_DIR, 'transactions.yaml');
    
    if (existsSync(tasksFile)) {
        rmSync(tasksFile);
    }
    if (existsSync(completedFile)) {
        rmSync(completedFile);
    }
    if (existsSync(transactionsFile)) {
        rmSync(transactionsFile);
    }
    
    console.log('🧹 Cleaned up test task files');
}

/**
 * Get configured test environment
 */
function getTestEnv() {
    return testEnv;
}

/**
 * Get tasks CLI path
 */
function getTasksCLI() {
    return TASKS_CLI;
}

/**
 * Normalize YAML output by removing location and due fields, then sorting tasks
 */
function normalize(yamlOutput) {
    try {
        // Parse YAML to get task objects
        const tasks = yaml.load(yamlOutput) || [];
        
        // If not an array, return original normalization
        if (!Array.isArray(tasks)) {
            return _(yamlOutput)
                .split('\n')
                .reject(line => 
                    _.startsWith(_.trim(line), 'location:') || 
                    _.startsWith(_.trim(line), 'due:')
                )
                .filter(line => !_.isEmpty(_.trim(line)))
                .join('\n');
        }
        
        // Remove location and due fields, then sort by ID for consistent ordering
        const normalized = tasks
            .map(task => _.omit(task, ['location', 'due']))
            .sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        
        // Convert back to YAML
        return yaml.dump(normalized).trim();
    } catch (error) {
        // Fallback to original string-based normalization if YAML parsing fails
        return _(yamlOutput)
            .split('\n')
            .reject(line => 
                _.startsWith(_.trim(line), 'location:') || 
                _.startsWith(_.trim(line), 'due:')
            )
            .filter(line => !_.isEmpty(_.trim(line)))
            .join('\n');
    }
}

function enter(message) {
    console.log(`ℹ️  ${message}`);
}

function success(message) {
    console.log(`✅ ${message}`);
    console.log();
}

function fail(message) {
    console.log(`❌ ${message}`);
    console.log();
}

export { 
    sh, 
    init, 
    diff, 
    cleanup, 
    getTestEnv, 
    getTasksCLI, 
    setupTestProject,
    clearTodoistProject,
    normalize,
    enter,
    success,
    fail,
    TEST_DIR, 
    TASKS_CLI 
};