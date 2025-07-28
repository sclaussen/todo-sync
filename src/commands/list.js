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
    const showBoth = showLocal && showRemote;
    
    if (showLocal) {
        const localData = await getLocalTasks();
        if (showCompleted) {
            displayTasks(localData.completed.tasks, showBoth ? 'Local' : '', true);
        } else {
            displayTasks(localData.current.tasks, showBoth ? 'Local' : '', false);
        }
    }

    if (showRemote) {
        if (showBoth) {
            console.log(''); // Add blank line between local and remote when showing both
        }
        const remoteData = await getTodoistTasks();
        if (showCompleted) {
            // Show both current and completed tasks separately for remote
            if (remoteData.current.tasks.length > 0) {
                displayTasks(remoteData.current.tasks, showBoth ? 'Remote' : '', false);
                console.log(''); // Add blank line between sections
            }
            displayTasks(remoteData.completed.tasks, showBoth ? 'Remote Completed' : 'Completed', true);
        } else {
            displayTasks(remoteData.current.tasks, showBoth ? 'Remote' : '', false);
        }
    }
}