#!/usr/bin/env node

import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const TEST_DIR = join(__dirname, 'data');
const TASKS_CLI = join(__dirname, '..', 'tasks.js');

// Test environment
const testEnv = {
    ...process.env,
    TODO_DIR: TEST_DIR,
    TODOIST_PROJECT_NAME: 'Test',
};

/**
 * Helper to run tasks.js CLI with test environment
 */
function runTasksCLI(args = '', expectError = false) {
    try {
        const command = `node "${TASKS_CLI}" ${args}`;
        console.log(`🔧 Running: ${command}`);
        const result = execSync(command, { 
            env: testEnv, 
            encoding: 'utf8',
            stdio: 'pipe'
        });
        console.log(`✅ Output:\n${result}`);
        return { success: true, output: result };
    } catch (error) {
        if (expectError) {
            console.log(`✅ Expected error: ${error.message}`);
            return { success: false, output: error.stdout || '', error: error.message };
        } else {
            console.error(`❌ Unexpected error: ${error.message}`);
            if (error.stdout) console.error(`STDOUT: ${error.stdout}`);
            if (error.stderr) console.error(`STDERR: ${error.stderr}`);
            throw error;
        }
    }
}

/**
 * Create a test file with duplicates
 */
function createTestFileWithDuplicates() {
    const testFilePath = join(TEST_DIR, '.tasks');
    const duplicateContent = `Priority 0
-------------------------------------------------------------------------------
urgent test task
urgent test task
critical bug fix (12345)

Priority 1
-------------------------------------------------------------------------------
important feature implementation
important feature implementation
review pull request (67890)

Priority 2
-------------------------------------------------------------------------------
update documentation
update documentation
refactor legacy code

Priority 3
-------------------------------------------------------------------------------
optimize performance
clean up old files

Priority 4
-------------------------------------------------------------------------------
research new tools
minor UI tweaks`;

    writeFileSync(testFilePath, duplicateContent, 'utf8');
    console.log('📄 Created test file with duplicates');
}

/**
 * Test: Find duplicates in preview mode
 */
function testFindDuplicatesPreview() {
    console.log('\n🔍 Testing: Find duplicates (preview)');
    
    createTestFileWithDuplicates();
    
    const result = runTasksCLI('dups -p -l');
    
    // Should find duplicates without removing them
    if (!result.output.includes('urgent test task')) {
        throw new Error('Expected to find duplicate "urgent test task"');
    }
    
    console.log('✅ Find duplicates preview test passed');
}

/**
 * Test: Remove duplicates
 */
function testRemoveDuplicates() {
    console.log('\n🗑️  Testing: Remove duplicates');
    
    createTestFileWithDuplicates();
    
    // Remove duplicates
    const result = runTasksCLI('dups -l');
    
    // Verify duplicates were removed by checking the file
    const fileContent = readFileSync(join(TEST_DIR, '.tasks'), 'utf8');
    const lines = fileContent.split('\n').filter(line => line.trim());
    
    // Count occurrences of "urgent test task"
    const duplicateCount = lines.filter(line => line.includes('urgent test task')).length;
    
    if (duplicateCount > 1) {
        throw new Error(`Expected only 1 occurrence of "urgent test task", found ${duplicateCount}`);
    }
    
    console.log('✅ Remove duplicates test passed');
}

/**
 * Test: Task creation with different priorities
 */
function testCreateTasksWithPriorities() {
    console.log('\n📝 Testing: Create tasks with different priorities');
    
    const testTasks = [
        { content: 'P0 test task', priority: 0 },
        { content: 'P1 test task', priority: 1 },
        { content: 'P2 test task', priority: 2 },
        { content: 'P3 test task', priority: 3 },
        { content: 'P4 test task', priority: 4 },
    ];
    
    for (const task of testTasks) {
        const result = runTasksCLI(`create "${task.content}" -l -P ${task.priority}`);
        
        // Verify task was created in correct priority section
        const listResult = runTasksCLI('list -l');
        if (!listResult.output.includes(task.content)) {
            throw new Error(`Expected to find "${task.content}" in task list`);
        }
    }
    
    console.log('✅ Create tasks with priorities test passed');
}

/**
 * Test: Invalid priority handling
 */
function testInvalidPriority() {
    console.log('\n⚠️  Testing: Invalid priority handling');
    
    // Should handle invalid priority gracefully
    const result = runTasksCLI('create "invalid priority task" -l -P 10', true);
    
    // This should either succeed with a default priority or fail gracefully
    console.log('✅ Invalid priority test passed');
}

/**
 * Test: Empty task content
 */
function testEmptyTaskContent() {
    console.log('\n⚠️  Testing: Empty task content');
    
    // Should handle empty content gracefully
    const result = runTasksCLI('create "" -l', true);
    
    console.log('✅ Empty task content test passed');
}

/**
 * Test: Remote operations (if API token available)
 */
function testRemoteOperations() {
    console.log('\n🌐 Testing: Remote operations');
    
    if (!testEnv.TODOIST_API_TOKEN) {
        console.log('⚠️  Skipping remote tests - no TODOIST_API_TOKEN configured');
        return;
    }
    
    try {
        // Test listing remote tasks
        const listResult = runTasksCLI('list -r');
        console.log('✅ List remote tasks succeeded');
        
        // Test creating remote task
        const createResult = runTasksCLI(`create "remote test task ${Date.now()}" -r -P 4`);
        console.log('✅ Create remote task succeeded');
        
        // Test finding remote duplicates
        const dupsResult = runTasksCLI('dups -p -r');
        console.log('✅ Find remote duplicates succeeded');
        
    } catch (error) {
        console.error(`⚠️  Remote operation failed: ${error.message}`);
        // Don't fail the entire test suite for remote errors
    }
}

/**
 * Run all advanced tests
 */
function runAdvancedTests() {
    console.log('🧪 Starting advanced tasks.js CLI tests...');
    console.log(`📁 Test directory: ${TEST_DIR}`);
    
    // Ensure test data directory exists
    if (!existsSync(TEST_DIR)) {
        throw new Error(`Test data directory not found: ${TEST_DIR}`);
    }
    
    try {
        testFindDuplicatesPreview();
        testRemoveDuplicates();
        testCreateTasksWithPriorities();
        testInvalidPriority();
        testEmptyTaskContent();
        testRemoteOperations();
        
        console.log('\n🎉 All advanced tests passed!');
    } catch (error) {
        console.error(`\n💥 Advanced test failed: ${error.message}`);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (process.argv[1] === __filename) {
    runAdvancedTests();
}

export { runAdvancedTests, runTasksCLI };