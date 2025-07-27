# Transaction Log Format (TRANLOG)

The transaction log (`~/.tasks/transactions.yaml`) maintains a chronological record of all task operations performed by the task management system. This file uses YAML format and is append-only to preserve the complete audit trail.

## File Structure

```yaml
# Entries are append-only, ordered chronologically
entries:
  - type: create
    timestamp: 2025-07-22T19:38:24-0700
    name: "P0 item"
    priority: 0
    source: task.el

  - type: create
    timestamp: 2025-07-22T19:38:27-0700
    name: "P1 item"
    priority: 1
    source: task.el

  - type: update-priority
    timestamp: 2025-07-22T19:38:43-0700
    name: "P0 item"
    old-priority: 0
    new-priority: 2
    source: task.el

  - type: update-name
    timestamp: 2025-07-22T19:39:05-0700
    name: "P1 item"
    new-name: "P1 item new name"
    source: task.el

  - type: complete
    timestamp: 2025-07-22T19:39:45-0700
    name: "P1 item new name"
    source: task.el

  - type: create
    timestamp: 2025-07-22T20:05:30-0700
    name: "P3 item"
    priority: 3
    source: task.el

  - type: update-name
    timestamp: 2025-07-22T20:05:35-0700
    name: "P3 item"
    new-name: "P3 item edited"
    source: task.el

  - type: complete
    timestamp: 2025-07-22T20:05:37-0700
    name: "P3 item edited"
    source: task.el

```

## Entry Types

### create
Records the creation of a new task.

**Properties:**
- `type`: "create"
- `timestamp`: ISO 8601 timestamp with timezone
- `name`: The task description/name
- `priority`: Task priority (0-4)
- `source`: Source of the operation ("task.el" or "cli")

**Example:**
```yaml
  - type: create
    timestamp: 2025-07-22T16:16:24-0700
    name: Implement new feature
    priority: 1
    source: task.el
```

### update-name
Records changes to a task's name/description.

**Properties:**
- `type`: "update-name"
- `timestamp`: ISO 8601 timestamp with timezone
- `name`: Original task name
- `new-name`: Updated task name
- `source`: Source of the operation ("task.el" or "cli")

**Example:**
```yaml
  - type: update-name
    timestamp: 2025-07-22T16:17:30-0700
    name: Implement new feature
    new-name: Implement enhanced feature with validation
    source: task.el
```

### update-priority
Records changes to a task's priority.

**Properties:**
- `type`: "update-priority"
- `timestamp`: ISO 8601 timestamp with timezone
- `name`: Task name
- `old-priority`: Original priority (0-4)
- `new-priority`: New priority (0-4)
- `source`: Source of the operation ("task.el" or "cli")

**Example:**
```yaml
  - type: update-priority
    timestamp: 2025-07-22T16:18:45-0700
    name: Implement enhanced feature with validation
    old-priority: 1
    new-priority: 0
    source: task.el
```

### complete
Records task completion.

**Properties:**
- `type`: "complete"
- `timestamp`: ISO 8601 timestamp with timezone
- `name`: Task name
- `source`: Source of the operation ("task.el" or "cli")

**Example:**
```yaml
  - type: complete
    timestamp: 2025-07-22T16:45:12-0700
    name: Implement enhanced feature with validation
    source: task.el
```

### remove
Records task deletion/removal.

**Properties:**
- `type`: "remove"
- `timestamp`: ISO 8601 timestamp with timezone
- `name`: Task name
- `source`: Source of the operation ("task.el" or "cli")

**Example:**
```yaml
  - type: remove
    timestamp: 2025-07-22T16:50:30-0700
    name: Outdated task
    source: task.el
```

## Common Properties

### timestamp
All entries include a timestamp in ISO 8601 format with timezone information:
- Format: `YYYY-MM-DDTHH:MM:SS±HHMM`
- Example: `2025-07-22T16:16:24-0700`

### source
Indicates the tool that performed the operation:
- `task.el`: Operations performed through the Emacs task mode
- `cli`: Operations performed through the command-line interface

### name
The task description/name as it appears in the task list. This field is quoted in YAML to handle special characters and preserve formatting.

## Usage Notes

1. **Append-Only**: New entries are always appended to the end of the file
2. **Chronological Order**: Entries appear in the order they were performed
3. **Immutable History**: Existing entries should never be modified or deleted
4. **File Location**: The tranlog file is stored at `~/.tasks/transactions.yaml`
5. **Automatic Creation**: The file and its header are created automatically when the first entry is logged

## File Organization

The task management system uses the following file structure under `~/.tasks/`:
- `tasks` - Main task file with active tasks organized by priority
- `completed` - Archive of completed tasks with timestamps
- `transactions.yaml` - Transaction log with all task operations
- `backup/` - Directory for backup files (future use)

## Integration

The transaction log integrates with:
- **Emacs task.el**: All task operations automatically generate tranlog entries
- **CLI tool**: Future integration will log operations from command-line interface
- **Audit Tools**: The structured format enables easy parsing and analysis of task history
