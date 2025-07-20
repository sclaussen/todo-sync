import { TodoistApi, Task, Project } from '@doist/todoist-api-typescript';
import { TodoItem, Config } from './types.js';

export class TodoistClient {
  private api: TodoistApi;
  private config: Config;
  private projectId?: string;

  constructor(config: Config) {
    this.config = config;
    this.api = new TodoistApi(config.todoist.apiToken);
    this.projectId = config.todoist.projectId;
  }

  async initialize(): Promise<void> {
    if (!this.projectId) {
      this.projectId = await this.ensureProject();
      this.config.todoist.projectId = this.projectId;
    }
  }

  private async ensureProject(): Promise<string> {
    const projects = await this.api.getProjects();
    const existingProject = projects.find(p => p.name === this.config.todoist.projectName);
    
    if (existingProject) {
      return existingProject.id;
    }

    const newProject = await this.api.addProject({
      name: this.config.todoist.projectName
    });
    return newProject.id;
  }

  async getTasks(): Promise<Task[]> {
    if (!this.projectId) {
      await this.initialize();
    }
    
    const tasks = await this.api.getTasks({
      projectId: this.projectId
    });
    
    return tasks;
  }

  async createTask(item: TodoItem): Promise<Task> {
    if (!this.projectId) {
      await this.initialize();
    }

    const priorityMapping = this.config.mapping.priorityMapping[item.localPriority?.toString() || '4'];
    
    const taskData: any = {
      content: item.content,
      projectId: this.projectId,
      priority: priorityMapping.todoistPriority
    };

    if (priorityMapping.dueString) {
      taskData.dueString = priorityMapping.dueString;
    }

    const task = await this.api.addTask(taskData);
    return task;
  }

  async updateTask(taskId: string, content: string, priority?: number): Promise<Task> {
    const task = await this.api.updateTask(taskId, {
      content,
      priority
    });
    return task;
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.api.deleteTask(taskId);
  }

  mapTodoistTaskToItem(task: Task): TodoItem {
    const reversePriorityMap: { [key: number]: number } = {
      4: 0,
      3: 1,
      2: 2,
      1: 3
    };

    return {
      content: task.content,
      todoistId: task.id,
      todoistPriority: task.priority,
      localPriority: reversePriorityMap[task.priority] || 4,
      syncId: '',
      checksum: '',
      lastModifiedSource: 'todoist',
      dueDate: task.due?.date
    };
  }
}