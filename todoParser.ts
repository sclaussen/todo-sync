import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { TodoItem, TodoSection, TodoFile, createTodoItem, calculateChecksum } from './types.js';

export class TodoParser {
  private filePath: string;
  private priorityPattern = /^Priority\s+(\d+)\s*$/;
  private separatorPattern = /^-+\s*$/;

  constructor(todoFilePath: string = '~/.todo') {
    this.filePath = todoFilePath.replace('~', homedir());
  }

  parse(): TodoFile {
    if (!existsSync(this.filePath)) {
      throw new Error(`Todo file not found: ${this.filePath}`);
    }

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.split('\n');
    
    const todoFile: TodoFile = {
      sections: [],
      otherContent: []
    };

    let currentSection: TodoSection | null = null;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const lineContent = line.trimEnd();

      const priorityMatch = lineContent.match(this.priorityPattern);
      if (priorityMatch) {
        const priority = parseInt(priorityMatch[1]);
        
        if (i + 1 < lines.length && this.separatorPattern.test(lines[i + 1].trimEnd())) {
          if (currentSection) {
            currentSection.endLine = i - 1;
          }

          currentSection = {
            priority,
            items: [],
            startLine: i
          };
          todoFile.sections.push(currentSection);
          i += 2;
          continue;
        }
      }

      if (currentSection !== null && lineContent.trim()) {
        const todoItem = createTodoItem(
          lineContent.trim(),
          currentSection.priority,
          i + 1
        );
        currentSection.items.push(todoItem);
      } else if (currentSection === null || !lineContent.trim()) {
        todoFile.otherContent.push([i, line]);
      }

      i++;
    }

    if (currentSection) {
      currentSection.endLine = lines.length - 1;
    }

    return todoFile;
  }

  write(todoFile: TodoFile): void {
    const lines: string[] = [];
    
    // Sort sections by priority (0, 1, 2, 3, 4) to ensure deterministic order
    const sortedSections = [...todoFile.sections].sort((a, b) => a.priority - b.priority);
    
    // Write priority sections in order
    for (let i = 0; i < sortedSections.length; i++) {
      const section = sortedSections[i];
      
      // Add section header
      lines.push(`Priority ${section.priority}`);
      lines.push('-'.repeat(79));
      
      // Add all items in this section
      for (const item of section.items) {
        lines.push(item.content);
      }
      
      // Add blank line after section (except for last section)
      if (i < sortedSections.length - 1) {
        lines.push('');
      }
    }
    
    // Add any non-priority content that should be preserved below the priority sections
    const nonPriorityContent = todoFile.otherContent
      .filter(([lineNum, content]) => {
        // Only include content that appears after all priority sections
        // This preserves any footer content or notes
        return content.trim() !== '' && !this.priorityPattern.test(content) && !this.separatorPattern.test(content);
      })
      .sort((a, b) => a[0] - b[0]); // Sort by original line number
    
    if (nonPriorityContent.length > 0) {
      lines.push(''); // Add blank line before non-priority content
      for (const [, content] of nonPriorityContent) {
        lines.push(content);
      }
    }
    
    // Write to file
    writeFileSync(this.filePath, lines.join('\n'), 'utf-8');
  }

  updateTodoContent(syncId: string, newContent: string, todoFile: TodoFile): boolean {
    for (const section of todoFile.sections) {
      for (const item of section.items) {
        if (item.syncId === syncId) {
          item.content = newContent;
          item.checksum = calculateChecksum(newContent);
          item.lastModifiedSource = 'todoist';
          return true;
        }
      }
    }
    return false;
  }

  getAllTodos(todoFile: TodoFile): TodoItem[] {
    return todoFile.sections.flatMap(section => section.items);
  }

  getSyncableTodos(todoFile: TodoFile): TodoItem[] {
    return todoFile.sections
      .filter(section => section.priority >= 0 && section.priority <= 4)
      .flatMap(section => section.items);
  }

  getTodosByPriority(todoFile: TodoFile, priority: number): TodoItem[] {
    const section = todoFile.sections.find(s => s.priority === priority);
    return section ? section.items : [];
  }
}