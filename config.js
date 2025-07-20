import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ConflictResolution = {
    LOCAL_WINS: 'local',
    REMOTE_WINS: 'remote',
    MERGE: 'merge',
    INTERACTIVE: 'interactive',
    NEWEST_WINS: 'newest'
};

const DEFAULT_CONFIG = {
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
  constructor(configPath = '~/.todo-sync.json') {
    this.configPath = configPath.replace('~', homedir());
    this.config = this.load();
  }

  load() {
    if (!existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    try {
      const content = readFileSync(this.configPath, 'utf-8');
      const loadedConfig = JSON.parse(content);
      
      return this.mergeWithDefaults(loadedConfig);
    } catch (error) {
      console.error('Error loading config:', error);
      return { ...DEFAULT_CONFIG };
    }
  }

  save() {
    const configJson = JSON.stringify(this.config, null, 2);
    writeFileSync(this.configPath, configJson, 'utf-8');
  }

  get() {
    return this.config;
  }

  set(updates) {
    this.config = this.mergeDeep(this.config, updates);
    this.save();
  }

  setApiToken(token) {
    this.config.todoist.apiToken = token;
    this.save();
  }

  setProjectName(name) {
    this.config.todoist.projectName = name;
    this.config.todoist.projectId = undefined;
    this.save();
  }

  setConflictResolution(resolution) {
    this.config.sync.conflictResolution = resolution;
    this.save();
  }

  updateLastSync() {
    this.config.sync.lastSync = new Date();
    this.save();
  }

  mergeWithDefaults(loadedConfig) {
    return this.mergeDeep({ ...DEFAULT_CONFIG }, loadedConfig);
  }

  mergeDeep(target, source) {
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

  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}