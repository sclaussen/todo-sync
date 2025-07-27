#!/usr/bin/env node

import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync } from 'fs';
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
    // Use existing TODOIST_API_TOKEN from environment if available
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
 * Test: List local tasks
 */
function testListLocalTasks() {
    console.log('\n📋 Testing: List local tasks');
    const result = runTasksCLI('list -l');
    
    // Should contain tasks from our test file
    if (!result.output.includes('urgent test task')) {
        throw new Error('Expected to find "urgent test task" in output');
    }
    
    if (!result.output.includes('Priority 0')) {
        throw new Error('Expected to find priority sections in output');
    }
    
    console.log('✅ List local tasks test passed');
}

/**
 * Test: List completed tasks
 */
function testListCompletedTasks() {
    console.log('\n📋 Testing: List completed tasks');
    const result = runTasksCLI('list -l -c');
    
    // Should contain completed tasks from our test file
    if (!result.output.includes('fixed critical security vulnerability')) {
        throw new Error('Expected to find completed tasks in output');
    }
    
    console.log('✅ List completed tasks test passed');
}

/**
 * Test: Create local task
 */
function testCreateLocalTask() {
    console.log('\n📝 Testing: Create local task');
    
    const testTaskContent = `test task created at ${new Date().toISOString()}`;
    const result = runTasksCLI(`create "${testTaskContent}" -l -P 2`);
    
    // Verify task was created by listing tasks
    const listResult = runTasksCLI('list -l');
    if (!listResult.output.includes(testTaskContent)) {
        throw new Error(`Expected to find "${testTaskContent}" in task list`);
    }
    
    console.log('✅ Create local task test passed');
}

/**
 * Test: YAML output format
 */
function testYamlOutput() {
    console.log('\n📊 Testing: YAML output format');
    const result = runTasksCLI('list -l -y');
    
    // Should contain YAML structure (array of tasks)
    if (!result.output.includes('- name:') || !result.output.includes('priority:')) {
        throw new Error('Expected YAML format output');
    }
    
    console.log('✅ YAML output test passed');
}

/**
 * Test: Sync preview (dry-run)
 */
function testSyncPreview() {
    console.log('\n🔄 Testing: Sync preview');
    
    if (!testEnv.TODOIST_API_TOKEN) {
        console.log('⚠️  Skipping sync preview test - no TODOIST_API_TOKEN configured');
        return;
    }
    
    // Run sync in preview mode
    const result = runTasksCLI('sync -p');
    
    // Preview should not throw errors and should show what would be synced
    console.log('✅ Sync preview test passed');
}

/**
 * Run all tests
 */
function runTests() {
    console.log('🧪 Starting tasks.js CLI tests...');
    console.log(`📁 Test directory: ${TEST_DIR}`);
    
    // Ensure test data directory exists
    if (!existsSync(TEST_DIR)) {
        throw new Error(`Test data directory not found: ${TEST_DIR}`);
    }
    
    try {
        testListLocalTasks();
        testListCompletedTasks();
        testCreateLocalTask();
        testYamlOutput();
        testSyncPreview();
        
        console.log('\n🎉 All tests passed!');
    } catch (error) {
        console.error(`\n💥 Test failed: ${error.message}`);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (process.argv[1] === __filename) {
    runTests();
}

export { runTests, runTasksCLI };