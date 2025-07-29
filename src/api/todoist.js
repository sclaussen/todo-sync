import { TODOIST } from '../config/constants.js';

/**
 * Todoist API client for handling all Todoist REST API interactions
 */
export class TodoistAPI {
    constructor(apiToken) {
        this.apiToken = apiToken;
        this.baseURL = 'https://api.todoist.com';
    }

    async request(endpoint, options = {}) {
        if (!this.apiToken) {
            throw new Error('No Todoist API token configured');
        }

        const url = endpoint.startsWith('http') ? endpoint : `${this.baseURL}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    async getProjects() {
        return this.request('/rest/v2/projects');
    }

    async createProject(name) {
        return this.request('/rest/v2/projects', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
    }

    async getTasks(projectId) {
        return this.request(`/rest/v2/tasks?project_id=${projectId}`);
    }

    async getCompletedTasks() {
        return this.request('https://api.todoist.com/sync/v9/completed/get_all', {
            method: 'POST',
            body: JSON.stringify({})
        });
    }

    async createTask(taskData) {
        return this.request('/rest/v2/tasks', {
            method: 'POST',
            body: JSON.stringify(taskData)
        });
    }

    async updateTask(taskId, updateData) {
        return this.request(`/rest/v2/tasks/${taskId}`, {
            method: 'POST',
            body: JSON.stringify(updateData)
        });
    }

    async closeTask(taskId) {
        return this.request(`/rest/v2/tasks/${taskId}/close`, {
            method: 'POST'
        });
    }

    async reopenTask(taskId) {
        return this.request(`/rest/v2/tasks/${taskId}/reopen`, {
            method: 'POST'
        });
    }
}

// Default instance using the configured API token
export const todoistAPI = new TodoistAPI(TODOIST.API_TOKEN);

// For backward compatibility
export default todoistAPI;