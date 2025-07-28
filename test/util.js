#!/usr/bin/env node

import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ensureProjectExists, getTasks } from '../lib.js';
import dotenv from 'dotenv';
import _ from 'lodash';

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
    TODO_DIR: TEST_DIR,
    TODOIST_PROJECT_NAME: 'Test',
    TODOIST_API_TOKEN: process.env.TODOIST_API_TOKEN,
    DOTENV_CONFIG_SILENT: 'true'  // Suppress dotenv output
};

/**
 * Test utility - sh() function for running CLI commands
 */
function sh(command, options = {}) {
    const { echo = false, rc = null } = options;
    
    try {
        if (echo) {
            console.log(command);
        }
        
        const result = execSync(command, { 
            env: testEnv, 
            encoding: 'utf8',
            stdio: 'pipe',
            cwd: join(__dirname, '..')
        });
        
        // Check expected return code if specified
        if (rc !== null && rc !== 0) {
            throw new Error(`Expected non-zero return code ${rc}, but command succeeded`);
        }
        
        return result.trim();
    } catch (error) {
        if (rc !== null && rc !== 0) {
            // Expected failure - silent
            return error.stdout ? error.stdout.trim() : '';
        } else {
            console.error(`❌ Command failed: ${command}`);
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
async function init() {
    // Ensure test project exists (create if needed)
    await setupTestProject();
    
    // Clear all tasks from the test project if it exists
    await clearTodoistProject();
    
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
 * Normalize YAML output by removing location and due fields
 */
function normalize(yamlOutput) {
    return _(yamlOutput)
        .split('\n')
        .reject(line => 
            _.startsWith(_.trim(line), 'location:') || 
            _.startsWith(_.trim(line), 'due:')
        )
        .filter(line => !_.isEmpty(_.trim(line)))
        .join('\n');
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
    TEST_DIR, 
    TASKS_CLI 
};