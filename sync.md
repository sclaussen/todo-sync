# Synchronization Test Scenarios and Algorithm

## Sync Algorithm

### Core Principles
1. Use transactions.yaml to determine operations since last sync
2. Local changes win by default in conflicts
3. User prompted for significant conflicts (with local as default)
4. Completed/deleted states are final

### Sync Process Steps
1. Read last sync timestamp from transactions.yaml
2. Identify all local operations since last sync
3. Fetch current remote state
4. Compare states and categorize changes:
   - Local-only changes
   - Remote-only changes
   - Conflicting changes (both sides modified)
5. Resolve conflicts using rules below
6. Apply changes in order: deletes → updates → creates
7. Log sync operation to transactions.yaml

### Conflict Resolution Rules
| Local Change | Remote Change | Resolution | User Prompt |
|--------------|---------------|------------|-------------|
| Update name | Update name | Local wins | Yes (Y/n) |
| Update priority | Update priority | Local wins | Yes (Y/n) |
| Update name | Update priority | Merge both | No |
| Update priority | Update name | Merge both | No |
| Any update | Complete | Complete with local updates | No |
| Any update | Delete | Delete wins | No |
| Complete | Any update | Complete with remote updates | No |
| Delete | Any update | Delete wins | No |
| Complete | Complete | Stay completed | No |
| Delete | Delete | Stay deleted | No |

## Minimum Test Set (43 tests)

### Category 1: Simple Operations (10 tests)

#### Simple sync operations (parameterized with -l/-r option)
- [ ] Test 1: Create task → sync → verify created on other side
- [ ] Test 2: Update name → sync → verify updated on other side
- [ ] Test 3: Update priority → sync → verify priority updated on other side
- [ ] Test 4: Complete task → sync → verify completed on other side
- [ ] Test 5: Remove task → sync → verify deleted on other side

Note: Run tests 1-5 twice:
- First with option='-l' (local changes synced to remote)
- Then with option='-r' (remote changes synced to local)

### Category 2: Compound Operations (22 tests - 11 patterns × 2 options)

#### Local compound operations
- [ ] Test 11: Create local → update name → sync (LOW PRIORITY - covered by Test 14)
  - Expected: Remote has task with updated name
- [ ] Test 12: Create local → update priority → sync (LOW PRIORITY - covered by Test 14)
  - Expected: Remote has task with updated priority
- [ ] Test 13: Create local → complete → sync (LOW PRIORITY - similar to Test 4)
  - Expected: Remote has completed task
- [ ] Test 14: Create local → update name → update priority → sync
  - Expected: Remote has task with final name and priority (handles multiple updates of both types)
- [ ] Test 15: Create local → update name → update priority → complete → sync
  - Expected: Remote has completed task with final name and priority
- [ ] Test 16: Create local → update name → update priority → remove → sync
  - Expected: No sync needed (task never existed remotely)
- [ ] Test 17: Existing synced task → update name → sync (LOW PRIORITY - covered by Test 19)
  - Expected: Remote task has updated name
- [ ] Test 18: Existing synced task → update priority → sync (LOW PRIORITY - covered by Test 19)
  - Expected: Remote task has updated priority
- [ ] Test 19: Existing synced task → update priority → update name → sync
  - Expected: Remote task has final name and priority
- [ ] Test 20: Existing synced task → update name → update priority → complete → sync
  - Expected: Remote task completed with final name and priority
- [ ] Test 21: Existing synced task → update priority → update name → remove → sync
  - Expected: Remote task deleted

#### Compound operations (parameterized with -l/-r option)
Note: Tests 11-21 run with option='-l' (local operations)
      Tests 22-32 are the same tests run with option='-r' (remote operations)

### Category 3: Conflict Scenarios (6 tests)

#### Property conflicts (parameterized sync tests)
- [ ] Test 33: Rename conflict → sync
  - Run 1 (context.local=rename, context.remote=rename): Local "A→B" + Remote "A→C" → "B" wins, user prompted
  - Run 2 (context.local=rename, context.remote=priority): Local rename + Remote priority → Both applied
- [ ] Test 34: Priority conflict → sync
  - Run 1 (context.local=priority, context.remote=priority): Local 1→2 + Remote 1→3 → 2 wins, user prompted
  - Run 2 (context.local=priority, context.remote=rename): Local priority + Remote rename → Both applied

Note: Tests 33-34 run with context parameters for same-property conflicts
      Tests 35-36 are the same tests run with context parameters for different-property merges

#### Update vs state change conflicts (parameterized sync tests)
- [ ] Test 35: Update + Complete conflict → sync
  - Run 1 (context.local=rename, context.remote=complete): Completed with local name
  - Run 2 (context.local=complete, context.remote=rename): Completed with remote name
- [ ] Test 36: Update + Delete conflict → sync
  - Run 1 (context.local=rename, context.remote=delete): Task deleted
  - Run 2 (context.local=delete, context.remote=rename): Task deleted

Note: Tests 35-36 each run twice with swapped context parameters to test both directions

#### Complex conflicts (parameterized sync tests)
- [ ] Test 37: Multiple updates + Rename conflict → sync
  - Run 1 (context.local=both, context.remote=rename): Local (rename + priority) + Remote rename → Local name + local priority, user prompted
  - Run 2 (context.local=rename, context.remote=both): Local rename + Remote (rename + priority) → Local name + remote priority, user prompted
- [ ] Test 38: Multiple updates + Complete conflict → sync
  - Run 1 (context.local=both, context.remote=complete): Local (rename + complete) + Remote rename → Completed with local name
  - Run 2 (context.local=rename, context.remote=both): Local rename + Remote (rename + complete) → Completed with local name

Note: Tests 37-38 each run twice with swapped context parameters to test both directions

### Category 4: Edge Cases (5 tests)

- [ ] Test 39: Duplicate content (same task created both sides) → sync
  - Expected: Single task with correlation ID
- [ ] Test 40: Corrupted correlation ID → sync
  - Expected: Treated as new task
- [ ] Test 41: Task with subtasks → sync
  - Expected: Parent and subtasks synced correctly
- [ ] Test 42: Priority 0 special handling → sync
  - Expected: Remote has priority 4 + due date today
- [ ] Test 43: Orphaned subtask → sync
  - Expected: Converted to regular task

## Test Implementation Pattern

```javascript
// Create initial synced state with tasks at different priorities
async function syncedState() {
    // Create 5 tasks locally with different priorities
    sh(`node tasks.js create -l -P0 p0`);
    sh(`node tasks.js create -l -P1 p1`);
    sh(`node tasks.js create -l -P2 p2`);
    sh(`node tasks.js create -l -P3 p3`);
    sh(`node tasks.js create -l -P4 p4`);
    
    // Sync to establish initial state on both sides
    sh(`node tasks.js sync`);
    
    // Verify sync was successful
    const localTasks = sh(`node tasks.js list -l -y`);
    const remoteTasks = sh(`node tasks.js list -r -y`);
    const localTasksNormalized = normalize(localTasks);
    const remoteTasksNormalized = normalize(remoteTasks);
    const differences = diff(localTasksNormalized, remoteTasksNormalized);
    if (differences) {
        fail('Initial sync failed: ' + differences.message);
        throw new Error();
    }
}

// Parameterized test for simple operations (tests 1-5)
async function simpleSync(operation, option = '-l') {
    const side = option === '-l' ? 'local' : 'remote';
    const otherSide = option === '-l' ? 'remote' : 'local';
    const otherOption = option === '-l' ? '-r' : '-l';
    
    enter(`${operation} ${side}`);
    await init();
    await syncedState(); // Start with synced state
    
    // Setup: Create initial state on one side
    sh(`node tasks.js create ${option} task`);
    
    // Action: Perform operation
    switch(operation) {
        case 'create':
            // Already created above
            break;
        case 'update-name':
            sh(`node tasks.js update ${option} "task" "new name"`);
            break;
        case 'update-priority':
            sh(`node tasks.js update ${option} -P2 "task"`);
            break;
        case 'complete':
            sh(`node tasks.js complete ${option} task`);
            break;
        case 'remove':
            sh(`node tasks.js remove ${option} task`);
            break;
    }
    
    // Sync
    sh(`node tasks.js sync`);
    
    // Verify: Check state propagated to other side
    // Implementation specific to each operation...
    
    success(`${operation} ${side}`);
}

// Compound operation tests (tests 11-22)
async function compoundSync(testNum, option = '-l') {
    const side = option === '-l' ? 'local' : 'remote';
    
    enter(`Test ${testNum} ${side}`);
    await init();
    await syncedState(); // Start with synced state
    
    // Test-specific implementation...
    
    success(`Test ${testNum} ${side}`);
}

// Conflict scenario tests (tests 23-34)
async function conflictSync(testNum) {
    enter(`Test ${testNum}`);
    await init();
    await syncedState(); // Start with synced state
    
    // Test-specific conflict setup...
    
    success(`Test ${testNum}`);
}

// Usage:
// Tests 1-5 with local changes: simpleSync('create', '-l'), etc.
// Tests 6-10 with remote changes: simpleSync('create', '-r'), etc.
// Tests 11-22: compoundSync(11, '-l'), compoundSync(17, '-r'), etc.
// Tests 23-34: conflictSync(23), etc.
```

## Transaction Log Usage

The sync algorithm uses transactions.yaml to determine what changed:

1. Find last sync entry timestamp
2. Collect all operations after that timestamp
3. Group operations by task (using name matching)
4. For each task, determine net change:
   - Created then deleted = no sync needed
   - Created then modified = sync as create with modifications
   - Modified multiple times = use final state
   - Completed/deleted = terminal state

Example analysis:
```yaml
entries:
  - type: sync
    timestamp: 2025-07-28T10:00:00Z
  - type: create
    timestamp: 2025-07-28T10:01:00Z
    name: "Task A"
  - type: update-name
    timestamp: 2025-07-28T10:02:00Z
    name: "Task A"
    new-name: "Task A Updated"
```
Result: Sync "Task A Updated" as new task to remote

## Priority Mapping

| Local Priority | Remote Priority | Remote Due Date |
|----------------|-----------------|-----------------|
| 0 | 4 (red) | Today |
| 1 | 4 (red) | None |
| 2 | 3 (orange) | None |
| 3 | 2 (blue) | None |
| 4 | 1 (none) | None |

## Conflict Prompt Format

When user confirmation needed:
```
Conflict detected for task "Task Name":
  Local:  [current local state]
  Remote: [current remote state]
Apply local changes? (Y/n):
```

## Success Criteria

Each test passes if:
1. Sync completes without errors
2. Final states match expected outcomes
3. Correlation IDs properly maintained
4. Transaction log shows sync entry
5. No data loss or duplication