import { readFile } from 'fs/promises';
import { FILE_PATHS } from '../config/constants.js';

export async function execute(options = {}) {
    try {
        const transactionPath = FILE_PATHS.TRANSACTIONS;
        const content = await readFile(transactionPath, 'utf8');
        
        console.log(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('No transaction log found');
        } else {
            throw error;
        }
    }
}