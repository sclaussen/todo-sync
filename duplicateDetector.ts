import { TodoItem } from './types.js';

export interface DuplicateGroup {
  items: TodoItem[];
  similarity: number;
  suggestedAction: 'merge' | 'keep_first' | 'keep_newest' | 'keep_oldest' | 'user_choice';
}

export interface DuplicateDetectionResult {
  duplicates: DuplicateGroup[];
  unique: TodoItem[];
}

export interface DuplicateDetectionConfig {
  similarityThreshold: number; // 0.0 to 1.0
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
  enableFuzzyMatching: boolean;
}

export class DuplicateDetector {
  private config: DuplicateDetectionConfig;

  constructor(config: Partial<DuplicateDetectionConfig> = {}) {
    this.config = {
      similarityThreshold: 0.85,
      ignoreCase: true,
      ignoreWhitespace: true,
      enableFuzzyMatching: true,
      ...config
    };
  }

  findDuplicates(items: TodoItem[]): DuplicateDetectionResult {
    const duplicates: DuplicateGroup[] = [];
    const unique: TodoItem[] = [];
    const processed = new Set<string>();

    for (const item of items) {
      if (processed.has(item.syncId)) {
        continue;
      }

      const duplicateGroup = this.findDuplicatesFor(item, items);
      
      if (duplicateGroup.length > 1) {
        duplicates.push({
          items: duplicateGroup,
          similarity: this.calculateGroupSimilarity(duplicateGroup),
          suggestedAction: this.suggestAction(duplicateGroup)
        });
        
        // Mark all items in this group as processed
        duplicateGroup.forEach(groupItem => processed.add(groupItem.syncId));
      } else {
        unique.push(item);
        processed.add(item.syncId);
      }
    }

    return { duplicates, unique };
  }

  findDuplicatesFor(targetItem: TodoItem, items: TodoItem[]): TodoItem[] {
    const duplicates: TodoItem[] = [];
    const normalizedTarget = this.normalizeContent(targetItem.content);

    for (const item of items) {
      if (item.syncId === targetItem.syncId) {
        duplicates.push(item);
        continue;
      }

      const normalizedContent = this.normalizeContent(item.content);
      
      // Check for exact match first
      if (normalizedTarget === normalizedContent) {
        duplicates.push(item);
        continue;
      }

      // Check for fuzzy match if enabled
      if (this.config.enableFuzzyMatching) {
        const similarity = this.calculateSimilarity(normalizedTarget, normalizedContent);
        if (similarity >= this.config.similarityThreshold) {
          duplicates.push(item);
        }
      }
    }

    return duplicates;
  }

  isDuplicate(item1: TodoItem, item2: TodoItem): boolean {
    if (item1.syncId === item2.syncId) {
      return true;
    }

    const content1 = this.normalizeContent(item1.content);
    const content2 = this.normalizeContent(item2.content);

    if (content1 === content2) {
      return true;
    }

    if (this.config.enableFuzzyMatching) {
      const similarity = this.calculateSimilarity(content1, content2);
      return similarity >= this.config.similarityThreshold;
    }

    return false;
  }

  private normalizeContent(content: string): string {
    let normalized = content.trim();
    
    if (this.config.ignoreCase) {
      normalized = normalized.toLowerCase();
    }
    
    if (this.config.ignoreWhitespace) {
      normalized = normalized.replace(/\s+/g, ' ');
    }
    
    return normalized;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;

    // Use Levenshtein distance for similarity calculation
    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    return 1 - (distance / maxLength);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  private calculateGroupSimilarity(items: TodoItem[]): number {
    if (items.length <= 1) return 1.0;

    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const content1 = this.normalizeContent(items[i].content);
        const content2 = this.normalizeContent(items[j].content);
        totalSimilarity += this.calculateSimilarity(content1, content2);
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 1.0;
  }

  private suggestAction(items: TodoItem[]): 'merge' | 'keep_first' | 'keep_newest' | 'keep_oldest' | 'user_choice' {
    if (items.length === 2) {
      // If items are identical, suggest merge
      const content1 = this.normalizeContent(items[0].content);
      const content2 = this.normalizeContent(items[1].content);
      
      if (content1 === content2) {
        return 'merge';
      }
      
      // If very similar, suggest keeping the first one
      const similarity = this.calculateSimilarity(content1, content2);
      if (similarity > 0.95) {
        return 'keep_first';
      }
    }

    // For complex cases, let the user decide
    return 'user_choice';
  }
}