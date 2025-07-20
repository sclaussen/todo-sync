import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import winston from 'winston';
import { join } from 'path';
import { homedir } from 'os';

// Utility functions
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

// Logger setup
const logDir = join(homedir(), '.todo-sync');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: join(logDir, 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: join(logDir, 'combined.log') 
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

export { logger };