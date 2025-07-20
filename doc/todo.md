# Todo Sync Debugging Plan

## Problem Statement
When running `npm run start sync`, todos from the Todoist "Sync" project are not being properly written to the ~/.todo file, even though the sync engine reports they were added.

## Root Cause Analysis
1. The sync engine correctly identifies 31 todos from Todoist that need to be added to the local file
2. These todos are added to the in-memory `todoFile` structure
3. However, the `todoParser.write()` method doesn't properly handle todos without line numbers
4. New todos from Todoist don't have `lineNumber` assigned, so they're skipped during writing

## Todo Items

### 1. Fix TodoParser write method to handle new todos without line numbers
- [ ] Modify the write method to assign line numbers to new todos
- [ ] Ensure new todos are properly appended to their respective sections
- [ ] Maintain proper formatting with blank lines between todos

### 2. Add better error handling and validation
- [ ] Add validation to ensure all todos in memory are written to file
- [ ] Add logging to track which todos are being written/skipped
- [ ] Add post-write verification to confirm all todos were saved

### 3. Test the fix
- [ ] Run a sync to verify todos from Todoist are properly added
- [ ] Verify the ~/.todo file format is maintained correctly
- [ ] Check that existing todos aren't duplicated or corrupted

### 4. Consider additional improvements
- [ ] Add a dry-run mode that shows what changes would be made
- [ ] Improve the sync state management to handle edge cases
- [ ] Add better conflict resolution for duplicate content

## Implementation Details

The main issue is in `todoParser.ts` in the `write()` method (lines 76-110). The method needs to:
1. Calculate appropriate line numbers for new todos
2. Expand the lines array if needed to accommodate new todos
3. Properly insert new todos at the end of their respective sections

## Review

### Changes Made

1. **Fixed the TodoParser write method** (src/todoParser.ts:76-156)
   - Rewrote the method to properly handle todos without line numbers
   - Now builds the file from scratch, ensuring all todos are included
   - Maintains proper section formatting with headers and separators
   - Adds all items in each section sequentially

2. **Testing Results**
   - Successfully synced 31 todos from Todoist to the local ~/.todo file
   - All todos were properly placed in their respective priority sections
   - File formatting was preserved correctly
   - No data loss or corruption occurred

### Key Improvements
- The write method now handles both existing todos (with line numbers) and new todos (without line numbers)
- Todos are written sequentially within their sections, making the file more organized
- The method preserves the overall file structure while accommodating new entries

### What Was Causing the Issue
- The original write method only wrote todos that had a `lineNumber` property
- Todos synced from Todoist didn't have line numbers assigned
- These todos were added to the in-memory structure but skipped during file writing
- The fix ensures all todos are written regardless of whether they have line numbers

### Next Steps
The basic sync functionality is now working. Consider implementing:
- Dry-run mode to preview changes before applying them
- Better conflict resolution UI
- Automatic line number assignment for better tracking
- Validation to ensure no todos are lost during sync