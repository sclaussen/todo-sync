import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import yaml from 'js-yaml';
import {
    getCurrentCorrelations,
    getLastLocalChangeTime,
    findCorrelationByTodoistId,
    findCorrelationByContent,
    logConflictResolution,
    extractCorrelationId,
    stripCorrelationId,
    addCorrelationId,
    calculateChecksum,
    checkTodoistTaskModified
} from './todoLog.js';

// Legacy support - will be removed after migration
const SYNC_STATE_FILE = join(homedir(), '.todo-sync-state.yaml');
const LOCAL_CHANGES_FILE = join(homedir(), '.todo.yaml');

export function loadSyncState() {
    if (!existsSync(SYNC_STATE_FILE)) {
        return createEmptySyncState();
    }

    try {
        const content = readFileSync(SYNC_STATE_FILE, 'utf8');
        const state = yaml.load(content);

        return migrateSyncState(state);
    } catch (error) {
        console.warn(`⚠️  Could not load sync state: ${error.message}`);
        return createEmptySyncState();
    }
}

export function saveSyncState(state) {
    try {
        state.lastSync = new Date().toISOString();
        const content = yaml.dump(state, {
            indent: 2,
            lineWidth: 120,
            noRefs: true,
            sortKeys: false
        });
        writeFileSync(SYNC_STATE_FILE, content, 'utf8');
    } catch (error) {
        throw new Error(`Failed to save sync state: ${error.message}`);
    }
}

function createEmptySyncState() {
    return {
        version: '1.0.0',
        lastSync: null,
        correlations: {},
        recentCompletions: {
            local: [],
            todoist: []
        },
        statistics: {
            totalSyncs: 0,
            lastSuccessfulSync: null,
            conflictsResolved: 0,
            tasksCreatedLocal: 0,
            tasksCreatedTodoist: 0
        }
    };
}

function migrateSyncState(state) {
    if (!state.version) {
        state.version = '1.0.0';
    }

    if (!state.correlations) {
        state.correlations = {};
    }

    if (!state.recentCompletions) {
        state.recentCompletions = { local: [], todoist: [] };
    }

    if (!state.statistics) {
        state.statistics = {
            totalSyncs: 0,
            lastSuccessfulSync: null,
            conflictsResolved: 0,
            tasksCreatedLocal: 0,
            tasksCreatedTodoist: 0
        };
    }

    return state;
}

export function generateCorrelationId(content) {
    const fullUuid = uuidv4();
    const hash = createHash('md5').update(content + fullUuid).digest('hex');
    return hash.substring(0, 8);
}

// calculateChecksum moved to todoLog.js

export function findCorrelationBySyncId(state, syncId) {
    return Object.values(state.correlations).find(corr => corr.syncId === syncId);
}

// Legacy findCorrelationByTodoistId and findCorrelationByContent moved to todoLog.js

function calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));

    const intersection = new Set([ ...words1 ].filter(word => words2.has(word)));
    const union = new Set([ ...words1, ...words2 ]);

    return intersection.size / union.size;
}

function mapTodoistPriorityToLocal(todoistTask) {
    // Ensure todoistTask.priority is a valid number, default to 1 if not
    const todoistPriority = typeof todoistTask.priority === 'number' ? todoistTask.priority : 1;
    
    // Check if task is Priority 4 and due today or in the past
    if (todoistPriority === 4 && todoistTask.due) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of day for comparison

        // Parse the due date from Todoist format
        let dueDate;
        if (todoistTask.due.date) {
            // Use the date field (YYYY-MM-DD format)
            dueDate = new Date(todoistTask.due.date + 'T00:00:00');
        } else if (todoistTask.due.datetime) {
            // Use datetime field if available
            dueDate = new Date(todoistTask.due.datetime);
        } else if (typeof todoistTask.due === 'string') {
            // Fallback to string parsing
            dueDate = new Date(todoistTask.due);
        } else {
            // Last resort
            dueDate = new Date(todoistTask.due);
        }

        dueDate.setHours(0, 0, 0, 0); // Set to start of day for comparison

        // If due today or in the past, make it Priority 0
        if (dueDate <= today) {
            return 0;
        }
    }

    // Map Todoist priorities to local priorities
    const priorityMap = {
        4: 1, // Todoist Priority 4 (highest) -> Local Priority 1 (unless overdue, then Priority 0 above)
        3: 2, // Todoist Priority 3 -> Local Priority 2
        2: 3, // Todoist Priority 2 -> Local Priority 3
        1: 4  // Todoist Priority 1 (lowest) -> Local Priority 4
    };

    return priorityMap[todoistPriority] || 4;
}

export function loadLocalChanges() {
    if (!existsSync(LOCAL_CHANGES_FILE)) {
        return [];
    }

    try {
        const content = readFileSync(LOCAL_CHANGES_FILE, 'utf8');
        const changes = yaml.load(content) || [];

        // Ensure we return an array even if the YAML contains a single object
        return Array.isArray(changes) ? changes : [ changes ];
    } catch (error) {
        console.warn(`⚠️  Could not load local changes: ${error.message}`);
        return [];
    }
}

// getLastLocalChangeTime, checkTodoistTaskModified, resolveConflictByTimestamp moved to todoLog.js

export function updateCorrelationWithTodoistTask(syncState, corrId, todoistTask) {
    if (!syncState.correlations[corrId]) {
        return;
    }

    // Update the correlation with current Todoist task state
    syncState.correlations[corrId].lastTodoistPriority = todoistTask.priority;
    syncState.correlations[corrId].todoistContent = todoistTask.content;
    syncState.correlations[corrId].lastTodoistSeen = new Date().toISOString();
}

export function cleanupOldCompletions(state) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    state.recentCompletions.local = state.recentCompletions.local.filter(
        task => new Date(task.completedAt) > thirtyDaysAgo
    );

    state.recentCompletions.todoist = state.recentCompletions.todoist.filter(
        task => new Date(task.completedAt) > thirtyDaysAgo
    );
}

// extractCorrelationId, stripCorrelationId, addCorrelationId moved to todoLog.js

export function categorizeChanges(localTasks, todoistTasks, legacySyncState = null, previewMode = false) {
    // Use current correlations from the transactional log
    const correlations = getCurrentCorrelations();
    const changes = {
        local: {
            noneToCurrent: [],
            noneToCompleted: [],
            currentToCompleted: [],
            currentToNone: [],
            completedToCurrent: [],
            renames: []
        },
        todoist: {
            noneToCurrent: [],
            noneToCompleted: [],
            currentToCompleted: [],
            currentToNone: [],
            completedToCurrent: [],
            renames: []
        },
        conflicts: [],
        potentialRenames: []
    };

    const processedCorrelations = new Set();
    const uncorrelatedLocal = [];
    const uncorrelatedTodoist = [];

    for (const localTask of localTasks.current.tasks) {
        const corrId = extractCorrelationId(localTask.content);

        if (corrId && correlations[corrId]) {
            const correlation = correlations[corrId];
            const todoistTask = todoistTasks.current.tasks.find(t => t.id === correlation.todoistId);

            if (todoistTask) {
                const cleanLocalContent = stripCorrelationId(localTask.content);
                const localChecksum = calculateChecksum(cleanLocalContent);
                const todoistChecksum = calculateChecksum(todoistTask.content);

                const localChanged = localChecksum !== correlation.localChecksum;
                const todoistChanged = todoistChecksum !== correlation.todoistChecksum;

                if (localChanged && todoistChanged) {
                    changes.conflicts.push({
                        corrId,
                        localTask: { ...localTask, content: cleanLocalContent },
                        todoistTask,
                        correlation
                    });
                } else if (localChanged) {
                    changes.todoist.renames.push({
                        corrId,
                        oldContent: correlation.localContent,
                        newContent: cleanLocalContent,
                        todoistId: correlation.todoistId
                    });
                } else if (todoistChanged) {
                    changes.local.renames.push({
                        corrId,
                        oldContent: correlation.todoistContent,
                        newContent: todoistTask.content,
                        localTask
                    });
                }

                processedCorrelations.add(corrId);
            } else {
                uncorrelatedLocal.push({ ...localTask, content: stripCorrelationId(localTask.content) });
            }
        } else {
            uncorrelatedLocal.push(localTask);
        }
    }

    for (const todoistTask of todoistTasks.current.tasks) {
        const result = findCorrelationByTodoistId(todoistTask.id);

        if (!result || !processedCorrelations.has(result.corrId)) {
            uncorrelatedTodoist.push(todoistTask);
        }
    }

    // Cross-match uncorrelated tasks to find exact content matches (potential priority changes)
    const localTasksToSync = [];
    const todoistTasksToSync = [];
    const exactMatches = [];

    for (const localTask of uncorrelatedLocal) {
        const cleanLocalContent = stripCorrelationId(localTask.content);

        // Look for exact content match in uncorrelated Todoist tasks
        const exactMatch = uncorrelatedTodoist.find(todoistTask => {
            const cleanTodoistContent = todoistTask.content.trim();
            return cleanLocalContent.toLowerCase().trim() === cleanTodoistContent.toLowerCase().trim();
        });

        if (exactMatch) {
            const localPriority = localTask.priority !== undefined ? localTask.priority : 'unknown';
            const todoistPriority = mapTodoistPriorityToLocal(exactMatch);

            if (localPriority !== todoistPriority) {
                // Priority mismatch - treat as priority change
                exactMatches.push({
                    localTask,
                    todoistTask: exactMatch,
                    type: 'priority_change',
                    localPriority,
                    todoistPriority
                });
            } else {
                // Same content and priority - likely a sync correlation issue, treat as already synced
                exactMatches.push({
                    localTask,
                    todoistTask: exactMatch,
                    type: 'already_synced'
                });
            }
        } else {
            localTasksToSync.push(localTask);
        }
    }

    for (const todoistTask of uncorrelatedTodoist) {
        const cleanTodoistContent = todoistTask.content.trim();

        // Check if this task was already matched
        const alreadyMatched = exactMatches.some(match =>
            match.todoistTask.content.toLowerCase().trim() === cleanTodoistContent.toLowerCase().trim()
        );

        if (!alreadyMatched) {
            todoistTasksToSync.push(todoistTask);
        }
    }

    // Handle exact matches
    for (const match of exactMatches) {
        if (match.type === 'priority_change') {
            // Always favor local priority over remote
            const resolution = { winner: 'local', reason: 'local_always_wins' };

            // Log the conflict resolution decision (only if not in preview mode)
            if (!previewMode) {
                logConflictResolution(
                    match.localTask.content,
                    match.localPriority,
                    match.todoistPriority,
                    resolution
                );
            }

            // Generate correlation ID for this matched pair
            const corrId = generateCorrelationId(stripCorrelationId(match.localTask.content));

            // Local priority always wins - update Todoist
            changes.todoist.renames.push({
                content: stripCorrelationId(match.localTask.content),
                oldPriority: match.todoistPriority,
                newPriority: match.localPriority,
                changeType: 'priority_update',
                reason: resolution.reason,
                todoistId: match.todoistTask.id,
                corrId: corrId,
                metadata: {
                    priority: match.localPriority,
                    source: 'local',
                    isAutomaticResolution: true,
                    resolutionReason: resolution.reason
                }
            });
        }
        // For 'already_synced', we don't add them to changes (no action needed)
    }

    // Process remaining unmatched tasks
    for (const localTask of localTasksToSync) {
        const potentialMatch = findCorrelationByContent(localTask.content, 0.8);

        if (potentialMatch) {
            changes.potentialRenames.push({
                type: 'local_new_similar_to_existing',
                localTask,
                existingCorrelation: potentialMatch.correlation,
                similarity: potentialMatch.similarity
            });
        } else {
            changes.todoist.noneToCurrent.push({
                ...localTask,
                stateTransition: 'none→current',
                metadata: {
                    priority: localTask.priority !== undefined ? localTask.priority : 'unknown',
                    source: 'local',
                    isNew: true
                }
            });
        }
    }

    for (const todoistTask of todoistTasksToSync) {
        const potentialMatch = findCorrelationByContent(todoistTask.content, 0.8);

        if (potentialMatch) {
            changes.potentialRenames.push({
                type: 'todoist_new_similar_to_existing',
                todoistTask,
                existingCorrelation: potentialMatch.correlation,
                similarity: potentialMatch.similarity
            });
        } else {
            changes.local.noneToCurrent.push({
                ...todoistTask,
                stateTransition: 'none→current',
                metadata: {
                    priority: mapTodoistPriorityToLocal(todoistTask),
                    source: 'todoist',
                    isNew: true,
                    created: todoistTask.created
                }
            });
        }
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Track processed local completed tasks to avoid duplicates
    const processedLocalContent = new Set();

    for (const localCompleted of localTasks.completed.tasks) {
        // Skip invalid entries (separators, empty content, etc.)
        let cleanContent = stripCorrelationId(localCompleted.content).trim();
        
        // Skip entries that are separators, empty, or contain only dashes
        if (!cleanContent || 
            cleanContent.includes('---') || 
            cleanContent.match(/^-+$/) || 
            cleanContent.length < 3) {
            continue;
        }
        
        // Remove the "- " prefix if it exists (these shouldn't be in completed file)
        cleanContent = cleanContent.replace(/^-\s+/, '').trim();
        
        // Skip if still empty after cleaning
        if (!cleanContent) {
            continue;
        }

        // Skip if we've already processed this content
        const normalizedLocalContent = cleanContent.toLowerCase().trim();
        if (processedLocalContent.has(normalizedLocalContent)) {
            continue;
        }
        processedLocalContent.add(normalizedLocalContent);

        const corrId = extractCorrelationId(localCompleted.content);

        if (!corrId) {
            // Check if this completion already exists in Todoist completed tasks
            const alreadyExistsInTodoist = todoistTasks.completed.tasks.some(todoistTask => {
                const todoistCleanContent = stripCorrelationId(todoistTask.content).toLowerCase().trim();
                return todoistCleanContent === normalizedLocalContent;
            });

            if (!alreadyExistsInTodoist) {
                changes.todoist.noneToCompleted.push({
                    content: cleanContent,
                    priority: localCompleted.priority,
                    stateTransition: 'none→completed',
                    metadata: {
                        priority: localCompleted.priority || 'unknown',
                        source: 'local',
                        isNew: true,
                        wasDirectlyCompleted: true
                    }
                });
            }
        } else {
            // Task was previously current, now completed
            const correlation = correlations[corrId];
            if (correlation && correlation.status === 'current') {
                changes.todoist.currentToCompleted.push({
                    content: cleanContent,
                    corrId: corrId,
                    stateTransition: 'current→completed',
                    metadata: {
                        priority: localCompleted.priority || 'unknown',
                        source: 'local',
                        wasCurrentTask: true,
                        todoistId: correlation.todoistId
                    }
                });
            }
        }
    }

    // Track processed Todoist completed tasks to avoid duplicates
    const processedTodoistContent = new Set();
    
    for (const todoistCompleted of todoistTasks.completed.tasks) {
        if (new Date(todoistCompleted.completed) > thirtyDaysAgo) {
            // Clean the content and check for duplicates
            let cleanContent = stripCorrelationId(todoistCompleted.content);
            cleanContent = cleanContent.replace(/\s*\(completed:.*?\)$/, '').trim();
            
            // Skip invalid entries (separators, empty content, etc.)
            if (!cleanContent || 
                cleanContent.includes('---') || 
                cleanContent.match(/^-+$/) || 
                cleanContent.length < 3) {
                continue;
            }
            
            // Remove the "- " prefix if it exists
            cleanContent = cleanContent.replace(/^-\s+/, '').trim();
            
            // Skip if still empty after cleaning
            if (!cleanContent) {
                continue;
            }
            
            // Skip if we've already processed this content
            const normalizedContent = cleanContent.toLowerCase().trim();
            if (processedTodoistContent.has(normalizedContent)) {
                continue;
            }
            processedTodoistContent.add(normalizedContent);

            const result = findCorrelationByTodoistId(todoistCompleted.id);
            const correlation = result?.correlation;

            if (!correlation) {
                // Check if this completion already exists in local completed tasks
                const alreadyExistsInLocal = localTasks.completed.tasks.some(localTask => {
                    // Remove correlation ID and completion date from local task
                    let localCleanContent = stripCorrelationId(localTask.content);
                    localCleanContent = localCleanContent.replace(/\s*\(completed:.*?\)$/, '').replace(/^-\s+/, '').toLowerCase().trim();
                    return localCleanContent === normalizedContent;
                });

                if (!alreadyExistsInLocal) {
                    changes.local.noneToCompleted.push({
                        ...todoistCompleted,
                        content: cleanContent,
                        stateTransition: 'none→completed',
                        metadata: {
                            priority: mapTodoistPriorityToLocal(todoistCompleted),
                            source: 'todoist',
                            isNew: true,
                            wasDirectlyCompleted: true,
                            completed: todoistCompleted.completed
                        }
                    });
                }
            } else if (correlation.status === 'current') {
                // Task was previously current, now completed
                changes.local.currentToCompleted.push({
                    ...todoistCompleted,
                    content: cleanContent,
                    stateTransition: 'current→completed',
                    metadata: {
                        priority: mapTodoistPriorityToLocal(todoistCompleted),
                        source: 'todoist',
                        wasCurrentTask: true,
                        completed: todoistCompleted.completed,
                        corrId: result?.corrId
                    }
                });
            }
        }
    }

    return changes;
}
