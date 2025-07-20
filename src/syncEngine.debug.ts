import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { TodoItem, SyncState, ConflictResolution, calculateChecksum } from './types.js';
import { TodoParser } from './todoParser.js';
import { TodoistClient } from './todoistClient.js';
import { ConfigManager } from './config.js';
import { Task } from '@doist/todoist-api-typescript';

interface SyncStateFile {
  [syncId: string]: SyncState;
}

interface SyncResult {
  added: { local: number; todoist: number };
  updated: { local: number; todoist: number };
  deleted: { local: number; todoist: number };
  conflicts: number;
  errors: string[];
}

export class SyncEngine {
  private todoParser: TodoParser;
  private todoistClient: TodoistClient;
  private configManager: ConfigManager;
  private syncStatePath: string;
  private syncStates: SyncStateFile;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    this.todoParser = new TodoParser();
    this.todoistClient = new TodoistClient(configManager.get());
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
      errors: []
    };

    try {
      // Initialize Todoist client
      await this.todoistClient.initialize();

      // Load current state from both sources
      const todoFile = this.todoParser.parse();
      const localTodos = this.todoParser.getSyncableTodos(todoFile);
      const todoistTasks = await this.todoistClient.getTasks();

      console.log('\n=== DEBUG: Sync Starting ===');
      console.log(`Local todos found: ${localTodos.length}`);
      console.log(`Todoist tasks found: ${todoistTasks.length}`);
      console.log(`Sync states loaded: ${Object.keys(this.syncStates).length}`);

      // Debug: Show first few todos from each source
      console.log('\nFirst 5 local todos:');
      localTodos.slice(0, 5).forEach(t => console.log(`  - "${t.content}" (priority: ${t.localPriority})`));
      
      console.log('\nFirst 5 Todoist tasks:');
      todoistTasks.slice(0, 5).forEach(t => console.log(`  - "${t.content}" (priority: ${t.priority})`));

      // Assign sync IDs to local todos without them
      let newSyncIds = 0;
      for (const todo of localTodos) {
        if (!todo.syncId) {
          todo.syncId = this.findOrCreateSyncId(todo);
          newSyncIds++;
        }
      }
      console.log(`\nAssigned ${newSyncIds} new sync IDs to local todos`);

      // Create maps for efficient lookup
      const localMap = new Map(localTodos.map(t => [t.syncId, t]));
      const todoistMap = new Map<string, Task>();
      
      // Map Todoist tasks to sync IDs
      console.log('\nMapping Todoist tasks to sync IDs...');
      for (const task of todoistTasks) {
        const syncId = this.findSyncIdForTodoistTask(task);
        if (syncId) {
          todoistMap.set(syncId, task);
          console.log(`  - Mapped "${task.content}" to syncId: ${syncId}`);
        }
      }

      console.log(`\nProcessing ${localTodos.length} local todos...`);
      // Process local todos
      for (const localTodo of localTodos) {
        const todoistTask = todoistMap.get(localTodo.syncId);
        const syncState = this.syncStates[localTodo.syncId];

        if (!todoistTask) {
          // Todo exists only locally - create in Todoist
          console.log(`  - Creating in Todoist: "${localTodo.content}"`);
          try {
            const newTask = await this.todoistClient.createTask(localTodo);
            this.updateSyncState(localTodo.syncId, localTodo.checksum, calculateChecksum(newTask.content));
            result.added.todoist++;
          } catch (error) {
            console.error(`    ERROR: ${error}`);
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

      console.log(`\nProcessing Todoist tasks not in local...`);
      // Process Todoist tasks not in local
      let addedToLocal = 0;
      for (const [syncId, task] of todoistMap) {
        if (!localMap.has(syncId)) {
          // Task exists only in Todoist - add to local
          const todoItem = this.todoistClient.mapTodoistTaskToItem(task);
          todoItem.syncId = syncId;
          
          console.log(`  - Checking if should add to local: "${task.content}" (priority: ${todoItem.localPriority})`);
          
          // Only add to Priority 0-4 sections
          if (todoItem.localPriority !== undefined && todoItem.localPriority >= 0 && todoItem.localPriority <= 4) {
            const section = todoFile.sections.find(s => s.priority === todoItem.localPriority);
            if (section) {
              section.items.push(todoItem);
              result.added.local++;
              addedToLocal++;
              console.log(`    - Added to Priority ${todoItem.localPriority} section`);
            } else {
              console.log(`    - No section found for priority ${todoItem.localPriority}`);
            }
          } else {
            console.log(`    - Skipped: priority ${todoItem.localPriority} out of range`);
          }
        }
      }
      console.log(`Added ${addedToLocal} tasks from Todoist to local file`);

      // Save updated todo file
      this.todoParser.write(todoFile);
      
      // Update last sync time
      this.configManager.updateLastSync();
      
      // Save sync states
      this.saveSyncStates();

      console.log('\n=== Sync Complete ===');
      console.log(`Added: ${result.added.local} local, ${result.added.todoist} Todoist`);
      console.log(`Updated: ${result.updated.local} local, ${result.updated.todoist} Todoist`);
      console.log(`Conflicts: ${result.conflicts}`);
      console.log(`Errors: ${result.errors.length}`);

    } catch (error) {
      console.error('\n=== SYNC FAILED ===');
      console.error(error);
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
}