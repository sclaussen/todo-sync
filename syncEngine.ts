import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { TodoItem, SyncState, ConflictResolution, calculateChecksum } from './types.js';
import { TodoParser } from './todoParser.js';
import { TodoistClient } from './todoistClient.js';
import { ConfigManager } from './config.js';
import { DuplicateDetector } from './duplicateDetector.js';
import { Task } from '@doist/todoist-api-typescript';

interface SyncStateFile {
    [syncId: string]: SyncState;
}

interface SyncResult {
    added: { local: number; todoist: number };
    updated: { local: number; todoist: number };
    deleted: { local: number; todoist: number };
    conflicts: number;
    duplicatesResolved: number;
    errors: string[];
}

export class SyncEngine {
    private todoParser: TodoParser;
    private todoistClient: TodoistClient;
    private configManager: ConfigManager;
    private duplicateDetector: DuplicateDetector;
    private syncStatePath: string;
    private syncStates: SyncStateFile;

    constructor(configManager: ConfigManager) {
        this.configManager = configManager;
        this.todoParser = new TodoParser();
        this.todoistClient = new TodoistClient(configManager.get());
        this.duplicateDetector = new DuplicateDetector(configManager.get().duplicateDetection);
        this.syncStatePath = homedir() + '/.todo-sync-state.json';
        this.syncStates = this.loadSyncStates();
    }

    private loadSyncStates(): SyncStateFile {
        if (!existsSync(this.syncStatePath)) {
            return {};
        }

        try {
            const content = readFileSync(this.syncStatePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.error('Error loading sync states:', error);
            return {};
        }
    }

    private saveSyncStates(): void {
        writeFileSync(this.syncStatePath, JSON.stringify(this.syncStates, null, 2));
    }

    async sync(): Promise<SyncResult> {
        const result: SyncResult = {
            added: { local: 0, todoist: 0 },
            updated: { local: 0, todoist: 0 },
            deleted: { local: 0, todoist: 0 },
            conflicts: 0,
            duplicatesResolved: 0,
            errors: []
        };

        try {
            // Initialize Todoist client
            await this.todoistClient.initialize();

            // Load current state from both sources
            const todoFile = this.todoParser.parse();
            const localTasks = this.todoParser.getSyncableTodos(todoFile);
            const todoistTasks = await this.todoistClient.getTasks();

            // Assign sync IDs to local todos without them
            for (const todo of localTasks) {
                if (!todo.syncId) {
                    todo.syncId = this.findOrCreateSyncId(todo);
                }
            }

            // Check for duplicates if enabled
            if (this.configManager.get().duplicateDetection.enabled) {
                const duplicateResult = this.duplicateDetector.findDuplicates(localTasks);
                if (duplicateResult.duplicates.length > 0) {
                    result.duplicatesResolved = await this.resolveDuplicates(duplicateResult.duplicates, todoFile);

                    // Save the file immediately after duplicate resolution
                    this.todoParser.write(todoFile);

                    // Refresh local todos after duplicate resolution
                    const updatedLocalTodos = this.todoParser.getSyncableTodos(todoFile);

                    // Ensure sync IDs are assigned to the refreshed todos
                    for (const todo of updatedLocalTodos) {
                        if (!todo.syncId) {
                            todo.syncId = this.findOrCreateSyncId(todo);
                        }
                    }

                    localTasks.length = 0; // Clear the array
                    localTasks.push(...updatedLocalTodos); // Add the updated todos
                }
            }

            // Create maps for efficient lookup
            const localMap = new Map(localTasks.map(t => [t.syncId, t]));
            const todoistMap = new Map<string, Task>();

            // Map Todoist tasks to sync IDs
            for (const task of todoistTasks) {
                const syncId = this.findSyncIdForTodoistTask(task);
                if (syncId) {
                    todoistMap.set(syncId, task);
                }
            }

            // Process local todos
            for (const localTodo of localTasks) {
                const todoistTask = todoistMap.get(localTodo.syncId);
                const syncState = this.syncStates[localTodo.syncId];

                if (!todoistTask) {
                    // Todo exists only locally - create in Todoist
                    try {
                        const newTask = await this.todoistClient.createTask(localTodo);
                        this.updateSyncState(localTodo.syncId, localTodo.checksum, calculateChecksum(newTask.content));
                        result.added.todoist++;
                    } catch (error) {
                        result.errors.push(`Failed to create task in Todoist: ${localTodo.content}`);
                    }
                } else {
                    // Todo exists in both - check for updates
                    const todoistChecksum = calculateChecksum(todoistTask.content);

                    if (syncState) {
                        if (localTodo.checksum !== syncState.localChecksum && todoistChecksum !== syncState.todoistChecksum) {
                            // Both changed - conflict!
                            result.conflicts++;
                            await this.handleConflict(localTodo, todoistTask, todoFile);
                        } else if (localTodo.checksum !== syncState.localChecksum) {
                            // Local changed - update Todoist
                            try {
                                await this.todoistClient.updateTask(todoistTask.id, localTodo.content);
                                this.updateSyncState(localTodo.syncId, localTodo.checksum, localTodo.checksum);
                                result.updated.todoist++;
                            } catch (error) {
                                result.errors.push(`Failed to update task in Todoist: ${localTodo.content}`);
                            }
                        } else if (todoistChecksum !== syncState.todoistChecksum) {
                            // Todoist changed - update local
                            this.todoParser.updateTodoContent(localTodo.syncId, todoistTask.content, todoFile);
                            this.updateSyncState(localTodo.syncId, todoistChecksum, todoistChecksum);
                            result.updated.local++;
                        }
                    } else {
                        // No sync state - create one
                        this.updateSyncState(localTodo.syncId, localTodo.checksum, todoistChecksum);
                    }
                }
            }

            // Process Todoist tasks not in local
            for (const [syncId, task] of todoistMap) {
                if (!localMap.has(syncId)) {
                    // Task exists only in Todoist - add to local
                    const todoItem = this.todoistClient.mapTodoistTaskToItem(task);
                    todoItem.syncId = syncId;

                    // Only add to Priority 0-4 sections
                    if (todoItem.localPriority !== undefined && todoItem.localPriority >= 0 && todoItem.localPriority <= 4) {
                        const section = todoFile.sections.find(s => s.priority === todoItem.localPriority);
                        if (section) {
                            // Check if this would create a duplicate
                            const existingItems = section.items;
                            const wouldBeDuplicate = existingItems.some(existing =>
                                this.duplicateDetector.isDuplicate(todoItem, existing)
                            );

                            if (!wouldBeDuplicate) {
                                section.items.push(todoItem);
                                result.added.local++;
                            } else {
                                console.warn(`Skipping duplicate item from Todoist: "${todoItem.content}"`);
                            }
                        }
                    }
                }
            }

            // Save updated todo file
            this.todoParser.write(todoFile);

            // Update last sync time
            this.configManager.updateLastSync();

            // Save sync states
            this.saveSyncStates();

        } catch (error) {
            result.errors.push(`Sync failed: ${error}`);
        }

        return result;
    }

    private findOrCreateSyncId(todo: TodoItem): string {
        // Try to find existing sync ID by content match
        for (const [syncId, state] of Object.entries(this.syncStates)) {
            if (state.localChecksum === todo.checksum) {
                return syncId;
            }
        }

        // Create new sync ID
        return uuidv4();
    }

    private findSyncIdForTodoistTask(task: Task): string | null {
        const taskChecksum = calculateChecksum(task.content);

        // Try to find by Todoist checksum
        for (const [syncId, state] of Object.entries(this.syncStates)) {
            if (state.todoistChecksum === taskChecksum) {
                return syncId;
            }
        }

        // If not found, create new sync ID
        const syncId = uuidv4();
        this.updateSyncState(syncId, '', taskChecksum);
        return syncId;
    }

    private updateSyncState(syncId: string, localChecksum: string, todoistChecksum: string): void {
        this.syncStates[syncId] = {
            syncId,
            localChecksum,
            todoistChecksum,
            lastSyncTimestamp: new Date(),
            conflictStatus: 'none'
        };
    }

    private async handleConflict(localTodo: TodoItem, todoistTask: Task, todoFile: any): Promise<void> {
        const resolution = this.configManager.get().sync.conflictResolution;

        switch (resolution) {
        case ConflictResolution.LOCAL_WINS:
            await this.todoistClient.updateTask(todoistTask.id, localTodo.content);
            this.updateSyncState(localTodo.syncId, localTodo.checksum, localTodo.checksum);
            break;

        case ConflictResolution.REMOTE_WINS:
            this.todoParser.updateTodoContent(localTodo.syncId, todoistTask.content, todoFile);
            const newChecksum = calculateChecksum(todoistTask.content);
            this.updateSyncState(localTodo.syncId, newChecksum, newChecksum);
            break;

        case ConflictResolution.NEWEST_WINS:
            // For now, default to local wins (would need timestamps to implement properly)
            await this.todoistClient.updateTask(todoistTask.id, localTodo.content);
            this.updateSyncState(localTodo.syncId, localTodo.checksum, localTodo.checksum);
            break;

        default:
            // Mark as pending conflict for manual resolution
            this.syncStates[localTodo.syncId].conflictStatus = 'pending';
            break;
        }
    }

    private async resolveDuplicates(duplicateGroups: import('./duplicateDetector.js').DuplicateGroup[], todoFile: import('./types.js').TodoFile): Promise<number> {
        const strategy = this.configManager.get().duplicateDetection.strategy;
        let resolvedCount = 0;

        for (const group of duplicateGroups) {
            const items = group.items;

            switch (strategy) {
            case 'merge':
                // Keep the first item, merge data if needed
                const mergedItem = items[0];

                // Remove other items from their sections
                for (let i = 1; i < items.length; i++) {
                    this.removeItemFromTodoFile(items[i], todoFile);
                    resolvedCount++;
                }
                break;

            case 'keep_newest':
                // Keep the item with the most recent sync timestamp
                const newestItem = items.reduce((newest: TodoItem, current: TodoItem) => {
                    const newestSync = this.syncStates[newest.syncId]?.lastSyncTimestamp;
                    const currentSync = this.syncStates[current.syncId]?.lastSyncTimestamp;

                    if (!newestSync && currentSync) return current;
                    if (!currentSync && newestSync) return newest;
                    if (!newestSync && !currentSync) return newest; // Keep first if no timestamps

                    return new Date(currentSync) > new Date(newestSync) ? current : newest;
                });

                // Remove all other items
                for (const item of items) {
                    if (item.syncId !== newestItem.syncId) {
                        this.removeItemFromTodoFile(item, todoFile);
                        resolvedCount++;
                    }
                }
                break;

            case 'keep_oldest':
                // Keep the item with the oldest sync timestamp
                const oldestItem = items.reduce((oldest: TodoItem, current: TodoItem) => {
                    const oldestSync = this.syncStates[oldest.syncId]?.lastSyncTimestamp;
                    const currentSync = this.syncStates[current.syncId]?.lastSyncTimestamp;

                    if (!oldestSync && currentSync) return oldest; // Keep first if no timestamp
                    if (!currentSync && oldestSync) return current;
                    if (!oldestSync && !currentSync) return oldest; // Keep first if no timestamps

                    return new Date(currentSync) < new Date(oldestSync) ? current : oldest;
                });

                // Remove all other items
                for (const item of items) {
                    if (item.syncId !== oldestItem.syncId) {
                        this.removeItemFromTodoFile(item, todoFile);
                        resolvedCount++;
                    }
                }
                break;

            case 'prevent':
                // Don't allow sync to proceed with duplicates
                throw new Error(`Duplicate items detected: ${items.map((i: TodoItem) => i.content).join(', ')}`);

            case 'interactive':
            default:
                // For now, just log and keep the first item
                console.warn(`Duplicate items detected (interactive resolution not yet implemented):`);
                items.forEach((item: TodoItem, index: number) => {
                    console.warn(`  ${index + 1}. "${item.content}" (Priority ${item.localPriority}) [ID: ${item.syncId}]`);
                });

                // Keep first item, remove others
                for (let i = 1; i < items.length; i++) {
                    console.log(`Attempting to remove: "${items[i].content}" with syncId: ${items[i].syncId}`);
                    this.removeItemFromTodoFile(items[i], todoFile);
                    resolvedCount++;
                }
                break;
            }
        }

        return resolvedCount;
    }

    private removeItemFromTodoFile(item: TodoItem, todoFile: import('./types.js').TodoFile): void {
        for (const section of todoFile.sections) {
            const itemIndex = section.items.findIndex((sectionItem: TodoItem) => sectionItem.syncId === item.syncId);
            if (itemIndex !== -1) {
                section.items.splice(itemIndex, 1);
                break;
            }
        }
    }
}
