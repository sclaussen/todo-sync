# lib.js and tasks.js Refactoring Plan

## Overview

This document tracks the comprehensive refactoring of the monolithic `lib.js` (2816 lines) and improvement of `tasks.js` to create a more maintainable, testable, and modular codebase.

## Current State (Progress So Far)

### ✅ Completed Tasks
1. **Phase 1: Move TodoistAPI class from lib.js to src/api/todoist.js** - ✅ COMPLETED
   - Created `/src/api/todoist.js` with TodoistAPI class
   - Updated lib.js to import from new module
   - Verified functionality with `node tasks.js list -l --yaml`

2. **Phase 1: Create sync engine in src/sync/engine.js** - ✅ COMPLETED (PARTIAL)
   - Created `/src/sync/engine.js` with basic structure
   - Implemented `executeSync()` and `displaySyncResults()` functions
   - Added placeholders for `executeLocalChanges()`, `executeRemoteChanges()`, `categorizeChanges()`
   - Updated lib.js imports to reference new sync engine

### 🔄 In Progress / Pending Tasks

#### Phase 1: Core Infrastructure (Priority: High)
- [ ] **Create duplicate detection in src/operations/duplicates.js**
- [ ] **Create backup system in src/operations/backup.js**

#### Phase 2: Business Logic Migration (Priority: High)  
- [ ] **Enhance data layer - move remaining CRUD operations from lib.js**
- [ ] **Create operation services for complex multi-step operations**
- [ ] **Update lib.js to become a compatibility facade**

#### Phase 3: Command Interface Improvements (Priority: Medium)
- [ ] **Refactor tasks.js - reduce repetition with command factory pattern**
- [ ] **Update imports across all commands to use new modules**

#### Phase 4: Testing & Cleanup (Priority: Medium)
- [ ] **Add comprehensive tests for new modules** 
- [ ] **Remove lib.js facade once all dependencies updated**
- [ ] **Documentation and final cleanup**

## Architecture & Module Structure

### Existing Project Structure
The project already has good modular structure:
```
src/
├── commands/     - Individual command implementations
├── data/         - Data layer (local.js, todoist.js, index.js)
├── display/      - Output formatting (console.js, yaml.js)
├── config/       - Configuration and utilities
├── models/       - Data models (Task.js)
└── utils/        - Utilities (correlationId.js)
```

### New Modules Created/Planned
```
src/
├── api/          - API clients
│   └── todoist.js - ✅ TodoistAPI class and default instance
├── sync/         - Sync engine
│   └── engine.js  - ✅ Core sync orchestration (PARTIAL)
├── operations/   - Business operations
│   ├── duplicates.js - 🔄 Duplicate detection and removal
│   └── backup.js     - 🔄 Backup creation and management
└── services/     - High-level service orchestration
    └── taskOperations.js - 🔄 Multi-step task operations
```

### Key Functions in lib.js (2816 lines total)

#### ✅ Extracted Functions
- `TodoistAPI` class → `src/api/todoist.js`
- `executeSync()` → `src/sync/engine.js`
- `displaySyncResults()` → `src/sync/engine.js`

#### 🔄 Functions Still To Extract

**Sync Engine Functions (Priority: High)**
- `categorizeChanges()` (line 2371) - Core sync logic that categorizes changes
- `executeLocalChanges()` (line 961) - Executes changes to local files  
- `executeRemoteChanges()` (line 1056) - Executes changes to remote Todoist

**Duplicate Operations (Priority: High)**
- `findDuplicates()` (line 133)
- `findLocalDuplicates()` (line 421)
- `findRemoteDuplicates()` (line 501) 
- `removeDuplicates()` (line 664)
- `displayDuplicates()` (line 625)

**Backup Operations (Priority: High)**
- `createBackup()` (line 1723)
- `backupLocalFiles()` (line 1752)
- `backupRemoteData()` (line 1809)

**CRUD Operations (Priority: High)**
- `createLocalTask()` (line 1925)
- `createRemoteTaskByContent()` (line 2021)
- `updateLocalTask()` (line 2041)
- `updateRemoteTaskByName()` (line 2135)
- `completeLocalTask()` (line 2215)
- `completeRemoteTaskByName()` (line 2282)
- `cancelLocalTask()` (line 2327)
- `cancelRemoteTask()` (line 2373)

#### 🔄 16 Exported Functions (Public API - Must Maintain Backward Compatibility)
- `getTasks()`
- `findDuplicates()`
- `displayDuplicates()`
- `removeDuplicates()`
- `executeSync()`
- `createBackup()`
- `createLocalTask()`
- `createRemoteTaskByContent()`
- `updateLocalTask()`
- `updateRemoteTaskByName()`
- `completeLocalTask()`
- `completeRemoteTaskByName()`
- `cancelLocalTask()`
- `cancelRemoteTask()`
- `categorizeChanges()`
- `ensureProjectExists()`

## tasks.js Refactoring Plan

### Current Issues
- **Command Definition Repetition**: Each command follows nearly identical patterns
- **Inconsistent Option Patterns**: Similar options (`-l, --local`, `-r, --remote`) defined repeatedly
- **Long Single Function**: 140+ lines with all command definitions inline

### Proposed Improvements
1. **Extract Command Configuration** - Create reusable command config objects
2. **Create Command Registration Helper** - Reduce repetitive command setup
3. **Extract Common Options** - Define reusable option sets
4. **Simplify Main Function** - Use configuration-driven approach

## Implementation Strategy

### Migration Approach
- **Backward Compatibility**: lib.js becomes facade during transition
- **Gradual Migration**: Move functions in logical groups
- **Interface Stability**: Maintain existing exported function signatures
- **Progressive Enhancement**: Improve each module as it's created

### Testing Strategy
- Test each extracted module individually
- Maintain integration tests for full CLI functionality
- Use existing test infrastructure in `test/test.js`

## Files Modified So Far

### ✅ Files Created
- `/src/api/todoist.js` - TodoistAPI class and utilities
- `/src/sync/engine.js` - Sync orchestration (partial implementation)

### ✅ Files Modified  
- `lib.js` - Updated imports to use new modules, removed TodoistAPI class definition

### 🔄 Files To Create
- `/src/operations/duplicates.js`
- `/src/operations/backup.js`
- `/src/services/taskOperations.js`

### 🔄 Files To Modify
- `lib.js` - Continue extracting functions, eventually become facade
- `tasks.js` - Implement command factory pattern
- All command files in `src/commands/` - Update imports as needed

## Key Dependencies & Imports

### Current lib.js imports that new modules will need:
```javascript
import { readFileSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';
import { FILE_PATHS, TODOIST, logTransaction, getCurrentTimestamp } from './src/config/constants.js';
import { extractCorrelationId, stripCorrelationId, addCorrelationId } from './src/utils/correlationId.js';
import { todoistAPI } from './src/api/todoist.js';
```

## Next Steps

1. **Continue with Phase 1**: Extract remaining core functions
   - Complete sync engine implementation (`categorizeChanges`, `executeLocalChanges`, `executeRemoteChanges`)
   - Create duplicate operations module
   - Create backup operations module

2. **Test extracted modules**: Verify each module works in isolation

3. **Update lib.js**: Transform into compatibility facade

4. **Move to Phase 2**: Enhance data layer and create service modules

## Notes

- All functions must maintain exact same signatures for backward compatibility
- Use JSDoc documentation for all exported functions
- Follow existing project patterns and conventions
- Focus on single responsibility principle for each module
- Ensure proper error handling in all new modules

---

**Last Updated**: Current session
**Status**: 2/12 tasks completed, Phase 1 in progress