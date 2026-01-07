/**
 * Filesystem Watcher Module
 * Watches for file changes from external sources (agents, git operations)
 */

import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import ignore, { type Ignore } from 'ignore'
import { LRUCache } from 'lru-cache'

// Configuration
const DEBOUNCE_WINDOW_MS = 500
const MAX_CACHE_SIZE = 5000

export type FileChangeCallback = (file: string, changeType: 'create' | 'change' | 'delete', diff: string | null) => void

let fileChangeCallback!: FileChangeCallback

let gitignoreMatcher: Ignore | null = null
let workspaceRoot: string | null = null
let workspaceFolder: vscode.WorkspaceFolder | null = null

// File content cache for diff computation (using lru-cache)
const fileCache = new LRUCache<string, string>({ max: MAX_CACHE_SIZE })

// Debounce tracking
const pendingChanges = new Map<string, {
	type: 'create' | 'change' | 'delete'
	timeout: NodeJS.Timeout
}>()

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
	if (fileCache.has(filePath)) return true
	if (isExcluded(filePath)) return false
	if (!workspaceRoot || !workspaceFolder) return false
	
	const relativePath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/')
	const matches = await vscode.workspace.findFiles(
		new vscode.RelativePattern(workspaceFolder, relativePath)
	)
	return matches.length > 0
}

/**
 * Compute a unified diff between old and new content
 * Returns a string representation of the changes in unified diff format
 */
function computeDiff(oldContent: string | null, newContent: string | null, filePath?: string): string | null {
	if (oldContent === null && newContent === null) {
		return null
	}

	if (oldContent === newContent) {
		return null
	}

	const fileName = filePath ? path.basename(filePath) : 'file'
	const oldStr = oldContent ?? ''
	const newStr = newContent ?? ''

	// createTwoFilesPatch produces a standard unified diff
	const patch = createTwoFilesPatch(
		`a/${fileName}`,
		`b/${fileName}`,
		oldStr,
		newStr,
		'',
		'',
		{ context: 3 }
	)

	return patch
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
 * Process a file change event (after debounce)
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
		fileCache.delete(filePath)
		fileChangeCallback(filePath, changeType, null)
		return
	}

	const oldContent = fileCache.get(filePath) ?? null
	const newContent = await readFileContent(filePath)
	if (newContent === null) {
		return
	}

	const diff = computeDiff(oldContent, newContent, filePath)
	fileCache.set(filePath, newContent)

	if (diff !== null || changeType === 'create') {
		fileChangeCallback(filePath, changeType, diff)
	}
}

/**
 * Handle a file system event with debouncing
 */
function handleFileEvent(uri: vscode.Uri, eventType: 'create' | 'change' | 'delete'): void {
	const filePath = uri.fsPath

	if (isExcluded(filePath)) {
		return
	}

	const pending = pendingChanges.get(filePath)
	if (pending) {
		clearTimeout(pending.timeout)
	}

	const timeout = setTimeout(() => {
		pendingChanges.delete(filePath)
		processFileChange(filePath, eventType)
	}, DEBOUNCE_WINDOW_MS)

	pendingChanges.set(filePath, {
		type: eventType,
		timeout
	})
}

/**
 * Background initialization: cache all workspace files
 */
async function initializeCacheBackground(): Promise<void> {
	const files = await vscode.workspace.findFiles('**/*')
	
	for (const file of files) {
		if (isExcluded(file.fsPath)) continue
		
		// Yield to event loop between files to avoid blocking
		await new Promise(resolve => setImmediate(resolve))
		
		try {
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

	if (fileWatcher) {
		return
	}

	const folder = vscode.workspace.workspaceFolders?.[0]
	if (!folder) {
		return
	}

	loadGitignore()

	initializeCacheBackground()

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

	// Clear pending changes
	for (const [, pending] of pendingChanges) {
		clearTimeout(pending.timeout)
	}
	pendingChanges.clear()
}

/**
 * Reset the filesystem watcher state (invalidate cache)
 */
export function resetFilesystemState(): void {
	fileCache.clear()

	// Clear pending changes
	for (const [, pending] of pendingChanges) {
		clearTimeout(pending.timeout)
	}
	pendingChanges.clear()
}

