#!/usr/bin/env node
import { sh, init, diff, cleanup, getTestEnv, setupTestProject, normalize, enter, success, fail } from './util.js';
import { fileURLToPath } from 'url';
import { Command } from 'commander';

const program = new Command();

program
    .name('test')
    .description('Run task synchronization tests')
    .option('-l, --local', 'Run tests with local only operations')
    .option('-r, --remote', 'Run tests with remote only operations')
    .parse(process.argv);
const options = program.opts();
const context = {
    local: options.local || (!options.local && !options.remote),
    remote: options.remote || (!options.local && !options.remote)
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

async function priority(context, initialPriority = null, option = '-l') {
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

async function syncUp(context) {
    enter('syncUp');
    await init();

    sh(`node tasks.js create -l -P 0 P0 urgent priority task`);
    sh(`node tasks.js create -l -P 1 P1 high priority task`);
    sh(`node tasks.js create -l -P 2 P2 medium priority task`);
    sh(`node tasks.js create -l -P 3 P3 low priority task`);
    sh(`node tasks.js create -l -P 4 P4 lowest priority task`);
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
    sh(`node tasks.js create -r -P 0 P0 urgent priority task`);
    sh(`node tasks.js create -r -P 1 P1 high priority task`);
    sh(`node tasks.js create -r -P 2 P2 medium priority task`);
    sh(`node tasks.js create -r -P 3 P3 low priority task`);
    sh(`node tasks.js create -r -P 4 P4 lowest priority task`);
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
        // if (context.local) {
        //     await complete(context, '-l');
        //     await remove(context, '-l');
        //     await priority(context, null, '-l');
        //     await priority(context, 0, '-l');
        //     await priority(context, 1, '-l');
        //     await priority(context, 2, '-l');
        //     await priority(context, 3, '-l');
        //     await priority(context, 4, '-l');
        // } else if (context.remote) {
        //     await complete(context, '-r');
        //     await remove(context, '-r');
        //     await priority(context, null, '-r');
        //     await priority(context, 0, '-r');
        //     await priority(context, 1, '-r');
        //     await priority(context, 2, '-r');
        //     await priority(context, 3, '-r');
        //     await priority(context, 4, '-r');
        //     await syncUp(context);
        //     await syncDown(context);
        // }
        await syncUp(context);
        await syncDown(context);
    } catch (error) {
        process.exit(1);
    }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    testAll();
}

export { testAll };
