import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import yaml from 'js-yaml';

const TODO_LOG_FILE = join(homedir(), '.todo.yaml');

// Load the entire transactional log
export function loadTodoLog() {
    if (!existsSync(TODO_LOG_FILE)) {
        return [];
    }

    try {
        const content = readFileSync(TODO_LOG_FILE, 'utf8');
        const data = yaml.load(content) || {};

        // Ensure we return an array even if the YAML contains a single object
        const entries = data.entries || [];
        return Array.isArray(entries) ? entries : [ entries ];
    } catch (error) {
        console.warn(`⚠️  Could not load todo log: ${error.message}`);
        return [];
    }
}

// Append a new entry to the transactional log
export function appendToTodoLog(entry) {
    const entries = loadTodoLog();

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
        writeFileSync(TODO_LOG_FILE, content, 'utf8');
    } catch (error) {
        throw new Error(`Failed to write todo log: ${error.message}`);
    }
}

// Get the most recent sync operation entry
export function getLastSyncOperation() {
    const entries = loadTodoLog();

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
    const entries = loadTodoLog();
    const lastSyncIndex = entries.findLastIndex(e => e.type === 'sync-operation');

    if (lastSyncIndex === -1) {
        // No sync has been performed, return all entries
        return entries;
    }

    return entries.slice(lastSyncIndex + 1);
}

// Get the last change time for a specific task content
export function getLastLocalChangeTime(itemContent) {
    const entries = loadTodoLog();

    // Find the most recent change for this item (excluding sync operations)
    const itemChanges = entries.filter(entry =>
        entry.content &&
        entry.content.toLowerCase().trim() === itemContent.toLowerCase().trim() &&
        entry.type !== 'sync-operation' &&
        entry.source === 'todo.el'
    );

    if (itemChanges.length === 0) {
        return null;
    }

    // Sort by timestamp and get the most recent
    itemChanges.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return new Date(itemChanges[0].timestamp);
}

// Get correlations from the last sync operation
export function getCurrentCorrelations() {
    const lastSync = getLastSyncOperation();
    return lastSync?.correlations_snapshot || {};
}

// Generate correlation ID (8-character hash)
export function generateCorrelationId(content) {
    const fullUuid = uuidv4();
    const hash = createHash('md5').update(content + fullUuid).digest('hex');
    return hash.substring(0, 8);
}

// Calculate checksum for content
export function calculateChecksum(content) {
    return createHash('md5').update(content.trim().toLowerCase()).digest('hex').substring(0, 12);
}

// Find correlation by Todoist ID
export function findCorrelationByTodoistId(todoistId) {
    const correlations = getCurrentCorrelations();

    for (const [ corrId, corr ] of Object.entries(correlations)) {
        if (corr.todoistId === todoistId) {
            return { corrId, correlation: corr };
        }
    }

    return null;
}

// Find correlation by content similarity
export function findCorrelationByContent(content, threshold = 0.8) {
    const correlations = getCurrentCorrelations();
    const normalizedContent = content.trim().toLowerCase();

    for (const [ corrId, corr ] of Object.entries(correlations)) {
        // Skip correlations with missing content
        if (!corr.localContent || !corr.todoistContent) {
            continue;
        }

        const localSimilarity = calculateSimilarity(normalizedContent, corr.localContent.toLowerCase());
        const todoistSimilarity = calculateSimilarity(normalizedContent, corr.todoistContent.toLowerCase());

        if (localSimilarity >= threshold || todoistSimilarity >= threshold) {
            return { corrId, correlation: corr, similarity: Math.max(localSimilarity, todoistSimilarity) };
        }
    }

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
    const cleanLocalContent = stripCorrelationId(localTask.content);
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
    const match = taskContent.match(/# \[([a-f0-9]{8})\]/);
    return match ? match[1] : null;
}

export function stripCorrelationId(taskContent) {
    return taskContent.replace(/\s*# \[[a-f0-9]{8}\]/, '').trim();
}

export function addCorrelationId(taskContent, correlationId) {
    const cleanContent = stripCorrelationId(taskContent);
    return `${cleanContent} # [${correlationId}]`;
}

// Record a conflict resolution in the log
export function logConflictResolution(content, localPriority, todoistPriority, resolution) {
    appendToTodoLog({
        type: 'conflict-resolution',
        content: stripCorrelationId(content),
        local_priority: localPriority,
        todoist_priority: todoistPriority,
        resolution: resolution.winner,
        reason: resolution.reason,
        resolved_priority: resolution.winner === 'local' ? localPriority : todoistPriority
    });
}

// Record a sync operation with correlations snapshot
export function logSyncOperation(correlations, statistics = {}) {
    appendToTodoLog({
        type: 'sync-operation',
        operation: 'full-sync',
        correlations_snapshot: correlations,
        statistics: {
            timestamp: new Date().toISOString(),
            ...statistics
        }
    });
}
