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
    console.log('Initializing git provider using file system watchers...')
    
    // Try to initialize immediately
    tryInitializeGitProvider().catch(error => {
        console.warn('Error in initial git provider initialization:', error)
    })
    
    // Also try after a delay in case git is not ready yet
    setTimeout(() => {
        if (!gitWatcherInitialized) {
            logToOutput('Retrying git provider initialization...', 'info')
            tryInitializeGitProvider().catch(error => {
                console.warn('Error in retry git provider initialization:', error)
            })
        }
    }, 2000)
    
    // Listen for workspace changes
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (!gitWatcherInitialized) {
            console.log('Workspace folders changed, retrying git provider initialization...')
            tryInitializeGitProvider().catch(error => {
                console.warn('Error in workspace change git provider initialization:', error)
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
            console.log('No workspace folder found')
            return
        }
        
        // Check if this is a git repository
        const gitDir = vscode.Uri.joinPath(workspaceFolder.uri, '.git')
        try {
            await vscode.workspace.fs.stat(gitDir)
            console.log('Git repository found')
            
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
                console.log('Git HEAD file changed, checking for branch checkout...')
                setTimeout(() => checkForBranchChanges(), 100) // Small delay to ensure file is written
            })
            
            gitWatcherInitialized = true
            console.log('Git provider initialized successfully')
        } catch (error) {
            console.log('Not a git repository:', error)
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
                console.log(`Branch checkout detected: ${lastKnownBranch} -> ${newBranch}`)
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
            console.log('Initial git state:', newState)
            
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
        console.log('Not recording, skipping git checkout event')
        return
    }

    if (isCurrentFileExported()) {
        console.log('Current file is exported, skipping git checkout event')
        return
    }

    recording.sequence++
    const checkoutMessage = `Switched from branch '${previousState.branch}' to '${newState.branch}'`
    
    console.log('Recording git checkout:', checkoutMessage)
    
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
    console.log('Resetting file cache due to branch checkout')
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