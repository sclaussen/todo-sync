import { createHash } from 'crypto';

export enum ConflictResolution {
    LOCAL_WINS = 'local',
    REMOTE_WINS = 'remote',
    MERGE = 'merge',
    INTERACTIVE = 'interactive',
    NEWEST_WINS = 'newest'
}

export interface TodoItem {
    content: string;
    localPriority?: number;
    todoistPriority?: number;
    todoistId?: string;
    syncId: string;
    checksum: string;
    lastModifiedSource: 'local' | 'todoist';
    lastSync?: Date;
    dueDate?: string;
    lineNumber?: number;
}

export interface SyncState {
    syncId: string;
    localChecksum: string;
    todoistChecksum: string;
    lastSyncTimestamp: Date;
    conflictStatus?: 'none' | 'resolved' | 'pending';
}

export interface TodoSection {
    priority: number;
    items: TodoItem[];
    startLine: number;
    endLine?: number;
}

export interface TodoFile {
    sections: TodoSection[];
    otherContent: Array<[number, string]>;
}

export interface Config {
    todoist: {
        apiToken: string;
        projectName: string;
        projectId?: string;
    };
    sync: {
        conflictResolution: ConflictResolution;
        autoSyncInterval?: number;
        backupBeforeSync: boolean;
        ignoredSections: string[];
        lastSync?: Date;
    };
    duplicateDetection: {
        enabled: boolean;
        similarityThreshold: number;
        ignoreCase: boolean;
        ignoreWhitespace: boolean;
        enableFuzzyMatching: boolean;
        strategy: 'prevent' | 'merge' | 'keep_newest' | 'keep_oldest' | 'interactive';
    };
    mapping: {
        priorityMapping: {
            [key: string]: {
                todoistPriority: number;
                dueString?: string;
            };
        };
    };
}

export function calculateChecksum(content: string): string {
    const normalizedContent = content.trim().toLowerCase();
    return createHash('md5').update(normalizedContent).digest('hex');
}

export function createTodoItem(content: string, priority?: number, lineNumber?: number): TodoItem {
    const checksum = calculateChecksum(content);
    return {
        content,
        localPriority: priority,
        syncId: '',
        checksum,
        lastModifiedSource: 'local',
        lineNumber
    };
}
