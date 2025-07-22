import yaml from 'js-yaml';

export function displayYaml(tasks) {
    const yamlTasks = tasks.map(task => task.toYaml());
    
    const yamlOutput = yaml.dump(yamlTasks, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: false
    });

    console.log(yamlOutput);
}

export function tasksToYaml(tasks) {
    return tasks.map(task => task.toYaml());
}