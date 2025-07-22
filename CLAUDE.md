# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Development Notes

**NEVER show dotenv debug messages** - The user has explicitly requested that dotenv debug output (like "[dotenv@17.2.0] injecting env (0) from .env") should NEVER be displayed. Always suppress these messages when working with dotenv configuration.

## Project Overview

This is a bidirectional todo synchronization tool that syncs between a local `~/.tasks` file and Todoist. The application uses JavaScript with ES modules and provides a CLI interface for todo management and sync operations.

## Development Commands

### Task Management
- `npm run tasks` or `npm run tasks -- list` - Show current todos from both local and remote
- `npm run tasks -- list -l` - Show only local current todos
- `npm run tasks -- list -r` - Show only remote current todos
- `npm run tasks -- list -c` - Show completed tasks from both sources

### Task Creation
- `npm run tasks -- create "New task"` - Create task locally (default)
- `npm run tasks -- create "New task" -r` - Create task on Todoist only
- `npm run tasks -- create "Urgent task" -p 0` - Create high priority task locally

### Synchronization
- `npm run tasks -- sync` - Full bidirectional sync
- `npm run tasks -- sync -p` - Show sync preview (dry-run)
- `npm run tasks -- sync -b` - Create backup only

### Duplicates Management
- `npm run tasks -- dups` - Find and remove duplicates from both sources
- `npm run tasks -- dups -p` - Show duplicates without removing them
- `npm run tasks -- dups -l` - Process local duplicates only
- `npm run tasks -- dups -r` - Process remote duplicates only

### Advanced Commands
- `npm run tasks -- bootstrap` - Bootstrap correlations by matching tasks by content
- `npm run tasks -- clean-dates` - Clean duplicate completion dates

### Development Tools
- `npm test` - Run Jest tests  
- `npm run lint` - Run ESLint on JavaScript files

### Testing
- Tests use a separate Todoist project called "Test" for isolation from production data
- The test environment is configured via `test/util.js` with `TODOIST_PROJECT_NAME: 'Test'`
- Test utilities automatically create/clear the "Test" project to ensure clean test runs

### Test Infrastructure
- **test/util.js**: Core testing utilities with functions for setup, cleanup, and command execution
  - `init()`: Sets up clean test environment (creates test project, clears tasks, initializes local files)
  - `sh()`: Executes CLI commands with test environment variables
  - `normalize()`: Normalizes YAML output by removing location/due fields for comparison
  - `diff()`: Compares local vs remote task outputs
  - `cleanup()`: Cleans up test files and remote project after tests
- **test/test.js**: Example test implementation showing sync functionality
  - Use this as a template for creating new tests
  - Keep tests simple, focused, and easy to read
  - Provide just enough output to verify functionality (single ✅ success message per test)
  - Follow the pattern: setup → action → verify → cleanup
- **Test file isolation**: Tests use `test/temp/` directory for local task files (`.tasks`, `.tasks.completed`)
  - This prevents interference with production `~/.tasks` files
  - Test environment automatically redirects `TODO_DIR` to `test/temp/`

## Architecture

### Core Components

- **tasks.js**: Main CLI interface with subcommands for listing, creating, syncing, and duplicates management
- **lib.js**: Core functionality for reading/writing todos, Todoist API integration, and sync logic

### Sync Architecture

The sync engine uses direct Todoist IDs for correlation:
- **Todoist IDs**: Tasks correlated using actual Todoist task IDs (e.g., `(12345678)`)
- **Local Correlation Markers**: Tasks marked with `(todoistId)` for tracking
- **Conflict Resolution**: Local changes always win over remote changes

### Priority Mapping

Local priorities (0-4) map to Todoist priorities:
- Priority 0 → Todoist Priority 4 (highest/red) + due date "today" or prior
- Priority 1 → Todoist Priority 4 (highest/red) without due date or future due date
- Priority 2 → Todoist Priority 3 (orange)
- Priority 3 → Todoist Priority 2 (blue)
- Priority 4 → Todoist Priority 1 (lowest/no flag)

### Todo File Format

The `~/.tasks` file uses structured sections with optional Todoist ID markers:
```
Priority 0
-------------------------------------------------------------------------------
urgent task content (12345678)
another urgent task

Priority 1
-------------------------------------------------------------------------------
high priority task (87654321)
```

## Key Implementation Details

- Uses ES modules with `.js` imports in JavaScript files
- Configuration via environment variables (TODOIST_API_TOKEN, TODOIST_PROJECT_NAME)
- Completed tasks filtered to last 30 days only
- Direct Todoist ID correlation for task tracking
- Dry-run sync preview mode showing what changes would be made

## Code Organization

- **Function Order**: Organize functions top-down with main/entry functions at the top, followed by helper functions in order of their call hierarchy
- **Avoid Bottom-Up Organization**: Do not place main functions at the bottom of files

## Claude Code Configuration

ALWAYS use `.claude/settings.json` for project settings (not settings.local.json or settings.yaml).
This is the official project settings file according to Claude Code documentation.