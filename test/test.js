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

async function testAll() {
    try {
        // Show which tests are being run
        const testSuites = [];
        if (context.local) testSuites.push('local');
        if (context.remote) testSuites.push('remote');
        if (context.sync) testSuites.push('sync');
        console.log(`Running test suites: ${testSuites.join(', ')}\n`);

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
            await syncDown(context);
            await syncUpPriorityZero(context);
            await syncDownPriorityZero(context);
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
