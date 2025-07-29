import { execSync } from 'child_process';

export async function execute(options = {}) {
    try {
        // Run npm run usage command
        execSync('npm run usage', {
            stdio: 'inherit',
            cwd: process.cwd()
        });
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error('npm command not found');
        } else if (error.signal === 'SIGINT') {
            // User interrupted with Ctrl+C
            process.exit(0);
        } else {
            throw error;
        }
    }
}