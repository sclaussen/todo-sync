# Test Directory Guide

This directory contains the test infrastructure for the task synchronization CLI.

## Test Environment

Tests use isolated environments to prevent interference with production data:
- **Local test files**: `test/.tasks/` directory (not `~/.tasks/`)
- **Remote test project**: Todoist project named "Test" (not "Sync")
- **Environment variables**: Automatically set during test execution

## Core Test Utilities (`test/util.js`)

### Setup Functions
- `init()`: Creates clean test environment (test project, clears tasks, initializes local files)
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

## Test Environment Variables

When tests run, these variables are automatically set:
- `TODO_DIR`: Points to `test/.tasks/` 
- `TODOIST_PROJECT_NAME`: Set to "Test"
- `TODOIST_API_TOKEN`: Uses production token for test project

## File Isolation

Test files are completely isolated from production:
- Production: `~/.tasks/current.tasks`, `~/.tasks/completed`
- Test: `test/.tasks/current.tasks`, `test/.tasks/completed`

This ensures tests never interfere with real task data.