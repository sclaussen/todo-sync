import { getLocalTasks } from '../data/local.js';
import { getTodoistTasks } from '../data/todoist.js';
import { displayTasks } from '../display/console.js';
import { displayYaml } from '../display/yaml.js';

export async function execute(options) {
    const showLocal = options.local || (!options.remote && !options.local);
    const showRemote = options.remote || (!options.remote && !options.local);

    if (options.yaml) {
        await handleYamlOutput(showLocal, showRemote, options.completed);
    } else {
        await handleConsoleOutput(showLocal, showRemote, options.completed);
    }
}

async function handleYamlOutput(showLocal, showRemote, showCompleted) {
    const allTasks = [];

    if (showLocal) {
        const localData = await getLocalTasks();
        const tasks = showCompleted ? localData.completed.tasks : localData.current.tasks;
        allTasks.push(...tasks);
    }

    if (showRemote) {
        const remoteData = await getTodoistTasks();
        const tasks = showCompleted ? remoteData.completed.tasks : remoteData.current.tasks;
        allTasks.push(...tasks);
    }

    displayYaml(allTasks);
}

async function handleConsoleOutput(showLocal, showRemote, showCompleted) {
    if (showLocal) {
        const localData = await getLocalTasks();
        const data = showCompleted 
            ? { current: { tasks: [] }, completed: localData.completed }
            : { current: localData.current, completed: { tasks: [] } };
        displayTasks(data, 'local');
    }

    if (showRemote) {
        const remoteData = await getTodoistTasks();
        const data = showCompleted
            ? { current: { tasks: [] }, completed: remoteData.completed }
            : { current: remoteData.current, completed: { tasks: [] } };
        displayTasks(data, 'remote');
    }
}