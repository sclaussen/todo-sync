import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Config, ConflictResolution } from './types.js';

const DEFAULT_CONFIG: Config = {
  todoist: {
    apiToken: '',
    projectName: 'Synced Tasks'
  },
  sync: {
    conflictResolution: ConflictResolution.INTERACTIVE,
    backupBeforeSync: true,
    ignoredSections: [],
  },
  duplicateDetection: {
    enabled: true,
    similarityThreshold: 0.85,
    ignoreCase: true,
    ignoreWhitespace: true,
    enableFuzzyMatching: true,
    strategy: 'interactive'
  },
  mapping: {
    priorityMapping: {
      '0': { todoistPriority: 4, dueString: 'today' },
      '1': { todoistPriority: 3 },
      '2': { todoistPriority: 2 },
      '3': { todoistPriority: 1 },
      '4': { todoistPriority: 1 }
    }
  }
};

export class ConfigManager {
  private configPath: string;
  private config: Config;

  constructor(configPath: string = '~/.todo-sync.json') {
    this.configPath = configPath.replace('~', homedir());
    this.config = this.load();
  }

  load(): Config {
    if (!existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    try {
      const content = readFileSync(this.configPath, 'utf-8');
      const loadedConfig = JSON.parse(content);
      
      // Merge with defaults to ensure all fields exist
      return this.mergeWithDefaults(loadedConfig);
    } catch (error) {
      console.error('Error loading config:', error);
      return { ...DEFAULT_CONFIG };
    }
  }

  save(): void {
    const configJson = JSON.stringify(this.config, null, 2);
    writeFileSync(this.configPath, configJson, 'utf-8');
  }

  get(): Config {
    return this.config;
  }

  set(updates: Partial<Config>): void {
    this.config = this.mergeDeep(this.config, updates);
    this.save();
  }

  setApiToken(token: string): void {
    this.config.todoist.apiToken = token;
    this.save();
  }

  setProjectName(name: string): void {
    this.config.todoist.projectName = name;
    this.config.todoist.projectId = undefined; // Reset project ID
    this.save();
  }

  setConflictResolution(resolution: ConflictResolution): void {
    this.config.sync.conflictResolution = resolution;
    this.save();
  }

  updateLastSync(): void {
    this.config.sync.lastSync = new Date();
    this.save();
  }

  private mergeWithDefaults(loadedConfig: any): Config {
    return this.mergeDeep({ ...DEFAULT_CONFIG }, loadedConfig) as Config;
  }

  private mergeDeep(target: any, source: any): any {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.mergeDeep(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }

  private isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}