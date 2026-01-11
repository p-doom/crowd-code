/**
 * Filesystem Watcher Module
 * Watches for file changes from external sources (agents, git operations)
 */

import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { LRUCache } from 'lru-cache'

// Configuration
const MAX_CACHE_SIZE = 5000
const MAX_FILE_SIZE_BYTES = 100 * 1024 // 100KB

export type FileChangeCallback = (
	file: string,
	changeType: 'create' | 'change' | 'delete',
	oldContent: string | null,
	newContent: string | null
) => void | Promise<void>

let fileChangeCallback!: FileChangeCallback

let gitignoreMatcher: Ignore | null = null
let workspaceRoot: string | null = null
let workspaceFolder: vscode.WorkspaceFolder | null = null

// File content cache for diff computation (using lru-cache)
const fileCache = new LRUCache<string, string>({ max: MAX_CACHE_SIZE })

// Filesystem watcher
let fileWatcher: vscode.FileSystemWatcher | null = null

/**
 * Check if a file path should be excluded from watching
 */
function isExcluded(filePath: string): boolean {
	if (!workspaceRoot || !gitignoreMatcher) {
		return false
	}

	const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/')
	return gitignoreMatcher.ignores(relativePath)
}

/**
 * Load gitignore patterns from workspace
 */
function loadGitignore(): void {
	const folder = vscode.workspace.workspaceFolders?.[0]
	if (!folder) {
		return
	}

	workspaceFolder = folder
	workspaceRoot = folder.uri.fsPath
	
	const ig = ignore()
	ig.add('.git')
	
	try {
		const gitignorePath = path.join(workspaceRoot, '.gitignore')
		const content = fs.readFileSync(gitignorePath, 'utf-8')
		ig.add(content)
	} catch {
		// .gitignore doesn't exist or can't be read
	}
	
	gitignoreMatcher = ig
}

/**
 * Check if a file should be tracked (respects VS Code's files.exclude)
 */
async function shouldTrackFile(filePath: string): Promise<boolean> {
	if (fileCache.has(filePath)) {return true}
	if (isExcluded(filePath)) {return false}
	if (!workspaceRoot || !workspaceFolder) {return false}
	
	const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/')
	const matches = await vscode.workspace.findFiles(
		new vscode.RelativePattern(workspaceFolder, relativePath)
	)
	return matches.length > 0
}

/**
 * Check if file size is within limit
 */
async function isFileSizeWithinLimit(filePath: string): Promise<boolean> {
	try {
		const stats = await fs.promises.stat(filePath)
		return stats.size <= MAX_FILE_SIZE_BYTES
	} catch {
		return false
	}
}

/**
 * Read file content safely
 */
async function readFileContent(filePath: string): Promise<string | null> {
	try {
		const content = await fs.promises.readFile(filePath, 'utf-8')
		return content
	} catch {
		return null
	}
}


/**
 * Process a file change event
 */
async function processFileChange(
	filePath: string,
	changeType: 'create' | 'change' | 'delete'
): Promise<void> {
	// For new files not in cache, check if we should track them
	if (!fileCache.has(filePath) && changeType !== 'delete') {
		const shouldTrack = await shouldTrackFile(filePath)
		if (!shouldTrack) {
			return
		}
	}

	if (changeType === 'delete') {
		const oldContent = fileCache.get(filePath) ?? null
		fileCache.delete(filePath)
		fileChangeCallback(filePath, changeType, oldContent, null)
		return
	}

	// Skip files that exceed size limit
	const withinLimit = await isFileSizeWithinLimit(filePath)
	if (!withinLimit) {
		// Remove from cache if it was previously tracked but now exceeds limit
		if (fileCache.has(filePath)) {
			fileCache.delete(filePath)
		}
		return
	}

	const oldContent = fileCache.get(filePath) ?? null
	const newContent = await readFileContent(filePath)
	if (newContent === null) {
		return
	}

	// Check if content actually changed
	if (oldContent === newContent && changeType !== 'create') {
		return
	}

	fileCache.set(filePath, newContent)
	fileChangeCallback(filePath, changeType, oldContent, newContent)
}

/**
 * Handle a file system event
 */
function handleFileEvent(uri: vscode.Uri, eventType: 'create' | 'change' | 'delete'): void {
	const filePath = uri.fsPath

	if (isExcluded(filePath)) {
		return
	}

	processFileChange(filePath, eventType)
}

/**
 * Background initialization: cache all workspace files
 */
async function initializeCacheBackground(): Promise<void> {
	const files = await vscode.workspace.findFiles('**/*')
	
	for (const file of files) {
		if (isExcluded(file.fsPath)) {continue}
		
		// Yield to event loop between files to avoid blocking
		await new Promise(resolve => setImmediate(resolve))
		
		try {
			// Skip files that exceed size limit
			const withinLimit = await isFileSizeWithinLimit(file.fsPath)
			if (!withinLimit) {continue}

			const content = await vscode.workspace.fs.readFile(file)
			fileCache.set(file.fsPath, content.toString())
		} catch {
			// File might have been deleted or is unreadable, ignore
		}
	}
}


/**
 * Initialize the filesystem watcher
 */
export async function initializeFilesystemWatcher(
	context: vscode.ExtensionContext,
	onFileChange: FileChangeCallback
): Promise<void> {
	fileChangeCallback = onFileChange

	const folder = vscode.workspace.workspaceFolders?.[0]
	if (!folder) {
		return
	}

	loadGitignore()

	initializeCacheBackground()

	if (fileWatcher) {
		return
	}

	fileWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(folder, '**/*')
	)

	fileWatcher.onDidCreate((uri) => handleFileEvent(uri, 'create'))
	fileWatcher.onDidChange((uri) => handleFileEvent(uri, 'change'))
	fileWatcher.onDidDelete((uri) => handleFileEvent(uri, 'delete'))

	context.subscriptions.push(fileWatcher)
}

/**
 * Cleanup the filesystem watcher
 */
export function cleanupFilesystemWatcher(): void {
	if (fileWatcher) {
		fileWatcher.dispose()
		fileWatcher = null
	}
}

/**
 * Reset the filesystem watcher state (invalidate cache)
 */
export function resetFilesystemState(): void {
	fileCache.clear()
}

/**
 * Get a snapshot of the current file cache
 * Returns a new Map to avoid external mutation of the cache
 */
export function getFileCacheSnapshot(): Map<string, string> {
	return new Map(fileCache.entries())
}

