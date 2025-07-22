import { getLocalTasks as getLocal } from './local.js';
import { getTodoistTasks as getRemote } from './todoist.js';

export async function getTasks(source) {
    switch (source) {
        case 'local':
            return await getLocal();
        case 'remote':
            return await getRemote();
        default:
            throw new Error('Source must be either "local" or "remote"');
    }
}

export async function getAllTasks() {
    const [localData, remoteData] = await Promise.all([
        getLocal(),
        getRemote()
    ]);

    return { local: localData, remote: remoteData };
}

// Re-export other functions
export * from './local.js';
export * from './todoist.js';