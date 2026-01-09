/**
 * Git Provider for crowd-code 2.0
 * Detects git operations to annotate filesystem changes
 */

import * as vscode from 'vscode'
import { logToOutput } from './utilities'

// Track recent git operations for filesystem change attribution
let sawHeadChange = false
let lastGitOperationTime = 0
const GIT_OPERATION_WINDOW_MS = 500

// File system watchers
let gitHeadWatcher: vscode.FileSystemWatcher | undefined
let gitRefsWatcher: vscode.FileSystemWatcher | undefined

/**
 * Check if there was a recent git operation
 * Returns 'git_checkout' if HEAD changed, 'git' for other operations, null otherwise
 */
export function getRecentGitOperation(): 'git' | 'git_checkout' | null {
	if (Date.now() - lastGitOperationTime > GIT_OPERATION_WINDOW_MS) {
		return null
	}
	const result = sawHeadChange ? 'git_checkout' : 'git'
	sawHeadChange = false
	return result
}

/**
 * Setup git file watchers for the current workspace
 */
function setupGitWatchers(): void {
	// Cleanup any existing watchers first
	disposeWatchers()

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
	if (!workspaceFolder) {
		logToOutput('No workspace folder found', 'info')
		return
	}

	const gitDir = vscode.Uri.joinPath(workspaceFolder.uri, '.git')
	vscode.workspace.fs.stat(gitDir).then(
		() => {
			logToOutput('Git repository found', 'info')

			// Watch .git/HEAD for branch changes
			gitHeadWatcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(workspaceFolder, '.git/HEAD')
			)
			gitHeadWatcher.onDidChange(() => {
				logToOutput('Git checkout detected', 'info')
				sawHeadChange = true
				lastGitOperationTime = Date.now()
			})

			// Watch .git/refs for other git operations (pull, stash, etc.)
			gitRefsWatcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(workspaceFolder, '.git/refs/**/*')
			)
			gitRefsWatcher.onDidChange(() => {
				logToOutput('Git refs changed', 'info')
				lastGitOperationTime = Date.now()
			})
			gitRefsWatcher.onDidCreate(() => {
				logToOutput('Git refs created', 'info')
				lastGitOperationTime = Date.now()
			})
			gitRefsWatcher.onDidDelete(() => {
				logToOutput('Git refs deleted', 'info')
				lastGitOperationTime = Date.now()
			})

			logToOutput('Git provider initialized', 'info')
		},
		() => {
			logToOutput('Not a git repository', 'info')
		}
	)
}

function disposeWatchers(): void {
	gitHeadWatcher?.dispose()
	gitHeadWatcher = undefined
	gitRefsWatcher?.dispose()
	gitRefsWatcher = undefined
}

/**
 * Initialize the git provider
 */
export function initializeGitProvider(context: vscode.ExtensionContext): void {
	logToOutput('Initializing git provider...', 'info')

	setupGitWatchers()

	// Reinitialize on workspace changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			logToOutput('Workspace changed, reinitializing git provider...', 'info')
			setupGitWatchers()
		})
	)
}

/**
 * Reset git state
 */
export function resetGitState(): void {
	sawHeadChange = false
	lastGitOperationTime = 0
}

/**
 * Cleanup the git provider
 */
export function cleanupGitProvider(): void {
	disposeWatchers()
	resetGitState()
}
