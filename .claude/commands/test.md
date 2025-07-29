# Run Tests

Execute the test suite for the sync project using the qa subagent.

Use the Task tool with the qa subagent to run the complete test suite. The qa agent will:
- Execute `npm run test` to run all tests
- Analyze test results and provide clear feedback
- Identify any failing tests and suggest fixes
- Ensure test environment is properly configured

The tests include:
- Unit tests for sync functionality
- Integration tests for local/remote operations
- Priority mapping tests
- Complete/remove operation tests

The tests use the test environment with a separate "Test" Todoist project to avoid affecting production data.