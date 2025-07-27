# Tests for tasks.js CLI

This directory contains tests for the tasks.js CLI that use a separate test environment to avoid interfering with your actual todo files.

## Test Environment

Tests use environment variables to configure a separate test environment:

- `TODO_DIR`: Points to `test/.tasks` directory instead of your home directory
- `TODOIST_PROJECT_NAME`: Uses "Test" project instead of "Sync"
- `TODOIST_API_TOKEN`: Uses your existing token if available for remote tests

## Test Files

- `.tasks/current.tasks` - Sample current tasks for testing
- `.tasks/completed` - Sample completed tasks for testing
- `.tasks/transactions.yaml` - Task transaction log for testing
- `basic.test.js` - Basic CLI functionality tests
- `advanced.test.js` - Advanced functionality and edge case tests
- `index.js` - Test runner that executes all tests

## Running Tests

```bash
# Run all tests
npm run test:cli

# Run basic tests only
npm run test:cli:basic

# Run advanced tests only
npm run test:cli:advanced

# Run tests with custom environment
TODO_DIR=/tmp/test npm run test:cli
```

## Test Coverage

### Basic Tests
- List local tasks
- List completed tasks  
- Create local tasks
- YAML output format
- Sync preview (if API token available)

### Advanced Tests
- Find duplicates (preview mode)
- Remove duplicates
- Create tasks with different priorities
- Invalid priority handling
- Empty task content handling
- Remote operations (if API token available)

## Notes

- Tests that require Todoist API access will be skipped if no `TODOIST_API_TOKEN` is configured
- Remote tests use the "Test" project on Todoist - make sure this project exists
- Tests are designed to be safe and won't interfere with your actual todo files
- Some tests create temporary tasks that may remain in your Test project