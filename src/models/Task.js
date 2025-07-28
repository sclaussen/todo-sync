import { PRIORITIES, LOCAL_PRIORITY_MAP, TODOIST_PRIORITY_MAP } from '../config/constants.js';
import { extractCorrelationId, stripCorrelationId } from '../utils/correlationId.js';

export class Task {
    constructor(content, priority = PRIORITIES.LOWEST, todoistId = null, options = {}) {
        this.content = content;
        this.priority = priority;
        this.todoistId = todoistId;
        this.due = options.due || null;
        this.completed = options.completed || null;
        this.isSubtask = options.isSubtask || false;
        this.parentContent = options.parentContent || null;
        this.metadata = options.metadata || {};
    }

    static fromLocal(rawTask) {
        if (typeof rawTask === 'string') {
            // Parse from raw line
            const todoistId = extractCorrelationId(rawTask);
            const content = stripCorrelationId(rawTask);
            return new Task(content, PRIORITIES.LOWEST, todoistId);
        }
        
        // From parsed task object
        return new Task(
            rawTask.content,
            rawTask.priority !== undefined ? rawTask.priority : PRIORITIES.LOWEST,
            rawTask.todoistId,
            {
                due: rawTask.due,
                completed: rawTask.completed,
                isSubtask: rawTask.isSubtask,
                parentContent: rawTask.parentContent,
                metadata: rawTask
            }
        );
    }

    static fromTodoist(todoistTask) {
        const localPriority = mapTodoistPriorityToLocal(todoistTask);
        
        return new Task(
            todoistTask.content,
            localPriority,
            todoistTask.id.toString(),
            {
                due: todoistTask.due ? todoistTask.due.date : null,
                completed: todoistTask.completed_at || todoistTask.completed,
                metadata: {
                    ...todoistTask,
                    source: 'todoist'
                }
            }
        );
    }

    toYaml() {
        return {
            name: this.content,
            priority: this.priority,
            due: this.due ? (typeof this.due === 'string' ? this.due : this.due.date || this.due.string || this.due) : null,
            id: this.todoistId,
            location: this.metadata?.source === 'todoist' ? 'remote' : 'local'
        };
    }

    toTodoistFormat() {
        return {
            content: this.content,
            priority: TODOIST_PRIORITY_MAP[this.priority] || 1,
            due_string: this.priority === PRIORITIES.HIGHEST ? 'today' : null
        };
    }

    hasCorrelation() {
        return this.todoistId !== null;
    }

    isHighPriority() {
        return this.priority <= PRIORITIES.HIGH;
    }

    equals(other) {
        return this.content.toLowerCase().trim() === other.content.toLowerCase().trim();
    }
}

function mapTodoistPriorityToLocal(todoistTask) {
    if (todoistTask.priority === 4 && todoistTask.due) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let dueDate;
        if (todoistTask.due.date) {
            dueDate = new Date(todoistTask.due.date + 'T00:00:00');
        } else if (todoistTask.due.datetime) {
            dueDate = new Date(todoistTask.due.datetime);
        } else {
            dueDate = new Date(todoistTask.due);
        }
        dueDate.setHours(0, 0, 0, 0);

        if (dueDate <= today) {
            return PRIORITIES.HIGHEST; // Due today or overdue
        }
    }

    return LOCAL_PRIORITY_MAP[todoistTask.priority] || PRIORITIES.LOWEST;
}