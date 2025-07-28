# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a task CLI whose primary goal is to synchronize tasks between a local
~/.tasks/current.tasks file and a remote Todoist project containing tasks.
The application uses Node.JS and ES modules.  Local refers to the
current.tasks on the file system, and the term remote refers to the Todoist
tasks in the Sync project.

## Local tasks
Local tasks use a priority of 0 through 4, 0 being the highest, 4 being the
lowest.

Local tasks do not have due dates.

There are test and production file locations for local tasks.

Production tasks are stored in ~/.tasks/current.tasks.
Production completed tasks are in  ~/.tasks/completed.
Production transation log describing local creates, updates,
completes, and removes in ~/.tasks/transactions.yaml.

Test tasks are stored in test/.tasks/current.tasks.
Test completed tasks are in  test/.tasks/completed.
Test transation log describing local creates, updates,
completes, and removes is stored in tet/.tasks/transactions.yaml.

### Primary User Interface: tasks.el
The `tasks.el` file provides an Emacs major mode that serves as the primary user interface for manipulating local tasks. While the `tasks.js` CLI provides programmatic access and sync functionality, `tasks.el` offers the main interactive experience for day-to-day task management.

**Key Features:**
- **Global Access**: `C-c C-t` opens the default task file (`~/.tasks/current.tasks`)
- **Vi-like Navigation**: `j/k` for moving between tasks, `n/p` for next/previous
- **Quick Task Creation**: Number keys `0-4` create tasks at respective priorities
- **Priority Management**: `C-c 0-4` change task priority, `,/.` raise/lower priority
- **Task Operations**: `c` complete, `x` delete, `e` edit task name
- **Edit Modes**: `C-c C-c` toggles between view mode (vi-like) and edit mode (full editing)
- **Task Movement**: `J/K` move tasks up/down within priority sections
- **Transaction Logging**: All operations are logged to `transactions.yaml` with timestamps

**File Structure Management:**
- Automatically maintains the priority section structure
- Works with both production (`~/.tasks/`) and test (`test/.tasks/`) directories
- Supports file auto-detection based on current buffer location
- Logs all changes with source attribution (`source: task.el`)

**Integration with CLI:**
- Uses the same file formats and transaction logging as the CLI
- Changes made in tasks.el are immediately available to the sync engine
- Maintains compatibility with Todoist ID correlation markers

### Todo File Format
The `~/.tasks/current.tasks` file uses structured sections for each of the 5
priorities with optional Todoist ID markers on each task if the task has been
synced:
```
Priority 0
-------------------------------------------------------------------------------
urgent task content (12345678)
another urgent task

Priority 1
-------------------------------------------------------------------------------
Some P1 task (87654321)

Priority 2
-------------------------------------------------------------------------------
Some P2 task

Priority 3
-------------------------------------------------------------------------------
Some P3 task

Priority 4
-------------------------------------------------------------------------------
Some P4 task
```

Subtasks are represented like this locally:

Some parent task
- subtask 1
- subtask 2

## Remote tasks
Production remote tasks are all stored in a Todist project named Sync.

Test remote tasks are all stored in a Todist project named Test.

Remote Todoist tasks use a different priority model, 4 to 1, where 4 is the
highest, and 1 is the lowest

We map local tasks to remote tasks, but we use the 0 to 4 model defined by
local tasks as our canonical model.

Local tasks that are priority 0 map to remote tasks in Todoist that are
priority 4, but, they have a due date that is today, or a day prior to today.

## Priority Mapping
Local priorities (0-4) map to remote Todoist priorities:
- Priority 0 → Todoist Priority 4 (highest/red) + due date "today" or prior
- Priority 1 → Todoist Priority 4 (highest/red) without due date or future due date
- Priority 2 → Todoist Priority 3 (orange)
- Priority 3 → Todoist Priority 2 (blue)
- Priority 4 → Todoist Priority 1 (lowest/no flag)

## Testing
- Tests use a separate Todoist project called "Test" for isolation from production data
- The test environment is configured via `test/util.js` with `TODOIST_PROJECT_NAME: 'Test'`
- Test utilities automatically create/clear the "Test" project to ensure clean test runs

## Project Structure
- `tasks.js`: Main CLI interface and entry point
- `tasks.el`: Emacs major mode providing the primary user interface for local task management
- `lib.js`: Core functionality for reading/writing tasks, Todoist API integration, and sync logic
- `src/commands/`: Command implementations for each CLI subcommand
  - `create.js`: Task creation functionality
  - `list.js`: Task listing and display
  - `sync.js`: Bidirectional synchronization logic
  - `complete.js`: Task completion handling
  - `update.js`: Task modification operations
  - `remove.js`: Task deletion functionality
  - `dups.js`: Duplicate detection and removal
- `src/data/`: Data layer for local and remote task management
  - `local.js`: Local file system task operations
  - `todoist.js`: Todoist API integration
  - `index.js`: Unified data access interface
- `src/display/`: Output formatting and presentation
  - `console.js`: Console output formatting
  - `yaml.js`: YAML output formatting
- `src/config/`: Configuration and utilities
  - `constants.js`: Application constants and settings
  - `errorHandler.js`: Error handling utilities
- `src/models/`: Data models and structures
  - `Task.js`: Task data model and validation
- `test/util.js`: Core testing utilities with functions for setup, cleanup, and command execution
  - `init()`: Sets up clean test environment (creates test project, clears tasks, initializes local files)
  - `sh()`: Executes CLI commands with test environment variables
  - `normalize()`: Normalizes YAML output by removing location/due fields for comparison
  - `diff()`: Compares local vs remote task outputs
  - `cleanup()`: Cleans up test files and remote project after tests
  - Add new utilities here
- `test/test.js`: Example test implementation showing sync functionality
  - Use this as a template for creating new tests
  - Keep tests simple, focused, and easy to read
  - Provide just enough output to verify functionality (single ✅ success message per test)
- **Test file isolation**: Tests use `test/.tasks/` directory for local
  - This prevents interference with production `~/.tasks/` files
  - Test environment automatically redirects `TASKS_DIR` to `test/.tasks/`

## Sync Design
The sync engine uses direct Todoist IDs for correlation:
- **Todoist IDs**: Tasks correlated using actual Todoist task IDs (e.g., `(12345678)`)
- **Local Correlation Markers**: Tasks marked with `(todoistId)` for tracking
- **Conflict Resolution**: Local changes always win over remote changes

## Environment Variables
The following environment variables are required in the `.env` file:

```bash
# Required - Todoist API Configuration
TODOIST_API_TOKEN=your_todoist_api_token_here
TODOIST_PROJECT_NAME=Sync

# Optional - Development/Testing
TASKS_DIR=/path/to/custom/tasks/directory
```

**Variable Details:**
- `TODOIST_API_TOKEN` (Required): Your Todoist API token for accessing the Todoist API
- `TODOIST_PROJECT_NAME` (Required): Name of the Todoist project to sync with (defaults to "Sync")
- `TASKS_DIR` (Optional): Custom directory for task files (defaults to `~/.tasks/`)

## Implementation Details
- Uses ES modules with `.js` imports in JavaScript files
- Configuration via environment variables (TODOIST_API_TOKEN, TODOIST_PROJECT_NAME)
- Direct Todoist ID correlation for task tracking
- Dry-run sync preview mode showing what changes would be made

## Git Commit Guidelines
- Please use Conventional Commits formatting for git commits.
- Please do not mention yourself (Claude) as a co-author when commiting, or
  include any lines to Claude Code.

## Guidance Memories
- Please ask for clarification upfront, upon the initial prompts, when you
  need more direction.

## Important Notes
- **Function Order**: Organize functions top-down with main/entry functions
  at the top, followed by helper functions in order of their call hierarchy
- **NEVER show dotenv debug messages** - The user has explicitly requested
  that dotenv debug output (like "[dotenv@17.2.0] injecting env (0) from
  .env") should NEVER be displayed. Always suppress these messages when
  working with dotenv configuration.

- ALWAYS use `.claude/settings.json` for project settings.
  NEVER use `.claude/settings.local.json`.
