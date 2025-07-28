/**
 * Utility functions for managing Todoist correlation IDs in task content.
 * 
 * Correlation IDs are used to link local tasks with their Todoist counterparts.
 * They are stored in the task content as "(todoistId)" at the end of the task.
 * 
 * Example: "Buy groceries (12345678)"
 */

/**
 * Extracts the Todoist correlation ID from task content
 * @param {string} taskContent - The task content that may contain a correlation ID
 * @returns {string|null} The extracted Todoist ID or null if not found
 * @example
 * extractCorrelationId("Buy groceries (12345678)") // returns "12345678"
 * extractCorrelationId("Buy groceries") // returns null
 */
export function extractCorrelationId(taskContent) {
    // First try new format (todoistId)
    const newFormatMatch = taskContent.match(/\((\d+)\)/);
    if (newFormatMatch) {
        return newFormatMatch[1];
    }

    // Fall back to old format for migration
    const oldFormatMatch = taskContent.match(/# \[([a-f0-9]{8})\]/);
    if (oldFormatMatch) {
        return oldFormatMatch[1]; // Return the old correlation ID
    }

    return null;
}

/**
 * Removes correlation ID markers from task content
 * @param {string} taskContent - The task content that may contain correlation markers
 * @returns {string} The task content without correlation markers
 * @example
 * stripCorrelationId("Buy groceries (12345678)") // returns "Buy groceries"
 * stripCorrelationId("Buy groceries # [a1b2c3d4]") // returns "Buy groceries" (old format)
 */
export function stripCorrelationId(taskContent) {
    // Remove new format first
    let cleaned = taskContent.replace(/\s*\(\d+\)/, '');
    // Remove old format if it exists
    cleaned = cleaned.replace(/\s*# \[[a-f0-9]{8}\]/, '');
    return cleaned.trim();
}

/**
 * Adds a Todoist correlation ID to task content
 * @param {string} taskContent - The clean task content
 * @param {string|number} todoistId - The Todoist ID to add
 * @returns {string} The task content with the correlation ID appended
 * @example
 * addCorrelationId("Buy groceries", "12345678") // returns "Buy groceries (12345678)"
 */
export function addCorrelationId(taskContent, todoistId) {
    const cleanContent = stripCorrelationId(taskContent);
    return `${cleanContent} (${todoistId})`;
}