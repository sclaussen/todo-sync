#!/usr/bin/env node
import { sh, init, diff, cleanup, getTestEnv, setupTestProject, normalize, enter, success, fail } from './util.js';
import { fileURLToPath } from 'url';
import { Command } from 'commander';

const program = new Command();

program
    .name('test')
    .description('Run task synchronization tests')
    .option('-l, --local', 'Run local-only tests')
    .option('-r, --remote', 'Run remote-only tests')
    .option('-s, --sync', 'Run sync tests (syncUp and syncDown)')
    .parse(process.argv);
const options = program.opts();
// If no options specified, run all tests
const runAll = !options.local && !options.remote && !options.sync;
const context = {
    local: options.local || runAll,
    remote: options.remote || runAll,
    sync: options.sync || runAll
};

async function complete(context, option = '-l') {
    enter(`complete ${option}`);
    await init(option);

    const expectedCount = option ? 1 : 2; // -l or -r = 1 task, null = 2 tasks (local & remote)
    sh(`node tasks.js create ${option} p1 task`);
    sh(`node tasks.js list ${option} -y`, { exp: `count === ${option ? 1 : 2}`, errmsg: `Should have ${option ? 1 : 2} task(s) after create` });
    sh(`node tasks.js complete ${option} p1 task`);
    sh(`node tasks.js list ${option} -y`, { exp: 'count === 0', errmsg: 'Should have 0 tasks after complete' });
    sh(`node tasks.js list ${option} -c -y`, { exp: `count === ${option ? 1 : 2}`, errmsg: `Should have ${option ? 1 : 2} completed task(s)` });
    success(`complete ${option}`);
}

async function remove(context, option = '-l') {
    enter(`remove ${option}`);
    await init(option);

    const expectedCount = option ? 1 : 2; // -l or -r = 1 task, null = 2 tasks (local & remote)
    sh(`node tasks.js create ${option} p1 task`);
    sh(`node tasks.js list ${option} -y`, { exp: `count === ${option ? 1 : 2}`, errmsg: `Should have ${option ? 1 : 2} task(s) after create` });
    sh(`node tasks.js remove ${option} p1 task`);
    sh(`node tasks.js list ${option} -y`, { exp: 'count === 0', errmsg: 'Should have 0 tasks after remove' });
    success(`remove ${option}`);
}

async function priorityZero(context) {
    enter(`priority zero`);
    await init('-r');

    // Create P0 task and verify it has a due date set (should be today)
    sh(`node tasks.js create -r -P0 p0`);
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 0 && t.due !== null)`,
        errmsg: `P0 task should have a due date set`
    });

    // Update to P1 and verify due date is removed
    sh(`node tasks.js update -r -P1 p0`);
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 1 && t.due === null)`,
        errmsg: `P1 task should have no due date`
    });

    // Update back to P0 and verify due date is set again
    sh(`node tasks.js update -r -P0 p0`);
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 0 && t.due !== null)`,
        errmsg: `P0 task should have a due date set again`
    });

    success(`priority zero`);
}

async function priority(context, option = '-l', initialPriority = null) {
    enter(`priority ${initialPriority !== null ? initialPriority : 'default'} ${option || 'both'}`);
    await init(option);

    // Create task with specified priority (null defaults to 1)
    const expectedPriority = initialPriority !== null ? initialPriority : 1;
    const priorityFlag = initialPriority !== null ? `-P ${initialPriority}` : '';
    const optionFlag = option || '';
    const expectedCount = option ? 1 : 2; // -l or -r = 1 task, null = 2 tasks (local & remote)

    sh(`node tasks.js create ${optionFlag} ${priorityFlag} priority test task`);
    sh(`node tasks.js list ${optionFlag} -y`, { exp: `count === ${expectedCount}`, errmsg: `Should have ${expectedCount} task(s) after create` });
    sh(`node tasks.js list ${optionFlag} -y`, { exp: `data.some(t => t.priority === ${expectedPriority})`, errmsg: `Task should have priority ${expectedPriority}` });

    // Pick two random priorities between 0-4 for updates
    const newPriority = Math.floor(Math.random() * 5);
    sh(`node tasks.js update ${optionFlag} -P ${newPriority} priority test task`);
    sh(`node tasks.js list ${optionFlag} -y`, { exp: `count === ${expectedCount}`, errmsg: `Should still have ${expectedCount} task(s) after update` });
    sh(`node tasks.js list ${optionFlag} -y`, { exp: `data.some(t => t.priority === ${newPriority})`, errmsg: `Task should have updated priority ${newPriority}` });

    success(`priority ${initialPriority !== null ? initialPriority : 'default'} ${option || 'both'}`);
}

async function syncUpPriorityZero(context) {
    enter('syncUpPriorityZero');
    await init();

    // Create local P0 task
    sh(`node tasks.js create -l -P0 p0`);
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 0)`,
        errmsg: `Local P0 task should exist`
    });

    // Sync to remote
    sh(`node tasks.js sync`);

    // Verify remote task has P0 with due date
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 0 && t.due !== null)`,
        errmsg: `Remote P0 task should have a due date after sync`
    });

    // Verify local task still has P0 priority and now has correlation ID
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 0 && t.id !== null)`,
        errmsg: `Local P0 task should have correlation ID after sync`
    });

    success('syncUpPriorityZero');
}

async function syncDownPriorityZero(context) {
    enter('syncDownPriorityZero');
    await init();

    // Create remote P0 task with due date
    sh(`node tasks.js create -r -P0 p0`);
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 0 && t.due !== null)`,
        errmsg: `Remote P0 task should have a due date`
    });

    // Sync to local
    sh(`node tasks.js sync`);

    // Verify local task has P0 priority with correlation ID
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 0 && t.id !== null)`,
        errmsg: `Local P0 task should exist with correlation ID after sync`
    });

    // Verify remote task still has P0 with due date
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p0' && t.priority === 0 && t.due !== null)`,
        errmsg: `Remote P0 task should still have due date after sync`
    });

    success('syncDownPriorityZero');
}

async function syncUp(context) {
    enter('syncUp');
    await init();

    sh(`node tasks.js create -l -P0 p0`);
    sh(`node tasks.js create -l -P1 p1`);
    sh(`node tasks.js create -l -P2 p2`);
    sh(`node tasks.js create -l -P3 p3`);
    sh(`node tasks.js create -l -P4 p4`);

    // Check transaction log before sync - should have create entries
    const transBefore = sh(`node tasks.js tran`);
    const createCount = (transBefore.match(/type: create/g) || []).length;
    if (createCount !== 5) {
        fail(`Transaction log should have 5 create entries, found ${createCount}`);
        throw new Error();
    }

    sh(`node tasks.js sync`);

    const localTasks = sh(`node tasks.js list -l -y`);
    const remoteTasks = sh(`node tasks.js list -r -y`);
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    if (differences) {
        fail(differences.message);
        console.log(localTasks);
        console.log(remoteTasks);
        throw new Error();
    }

    // Check transaction log after sync - should have sync entry
    const transAfter = sh(`node tasks.js tran`);
    if (!transAfter.includes('type: sync')) {
        fail('Transaction log should have sync entry after sync');
        console.log('Transaction log contents:');
        console.log(transAfter);
        throw new Error();
    }

    success('syncUp');
}

async function syncDown(context) {
    enter('syncDown');
    await init();

    // Create tasks with all priority levels locally first
    sh(`node tasks.js create -r -P0 p0`);
    sh(`node tasks.js create -r -P1 p1`);
    sh(`node tasks.js create -r -P2 p2`);
    sh(`node tasks.js create -r -P3 p3`);
    sh(`node tasks.js create -r -P4 p4`);
    sh(`node tasks.js sync`);

    const localTasks = sh(`node tasks.js list -l -y`);
    const remoteTasks = sh(`node tasks.js list -r -y`);
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    if (differences) {
        fail(differences.message);
        console.log(localTasks);
        console.log(remoteTasks);
        throw new Error();
    }

    success('syncDown');
}


// Helper function to create initial synced state with tasks at different priorities
async function syncedState() {
    sh(`node tasks.js create -l -P0 p0`);
    sh(`node tasks.js create -l -P1 p1`);
    sh(`node tasks.js create -l -P2 p2`);
    sh(`node tasks.js create -l -P3 p3`);
    sh(`node tasks.js create -l -P4 p4`);
    
    sh(`node tasks.js sync`);
    
    const localTasks = sh(`node tasks.js list -l -y`);
    const remoteTasks = sh(`node tasks.js list -r -y`);
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    if (differences) {
        fail('Initial sync failed: ' + differences.message);
        throw new Error();
    }
}

// Parameterized test functions for reusable patterns

// Simple sync operation pattern (used by tests 1-5 and their remote equivalents)
async function simpleSync(operation, option = '-l', taskName = 'test task') {
    const side = option === '-l' ? 'local' : 'remote';
    const otherSide = option === '-l' ? 'remote' : 'local';
    const otherOption = option === '-l' ? '-r' : '-l';
    
    enter(`${operation} ${side} (parameterized)`);
    await init();
    
    // Setup: Create initial task if needed
    if (operation !== 'create') {
        sh(`node tasks.js create ${option} ${taskName}`);
        if (operation === 'update-name' || operation === 'update-priority' || 
            operation === 'complete' || operation === 'remove') {
            // For update/complete/remove operations, sync first to have correlated tasks
            sh(`node tasks.js sync`);
        }
    }
    
    // Action: Perform operation
    switch(operation) {
        case 'create':
            sh(`node tasks.js create ${option} ${taskName}`);
            break;
        case 'update-name':
            sh(`node tasks.js update ${option} "${taskName}" "updated ${taskName}"`);
            taskName = `updated ${taskName}`;
            break;
        case 'update-priority':
            sh(`node tasks.js update ${option} -P2 "${taskName}"`);
            break;
        case 'complete':
            sh(`node tasks.js complete ${option} "${taskName}"`);
            break;
        case 'remove':
            sh(`node tasks.js remove ${option} "${taskName}"`);
            break;
    }
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify: Check state propagated to other side
    switch(operation) {
        case 'create':
        case 'update-name':
        case 'update-priority':
            sh(`node tasks.js list ${otherOption} -y`, {
                exp: `data.some(t => t.name === '${taskName}')`,
                errmsg: `Task should exist on ${otherSide} after sync`
            });
            break;
        case 'complete':
        case 'remove':
            sh(`node tasks.js list ${otherOption} -y`, {
                exp: `!data.some(t => t.name === '${taskName}')`,
                errmsg: `Task should not exist on ${otherSide} after sync`
            });
            break;
    }
    
    success(`${operation} ${side} (parameterized)`);
}

// Compound operation pattern (create → multiple updates → final state)
async function compoundSync(operations, option = '-l', initialTaskName = 'compound task') {
    const side = option === '-l' ? 'local' : 'remote';
    const otherOption = option === '-l' ? '-r' : '-l';
    
    enter(`Compound operations ${operations.join(' → ')} ${side} (parameterized)`);
    await init();
    
    let currentTaskName = initialTaskName;
    
    // Perform operations in sequence
    for (const operation of operations) {
        switch(operation.type) {
            case 'create':
                sh(`node tasks.js create ${option} ${currentTaskName}`);
                break;
            case 'update-name':
                sh(`node tasks.js update ${option} "${currentTaskName}" "${operation.newName}"`);
                currentTaskName = operation.newName;
                break;
            case 'update-priority':
                sh(`node tasks.js update ${option} -P${operation.priority} "${currentTaskName}"`);
                break;
            case 'complete':
                sh(`node tasks.js complete ${option} "${currentTaskName}"`);
                break;
            case 'remove':
                sh(`node tasks.js remove ${option} "${currentTaskName}"`);
                break;
        }
    }
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify final state based on last operation
    const lastOp = operations[operations.length - 1];
    const otherSide = option === '-l' ? 'remote' : 'local';
    
    if (lastOp.type === 'complete' || lastOp.type === 'remove') {
        sh(`node tasks.js list ${otherOption} -y`, {
            exp: `!data.some(t => t.name === '${currentTaskName}')`,
            errmsg: `Task should not exist on ${otherSide} after sync`
        });
    } else {
        sh(`node tasks.js list ${otherOption} -y`, {
            exp: `data.some(t => t.name === '${currentTaskName}')`,
            errmsg: `Task should exist on ${otherSide} after sync`
        });
    }
    
    success(`Compound operations ${operations.join(' → ')} ${side} (parameterized)`);
}

// Conflict resolution pattern (both sides modify same task)
async function conflictSync(localChange, remoteChange, expectedResolution, taskName = 'conflict task') {
    enter(`Conflict ${localChange.type} vs ${remoteChange.type} (parameterized)`);
    await init();
    await syncedState();
    
    // Apply local change
    switch(localChange.type) {
        case 'update-name':
            sh(`node tasks.js update -l "p1" "${localChange.newName}"`);
            break;
        case 'update-priority':
            sh(`node tasks.js update -l -P${localChange.priority} "p1"`);
            break;
        case 'complete':
            sh(`node tasks.js complete -l "p1"`);
            break;
        case 'remove':
            sh(`node tasks.js remove -l "p1"`);
            break;
    }
    
    // Apply remote change
    switch(remoteChange.type) {
        case 'update-name':
            sh(`node tasks.js update -r "p1" "${remoteChange.newName}"`);
            break;
        case 'update-priority':
            sh(`node tasks.js update -r -P${remoteChange.priority} "p1"`);
            break;
        case 'complete':
            sh(`node tasks.js complete -r "p1"`);
            break;
        case 'remove':
            sh(`node tasks.js remove -r "p1"`);
            break;
    }
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify expected resolution
    switch(expectedResolution.type) {
        case 'local-wins':
            // Verify local change is preserved on both sides
            if (localChange.type === 'update-name') {
                sh(`node tasks.js list -l -y`, {
                    exp: `data.some(t => t.name === '${localChange.newName}')`,
                    errmsg: 'Local name should win'
                });
                sh(`node tasks.js list -r -y`, {
                    exp: `data.some(t => t.name === '${localChange.newName}')`,
                    errmsg: 'Local name should win on remote'
                });
            }
            break;
        case 'merge':
            // Verify both changes are applied
            break;
        case 'terminal-state':
            // Verify task is completed/removed on both sides
            sh(`node tasks.js list -l -y`, {
                exp: `!data.some(t => t.name.includes('p1'))`,
                errmsg: 'Task should be in terminal state locally'
            });
            sh(`node tasks.js list -r -y`, {
                exp: `!data.some(t => t.name.includes('p1'))`,
                errmsg: 'Task should be in terminal state remotely'
            });
            break;
    }
    
    success(`Conflict ${localChange.type} vs ${remoteChange.type} (parameterized)`);
}

// Test 1: Create task local → sync → verify created remote
async function test1CreateLocal() {
    enter('Test 1: Create local → sync → verify remote');
    await init();

    // Create task locally
    sh(`node tasks.js create -l test task`);

    // Verify task exists locally
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'test task')`,
        errmsg: 'Task should exist locally'
    });

    // Sync
    sh(`node tasks.js sync`);

    // Verify task exists remotely
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'test task')`,
        errmsg: 'Task should exist remotely after sync'
    });

    // Verify local task now has correlation ID
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'test task' && t.id !== null)`,
        errmsg: 'Local task should have correlation ID after sync'
    });

    success('Test 1: Create local → sync → verify remote');
}

// Test 2: Update name local → sync → verify updated remote
async function test2UpdateNameLocal() {
    enter('Test 2: Update name local → sync → verify remote');
    await init();
    await syncedState();
    
    sh(`node tasks.js update -l "p1" "updated task name"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `data.some(t => t.name === 'updated task name')`, 
        errmsg: 'Task should have updated name locally' 
    });
    sh(`node tasks.js sync`);
    sh(`node tasks.js list -r -y`, { 
        exp: `data.some(t => t.name === 'updated task name')`, 
        errmsg: 'Task should have updated name remotely after sync' 
    });
    
    success('Test 2: Update name local → sync → verify remote');
}

// Test 3: Update priority local → sync → verify priority updated remote
async function test3UpdatePriorityLocal() {
    enter('Test 3: Update priority local → sync → verify remote');
    await init();
    await syncedState();
    
    sh(`node tasks.js update -l -P2 "p1"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `data.some(t => t.name === 'p1' && t.priority === 2)`, 
        errmsg: 'Task should have updated priority locally' 
    });
    sh(`node tasks.js sync`);
    sh(`node tasks.js list -r -y`, { 
        exp: `data.some(t => t.name === 'p1' && t.priority === 2)`, 
        errmsg: 'Task should have updated priority remotely after sync' 
    });
    
    success('Test 3: Update priority local → sync → verify remote');
}

// Test 4: Complete task local → sync → verify completed remote
async function test4CompleteLocal() {
    enter('Test 4: Complete local → sync → verify remote');
    await init();
    await syncedState();
    
    sh(`node tasks.js complete -l "p1"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'p1')`, 
        errmsg: 'Task should be removed from active tasks locally' 
    });
    sh(`node tasks.js list -l -c -y`, { 
        exp: `data.some(t => t.name === 'p1')`, 
        errmsg: 'Task should appear in completed tasks locally' 
    });
    sh(`node tasks.js sync`);
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'p1')`, 
        errmsg: 'Task should be removed from active tasks remotely after sync' 
    });
    
    success('Test 4: Complete local → sync → verify remote');
}

// Test 5: Remove task local → sync → verify deleted remote
async function test5RemoveLocal() {
    enter('Test 5: Remove local → sync → verify remote');
    await init();
    await syncedState();
    
    sh(`node tasks.js remove -l "p1"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'p1')`, 
        errmsg: 'Task should be removed locally' 
    });
    sh(`node tasks.js sync`);
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'p1')`, 
        errmsg: 'Task should be removed remotely after sync' 
    });
    
    success('Test 5: Remove local → sync → verify remote');
}

// Test 14: Create local → update name → update priority → sync
async function test14CompoundLocal() {
    enter('Test 14: Create local → update name → update priority → sync');
    await init();
    
    // Create task locally
    sh(`node tasks.js create -l test task`);
    
    // Update name
    sh(`node tasks.js update -l "test task" "updated task"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `data.some(t => t.name === 'updated task')`, 
        errmsg: 'Task should have updated name locally' 
    });
    
    // Update priority
    sh(`node tasks.js update -l -P2 "updated task"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `data.some(t => t.name === 'updated task' && t.priority === 2)`, 
        errmsg: 'Task should have updated priority locally' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task exists remotely with final name and priority
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'updated task' && t.priority === 2)`,
        errmsg: 'Task should exist remotely with final name and priority after sync'
    });
    
    success('Test 14: Create local → update name → update priority → sync');
}

// Test 15: Create local → update name → update priority → complete → sync
async function test15CompoundCompleteLocal() {
    enter('Test 15: Create local → update name → update priority → complete → sync');
    await init();
    
    // Create task locally
    sh(`node tasks.js create -l test task`);
    
    // Update name and priority
    sh(`node tasks.js update -l "test task" "completed task"`);
    sh(`node tasks.js update -l -P3 "completed task"`);
    
    // Complete task
    sh(`node tasks.js complete -l "completed task"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'completed task')`, 
        errmsg: 'Task should be removed from active tasks locally' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task doesn't exist in remote active tasks
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'completed task')`, 
        errmsg: 'Task should not exist in remote active tasks after sync' 
    });
    
    success('Test 15: Create local → update name → update priority → complete → sync');
}

// Test 16: Create local → update name → update priority → remove → sync
async function test16CompoundRemoveLocal() {
    enter('Test 16: Create local → update name → update priority → remove → sync');
    await init();
    
    // Create task locally
    sh(`node tasks.js create -l test task`);
    
    // Update name and priority
    sh(`node tasks.js update -l "test task" "removed task"`);
    sh(`node tasks.js update -l -P4 "removed task"`);
    
    // Remove task
    sh(`node tasks.js remove -l "removed task"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'removed task')`, 
        errmsg: 'Task should be removed locally' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task doesn't exist remotely (never existed there)
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'removed task')`, 
        errmsg: 'Task should not exist remotely' 
    });
    
    success('Test 16: Create local → update name → update priority → remove → sync');
}

// Test 19: Existing synced task → update priority → update name → sync
async function test19ExistingSyncedLocal() {
    enter('Test 19: Existing synced task → update priority → update name → sync');
    await init();
    await syncedState();
    
    // Update priority then name of existing synced task
    sh(`node tasks.js update -l -P3 "p1"`);
    sh(`node tasks.js update -l "p1" "modified p1"`);
    
    // Verify changes locally
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'modified p1' && t.priority === 3)`,
        errmsg: 'Task should have updated name and priority locally'
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify changes propagated to remote
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'modified p1' && t.priority === 3)`,
        errmsg: 'Task should have updated name and priority remotely after sync'
    });
    
    success('Test 19: Existing synced task → update priority → update name → sync');
}

// Test 20: Existing synced task → update name → update priority → complete → sync
async function test20ExistingSyncedCompleteLocal() {
    enter('Test 20: Existing synced task → update name → update priority → complete → sync');
    await init();
    await syncedState();
    
    // Update name and priority of existing synced task
    sh(`node tasks.js update -l "p2" "completed p2"`);
    sh(`node tasks.js update -l -P0 "completed p2"`);
    
    // Complete task
    sh(`node tasks.js complete -l "completed p2"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'completed p2')`, 
        errmsg: 'Task should be removed from active tasks locally' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task completed remotely
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'completed p2')`, 
        errmsg: 'Task should not exist in remote active tasks after sync' 
    });
    
    success('Test 20: Existing synced task → update name → update priority → complete → sync');
}

// Test 21: Existing synced task → update priority → update name → remove → sync
async function test21ExistingSyncedRemoveLocal() {
    enter('Test 21: Existing synced task → update priority → update name → remove → sync');
    await init();
    await syncedState();
    
    // Update priority and name of existing synced task
    sh(`node tasks.js update -l -P4 "p3"`);
    sh(`node tasks.js update -l "p3" "removed p3"`);
    
    // Remove task
    sh(`node tasks.js remove -l "removed p3"`);
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'removed p3')`, 
        errmsg: 'Task should be removed locally' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task removed remotely
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'removed p3')`, 
        errmsg: 'Task should be removed remotely after sync' 
    });
    
    success('Test 21: Existing synced task → update priority → update name → remove → sync');
}

// Remote versions of compound tests (Tests 22-32 equivalent)

// Test 22: Create remote → update name → update priority → sync (equivalent to Test 14)
async function test22CompoundRemote() {
    enter('Test 22: Create remote → update name → update priority → sync');
    await init();
    
    // Create task remotely
    sh(`node tasks.js create -r test task`);
    
    // Update name
    sh(`node tasks.js update -r "test task" "updated task"`);
    sh(`node tasks.js list -r -y`, { 
        exp: `data.some(t => t.name === 'updated task')`, 
        errmsg: 'Task should have updated name remotely' 
    });
    
    // Update priority
    sh(`node tasks.js update -r -P2 "updated task"`);
    sh(`node tasks.js list -r -y`, { 
        exp: `data.some(t => t.name === 'updated task' && t.priority === 2)`, 
        errmsg: 'Task should have updated priority remotely' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task exists locally with final name and priority
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'updated task' && t.priority === 2)`,
        errmsg: 'Task should exist locally with final name and priority after sync'
    });
    
    success('Test 22: Create remote → update name → update priority → sync');
}

// Test 23: Create remote → update name → update priority → complete → sync (equivalent to Test 15)
async function test23CompoundCompleteRemote() {
    enter('Test 23: Create remote → update name → update priority → complete → sync');
    await init();
    
    // Create task remotely
    sh(`node tasks.js create -r test task`);
    
    // Update name and priority
    sh(`node tasks.js update -r "test task" "completed task"`);
    sh(`node tasks.js update -r -P3 "completed task"`);
    
    // Complete task
    sh(`node tasks.js complete -r "completed task"`);
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'completed task')`, 
        errmsg: 'Task should be removed from active tasks remotely' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task doesn't exist in local active tasks
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'completed task')`, 
        errmsg: 'Task should not exist in local active tasks after sync' 
    });
    
    success('Test 23: Create remote → update name → update priority → complete → sync');
}

// Test 24: Create remote → update name → update priority → remove → sync (equivalent to Test 16)
async function test24CompoundRemoveRemote() {
    enter('Test 24: Create remote → update name → update priority → remove → sync');
    await init();
    
    // Create task remotely
    sh(`node tasks.js create -r test task`);
    
    // Update name and priority
    sh(`node tasks.js update -r "test task" "removed task"`);
    sh(`node tasks.js update -r -P4 "removed task"`);
    
    // Remove task
    sh(`node tasks.js remove -r "removed task"`);
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'removed task')`, 
        errmsg: 'Task should be removed remotely' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task doesn't exist locally
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'removed task')`, 
        errmsg: 'Task should not exist locally' 
    });
    
    success('Test 24: Create remote → update name → update priority → remove → sync');
}

// Test 25: Existing synced task → update priority → update name → sync (remote equivalent to Test 19)
async function test25ExistingSyncedRemote() {
    enter('Test 25: Existing synced task → update priority → update name → sync (remote)');
    await init();
    await syncedState();
    
    // Update priority then name of existing synced task remotely
    sh(`node tasks.js update -r -P3 "p1"`);
    sh(`node tasks.js update -r "p1" "modified p1"`);
    
    // Verify changes remotely
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'modified p1' && t.priority === 3)`,
        errmsg: 'Task should have updated name and priority remotely'
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify changes propagated to local
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'modified p1' && t.priority === 3)`,
        errmsg: 'Task should have updated name and priority locally after sync'
    });
    
    success('Test 25: Existing synced task → update priority → update name → sync (remote)');
}

// Test 26: Existing synced task → update name → update priority → complete → sync (remote equivalent to Test 20)
async function test26ExistingSyncedCompleteRemote() {
    enter('Test 26: Existing synced task → update name → update priority → complete → sync (remote)');
    await init();
    await syncedState();
    
    // Update name and priority of existing synced task remotely
    sh(`node tasks.js update -r "p2" "completed p2"`);
    sh(`node tasks.js update -r -P0 "completed p2"`);
    
    // Complete task
    sh(`node tasks.js complete -r "completed p2"`);
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'completed p2')`, 
        errmsg: 'Task should be removed from active tasks remotely' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task completed locally
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'completed p2')`, 
        errmsg: 'Task should not exist in local active tasks after sync' 
    });
    
    success('Test 26: Existing synced task → update name → update priority → complete → sync (remote)');
}

// Test 27: Existing synced task → update priority → update name → remove → sync (remote equivalent to Test 21)
async function test27ExistingSyncedRemoveRemote() {
    enter('Test 27: Existing synced task → update priority → update name → remove → sync (remote)');
    await init();
    await syncedState();
    
    // Update priority and name of existing synced task remotely
    sh(`node tasks.js update -r -P4 "p3"`);
    sh(`node tasks.js update -r "p3" "removed p3"`);
    
    // Remove task
    sh(`node tasks.js remove -r "removed p3"`);
    sh(`node tasks.js list -r -y`, { 
        exp: `!data.some(t => t.name === 'removed p3')`, 
        errmsg: 'Task should be removed remotely' 
    });
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify task removed locally
    sh(`node tasks.js list -l -y`, { 
        exp: `!data.some(t => t.name === 'removed p3')`, 
        errmsg: 'Task should be removed locally after sync' 
    });
    
    success('Test 27: Existing synced task → update priority → update name → remove → sync (remote)');
}

// Conflict scenario tests (Tests 33-38)

// Test 33: Rename conflict → sync (both sides rename same task)
async function test33RenameConflict() {
    enter('Test 33: Rename conflict → sync');
    await init();
    await syncedState();
    
    // Both sides rename the same task
    sh(`node tasks.js update -l "p1" "local name"`);
    sh(`node tasks.js update -r "p1" "remote name"`);
    
    // Verify local change
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'local name')`,
        errmsg: 'Task should have local name locally'
    });
    
    // Verify remote change
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'remote name')`,
        errmsg: 'Task should have remote name remotely'
    });
    
    // Sync - local should win (per sync.md rules)
    sh(`node tasks.js sync`);
    
    // Verify local name wins on both sides
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'local name')`,
        errmsg: 'Task should have local name locally after sync'
    });
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'local name')`,
        errmsg: 'Task should have local name remotely after sync'
    });
    
    success('Test 33: Rename conflict → sync');
}

// Test 34: Priority conflict → sync (both sides change priority)
async function test34PriorityConflict() {
    enter('Test 34: Priority conflict → sync');
    await init();
    await syncedState();
    
    // Both sides change priority of same task
    sh(`node tasks.js update -l -P2 "p1"`);
    sh(`node tasks.js update -r -P3 "p1"`);
    
    // Verify local change
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'p1' && t.priority === 2)`,
        errmsg: 'Task should have priority 2 locally'
    });
    
    // Verify remote change
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p1' && t.priority === 3)`,
        errmsg: 'Task should have priority 3 remotely'
    });
    
    // Sync - local should win
    sh(`node tasks.js sync`);
    
    // Verify local priority wins on both sides
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'p1' && t.priority === 2)`,
        errmsg: 'Task should have priority 2 locally after sync'
    });
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p1' && t.priority === 2)`,
        errmsg: 'Task should have priority 2 remotely after sync'
    });
    
    success('Test 34: Priority conflict → sync');
}

// Test 35: Different property updates → sync (local rename + remote priority)
async function test35DifferentPropertyMerge() {
    enter('Test 35: Different property updates → sync');
    await init();
    await syncedState();
    
    // Local renames, remote changes priority
    sh(`node tasks.js update -l "p1" "renamed locally"`);
    sh(`node tasks.js update -r -P4 "p1"`);
    
    // Verify local change
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'renamed locally' && t.priority === 1)`,
        errmsg: 'Task should have new name and original priority locally'
    });
    
    // Verify remote change
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'p1' && t.priority === 4)`,
        errmsg: 'Task should have original name and new priority remotely'
    });
    
    // Sync - both changes should be merged
    sh(`node tasks.js sync`);
    
    // Verify both changes are merged on both sides
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'renamed locally' && t.priority === 4)`,
        errmsg: 'Task should have local name and remote priority locally after sync'
    });
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'renamed locally' && t.priority === 4)`,
        errmsg: 'Task should have local name and remote priority remotely after sync'
    });
    
    success('Test 35: Different property updates → sync');
}

// Test 36: Update vs Complete conflict → sync (local update + remote complete)
async function test36UpdateCompleteConflict() {
    enter('Test 36: Update vs Complete conflict → sync');
    await init();
    await syncedState();
    
    // Local updates name, remote completes
    sh(`node tasks.js update -l "p1" "updated locally"`);
    sh(`node tasks.js complete -r "p1"`);
    
    // Verify local change
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'updated locally')`,
        errmsg: 'Task should be updated locally'
    });
    
    // Verify remote completion
    sh(`node tasks.js list -r -y`, {
        exp: `!data.some(t => t.name === 'p1')`,
        errmsg: 'Task should be completed remotely'
    });
    
    // Sync - complete should win with local updates (per sync.md rules)
    sh(`node tasks.js sync`);
    
    // Verify task is completed on both sides
    sh(`node tasks.js list -l -y`, {
        exp: `!data.some(t => t.name === 'updated locally')`,
        errmsg: 'Task should be completed locally after sync'
    });
    sh(`node tasks.js list -r -y`, {
        exp: `!data.some(t => t.name === 'updated locally')`,
        errmsg: 'Task should be completed remotely after sync'
    });
    
    success('Test 36: Update vs Complete conflict → sync');
}

// Test 37: Update vs Delete conflict → sync (local update + remote delete)
async function test37UpdateDeleteConflict() {
    enter('Test 37: Update vs Delete conflict → sync');
    await init();
    await syncedState();
    
    // Local updates name, remote deletes
    sh(`node tasks.js update -l "p1" "updated locally"`);
    sh(`node tasks.js remove -r "p1"`);
    
    // Verify local change
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'updated locally')`,
        errmsg: 'Task should be updated locally'
    });
    
    // Verify remote deletion
    sh(`node tasks.js list -r -y`, {
        exp: `!data.some(t => t.name === 'p1')`,
        errmsg: 'Task should be deleted remotely'
    });
    
    // Sync - delete should win (per sync.md rules)
    sh(`node tasks.js sync`);
    
    // Verify task is deleted on both sides
    sh(`node tasks.js list -l -y`, {
        exp: `!data.some(t => t.name === 'updated locally')`,
        errmsg: 'Task should be deleted locally after sync'
    });
    sh(`node tasks.js list -r -y`, {
        exp: `!data.some(t => t.name === 'updated locally')`,
        errmsg: 'Task should be deleted remotely after sync'
    });
    
    success('Test 37: Update vs Delete conflict → sync');
}

// Test 38: Multiple updates vs Complete conflict → sync
async function test38MultipleUpdatesCompleteConflict() {
    enter('Test 38: Multiple updates vs Complete conflict → sync');
    await init();
    await syncedState();
    
    // Local does multiple updates, remote completes
    sh(`node tasks.js update -l "p1" "multi updated"`);
    sh(`node tasks.js update -l -P0 "multi updated"`);
    sh(`node tasks.js complete -r "p1"`);
    
    // Verify local changes
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'multi updated' && t.priority === 0)`,
        errmsg: 'Task should have multiple local updates'
    });
    
    // Verify remote completion
    sh(`node tasks.js list -r -y`, {
        exp: `!data.some(t => t.name === 'p1')`,
        errmsg: 'Task should be completed remotely'
    });
    
    // Sync - complete should win with local updates preserved
    sh(`node tasks.js sync`);
    
    // Verify task is completed on both sides
    sh(`node tasks.js list -l -y`, {
        exp: `!data.some(t => t.name === 'multi updated')`,
        errmsg: 'Task should be completed locally after sync'
    });
    sh(`node tasks.js list -r -y`, {
        exp: `!data.some(t => t.name === 'multi updated')`,
        errmsg: 'Task should be completed remotely after sync'
    });
    
    success('Test 38: Multiple updates vs Complete conflict → sync');
}

// Edge case tests (Tests 39-43)

// Test 39: Duplicate content (same task created both sides) → sync
async function test39DuplicateContent() {
    enter('Test 39: Duplicate content → sync');
    await init();
    
    // Create same task on both sides
    sh(`node tasks.js create -l duplicate task`);
    sh(`node tasks.js create -r duplicate task`);
    
    // Verify both sides have the task
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'duplicate task')`,
        errmsg: 'Task should exist locally'
    });
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'duplicate task')`,
        errmsg: 'Task should exist remotely'
    });
    
    // Sync should detect and merge duplicates
    sh(`node tasks.js sync`);
    
    // Verify single task with correlation ID on both sides
    sh(`node tasks.js list -l -y`, {
        exp: `data.filter(t => t.name === 'duplicate task').length === 1`,
        errmsg: 'Should have exactly one task locally after sync'
    });
    sh(`node tasks.js list -r -y`, {
        exp: `data.filter(t => t.name === 'duplicate task').length === 1`,
        errmsg: 'Should have exactly one task remotely after sync'
    });
    
    // Verify task has correlation ID locally
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'duplicate task' && t.id !== null)`,
        errmsg: 'Task should have correlation ID locally after sync'
    });
    
    success('Test 39: Duplicate content → sync');
}

// Test 42: Priority 0 special handling → sync
async function test42Priority0Special() {
    enter('Test 42: Priority 0 special handling → sync');
    await init();
    
    // Create P0 task locally
    sh(`node tasks.js create -l -P0 priority zero task`);
    
    // Sync to remote
    sh(`node tasks.js sync`);
    
    // Verify remote task has priority 0 with due date
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'priority zero task' && t.priority === 0 && t.due !== null)`,
        errmsg: 'Remote P0 task should have due date set'
    });
    
    // Create P0 task remotely and verify it gets due date immediately
    sh(`node tasks.js create -r -P0 remote priority zero`);
    sh(`node tasks.js list -r -y`, {
        exp: `data.some(t => t.name === 'remote priority zero' && t.priority === 0 && t.due !== null)`,
        errmsg: 'Remote P0 task should have due date set on creation'
    });
    
    // Sync back to local
    sh(`node tasks.js sync`);
    
    // Verify local task has P0 priority with correlation ID
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'remote priority zero' && t.priority === 0 && t.id !== null)`,
        errmsg: 'Local P0 task should have correlation ID after sync'
    });
    
    success('Test 42: Priority 0 special handling → sync');
}

// Test 40: Corrupted correlation ID → sync (simulated by creating task with invalid ID)
async function test40CorruptedCorrelationId() {
    enter('Test 40: Corrupted correlation ID → sync');
    await init();
    await syncedState();
    
    // Create a task remotely
    sh(`node tasks.js create -r test task`);
    sh(`node tasks.js sync`);
    
    // Now manually corrupt the local correlation by updating the task file
    // This simulates a corrupted or invalid correlation ID
    // We'll create a new task locally with same name but no sync
    sh(`node tasks.js remove -l "test task"`);  // Remove the synced version
    sh(`node tasks.js create -l test task`);   // Create new one without correlation
    
    // Verify local task has no correlation ID
    sh(`node tasks.js list -l -y`, {
        exp: `data.some(t => t.name === 'test task' && t.id === null)`,
        errmsg: 'Local task should have no correlation ID'
    });
    
    // Sync should treat this as a new task (creating duplicate)
    sh(`node tasks.js sync`);
    
    // After sync, both tasks should exist (the original remote + the new local)
    // This demonstrates the behavior when correlation is lost
    sh(`node tasks.js list -l -y`, {
        exp: `data.filter(t => t.name === 'test task').length >= 1`,
        errmsg: 'Should have at least one task locally after sync'
    });
    
    success('Test 40: Corrupted correlation ID → sync');
}

// Note: Tests 41 (subtasks) and 43 (orphaned subtasks) are not implemented
// as the current system doesn't fully support subtask synchronization yet

async function testAll() {
    try {
        // Show which tests are being run
        const testSuites = [];
        if (context.local) testSuites.push('local');
        if (context.remote) testSuites.push('remote');
        if (context.sync) testSuites.push('sync');
        console.log(`Running test suites: ${testSuites.join(', ')}\n`);

        // Run sync.md tests - simple operations
        await test1CreateLocal();
        await test2UpdateNameLocal();
        await test3UpdatePriorityLocal();
        await test4CompleteLocal();
        await test5RemoveLocal();

        // Run sync.md tests - compound operations (local)
        await test14CompoundLocal();
        await test15CompoundCompleteLocal();
        await test16CompoundRemoveLocal();
        await test19ExistingSyncedLocal();
        await test20ExistingSyncedCompleteLocal();
        await test21ExistingSyncedRemoveLocal();

        // Run sync.md tests - compound operations (remote)
        await test22CompoundRemote();
        await test23CompoundCompleteRemote();
        await test24CompoundRemoveRemote();
        await test25ExistingSyncedRemote();
        await test26ExistingSyncedCompleteRemote();
        await test27ExistingSyncedRemoveRemote();

        // Run sync.md tests - conflict scenarios
        await test33RenameConflict();
        await test34PriorityConflict();
        await test35DifferentPropertyMerge();
        await test36UpdateCompleteConflict();
        await test37UpdateDeleteConflict();
        await test38MultipleUpdatesCompleteConflict();

        // Run sync.md tests - edge cases
        await test39DuplicateContent();
        await test40CorruptedCorrelationId();
        await test42Priority0Special();

        // Demonstrate parameterized test functions
        // Simple operations using parameterized function
        await simpleSync('create', '-l', 'param test local');
        await simpleSync('create', '-r', 'param test remote');
        
        // Example compound operation using parameterized function
        await compoundSync([
            { type: 'create' },
            { type: 'update-name', newName: 'param compound updated' },
            { type: 'update-priority', priority: 3 }
        ], '-l', 'param compound test');
        
        // Example conflict resolution using parameterized function
        await conflictSync(
            { type: 'update-name', newName: 'local param name' },
            { type: 'update-name', newName: 'remote param name' },
            { type: 'local-wins' }
        );

        // Run local tests if requested
        if (context.local) {
            await complete(context, '-l');
            await remove(context, '-l');
            await priority(context, '-l', 0);
            await priority(context, '-l', null);
            await priority(context, '-l', 1);
            await priority(context, '-l', 2);
            await priority(context, '-l', 3);
            await priority(context, '-l', 4);
        }

        // Run remote tests if requested
        if (context.remote) {
            await complete(context, '-r');
            await remove(context, '-r');
            await priorityZero(context);
            await priority(context, '-r', null);
            await priority(context, '-r', 1);
            await priority(context, '-r', 2);
            await priority(context, '-r', 3);
            await priority(context, '-r', 4);
        }

        // Run sync tests if requested
        if (context.sync) {
            await syncUp(context);
            // await syncDown(context);
            // await syncUpPriorityZero(context);
            // await syncDownPriorityZero(context);
        }
    } catch (error) {
        process.exit(1);
    }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    testAll();
}

export { testAll };
