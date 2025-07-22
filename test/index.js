#!/usr/bin/env node

import { runTests } from './basic.test.js';
import { runAdvancedTests } from './advanced.test.js';

/**
 * Main test runner
 */
async function runAllTests() {
    console.log('🚀 Starting tasks.js test suite...\n');
    
    const startTime = Date.now();
    
    try {
        // Run basic tests
        console.log('=' .repeat(60));
        console.log('🔧 BASIC TESTS');
        console.log('=' .repeat(60));
        runTests();
        
        console.log('\n');
        
        // Run advanced tests
        console.log('=' .repeat(60));
        console.log('🚀 ADVANCED TESTS');
        console.log('=' .repeat(60));
        runAdvancedTests();
        
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        
        console.log('\n' + '=' .repeat(60));
        console.log(`🎉 ALL TESTS PASSED! (${duration}s)`);
        console.log('=' .repeat(60));
        
    } catch (error) {
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        
        console.error('\n' + '=' .repeat(60));
        console.error(`💥 TESTS FAILED! (${duration}s)`);
        console.error(`Error: ${error.message}`);
        console.error('=' .repeat(60));
        
        process.exit(1);
    }
}

// Print usage information
function printUsage() {
    console.log(`
Usage: node test/index.js [option]

Options:
  (no args)    Run all tests
  basic        Run basic tests only
  advanced     Run advanced tests only
  help         Show this help message

Environment Variables:
  TODO_DIR               Custom directory for test todo files (default: test/data)
  TODOIST_API_TOKEN      Todoist API token for remote tests (optional)
  TODOIST_PROJECT_NAME   Todoist project name (default: "Test")

Examples:
  node test/index.js                    # Run all tests
  node test/index.js basic              # Run basic tests only
  TODO_DIR=/tmp/test node test/index.js # Use custom test directory
`);
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('help') || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
}

if (args.includes('basic')) {
    console.log('🔧 Running basic tests only...\n');
    runTests();
} else if (args.includes('advanced')) {
    console.log('🚀 Running advanced tests only...\n');
    runAdvancedTests();
} else {
    runAllTests();
}