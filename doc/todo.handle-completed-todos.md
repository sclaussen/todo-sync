# Todo: Handle Completed Tasks with Annotations

## Analysis

The current todo parser doesn't handle completed tasks with annotation lines. Looking at the user's example:

```
07/06 something else
07/06 blah blah
    This is a comment about the completion
07/06 complete me
    done
07/06 some other task
```

The parser needs to recognize that lines indented with whitespace are annotation/comment lines that belong to the preceding todo item, not separate todo items.

## Todo Items

- [ ] Analyze the current todo parser to understand how it handles completion status
- [ ] Identify what needs to be changed to properly parse completed todos  
- [ ] Create a test case to verify the parsing behavior
- [ ] Implement the fix for parsing completed todos
- [ ] Test the implementation with the provided example

## Current Problem

The `todoParser.ts` currently treats any non-empty line as a potential todo item. It doesn't recognize indented lines as annotations or comments belonging to the previous todo item.

## Solution Plan

1. Modify the parser to detect indented lines (lines starting with whitespace)
2. Associate indented lines with the previous todo item as annotations
3. Update the TodoItem type to include an optional annotations field
4. Test with the provided example

## Implementation Details

The parser needs to:
- Track when a line is indented (starts with whitespace)
- Associate indented lines with the most recent todo item
- Store annotations as part of the TodoItem structure