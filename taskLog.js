import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import yaml from 'js-yaml';

const TASK_LOG_FILE = join(homedir(), '.tasks.yaml');

// Load the entire transactional log
export function loadTaskLog() {
    if (!existsSync(TASK_LOG_FILE)) {
        return [];
    }

    try {
        const content = readFileSync(TASK_LOG_FILE, 'utf8');
        const data = yaml.load(content) || {};

        // Ensure we return an array even if the YAML contains a single object
        const entries = data.entries || [];
        return Array.isArray(entries) ? entries : [ entries ];
    } catch (error) {
        console.warn(`⚠️  Could not load task log: ${error.message}`);
        return [];
    }
}

// Append a new entry to the transactional log
export function appendToTaskLog(entry) {
    const entries = loadTaskLog();

    const newEntry = {
        timestamp: new Date().toISOString(),
        source: 'tasks.js',
        ...entry
    };

    entries.push(newEntry);

    try {
        const content = yaml.dump({ entries }, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: false
        });
        writeFileSync(TASK_LOG_FILE, content, 'utf8');
    } catch (error) {
        throw new Error(`Failed to write task log: ${error.message}`);
    }
}

// Get the most recent sync operation entry
export function getLastSyncOperation() {
    const entries = loadTaskLog();

    // Find the last sync-operation entry
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].type === 'sync-operation') {
            return entries[i];
        }
    }

    return null; // No sync has been performed yet
}

// Get all changes since the last sync operation
export function getChangesSinceLastSync() {
    const entries = loadTaskLog();
    const lastSyncIndex = entries.findLastIndex(e => e.type === 'sync-operation');

    if (lastSyncIndex === -1) {
        // No sync has been performed, return all entries
        return entries;
    }

    return entries.slice(lastSyncIndex + 1);
}

// Get the last change time for a specific task content
export function getLastLocalChangeTime(itemContent) {
    const entries = loadTaskLog();

    // Find the most recent change for this item (excluding sync operations)
    const itemChanges = entries.filter(entry =>
        entry.content &&
        entry.content.toLowerCase().trim() === itemContent.toLowerCase().trim() &&
        entry.type !== 'sync-operation' &&
        entry.source === 'task.el'
    );

    if (itemChanges.length === 0) {
        return null;
    }

    // Sort by timestamp and get the most recent
    itemChanges.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return new Date(itemChanges[0].timestamp);
}

// Get correlations from the last sync operation - simplified with direct IDs
export function getCurrentCorrelations() {
    // With direct Todoist IDs, we don't need a complex correlation table
    // Return empty object to maintain compatibility
    return {};
}

// This function is no longer needed - we use Todoist IDs directly

// Find correlation by Todoist ID - simplified to direct lookup
export function findCorrelationByTodoistId(todoistId) {
    // With direct Todoist IDs, we don't need a correlation table
    // This function is kept for compatibility but simplified
    return {
        corrId: todoistId?.toString() || 'unknown',
        correlation: {
            todoistId: todoistId,
            status: 'current'
        }
    };
}

// Find correlation by content similarity - deprecated with direct IDs
export function findCorrelationByContent(content, threshold = 0.8) {
    // With direct Todoist IDs, content similarity matching is not needed
    // Tasks are correlated by their explicit Todoist ID
    console.warn('findCorrelationByContent is deprecated with direct Todoist ID system');
    return null;
}

// Calculate similarity between two strings
function calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));

    const intersection = new Set([ ...words1 ].filter(word => words2.has(word)));
    const union = new Set([ ...words1, ...words2 ]);

    return intersection.size / union.size;
}

// Map Todoist priority to local priority
function mapTodoistPriorityToLocal(todoistPriority) {
    const priorityMap = {
        4: 1, // Todoist Priority 4 (highest) -> Local Priority 1
        3: 2, // Todoist Priority 3 -> Local Priority 2
        2: 3, // Todoist Priority 2 -> Local Priority 3
        1: 4  // Todoist Priority 1 (lowest) -> Local Priority 4
    };

    return priorityMap[todoistPriority] || 4;
}

// Check if Todoist task was modified since last sync
export function checkTodoistTaskModified(todoistTask) {
    const result = findCorrelationByTodoistId(todoistTask.id);
    if (!result) {
        return false; // No correlation means it's new
    }

    const { correlation } = result;

    // Check if priority changed since last sync
    const lastKnownPriority = correlation.todoistPriority;
    const currentPriority = todoistTask.priority;

    return lastKnownPriority !== undefined && lastKnownPriority !== currentPriority;
}

// Resolve conflict using timestamp-based logic
export function resolveConflictByTimestamp(localTask, todoistTask) {
    const cleanLocalContent = localTask.content; // Already clean from parsing
    const localChangeTime = getLastLocalChangeTime(cleanLocalContent);

    // Get last sync time
    const lastSync = getLastSyncOperation();
    const lastSyncTime = lastSync ? new Date(lastSync.timestamp) : new Date(0);

    // Check if local changed since last sync
    const localChangedSinceSync = localChangeTime && localChangeTime > lastSyncTime;

    // Check if Todoist task priority changed since last sync
    const todoistChangedSinceSync = checkTodoistTaskModified(todoistTask);

    // Resolution logic:
    if (localChangedSinceSync && !todoistChangedSinceSync) {
        return { winner: 'local', reason: 'local_more_recent' };
    } else if (!localChangedSinceSync && todoistChangedSinceSync) {
        return { winner: 'todoist', reason: 'todoist_more_recent' };
    } else if (localChangedSinceSync && todoistChangedSinceSync) {
        // Both changed since last sync - prefer local since we have precise timestamps
        return { winner: 'local', reason: 'local_has_precise_timestamp' };
    } else {
        // Neither changed since last sync - shouldn't happen with priority mismatch
        return { winner: 'local', reason: 'fallback_local_wins' };
    }
}

// Utility functions for correlation IDs
export function extractCorrelationId(taskContent) {
    // First try new format (todoistId)
    const newFormatMatch = taskContent.match(/\((\d+)\)/);
    if (newFormatMatch) {
        return newFormatMatch[1];
    }

    // Fall back to old format for migration
    const oldFormatMatch = taskContent.match(/# \[([a-f0-9]{8})\]/);
    if (oldFormatMatch) {
        return oldFormatMatch[1]; // Return the old correlation ID
    }

    return null;
}

export function stripCorrelationId(taskContent) {
    // Remove new format first
    let cleaned = taskContent.replace(/\s*\(\d+\)/, '');
    // Remove old format if it exists
    cleaned = cleaned.replace(/\s*# \[[a-f0-9]{8}\]/, '');
    return cleaned.trim();
}

export function addCorrelationId(taskContent, todoistId) {
    const cleanContent = stripCorrelationId(taskContent);
    return `${cleanContent} (${todoistId})`;
}

// Record a conflict resolution in the log
export function logConflictResolution(content, localPriority, todoistPriority, resolution) {
    appendToTaskLog({
        type: 'conflict-resolution',
        content: content, // Should already be clean
        local_priority: localPriority,
        todoist_priority: todoistPriority,
        resolution: resolution.winner,
        reason: resolution.reason,
        resolved_priority: resolution.winner === 'local' ? localPriority : todoistPriority
    });
}

// Record a sync operation - simplified without correlations snapshot
export function logSyncOperation(operation, target, data = {}, statistics = {}) {
    appendToTaskLog({
        type: 'sync-operation',
        operation: operation || 'sync',
        target: target,
        data: data,
        statistics: {
            timestamp: new Date().toISOString(),
            ...statistics
        }
    });
}
