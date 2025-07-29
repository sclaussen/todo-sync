#!/usr/bin/env node
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'logs', 'coverage', 'dist', 'build']);
const IGNORE_FILES = new Set(['.DS_Store', 'package-lock.json', 'yarn.lock']);
const CODE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.json', '.yaml', '.yml', '.md']);

async function countLines(filePath) {
    const content = await readFile(filePath, 'utf8');
    const lines = content.split('\n');
    
    let codeLines = 0;
    let blankLines = 0;
    let commentLines = 0;
    
    const ext = extname(filePath);
    const isJS = ['.js', '.ts', '.jsx', '.tsx'].includes(ext);
    
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) {
            blankLines++;
        } else if (isJS && (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'))) {
            commentLines++;
        } else {
            codeLines++;
        }
    });
    
    return { total: lines.length, code: codeLines, blank: blankLines, comment: commentLines };
}

async function walkDirectory(dir, stats = {}, fileDetails = []) {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name)) {
                await walkDirectory(fullPath, stats, fileDetails);
            }
        } else if (entry.isFile()) {
            if (!IGNORE_FILES.has(entry.name) && CODE_EXTENSIONS.has(extname(entry.name))) {
                const ext = extname(entry.name);
                if (!stats[ext]) {
                    stats[ext] = { files: 0, total: 0, code: 0, blank: 0, comment: 0 };
                }
                
                try {
                    const counts = await countLines(fullPath);
                    stats[ext].files++;
                    stats[ext].total += counts.total;
                    stats[ext].code += counts.code;
                    stats[ext].blank += counts.blank;
                    stats[ext].comment += counts.comment;
                    
                    // Store file details for .js files
                    if (ext === '.js') {
                        fileDetails.push({
                            path: fullPath,
                            lines: counts.total,
                            code: counts.code
                        });
                    }
                } catch (err) {
                    console.error(`Error reading ${fullPath}:`, err.message);
                }
            }
        }
    }
    
    return { stats, fileDetails };
}

async function main() {
    console.log('Analyzing codebase...\n');
    
    const { stats, fileDetails } = await walkDirectory('.');
    const totals = { files: 0, total: 0, code: 0, blank: 0, comment: 0 };
    
    console.log('Language       Files     Code    Blank  Comment    Total');
    console.log('─'.repeat(58));
    
    Object.entries(stats)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([ext, data]) => {
            const lang = {
                '.js': 'JavaScript',
                '.ts': 'TypeScript',
                '.jsx': 'JSX',
                '.tsx': 'TSX',
                '.json': 'JSON',
                '.yaml': 'YAML',
                '.yml': 'YAML',
                '.md': 'Markdown'
            }[ext] || ext;
            
            console.log(
                `${lang.padEnd(14)} ${String(data.files).padStart(5)} ${String(data.code).padStart(8)} ${String(data.blank).padStart(8)} ${String(data.comment).padStart(8)} ${String(data.total).padStart(8)}`
            );
            
            totals.files += data.files;
            totals.total += data.total;
            totals.code += data.code;
            totals.blank += data.blank;
            totals.comment += data.comment;
        });
    
    console.log('─'.repeat(58));
    console.log(
        `${'Total'.padEnd(14)} ${String(totals.files).padStart(5)} ${String(totals.code).padStart(8)} ${String(totals.blank).padStart(8)} ${String(totals.comment).padStart(8)} ${String(totals.total).padStart(8)}`
    );
    
    // Summary
    console.log('\nSummary:');
    console.log(`  Total files: ${totals.files}`);
    console.log(`  Total lines: ${totals.total.toLocaleString()}`);
    console.log(`  Code lines: ${totals.code.toLocaleString()} (${((totals.code / totals.total) * 100).toFixed(1)}%)`);
    console.log(`  Blank lines: ${totals.blank.toLocaleString()} (${((totals.blank / totals.total) * 100).toFixed(1)}%)`);
    console.log(`  Comment lines: ${totals.comment.toLocaleString()} (${((totals.comment / totals.total) * 100).toFixed(1)}%)`);
    
    // Top 10 largest JavaScript files
    if (fileDetails.length > 0) {
        console.log('\nTop 10 Largest JavaScript Files:');
        console.log('─'.repeat(65));
        console.log('Lines    Code  File');
        console.log('─'.repeat(65));
        
        fileDetails
            .sort((a, b) => b.lines - a.lines)
            .slice(0, 10)
            .forEach(file => {
                const relativePath = file.path.startsWith('./') ? file.path : './' + file.path;
                console.log(
                    `${String(file.lines).padStart(5)}  ${String(file.code).padStart(6)}  ${relativePath}`
                );
            });
    }
}

main().catch(console.error);