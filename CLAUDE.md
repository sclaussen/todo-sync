# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a bidirectional todo synchronization tool that syncs between a local `~/.todo` file and Todoist. The application uses TypeScript with ES modules and provides a CLI interface for sync operations.

## Development Commands

- `npm run dev` - Run CLI in development mode using tsx
- `npm run build` - Build TypeScript to dist/
- `npm run start` - Run built CLI from dist/
- `npm test` - Run Jest tests  
- `npm run lint` - Run ESLint on TypeScript files
- `npm run typecheck` - Run TypeScript type checking without emitting files

## Architecture

### Core Components

- **cli.ts**: Main CLI interface using Commander.js with commands for sync, setup, status, and daemon mode
- **syncEngine.ts**: Core synchronization logic handling bidirectional sync between local and Todoist
- **todoParser.ts**: Parses and writes the structured `~/.todo` file format with priority sections
- **todoistClient.ts**: Todoist API client wrapper handling task CRUD operations
- **config.ts**: Configuration management for `~/.todo-sync.json` with defaults and validation
- **types.ts**: TypeScript interfaces and enums, including TodoItem, SyncState, and ConflictResolution

### Sync Architecture

The sync engine maintains state using:
- **Sync IDs**: UUIDs linking local todos to Todoist tasks
- **Checksums**: MD5 hashes for change detection
- **Sync State File**: `~/.todo-sync-state.json` tracking sync metadata
- **Conflict Resolution**: Multiple strategies (interactive, local wins, remote wins, newest wins)

### Priority Mapping

Local priorities (0-4) map to Todoist priorities:
- Priority 0 → Todoist Priority 4 (urgent) + due date "today"
- Priority 1 → Todoist Priority 3
- Priority 2 → Todoist Priority 2  
- Priority 3 → Todoist Priority 1
- Priority 4 → Todoist Priority 1

### Todo File Format

The `~/.todo` file uses structured sections:
```
Priority 0
-------------------------------------------------------------------------------
urgent task content
another urgent task

Priority 1
-------------------------------------------------------------------------------
high priority task
```

## Key Implementation Details

- Uses ES modules with `.js` imports in TypeScript files
- Configuration stored in `~/.todo-sync.json` in user's home directory
- Sync state persisted in `~/.todo-sync-state.json`
- Logs stored in `~/.todo-sync/` directory
- Supports daemon mode with configurable sync intervals
- Backup functionality before sync operations
- Dry-run mode for previewing changes