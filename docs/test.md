# Comprehensive Test Plan for Todo Sync System

## Overview

This document outlines a comprehensive test suite for the bidirectional todo synchronization system. The test suite covers all possible sync scenarios, from basic operations to complex conflict resolution, ensuring robust functionality across all use cases.

## Test Categories

### **Basic Sync Tests (Already Implemented)**
1. **syncUp** - Create tasks locally, sync to remote
2. **syncDown** - Create tasks remotely, sync to local

### **Single-Field Change Tests**
3. **localPriorityChange** - Task synced, change priority locally, sync (local wins)
4. **remotePriorityChange** - Task synced, change priority remotely, sync (local wins)
5. **localTextChange** - Task synced, change text locally, sync (local wins)  
6. **remoteTextChange** - Task synced, change text remotely, sync (local wins)

### **State Transition Tests**
7. **localComplete** - Task synced, complete locally, sync
8. **remoteComplete** - Task synced, complete remotely, sync
9. **localRemove** - Task synced, remove locally, sync
10. **remoteRemove** - Task synced, remove remotely, sync

### **Conflict Tests (Both Change Same Task)**
11. **conflictPriority** - Task synced, both change priority, sync (local wins)
12. **conflictText** - Task synced, both change text, sync (local wins)
13. **conflictBothFields** - Task synced, both change text AND priority, sync (local wins)
14. **conflictLocalCompleteRemoteChange** - Local completes, remote changes text/priority
15. **conflictRemoteCompleteLocalChange** - Remote completes, local changes text/priority
16. **conflictLocalRemoveRemoteChange** - Local removes, remote changes text/priority
17. **conflictRemoteRemoveLocalChange** - Remote removes, local changes text/priority

### **Mixed Operation Tests**
18. **multipleLocalChanges** - Multiple tasks with different local changes
19. **multipleRemoteChanges** - Multiple tasks with different remote changes
20. **mixedChanges** - Some local, some remote, some conflict scenarios
21. **priorityLevelMapping** - Test all priority level mappings (0-4)

### **Edge Cases**
22. **duplicateTaskCreation** - Same task created on both sides
23. **emptyTaskSync** - Sync with empty task lists
24. **correlationIdPreservation** - Ensure Todoist IDs are preserved through changes
25. **completedTaskFiltering** - Only last 30 days of completed tasks

## Test Infrastructure Requirements

### **Translog System**

Each test should create and verify entries in `test/temp/.tasks.translog.yaml`:

```yaml
entries:
  - type: create
    timestamp: 2025-07-20T16:16:24-0700
    name: New item
    priority: 1
    source: todo.el
  - type: update
    timestamp: <timestamp>
    name: New item
    new_name: New item 2
    priority: 1
    source: todo.el
  - type: update
    timestamp: <timestamp>
    name: New item
    priority: 1
    new_priority: 2
    source: todo.el
  - type: complete
    timestamp: <timestamp>
    name: New item 2
    priority: 2
    source: todo.el
  - type: remove
    timestamp: <timestamp>
    name: Something
    priority: 1
    source: todo.el
  - type: sync
    timestamp: <timestamp>
  - type: sync_complete
    timestamp: <timestamp>
```

**Entry Types:**
- `create` - New task created
- `update` - Task content or priority changed
- `complete` - Task marked as completed
- `remove` - Task deleted
- `sync` - Sync operation started
- `sync_complete` - Sync operation finished

### **Utility Functions Needed**

Add to `test/util.js`:
- `writeTranslogEntry(entry)` - Add entry to translog
- `readTranslog()` - Read all translog entries
- `getLastSyncComplete()` - Find last sync_complete timestamp
- `createTaskWithId(content, priority, location)` - Create task and return identifier
- `modifyTask(id, changes)` - Modify existing task
- `verifyTranslog(expectedEntries)` - Verify translog contains expected entries

### **Test Pattern Template**

Each test follows this standard pattern:

```javascript
async function testName() {
    await init();
    
    // 1. Setup: Create initial synced state
    sh(`node ${taskscli} create "Test Task" -P 1`, { echo: true, rc: 0 });
    sh(`node ${taskscli} sync`, { echo: true, rc: 0 });
    
    // 2. Action: Make specific changes
    // (local, remote, or both depending on test)
    
    // 3. Sync: Execute synchronization
    sh(`node ${taskscli} sync`, { echo: true, rc: 0 });
    
    // 4. Verify: Check results
    const localTasks = sh(`node ${taskscli} list -l -y`, { echo: true, rc: 0 });
    const remoteTasks = sh(`node ${taskscli} list -r -y`, { echo: true, rc: 0 });
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    
    if (differences) {
        console.error(differences.message);
        throw new Error();
    }
    
    // 5. Verify translog (optional)
    // verifyTranslog(expectedEntries);
    
    console.log('✅ testName passed');
}
```

## Outstanding Questions

### **1. Translog Implementation**
- Should we implement full translog functionality or mock it initially?
- Where exactly should translog files be stored in test environment?

### **2. Test Verification Strategy**
- Task state matching only (current approach)?
- Translog verification only?
- Both task matching AND translog verification?

### **3. Source Field Values**
- What `source` value for CLI-created tasks? (`"tasks-cli"`, `"test"`, `"local"`)
- Different source for remote changes? (`"todoist"`, `"remote"`)

### **4. Conflict Resolution Logging**
- How should conflicts be logged in translog?
- Show both attempted changes or only winning change?
- Special conflict resolution entry type?

### **5. Test Task Naming**
- Use descriptive names like `"Test Task [scenario]"`?
- Simple names like current examples?
- Standardized pattern for easier debugging?

### **6. Multi-Step Sync Scenarios**
- Some tests need multiple sync operations
- How to handle setup → change → sync → verify cycles?

### **7. Priority Level Testing**
- Test each priority level (0-4) individually?
- Test bidirectional priority changes?
- Verify exact Todoist priority mapping?

### **8. Completed Task Handling**
- Set realistic completion dates in tests?
- Test 30-day filtering behavior?
- How to simulate old completed tasks?

## Implementation Notes

### **Conflict Resolution**
- System uses "local always wins" strategy per CLAUDE.md
- All conflict tests should verify local changes are preserved
- Remote changes should be overwritten without errors

### **Test Isolation**
- Each test starts with `await init()` for clean state
- Tests use isolated `test/temp/` directory
- Clean up handled automatically by test infrastructure

### **Task Identification**
- Use task content matching for task identification
- Todoist correlation IDs preserved through changes
- Consider predictable task naming for easier debugging

### **Priority Mapping**
Per CLAUDE.md:
- Priority 0 → Todoist Priority 4 (highest/red) + due date "today" or prior
- Priority 1 → Todoist Priority 4 (highest/red) without due date or future due date
- Priority 2 → Todoist Priority 3 (orange)
- Priority 3 → Todoist Priority 2 (blue)
- Priority 4 → Todoist Priority 1 (lowest/no flag)

## Future Enhancements

- Add performance benchmarking tests
- Test large dataset synchronization
- Add network failure simulation tests
- Test concurrent modification scenarios
- Add data corruption recovery tests