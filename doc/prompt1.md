# Todo Sync Bidirectional Synchronization Plan

## Overview
Build a synchronization system between ~/.todo file and Todoist that maintains consistency between both systems while handling conflicts intelligently.

## Phase 1: Research & Design
1. **Todoist API Research**
   - Authentication methods (API token)
   - Project management endpoints
   - Task CRUD operations
   - Rate limits and best practices

2. **Data Model Design**
   - Common todo format for internal representation
   - Priority mapping (0→1 with today's date, 1→2, etc.)
   - Unique ID strategy for tracking items across systems
   - Metadata for sync state and conflict detection

## Phase 2: Core Components

### 1. ~/.todo File Parser
- Parse priority sections (Priority 0-4)
- Extract todo items while preserving formatting
- Handle other sections (ignore as specified)
- Support for updating file while maintaining structure

### 2. Todoist API Client
- Authentication handling
- Project selection/creation
- Task CRUD operations
- Error handling and retry logic

### 3. Synchronization Engine
- **Sync Strategy**: Last-write-wins with conflict detection
- **Change Detection**: Track modifications using checksums/timestamps
- **Bidirectional Flow**:
  - Read both sources
  - Detect changes since last sync
  - Merge changes with conflict resolution
  - Write updates to both systems
  
### 4. Conflict Resolution
- Detect when same item modified in both places
- Options: Interactive prompt, prefer local, prefer remote, merge
- Log conflicts for user review

## Phase 3: Configuration & Usage

### Configuration File (~/.todo-sync.json)
- Todoist API token
- Target project name/ID
- Sync preferences (conflict resolution, ignored sections)
- Last sync timestamp

### CLI Interface
- `todo-sync` - Run synchronization
- `todo-sync --setup` - Initial configuration
- `todo-sync --dry-run` - Preview changes
- `todo-sync --daemon` - Run as background service

## Phase 4: Additional Features
- Logging system for sync history
- Backup before sync operations
- Scheduled automatic sync (cron/systemd)
- Sync statistics and reporting

## Technical Stack Recommendation
- **Language**: Python (good file I/O, excellent Todoist SDK)
- **Libraries**: 
  - `todoist-python` for API access
  - `click` for CLI
  - `apscheduler` for scheduling
  
## Success Criteria
- Reliable bidirectional sync without data loss
- Clear handling of edge cases and conflicts
- Minimal user intervention required
- Preserves formatting of ~/.todo file