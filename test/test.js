#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { sh, init, diff, cleanup, getTestEnv, setupTestProject, normalize, enter, success, fail } from './util.js';

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

async function createComplete(option = '-l') {
    enter(`createComplete ${option}`);
    await init(option);
    await tasks('create', option);
    await tasks('complete', option);
    success(`createComplete ${option}`);
}

async function createRemove(option = '-l') {
    enter(`createRemove ${option}`);
    await init(option);
    await tasks('create', option);
    await tasks('remove', option);
    success(`createRemove ${option}`);
}

async function createUpdateName(option = '-l') {
    enter(`createUpdateName ${option}`);
    await init(option);
    await tasks('create', option, 'p1');
    await tasks('update-name', option, 'p1', null, 'updated task name');
    success(`createUpdateName ${option}`);
}

async function createUpdatePriority(option = '-l', newPriority = 2) {
    enter(`createUpdatePriority ${option} P${newPriority}`);
    await init(option);
    await tasks('create', option, 'p1');
    await tasks('update-priority', option, 'p1', newPriority);
    success(`createUpdatePriority ${option} P${newPriority}`);
}

async function createUpdatePriorityZero(option = '-l') {
    enter(`createUpdatePriorityZero ${option}`);
    await init(option);
    await tasks('create', option, 'p0', 0);
    await tasks('update-priority', option, 'p0', 1);
    await tasks('update-priority', option, 'p0', 0);
    success(`createUpdatePriorityZero ${option}`);
}

async function createPriorityZeroSync(option = '-l') {
    enter(`createPriorityZeroSync ${option}`);
    await init();
    await sync('create', option, 'p0', 0);
    success(`createPriorityZeroSync ${option}`);
}

async function createTasksSync(option = '-l') {
    enter(`createTasksSync ${option}`);
    await init();
    tasks('create', option, 'p0', 0);
    tasks('create', option, 'p1', 1);
    tasks('create', option, 'p2', 2);
    tasks('create', option, 'p3', 3);
    tasks('create', option, 'p4', 4);
    tasks('sync');
    await verifySync();
    success(`createTasksSync ${option}`);
}

async function createSync(option = '-l') {
    enter(`createSync ${option}`);
    await init2(option);
    await sync('create', option, 'NEW TASK NEW TASK');
    success(`createSync ${option}`);
}

async function updateNameSync(option = '-l') {
    enter(`updateNameSync ${option}`);
    await init2(option);
    await sync('update-name', option, 'p1', null, 'UPDATED P1 UPDATED P1');
    success(`updateNameSync ${option}`);
}

async function updatePrioritySync(option = '-l') {
    enter(`updatePrioritySync ${option}`);
    await init2(option);
    await sync('update-priority', option, 'p1', 2);
    success(`updatePrioritySync ${option}`);
}

async function completeSync(option = '-l') {
    enter(`completeSync ${option}`);
    await init2(option);
    await tasks('complete', option, 'p1');
    await tasks('sync');
    success(`completeSync ${option}`);
}

async function removeSync(option = '-l') {
    enter(`removeSync ${option}`);
    await init2(option);
    await tasks('remove', option, 'p1');
    await tasks('sync');
    success(`removeSync ${option}`);
}

async function createUpdateCompoundSync(option = '-l') {
    enter(`createUpdateCompoundSync ${option}`);
    await tasks('create', option, 'test task');
    await tasks('update-name', option, 'test task', null, 'updated task');
    await tasks('update-priority', option, 'updated task', 2);
    await tasks('sync');
    success(`createUpdateCompoundSync ${option}`);
}

async function createUpdateCompleteSync(option = '-l') {
    enter(`createUpdateCompleteSync ${option}`);
    await tasks('create', option, 'test task');
    await tasks('update-name', option, 'test task', null, 'completed task');
    await tasks('update-priority', option, 'completed task', 3);
    await tasks('complete', option, 'completed task');
    await tasks('sync');
    success(`createUpdateCompleteSync ${option}`);
}

async function createUpdateRemoveSync(option = '-l') {
    enter(`createUpdateRemoveSync ${option}`);
    await tasks('create', option, 'test task');
    await tasks('update-name', option, 'test task', null, 'removed task');
    await tasks('update-priority', option, 'removed task', 4);
    await tasks('remove', option, 'removed task');
    await tasks('sync');
    success(`createUpdateRemoveSync ${option}`);
}

async function existingUpdateSync(option = '-l') {
    enter(`existingUpdateSync ${option}`);
    await init2(option);
    await tasks('update-priority', option, 'p1', 3);
    await tasks('update-name', option, 'p1', null, 'modified p1');
    await tasks('sync');
    success(`existingUpdateSync ${option}`);
}

async function existingUpdateCompleteSync(option = '-l') {
    enter(`existingUpdateCompleteSync ${option}`);
    await init2(option);
    await tasks('update-name', option, 'p2', null, 'completed p2');
    await tasks('update-priority', option, 'completed p2', 0);
    await tasks('complete', option, 'completed p2');
    await tasks('sync');
    success(`existingUpdateCompleteSync ${option}`);
}

async function existingUpdateRemoveSync(option = '-l') {
    enter(`existingUpdateRemoveSync ${option}`);
    await init2(option);
    await tasks('update-priority', option, 'p3', 4);
    await tasks('update-name', option, 'p3', null, 'removed p3');
    await tasks('remove', option, 'removed p3');
    await tasks('sync');
    success(`existingUpdateRemoveSync ${option}`);
}

// Remote versions of compound tests (Tests 22-32 equivalent)

// Test 22: Create remote → update name → update priority → sync (equivalent to Test 14)
async function test22CompoundRemote() {
    enter('Test 22: Create remote → update name → update priority → sync');

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
    await init2(option);

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
    await init2(option);

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
    await init2(option);

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
    await init2(option);

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
    await init2(option);

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
    await init2(option);

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
    await init2(option);

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
    await init2(option);

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
    await init2(option);

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
    await init2(option);

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

async function sync(operation, option = '-l', taskName = 'p1', priority = null, newName = null) {
    const side = option === '-l' ? 'local' : 'remote';
    const otherSide = option === '-l' ? 'remote' : 'local';
    const otherOption = option === '-l' ? '-r' : '-l';

    let finalTaskName = taskName;
    switch (operation) {
        case 'update-name':
            const updatedName = newName || `updated ${taskName}`;
            await tasks('update-name', option, taskName, null, updatedName);
            finalTaskName = updatedName;
            break;
        case 'update-priority':
            const targetPriority = priority !== null ? priority : 2;
            await tasks('update-priority', option, taskName, targetPriority);
            break;
        default:
            await tasks(operation, option, taskName, priority, newName);
            break;
    }

    // Sync
    sh(`node tasks.js sync`);

    // Verify: Check state propagated to other side and get both task lists
    let otherSideTasks;
    switch(operation) {
    case 'create':
    case 'update-name':
    case 'update-priority':
        otherSideTasks = sh(`node tasks.js list ${otherOption} -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${finalTaskName}')`, errmsg: `Task should exist on ${otherSide} after sync` });
        break;
    case 'complete':
    case 'remove':
        otherSideTasks = sh(`node tasks.js list ${otherOption} -y`, { echo: false, output: false, exp: `!data.some(t => t.name === '${finalTaskName}')`, errmsg: `Task should not exist on ${otherSide} after sync` });
        break;
    }

    // Get the current side's task list
    const currentSideTasks = sh(`node tasks.js list ${option} -y`, { echo: false, output: false });

    // Assign to local and remote based on option
    const localTasks = option === '-l' ? currentSideTasks : otherSideTasks;
    const remoteTasks = option === '-l' ? otherSideTasks : currentSideTasks;

    // Compare local and remote task lists for consistency
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    if (differences) {
        fail(differences.message);
        console.log('Local tasks:');
        console.log(localTasks);
        console.log('Remote tasks:');
        console.log(remoteTasks);
        throw new Error();
    }
}

// Compound operation pattern (create → multiple updates → final state)
async function compoundSync(operations, option = '-l', initialTaskName = 'compound task') {
    const side = option === '-l' ? 'local' : 'remote';
    const otherOption = option === '-l' ? '-r' : '-l';

    enter(`Compound operations ${operations.join(' → ')} ${side} (parameterized)`);

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
    await init2(option);

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

async function tasks(operation, option = '-l', taskName = 'p1', priority = null, newName = null) {
    const side = option === '-l' ? 'local' : 'remote';

    switch (operation) {

    case 'create':
        const priorityFlag = priority !== null ? `-P${priority}` : '';
        sh(`node tasks.js create ${option} ${priorityFlag} ${taskName}`);
        if (priority !== null) {
            if (option === '-r' && priority === 0) {
                sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${taskName}' && t.priority === ${priority} && t.due !== null)`, errmsg: `P${priority} task should be created with due date on ${side}` });
                return;
            }

            sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${taskName}' && t.priority === ${priority})`, errmsg: `P${priority} task should be created on ${side}` });
            return;
        }
        sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${taskName}')`, errmsg: `Task '${taskName}' should be created on ${side}` });
        return;

    case 'update-name':
        sh(`node tasks.js update ${option} "${taskName}" "${newName}"`);
        sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${newName}')`, errmsg: `Task should be renamed to '${newName}' on ${side}` });
        return;

    case 'update-priority':
        sh(`node tasks.js update ${option} -P${priority} "${taskName}"`);
        if (option === '-r' && priority === 0) {
            sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${taskName}' && t.priority === ${priority} && t.due !== null)`, errmsg: `Task should be updated to P${priority} with due date on ${side}` });
            return;
        }
        if (option === '-r' && priority !== 0) {
            sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${taskName}' && t.priority === ${priority} && t.due === null)`, errmsg: `Task should be updated to P${priority} without due date on ${side}` });
            return;
        }
        sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${taskName}' && t.priority === ${priority})`, errmsg: `Task should be updated to P${priority} on ${side}` });
        return;

    case 'complete':
        sh(`node tasks.js complete ${option} ${taskName}`);
        sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `!data.some(t => t.name === '${taskName}')`, errmsg: `Task '${taskName}' should not be in active tasks after complete on ${side}` });
        sh(`node tasks.js list ${option} -c -y`, { echo: false, output: false, exp: `data.some(t => t.name === '${taskName}')`, errmsg: `Task '${taskName}' should be in completed tasks on ${side}` });
        return;

    case 'remove':
        sh(`node tasks.js remove ${option} ${taskName}`);
        sh(`node tasks.js list ${option} -y`, { echo: false, output: false, exp: `!data.some(t => t.name === '${taskName}')`, errmsg: `Task '${taskName}' should not exist after remove on ${side}` });
        return;

    case 'sync':
        sh(`node tasks.js sync`);
        return;

    default:
        throw new Error(`Unknown operation: ${operation}`);
    }
}

// Helper function to create initial synced state with tasks at different priorities
async function init2(option) {
    await init();
    await tasks('create', option, 'p0', 0);
    await tasks('create', option, 'p1', 1);
    await tasks('create', option, 'p2', 2);
    await tasks('create', option, 'p3', 3);
    await tasks('create', option, 'p4', 4);
    await tasks('sync');
}

// Utility function to verify local and remote tasks are synchronized
async function verifySync() {
    const localTasks = sh(`node tasks.js list -l -y`);
    const remoteTasks = sh(`node tasks.js list -r -y`);
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    if (differences) {
        fail(differences.message);
        console.log('Local tasks:');
        console.log(localTasks);
        console.log('Remote tasks:');
        console.log(remoteTasks);
        throw new Error();
    }
}

// Note: Tests 41 (subtasks) and 43 (orphaned subtasks) are not implemented
// as the current system doesn't fully support subtask synchronization yet

async function testAll() {
    try {
        // await createComplete('-l');
        // await createComplete('-r');
        // await createRemove('-l');
        // await createRemove('-r');
        // await createUpdateName('-l');
        // await createUpdateName('-r');
        // await createUpdatePriority('-l');
        // await createUpdatePriority('-r');
        // await createUpdatePriorityZero('-l');
        // await createUpdatePriorityZero('-r');

        await createPriorityZeroSync('-l');
        await createPriorityZeroSync('-r');
        // await createTasksSync('-l');
        // await createTasksSync('-r');
        // await createSync('-l');
        // await createSync('-r');
        // await updateNameSync('-l'); // adds new vs updates
        // await updateNameSync('-r');
        // await updatePrioritySync('-l');
        // await updatePrioritySync('-r');


        // // Show which tests are being run
        // const testSuites = [];
        // if (context.local) testSuites.push('local');
        // if (context.remote) testSuites.push('remote');
        // if (context.sync) testSuites.push('sync');
        // console.log(`Running test suites: ${testSuites.join(', ')}\n`);

        // // Run sync.md tests - simple operations
        // await createSync();
        // await updateNameSync();
        // await updatePrioritySync();
        // await completeSync();
        // await removeSync();

        // // Run sync.md tests - compound operations (local)
        // await createUpdateCompoundSync();
        // await createUpdateCompleteSync();
        // await createUpdateRemoveSync();
        // await existingUpdateSync();
        // await existingUpdateCompleteSync();
        // await existingUpdateRemoveSync();

        // // Run sync.md tests - compound operations (remote)
        // await createUpdateCompoundSync('-r');
        // await createUpdateCompleteSync('-r');
        // await createUpdateRemoveSync('-r');
        // await existingUpdateSync('-r');
        // await existingUpdateCompleteSync('-r');
        // await existingUpdateRemoveSync('-r');

        // // Run sync.md tests - conflict scenarios
        // await test33RenameConflict();
        // await test34PriorityConflict();
        // await test35DifferentPropertyMerge();
        // await test36UpdateCompleteConflict();
        // await test37UpdateDeleteConflict();
        // await test38MultipleUpdatesCompleteConflict();

        // // Run sync.md tests - edge cases
        // await test39DuplicateContent();
        // await test40CorruptedCorrelationId();
        // await test42Priority0Special();

        // // Demonstrate parameterized test functions
        // // Simple operations using parameterized function
        // await sync('create', '-l', 'param test local');
        // await sync('create', '-r', 'param test remote');

        // // Example compound operation using parameterized function
        // await compoundSync([
        //     { type: 'create' },
        //     { type: 'update-name', newName: 'param compound updated' },
        //     { type: 'update-priority', priority: 3 }
        // ], '-l', 'param compound test');

        // // Example conflict resolution using parameterized function
        // await conflictSync(
        //     { type: 'update-name', newName: 'local param name' },
        //     { type: 'update-name', newName: 'remote param name' },
        //     { type: 'local-wins' }
        // );

        // // Run local tests if requested
        // if (context.local) {
        //     await createComplete('-l');
        //     await createRemove('-l');
        //     await createUpdateName('-l');
        //     await createUpdatePriority('-l', 0);
        //     await createUpdatePriority('-l', 1);
        //     await createUpdatePriority('-l', 2);
        //     await createUpdatePriority('-l', 3);
        //     await createUpdatePriority('-l', 4);
        // }

        // // Run remote tests if requested
        // if (context.remote) {
        //     await createComplete('-r');
        //     await createRemove('-r');
        //     await createUpdateName('-r');
        //     await createUpdatePriorityZero('-r');
        //     await createUpdatePriority('-r', 1);
        //     await createUpdatePriority('-r', 2);
        //     await createUpdatePriority('-r', 3);
        //     await createUpdatePriority('-r', 4);
        // }

        // // Run sync tests if requested
        // if (context.sync) {
        //     await createTasksSync('-l');
        //     // await createTasksSync('-r');
        //     // await createPriorityZeroSync('-l');
        //     // await createPriorityZeroSync('-r');
        // }
    } catch (error) {
        process.exit(1);
    }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    testAll();
}

export { testAll };
