import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export function calculateChecksum(content) {
    return createHash('md5').update(content).digest('hex');
}

export function createTodoItem(content, localPriority, lineNumber) {
    return {
        content: content.trim(),
        localPriority,
        syncId: uuidv4(),
        checksum: calculateChecksum(content.trim()),
        lastModifiedSource: 'local',
        lastSync: new Date(),
        lineNumber
    };
}