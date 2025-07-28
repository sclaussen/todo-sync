#!/usr/bin/env node
import { sh, init, diff, cleanup, getTestEnv, getTasksCLI, setupTestProject, normalize } from './util.js';
import { fileURLToPath } from 'url';

const taskscli = getTasksCLI();

async function syncUp() {
    console.log('✅ Running syncUp');
    await init();

    // Create tasks with all priority levels locally first
    sh(`node ${taskscli} create "P0 urgent task" -l -P 0`, { echo: true, rc: 0 });
    sh(`node ${taskscli} create "P1 high priority task" -l -P 1`, { echo: true, rc: 0 });
    sh(`node ${taskscli} create "P2 medium priority task" -l -P 2`, { echo: true, rc: 0 });
    sh(`node ${taskscli} create "P3 low priority task" -l -P 3`, { echo: true, rc: 0 });
    sh(`node ${taskscli} create "P4 lowest priority task" -l -P 4`, { echo: true, rc: 0 });
    sh(`node ${taskscli} sync`, { echo: true, rc: 0 });

    const localTasks = sh(`node ${taskscli} list -l -y`, { echo: true, rc: 0 });
    const remoteTasks = sh(`node ${taskscli} list -r -y`, { echo: true, rc: 0 });
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    if (differences) {
        console.error(differences.message);
        console.log(localTasks);
        console.log(remoteTasks);
        throw new Error();
    }

    console.log('✅ syncUp passed');
}

async function syncDown() {
    console.log('✅ Running syncDown');
    await init();

    // Create tasks with all priority levels locally first
    sh(`node ${taskscli} create "P0 urgent task" -r -P 0`, { echo: true, rc: 0 });
    sh(`node ${taskscli} create "P1 high priority task" -r -P 1`, { echo: true, rc: 0 });
    sh(`node ${taskscli} create "P2 medium priority task" -r -P 2`, { echo: true, rc: 0 });
    sh(`node ${taskscli} create "P3 low priority task" -r -P 3`, { echo: true, rc: 0 });
    sh(`node ${taskscli} create "P4 lowest priority task" -r -P 4`, { echo: true, rc: 0 });
    sh(`node ${taskscli} sync`, { echo: true, rc: 0 });

    const localTasks = sh(`node ${taskscli} list -l -y`, { echo: true, rc: 0 });
    const remoteTasks = sh(`node ${taskscli} list -r -y`, { echo: true, rc: 0 });
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    if (differences) {
        console.error(differences.message);
        console.log(localTasks);
        console.log(remoteTasks);
        throw new Error();
    }

    console.log('✅ syncDown passed');
}

async function testAll() {
    try {
        await syncUp();
        await syncDown();
    } catch (error) {
        process.exit(1);
    }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
    testAll();
}

export { testAll };
