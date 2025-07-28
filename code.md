# Task Sync System Architecture Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Layers](#architecture-layers)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [Detailed Function Reference](#detailed-function-reference)
6. [Integration Patterns](#integration-patterns)
7. [Sync Engine Design](#sync-engine-design)

## System Overview

The Task Sync System is a Node.js application that synchronizes tasks between local text files and Todoist. It provides a CLI interface for managing tasks with bidirectional sync capabilities, priority mapping, and conflict resolution.

### Key Features
- **Bidirectional Sync**: Changes flow both from local→remote and remote→local
- **Priority Mapping**: 5-level local priority system (0-4) maps to Todoist's 4-level system
- **Conflict Resolution**: Local changes always win in conflicts
- **Correlation Tracking**: Uses Todoist IDs embedded in local files for tracking
- **Subtask Support**: Maintains parent-child task relationships
- **Transaction Logging**: All operations logged for audit and rollback

## Architecture Layers

### 1. CLI Interface Layer (tasks.js)
**Purpose**: User interaction and command routing
- Parses command-line arguments using Commander.js
- Implements dynamic command loading pattern
- Provides consistent error handling wrapper
- Routes to appropriate command implementations

### 2. Command Implementation Layer (src/commands/)
**Purpose**: Command-specific business logic
- Each command in separate module (create.js, sync.js, etc.)
- Orchestrates lib.js functions to fulfill user requests
- Handles command-specific options and validation
- Provides user feedback and formatting

### 3. Core Business Logic Layer (lib.js)
**Purpose**: Shared functionality and data operations
- File I/O operations for local task management
- Todoist API integration via unified client
- Sync engine and conflict resolution
- Data transformations and priority mapping

### 4. Data Access Layer (src/data/)
**Purpose**: Abstracted data operations
- Local file operations (local.js)
- Todoist API operations (todoist.js)
- Unified data access interface (index.js)

## Core Components

### tasks.js - CLI Entry Point

```javascript
// Main entry point structure
async function main() {
    const program = new Command();
    
    // Configure program metadata
    program
        .name('tasks')
        .description('Manage tasks from local files and/or Todoist')
        .version('1.0.0');
    
    // Dynamic command loading pattern
    const commands = {
        list: () => import('./src/commands/list.js'),
        create: () => import('./src/commands/create.js'),
        sync: () => import('./src/commands/sync.js'),
        // ... other commands
    };
    
    // Command definitions with error handling
    program
        .command('create <content...>')
        .action(withErrorHandler(async(content, options) => {
            const { execute } = await commands.create();
            await execute(content.join(' '), options);
        }));
}
```

### lib.js - Core Functionality

#### TodoistAPI Class
Centralized API client managing all Todoist interactions:

```javascript
class TodoistAPI {
    constructor(apiToken) {
        this.apiToken = apiToken;
        this.baseURL = 'https://api.todoist.com';
    }
    
    async request(endpoint, options = {}) {
        // Unified request handling with auth headers
        // Error handling and response parsing
    }
    
    // Specific API methods
    async getProjects() { }
    async getTasks(projectId) { }
    async createTask(taskData) { }
    async updateTask(taskId, updateData) { }
    async closeTask(taskId) { }
}
```

## Data Flow

### 1. Command Execution Flow
```
User Input → tasks.js → Command Module → lib.js Functions → Response
```

### 2. Data Synchronization Flow
```
Local Files ←→ lib.js Sync Engine ←→ Todoist API
     ↓                    ↓                    ↓
current.tasks      categorizeChanges()    REST API
completed.tasks     executeSync()         Projects
transactions.yaml   Conflict Resolution   Tasks
```

### 3. Priority Mapping Flow
```
Local Priority (0-4) → Mapping Logic → Todoist Priority (4-1)
0 (urgent) → 4 + due="today"
1 (high) → 4
2 (medium) → 3
3 (low) → 2
4 (lowest) → 1
```

## Detailed Function Reference

### Data Access Functions

#### getTasks(source)
**Purpose**: Unified interface for retrieving tasks
- **Parameters**: `source` - 'local' or 'remote'
- **Returns**: `{ current: { tasks: [] }, completed: { tasks: [] } }`
- **Implementation**: Routes to `getLocalTasks()` or `getRemoteTasks()`

#### getLocalTasks()
**Purpose**: Read and parse local task files
- **Process**:
  1. Reads current.tasks via `parseLocalTasks('.tasks')`
  2. Reads completed.tasks via `parseLocalTasks('.tasks.completed')`
  3. Returns structured task data with error handling
- **File Format**:
  ```
  Priority 0
  -------------------------------------------------------------------------------
  Urgent task (12345678)
  Another urgent task
  
  Priority 1
  -------------------------------------------------------------------------------
  High priority task
  - Subtask 1
  - Subtask 2
  ```

#### parseLocalTasks(filename)
**Purpose**: Parse priority-based task file format
- **Process**:
  1. Read file line by line
  2. Track current priority section
  3. Extract task content and metadata
  4. Handle subtasks (lines starting with "- ")
  5. Extract Todoist IDs from (12345678) format
- **Returns**: Array of task objects with:
  - `content`: Task text
  - `todoistId`: Correlation ID if synced
  - `priority`: 0-4 or 'unknown'
  - `lineNumber`: Position in file
  - `subtasks`: Array of subtask objects
  - `isSubtask`: Boolean flag
  - `parentTaskId`: Reference for subtasks

#### getRemoteTasks()
**Purpose**: Fetch tasks from Todoist API
- **Process**:
  1. Get project list and find sync project
  2. Fetch active tasks for project
  3. Fetch completed tasks (last 30 days)
  4. Map Todoist priorities to local system
  5. Build subtask relationships
  6. Deduplicate completed tasks
- **Special Handling**:
  - Priority 0 detection: P4 + due date ≤ today
  - Subtask hierarchy preservation
  - Completed task date filtering

### Sync Engine Functions

#### categorizeChanges(localTasks, todoistTasks)
**Purpose**: Core sync logic comparing local and remote state
- **Process**:
  1. **Correlation Phase**: Match tasks by Todoist ID
  2. **Conflict Detection**: Identify content/priority mismatches
  3. **Change Categorization**:
     - `noneToCurrent`: New tasks to create
     - `currentToCompleted`: Tasks to mark complete
     - `noneToCompleted`: Already completed tasks to sync
     - `renames`: Content or priority updates
  4. **Exact Match Detection**: Find uncorrelated tasks with identical content
  5. **Priority Conflict Resolution**: Local always wins
- **Returns**: Categorized changes object:
  ```javascript
  {
    local: { noneToCurrent, currentToCompleted, renames, ... },
    todoist: { noneToCurrent, currentToCompleted, renames, ... },
    conflicts: [],
    potentialRenames: []
  }
  ```

#### executeSync(changes, showLocal, showRemote)
**Purpose**: Execute categorized changes from sync analysis
- **Process**:
  1. Execute local changes via `executeLocalChanges()`
  2. Execute remote changes via `executeRemoteChanges()`
  3. Collect all changes for organized display
  4. Display results via `displaySyncResults()`
- **Error Handling**: Collects errors without stopping sync
- **Returns**: Results object with success status and errors

#### executeLocalChanges(localChanges, allChanges)
**Purpose**: Apply remote changes to local files
- **Operations**:
  1. **New Tasks**: Add to appropriate priority section
  2. **Completed Tasks**: Move to completed file with timestamp
  3. **Updates**: Modify content or move between priorities
- **Transaction Logging**: Each operation logged via `logSyncOperation()`
- **Change Tracking**: Populates `allChanges` array for display
- **File Management**: Maintains file structure and formatting

#### executeRemoteChanges(todoistChanges, allChanges)
**Purpose**: Apply local changes to Todoist
- **Operations**:
  1. **New Tasks**: Create via API with priority mapping
  2. **Completed Tasks**: Mark complete via API
  3. **Updates**: Modify content/priority via API
- **Correlation Updates**: Add new Todoist IDs to local files
- **Transaction Logging**: Each operation logged
- **Due Date Handling**: Auto-add "today" for P0 tasks

### CRUD Operation Functions

#### createLocalTask(content, priority)
**Purpose**: Add new task to local file
- **Process**:
  1. Find or create priority section
  2. Insert task after section separator
  3. Maintain file structure
- **File Handling**: Creates file if doesn't exist

#### createRemoteTaskByContent(content, priority)
**Purpose**: Create task in Todoist
- **Process**:
  1. Get project ID
  2. Map local priority to Todoist
  3. Add due date for P0
  4. Create via API
- **Returns**: Success boolean

#### updateLocalTask(taskName, options)
**Purpose**: Update task in local file
- **Capabilities**:
  - Change priority (moves between sections)
  - Toggle due date (P0 ↔ P1)
  - Preserve Todoist ID during moves
- **Search**: Case-insensitive partial match

#### updateRemoteTaskByName(taskName, options)
**Purpose**: Update task in Todoist
- **Process**:
  1. Search for task by name
  2. Apply priority/due date changes
  3. Update via API
- **Due Date Logic**: P0 requires due="today"

#### completeLocalTask(taskName)
**Purpose**: Mark task complete locally
- **Process**:
  1. Remove from current.tasks
  2. Add to completed.tasks with timestamp
  3. Format: `Task content (completed: YYYY-MM-DD)`

#### completeRemoteTaskByName(taskName)
**Purpose**: Mark task complete in Todoist
- **Process**:
  1. Find task by name
  2. Close via API endpoint
- **Note**: Completed tasks remain in Todoist history

### Utility Functions

#### Priority Mapping Functions

##### mapRemotePriority(task)
**Purpose**: Convert Todoist priority to local
- **Logic**:
  ```javascript
  if (task.priority === 4 && task.due && dueDate <= today) {
      return 0; // Urgent (P4 + due today/past)
  }
  return PRIORITY_MAPPING.REMOTE_TO_LOCAL[task.priority] || 4;
  ```

##### mapLocalPriorityToRemote(localPriority)
**Purpose**: Convert local priority to Todoist
- **Mapping**:
  - 0 → 4 (+ due="today")
  - 1 → 4
  - 2 → 3
  - 3 → 2
  - 4 → 1

#### File Management Functions

##### addTaskToLocalFile(task)
**Purpose**: Insert task into correct priority section
- **Features**:
  - Creates section if missing
  - Adds Todoist ID if present
  - Maintains proper formatting
  - Handles subtasks

##### updateTaskInLocalFile(change)
**Purpose**: Modify existing task
- **Types**:
  - Priority changes (move between sections)
  - Content updates
  - Correlation ID updates
- **Preservation**: Maintains subtasks and metadata

##### createBackup()
**Purpose**: Create timestamped backup
- **Process**:
  1. Create backup directory with timestamp
  2. Save local files in YAML format
  3. Fetch and save remote data
  4. Include raw file copies
- **Format**: `YYYYMMDD.HHMMSS`

#### Duplicate Management

##### findDuplicates(source)
**Purpose**: Identify duplicate tasks
- **Logic**: Case-insensitive content comparison
- **Returns**: Array of duplicates with counts

##### removeDuplicates(source)
**Purpose**: Remove duplicate tasks
- **Strategy**: Keep first occurrence
- **Local**: Rewrite file without duplicates
- **Remote**: Delete via API with rate limiting

## Integration Patterns

### 1. Command Module Pattern
Commands act as orchestrators, combining lib.js functions:

```javascript
// Example from create.js
export async function execute(content, options) {
    if (!options.remote) {
        await createLocalTask(content, priority);
    }
    if (!options.local) {
        await createRemoteTaskByContent(content, priority);
    }
}
```

### 2. Shared API Client Pattern
Single TodoistAPI instance used throughout:

```javascript
// In lib.js
const todoistAPI = new TodoistAPI(TODOIST.API_TOKEN);

// Used by all remote operations
const projects = await todoistAPI.getProjects();
const tasks = await todoistAPI.getTasks(projectId);
```

### 3. Unified Data Structure Pattern
Both local and remote sources return same structure:

```javascript
// Consistent return format
return {
    current: { 
        tasks: [
            { content, priority, todoistId, ... }
        ] 
    },
    completed: { 
        tasks: [
            { content, priority, completed, ... }
        ] 
    }
};
```

### 4. Transaction Logging Pattern
All modifications logged for audit:

```javascript
logSyncOperation('create', 'local', {
    todoistId: task.id,
    content: task.content,
    priority: task.priority,
    source: 'todoist'
});
```

### 5. Error Handling Pattern
Graceful degradation with error collection:

```javascript
try {
    // Operation
} catch (error) {
    results.errors.push(`Context: ${error.message}`);
    // Continue processing other items
}
```

## Sync Engine Design

### Correlation Strategy
- **Primary Key**: Todoist task ID
- **Storage**: Embedded in local files as `(12345678)`
- **Extraction**: Via regex patterns
- **Updates**: Preserved during all operations

### Conflict Resolution Rules
1. **Content Conflicts**: Local content wins
2. **Priority Conflicts**: Local priority wins
3. **Existence Conflicts**: Explicit user action required
4. **Completion Conflicts**: Most recent action wins

### Change Detection Algorithm
1. **Phase 1**: Match by Todoist ID
2. **Phase 2**: Exact content matching for uncorrelated
3. **Phase 3**: Identify truly new tasks
4. **Phase 4**: Categorize all changes

### Transaction Safety
- **Atomic Operations**: Each change independent
- **Rollback**: Via transaction log
- **Idempotency**: Repeated syncs safe
- **Audit Trail**: Complete operation history

### Performance Optimizations
- **Batch Operations**: Group API calls
- **Caching**: 30-day completed task window
- **Deduplication**: Prevent duplicate syncs
- **Rate Limiting**: 100ms delay between API calls

## File Formats

### current.tasks Format
```
Priority 0
-------------------------------------------------------------------------------
Urgent task needing immediate attention (12345678)
Another urgent task

Priority 1
-------------------------------------------------------------------------------
Important task (87654321)
- First subtask
- Second subtask
Project planning task

Priority 2
-------------------------------------------------------------------------------
Medium priority items
```

### completed.tasks Format
```
Completed task one (completed: 2025-01-15) (12345678)
Completed task two (completed: 2025-01-14)
```

### transactions.yaml Format
```yaml
- timestamp: 2025-01-15T10:30:00Z
  operation: create
  location: local
  data:
    todoistId: 12345678
    content: New task
    priority: 1
    source: todoist
```

## Best Practices

### For Extending the System
1. **New Commands**: Create in src/commands/, import needed lib.js functions
2. **API Extensions**: Add methods to TodoistAPI class
3. **New Sync Rules**: Modify categorizeChanges() logic
4. **File Format Changes**: Update parseLocalTasks() and writers

### For Testing
1. **Test Mode**: Uses separate "Test" Todoist project
2. **Test Files**: Located in test/.tasks/
3. **Isolation**: No production data affected
4. **Utilities**: test/util.js provides helpers

### For Maintenance
1. **Logging**: Use logSyncOperation() for all changes
2. **Error Handling**: Collect errors, don't throw
3. **Backups**: Regular automated backups recommended
4. **Monitoring**: Check transaction logs for anomalies