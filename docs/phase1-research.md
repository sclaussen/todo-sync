# Phase 1: Research & Design Results

## Todoist API Research

### Authentication
- **Method**: Bearer token authentication
- **Header Format**: `Authorization: Bearer YOUR_API_TOKEN`
- **Token Location**: Available in Todoist Settings → Integrations
- **Rate Limits**: 1000 requests per 15 minutes per user

### REST API v2 Endpoints

#### Tasks API
- **Base URL**: `https://api.todoist.com/rest/v2/tasks`

**Create Task**
```
POST /tasks
Content-Type: application/json

{
  "content": "Task description",
  "project_id": "PROJECT_ID",
  "priority": 1-4,
  "due_string": "today" or "tomorrow",
  "labels": ["label1", "label2"]
}
```

**Update Task**
```
POST /tasks/{task_id}
```

**Delete Task**
```
DELETE /tasks/{task_id}
```

**Get Tasks**
```
GET /tasks
GET /tasks/{task_id}
```

#### Projects API
- **Get Projects**: `GET /projects`
- **Create Project**: `POST /projects` with `{"name": "Project Name"}`
- **Update Project**: `POST /projects/{project_id}`
- **Delete Project**: `DELETE /projects/{project_id}`

### Priority Mapping
- Todoist uses priorities 1-4 (where 4 is most urgent)
- Our mapping:
  - ~/.todo Priority 0 → Todoist Priority 4 (urgent) + due date "today"
  - ~/.todo Priority 1 → Todoist Priority 3
  - ~/.todo Priority 2 → Todoist Priority 2
  - ~/.todo Priority 3 → Todoist Priority 1
  - ~/.todo Priority 4 → Todoist Priority 1

## Data Model Design

### Core Todo Item Model
```python
@dataclass
class TodoItem:
    content: str                    # The todo text
    local_priority: Optional[int]   # 0-4 from ~/.todo file
    todoist_priority: Optional[int] # 1-4 for Todoist
    todoist_id: Optional[str]       # Todoist task ID
    sync_id: str                    # Unique ID for sync tracking
    checksum: str                   # MD5 of content for change detection
    last_modified_source: str       # "local" or "todoist"
    last_sync: datetime             # Last successful sync timestamp
    due_date: Optional[str]         # Due date (for priority 0 items)
```

### Sync State Model
```python
@dataclass
class SyncState:
    sync_id: str                    # Maps to TodoItem.sync_id
    local_checksum: str             # Content checksum from ~/.todo
    todoist_checksum: str           # Content checksum from Todoist
    last_sync_timestamp: datetime   # When last synced
    conflict_status: Optional[str]  # "none", "resolved", "pending"
```

### ID Strategy
Since ~/.todo items don't have IDs, we'll generate stable IDs using:
1. **Initial sync**: Create UUID for each item
2. **Store mapping**: Save in `~/.todo-sync-state.json`
3. **Match by content**: For new items, fuzzy match to find moved items
4. **Preserve IDs**: Keep sync_id stable across edits

### Change Detection
1. **Content Hash**: MD5 hash of normalized content
2. **Timestamp Tracking**: Track last modification time
3. **Source Tracking**: Remember which system last modified item

### Conflict Resolution Strategy
```python
class ConflictResolution(Enum):
    LOCAL_WINS = "local"          # ~/.todo version overwrites
    REMOTE_WINS = "remote"        # Todoist version overwrites
    MERGE = "merge"               # Attempt to merge changes
    INTERACTIVE = "interactive"   # Ask user
    NEWEST_WINS = "newest"        # Use most recent change
```

### File Format Preservation
- Parse ~/.todo maintaining exact formatting
- Store original line positions and whitespace
- When writing back, preserve structure and formatting
- Only modify todo item lines, leave headers/sections intact

### Configuration Schema
```json
{
  "todoist": {
    "api_token": "YOUR_TOKEN",
    "project_name": "Synced Tasks",
    "project_id": null
  },
  "sync": {
    "conflict_resolution": "interactive",
    "auto_sync_interval": null,
    "backup_before_sync": true,
    "ignored_sections": [],
    "last_sync": null
  },
  "mapping": {
    "priority_mapping": {
      "0": {"todoist_priority": 4, "due_string": "today"},
      "1": {"todoist_priority": 3},
      "2": {"todoist_priority": 2},
      "3": {"todoist_priority": 1},
      "4": {"todoist_priority": 1}
    }
  }
}
```

## Next Steps
With this research complete, we can proceed to Phase 2 implementation:
1. Build ~/.todo file parser
2. Create Todoist API client wrapper
3. Implement sync engine with conflict detection
4. Build CLI interface