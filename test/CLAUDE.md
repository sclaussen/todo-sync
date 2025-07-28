# Test Directory Guide

This directory contains the test infrastructure for the task synchronization CLI.

## Test Environment

Tests use isolated environments to prevent interference with production data:
- **Local test files**: `test/.tasks/` directory (not `~/.tasks/`)
- **Remote test project**: Todoist project named "Test" (not "Sync")
- **Environment variables**: Automatically set during test execution

### Environment Variables
- `TODO_DIR`: Points to `test/.tasks` directory instead of your home directory
- `TODOIST_PROJECT_NAME`: Uses "Test" project instead of "Sync"
- `TODOIST_API_TOKEN`: Uses your existing token if available for remote tests

## Core Test Utilities (`test/util.js`)

### Setup Functions
- `init()`: Creates clean test environment (test project, clears tasks, initializes local files)
  - Resets `current.tasks` with empty priority sections
  - Initializes `completed.yaml` with `completed: []`
  - Initializes `transactions.yaml` with proper YAML structure and empty entries
- `cleanup()`: Removes test files and clears remote test project

### Execution Functions  
- `sh(command)`: Executes CLI commands with test environment variables
- `diff()`: Compares local vs remote task outputs for verification

### Data Functions
- `normalize(yamlOutput)`: Removes location/due fields for clean comparisons

## Test Structure

### Example Test Pattern (`test/test.js`)
```javascript
import { init, sh, cleanup, diff } from './util.js';

describe('Feature Tests', () => {
  beforeEach(async () => await init());
  afterEach(async () => await cleanup());
  
  it('should test specific functionality', async () => {
    // Test implementation
    console.log('✅ Test passed');
  });
});
```

### Writing New Tests
1. Use `test/test.js` as a template
2. Keep tests simple and focused on single functionality
3. Use descriptive test names
4. Provide single ✅ success message per test
5. Always use `beforeEach(init)` and `afterEach(cleanup)`

## Running Tests

```bash
# Run the main test file
node test/test.js

# Run tests with custom environment
TODO_DIR=/tmp/test node test/test.js
```

## Test Coverage Areas

### Core Functionality
- List local tasks
- List completed tasks  
- Create local tasks with different priorities
- YAML output format
- Task completion and removal

### Sync Operations (requires API token)
- Sync preview mode
- Find and remove duplicates
- Remote Todoist operations

### Edge Cases
- Invalid priority handling
- Empty task content handling
- Error conditions

## Important Notes

- Tests that require Todoist API access will be skipped if no `TODOIST_API_TOKEN` is configured
- Remote tests use the "Test" project on Todoist - this project is created automatically if needed
- Tests are designed to be safe and won't interfere with your actual todo files
- Each test run starts with a completely clean environment


## File Isolation

Test files are completely isolated from production:
- Production: `~/.tasks/current.tasks`, `~/.tasks/completed.yaml`, `~/.tasks/transactions.yaml`
- Test: `test/.tasks/current.tasks`, `test/.tasks/completed.yaml`, `test/.tasks/transactions.yaml`

### Test File Initialization
Each test run starts with clean, properly structured files:
- `current.tasks`: Empty priority sections (0-4)
- `completed.yaml`: `completed: []` (empty array)
- `transactions.yaml`: Empty entries with proper YAML header comment

This ensures tests never interfere with real task data and start from a predictable state.