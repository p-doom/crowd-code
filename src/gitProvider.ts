import * as vscode from 'vscode'
import { recording, addToFileQueue, buildCsvRow, appendToFile } from './recording'
import { ChangeType } from './types'
import { isCurrentFileExported } from './recording'
import * as child_process from 'child_process'
import * as util from 'util'
import { logToOutput } from from './utilities'

interface LocalGitState {
    branch: string
    repository: string
}

let currentGitState: LocalGitState | null = null
let gitWatcherInitialized = false
let lastKnownBranch: string | null = null
let gitStateCheckInterval: NodeJS.Timeout | undefined

/**
 * Initializes the git detection using file system watchers and git commands
 */
export function initializeGitProvider(): void {
    logToOutput('Initializing git provider using file system watchers...', 'info')
    
    // Try to initialize immediately
    tryInitializeGitProvider().catch(error => {
        logToOutput(`Error in initial git provider initialization: ${error}`, 'error')
    })
    
    // Also try after a delay in case git is not ready yet
    setTimeout(() => {
        if (!gitWatcherInitialized) {
            logToOutput('Retrying git provider initialization...', 'info')
            tryInitializeGitProvider().catch(error => {
                logToOutput(`Error in retry git provider initialization: ${error}`, 'error')
            })
        }
    }, 2000)
    
    // Listen for workspace changes
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (!gitWatcherInitialized) {
            logToOutput('Workspace folders changed, retrying git provider initialization...', 'info')
            tryInitializeGitProvider().catch(error => {
                logToOutput(`Error in workspace change git provider initialization: ${error}`, 'error')
            })
        }
    })
}

/**
 * Attempts to initialize the git provider
 */
async function tryInitializeGitProvider(): Promise<void> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        if (!workspaceFolder) {
            logToOutput('No workspace folder found', 'info')
            return
        }
        
        // Check if this is a git repository
        const gitDir = vscode.Uri.joinPath(workspaceFolder.uri, '.git')
        try {
            await vscode.workspace.fs.stat(gitDir)
            logToOutput('Git repository found', 'info')
            
            // Get initial state
            updateGitState()
            
            // Set up periodic checking for branch changes
            gitStateCheckInterval = setInterval(() => {
                if (recording.isRecording) {
                    checkForBranchChanges()
                }
            }, 5000) // Check every 5 seconds when recording
            
            // Watch for changes in .git/HEAD file
            const gitHeadWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(workspaceFolder, '.git/HEAD')
            )
            
            gitHeadWatcher.onDidChange(() => {
                logToOutput('Git HEAD file changed, checking for branch checkout...', 'info')
                setTimeout(() => checkForBranchChanges(), 100) // Small delay to ensure file is written
            })
            
            gitWatcherInitialized = true
            logToOutput('Git provider initialized successfully', 'info')
        } catch (error) {
            logToOutput(`Not a git repository: {$error}`, 'error') 
        }
        
    } catch (error) {
        console.warn('Error initializing git provider:', error)
    }
}

/**
 * Checks for branch changes
 */
async function checkForBranchChanges(): Promise<void> {
    try {
        const newBranch = await getCurrentGitBranchFromCommand()
        if (newBranch && newBranch !== lastKnownBranch) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
            const repository = workspaceFolder?.uri.fsPath || 'unknown'
            
            const newState = { branch: newBranch, repository }
            
            if (lastKnownBranch) {
                logToOutput(`Branch checkout detected: ${lastKnownBranch} -> ${newBranch}`, 'info')
                handleBranchCheckout(newState, { branch: lastKnownBranch, repository })
            }
            
            lastKnownBranch = newBranch
            currentGitState = newState
        }
    } catch (error) {
        console.warn('Error checking for branch changes:', error)
    }
}

/**
 * Updates the current git state
 */
function updateGitState(): void {
    getCurrentGitBranchFromCommand().then(branchName => {
        if (branchName) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
            const repository = workspaceFolder?.uri.fsPath || 'unknown'
            
            const newState = { branch: branchName, repository }
            logToOutput(`Initial git state: ${newState}`, 'info')
            
            lastKnownBranch = branchName
            currentGitState = newState
        }
    }).catch(error => {
        console.warn('Error getting initial git branch:', error)
    })
}

/**
 * Gets the current git branch using git command
 */
async function getCurrentGitBranchFromCommand(): Promise<string | null> {
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        if (!workspaceFolder) {
            return null
        }
        
        const execAsync = util.promisify(child_process.exec)
        const { stdout } = await execAsync('git branch --show-current', { 
            cwd: workspaceFolder.uri.fsPath 
        })
        return stdout.trim()
    } catch (error) {
        console.warn('Error executing git command:', error)
        return null
    }
}

/**
 * Handles branch checkout events
 */
function handleBranchCheckout(newState: LocalGitState, previousState: LocalGitState): void {
    if (!recording.isRecording) {
        logToOutput('Not recording, skipping git checkout event', 'info')
        return
    }

    if (isCurrentFileExported()) {
        logToOutput('Current file is exported, skipping git checkout event', 'info')
        return
    }

    recording.sequence++
    const checkoutMessage = `Switched from branch '${previousState.branch}' to '${newState.branch}'`
    
    logToOutput(`Recording git checkout: ${checkoutMessage}`, 'info')
    
    addToFileQueue(
        buildCsvRow({
            sequence: recording.sequence,
            rangeOffset: 0,
            rangeLength: 0,
            text: checkoutMessage,
            type: ChangeType.GIT_BRANCH_CHECKOUT,
        })
    )
    appendToFile()
    
    // Reset the file cache since files might have different content on the new branch
    logToOutput('Resetting file cache due to branch checkout', 'info')
    if (recording.activatedFiles) {
        recording.activatedFiles.clear()
    }
}

/**
 * Cleanup function to stop the interval
 */
export function cleanupGitProvider(): void {
    if (gitStateCheckInterval) {
        clearInterval(gitStateCheckInterval)
        gitStateCheckInterval = undefined
    }
} 