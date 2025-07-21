# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a bidirectional todo synchronization tool that syncs between a local `~/.todo` file and Todoist. The application uses JavaScript with ES modules and provides a CLI interface for todo management and sync operations.

## Development Commands

- `npm run tasks` - Run CLI for todo operations
- `npm run tasks -- -s` - Show sync preview (dry-run)
- `npm run tasks -- -R` - Remove duplicates
- `npm run tasks -- -l` - Show local todos only
- `npm run tasks -- -r` - Show remote todos only
- `npm test` - Run Jest tests  
- `npm run lint` - Run ESLint on JavaScript files

## Architecture

### Core Components

- **tasks.js**: Main CLI interface with commands for listing, duplicates, and sync preview operations
- **lib.js**: Core functionality for reading/writing todos and Todoist API integration  
- **syncState.js**: Sync state management and correlation tracking with YAML persistence

### Sync Architecture

The sync engine maintains state using:
- **Correlation IDs**: 8-character hashes linking local todos to Todoist tasks (e.g., `d4e5f6g7`)
- **Sync IDs**: Full UUIDs for robust programmatic correlation
- **Checksums**: MD5 hashes for change detection  
- **Sync State File**: `~/.todo-sync-state.yaml` tracking sync metadata
- **Local Correlation Markers**: Tasks marked with `# [corrId]` for tracking
- **Conflict Resolution**: Multiple strategies (interactive, local wins, remote wins, newest wins)

### Priority Mapping

Local priorities (0-4) map to Todoist priorities:
- Priority 0 → Todoist Priority 4 (highest/red) + due date "today" or prior
- Priority 1 → Todoist Priority 4 (highest/red) without due date or future due date
- Priority 2 → Todoist Priority 3 (orange)
- Priority 3 → Todoist Priority 2 (blue)
- Priority 4 → Todoist Priority 1 (lowest/no flag)

### Todo File Format

The `~/.todo` file uses structured sections with optional correlation markers:
```
Priority 0
-------------------------------------------------------------------------------
urgent task content # [d4e5f6g7]
another urgent task

Priority 1
-------------------------------------------------------------------------------
high priority task # [a1b2c3d4]
```

## Key Implementation Details

- Uses ES modules with `.js` imports in JavaScript files
- Configuration via environment variables (TODOIST_API_TOKEN, TODOIST_PROJECT_NAME)
- Sync state persisted in `~/.todo-sync-state.yaml`
- Completed tasks filtered to last 30 days only
- Correlation tracking for rename detection
- Content similarity detection (80% threshold) for potential renames
- Dry-run sync preview mode showing what changes would be made

## Code Organization

- **Function Order**: Organize functions top-down with main/entry functions at the top, followed by helper functions in order of their call hierarchy
- **Avoid Bottom-Up Organization**: Do not place main functions at the bottom of files

## Claude Code Configuration

ALWAYS use `.claude/settings.json` for project settings (not settings.local.json or settings.yaml).
This is the official project settings file according to Claude Code documentation.