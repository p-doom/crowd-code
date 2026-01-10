/**
 * Recording Orchestrator for crowd-code 2.0
 * Integrates viewport, terminal, filesystem, and deduplication modules
 * Implements the observation-action paradigm
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import axios from 'axios'
import { createTwoFilesPatch } from 'diff'
import { hasConsent } from './consent'
import {
    notificationWithProgress,
    generateBaseFilePath,
    formatDisplayTime,
    getExportPath,
    logToOutput,
    getConfig,
    addToGitignore,
} from './utilities'
import type {
	RecordingState,
	RecordingEvent,
	RecordingSession,
	Observation,
	Action,
	EditAction,
	EditReason,
	SelectionAction,
	TabSwitchAction,
	TerminalFocusAction,
	TerminalCommandAction,
	FileChangeAction,
} from './types'
import { extContext, statusBarItem, actionsProvider } from './extension'
import {
	captureObservation,
	resetObservationState,
	resetViewportChanged,
	resetTerminalState,
	initializeViewportCapture,
	initializeTerminalCapture,
	initializeFilesystemWatcher,
	resetFilesystemState,
	TerminalViewport,
} from './capture'
import { getRecentGitOperation, resetGitState } from './gitProvider'

export const recording: RecordingState = {
	isRecording: false,
	startDateTime: null,
	endDateTime: null,
	sequence: 0,
	sessionId: vscode.env.sessionId,
	events: [],
}


export const commands = {
    openSettings: 'crowd-code.openSettings',
    startRecording: 'crowd-code.startRecording',
    stopRecording: 'crowd-code.stopRecording',
    panicButton: 'crowd-code.panicButton',
}


let intervalId: NodeJS.Timeout | null = null
let uploadIntervalId: NodeJS.Timeout | null = null
let timer = 0
let previousFile: string | null = null
let panicStatusBarItem: vscode.StatusBarItem | undefined
let panicButtonPressCount = 0
let panicButtonTimeoutId: NodeJS.Timeout | undefined

const CROWD_CODE_API_GATEWAY_URL = process.env.CROWD_CODE_API_GATEWAY_URL
const PANIC_BUTTON_TIMEOUT = 3000
const MAX_BUFFER_SIZE_PER_FILE = 1000 // Prevent unbounded growth

interface PendingEdit {
	rangeOffset: number
	rangeLength: number
	text: string
}
const pendingUserEdits = new Map<string, PendingEdit[]>()

// Flag to track pending edit observation (set by handleTextDocumentChange, cleared by handleSelectionChange)
// This coordinates the two handlers: edit logs action, then selection captures observation
let pendingEditFile: string | null = null

// Disposables for event subscriptions
const subscriptions: vscode.Disposable[] = []


function logObservation(observation: Observation): void {
	if (!recording.isRecording) {return}

	recording.sequence++
	const event: RecordingEvent = {
		sequence: recording.sequence,
		timestamp: Date.now(),
		type: 'observation',
		observation,
	}
	recording.events.push(event)
}

function logAction(action: Action): void {
	if (!recording.isRecording) {return}

	recording.sequence++
	const event: RecordingEvent = {
		sequence: recording.sequence,
		timestamp: Date.now(),
		type: 'action',
		action,
	}
	recording.events.push(event)
}

/**
 * Log an action followed by an observation (the standard pattern for user actions)
 * The observation captures the state AFTER the action was taken.
 * To reconstruct: Observation(N-1) + Action(N) → Observation(N)
 */
function logActionAndObservation(action: Action): void {
	logAction(action)
	logObservation(captureObservation())
	resetViewportChanged()
}

export function isCurrentFileExported(): boolean {
    const editor = vscode.window.activeTextEditor
    const filename = editor?.document.fileName.replaceAll('\\', '/')
    const exportPath = getExportPath()
    if (!editor || !filename || !exportPath) {
        return false
    }
    return filename.startsWith(exportPath)
}

/**
 * Check if a change range is within the visible viewport
 * User edits must be within viewport; edits outside are from agents
 */
function isChangeWithinViewport(
	changeRange: vscode.Range,
	visibleRanges: readonly vscode.Range[]
): boolean {
	return visibleRanges.some(visible =>
		visible.contains(changeRange.start) || visible.contains(changeRange.end)
	)
}

/**
 * Apply user edits to content to reconstruct what the file would look like
 * if only the user had edited it (no agent changes)
 */
function applyUserEdits(content: string, edits: PendingEdit[]): string {
	let result = content
	for (const edit of edits) {
		result = result.slice(0, edit.rangeOffset)
			+ edit.text
			+ result.slice(edit.rangeOffset + edit.rangeLength)
	}
	return result
}

/**
 * Compute the agent-only diff by comparing user baseline to actual new content
 */
function computeAgentOnlyDiff(
	oldContent: string,
	newContent: string,
	userEdits: PendingEdit[],
	filePath: string
): string | null {
	const userBaseline = applyUserEdits(oldContent, userEdits)

	if (userBaseline === newContent) {
		return null // No agent changes
	}

	const fileName = path.basename(filePath)
	return createTwoFilesPatch(
		`a/${fileName}`,
		`b/${fileName}`,
		userBaseline,
		newContent,
		'',
		'',
		{ context: 3 }
	)
}

function handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): void {
	if (!recording.isRecording) {return}
	if (isCurrentFileExported()) {return}
	if (event.document.uri.scheme !== 'file') {return}

	const editor = vscode.window.activeTextEditor

	// Must be active document to be a user edit
	if (!editor || event.document !== editor.document) {return}

	const visibleRanges = editor.visibleRanges
	const file = vscode.workspace.asRelativePath(event.document.fileName)

	let reason: EditReason
	if (event.reason === vscode.TextDocumentChangeReason.Undo) {
		reason = 'undo'
	} else if (event.reason === vscode.TextDocumentChangeReason.Redo) {
		reason = 'redo'
	}

	for (const change of event.contentChanges) {
		// Drop changes outside viewport, these will be captured by filesystem watcher
		if (!isChangeWithinViewport(change.range, visibleRanges)) {
			continue
		}

		// This is a user edit, record it
		const action: EditAction = {
			kind: 'edit',
			source: 'user',
			file,
			diff: {
				rangeOffset: change.rangeOffset,
				rangeLength: change.rangeLength,
				text: change.text,
			},
			reason,
		}

		// Log action only (observation will be captured by handleSelectionChange)
		// when VS Code fires onDidChangeTextEditorSelection (after visibleRanges and selection are updated VS-Code-internally)
		logAction(action)
		pendingEditFile = file

		// Add to pending edits buffer for correlation with FS_CHANGE
		const pendingEdit: PendingEdit = {
			rangeOffset: change.rangeOffset,
			rangeLength: change.rangeLength,
			text: change.text,
		}
		const edits = pendingUserEdits.get(file) ?? []
		if (edits.length < MAX_BUFFER_SIZE_PER_FILE) {
			edits.push(pendingEdit)
			pendingUserEdits.set(file, edits)
		}
	}

	actionsProvider.setCurrentFile(event.document.fileName)
}

function handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
	if (!recording.isRecording) {return}
	if (event.textEditor !== vscode.window.activeTextEditor) {return}
	if (isCurrentFileExported()) {return}

	const editor = event.textEditor
	const selection = event.selections[0]
	if (!selection) {return}

	const file = vscode.workspace.asRelativePath(editor.document.fileName)

	// Check if this selection change is completing a pending edit action
	// This means that this selection event is simply a consequence of an edit event
	// VS Code fires: onDidChangeTextDocument → onDidChangeTextEditorSelection
	// We logged the edit action earlier, now capture the observation with correct state
	if (pendingEditFile === file) {
		pendingEditFile = null
		logObservation(captureObservation())
		resetViewportChanged()
		actionsProvider.setCurrentFile(editor.document.fileName)
		return
	}

	// This is an intentional navigation (click, arrow keys, search, etc.)
	const selectedText = editor.document.getText(selection)

	const action: SelectionAction = {
		kind: 'selection',
		source: 'user',
		file,
		selectionStart: {
			line: selection.start.line,
			character: selection.start.character,
		},
		selectionEnd: {
			line: selection.end.line,
			character: selection.end.character,
		},
		selectedText,
	}

	logActionAndObservation(action)
	actionsProvider.setCurrentFile(editor.document.fileName)
}

function handleActiveEditorChange(editor: vscode.TextEditor | undefined): void {
	updateStatusBarItem()
	
	if (!recording.isRecording) {return}
	if (!editor) {return}
	if (isCurrentFileExported()) {return}

	const file = vscode.workspace.asRelativePath(editor.document.fileName)

	const action: TabSwitchAction = {
		kind: 'tab_switch',
		source: 'user',
		file,
		previousFile,
	}

	logActionAndObservation(action)
	
	previousFile = file
	actionsProvider.setCurrentFile(editor.document.fileName)
}

function handleTerminalFocus(terminalId: string, terminalName: string): void {
	if (!recording.isRecording) {return}
	if (isCurrentFileExported()) {return}

	const action: TerminalFocusAction = {
		kind: 'terminal_focus',
		source: 'user',
		terminalId,
		terminalName,
	}

	logActionAndObservation(action)
	actionsProvider.setCurrentFile(`Terminal: ${terminalName}`)
}

function handleTerminalCommand(terminalId: string, terminalName: string, command: string): void {
	if (!recording.isRecording) {return}
	if (isCurrentFileExported()) {return}

	const action: TerminalCommandAction = {
		kind: 'terminal_command',
		source: 'user',
		terminalId,
		terminalName,
		command,
	}

	logActionAndObservation(action)
}


export function handleFileChange(
	file: string,
	changeType: 'create' | 'change' | 'delete',
	oldContent: string | null,
	newContent: string | null
): void {
	if (!recording.isRecording) {return}

	const relativePath = vscode.workspace.asRelativePath(file)

	// Helper to compute full diff
	const computeFullDiff = (): string | null => {
		if (!oldContent && !newContent) {return null}
		if (oldContent === newContent) {return null}
		const fileName = path.basename(file)
		return createTwoFilesPatch(
			`a/${fileName}`,
			`b/${fileName}`,
			oldContent ?? '',
			newContent ?? '',
			'',
			'',
			{ context: 3 }
		)
	}

	// Check for git operation first
	const gitOperation = getRecentGitOperation()
	if (gitOperation) {
		pendingUserEdits.clear()
		const action: FileChangeAction = {
			kind: 'file_change',
			source: gitOperation,
			file: relativePath,
			changeType,
			diff: computeFullDiff(),
		}
		logActionAndObservation(action)
		return
	}

	const pending = pendingUserEdits.get(relativePath)

	// If no pending edits or missing content, record full diff
	// Use 'unknown' for create/delete, 'agent' for modifications (unlikely to be from user)
	if (!pending || pending.length === 0 || oldContent === null || newContent === null) {
		const source = (changeType === 'create' || changeType === 'delete') ? 'unknown' : 'agent'
		const action: FileChangeAction = {
			kind: 'file_change',
			source,
			file: relativePath,
			changeType,
			diff: computeFullDiff(),
		}
		logActionAndObservation(action)
		pendingUserEdits.delete(relativePath)
		return
	}

	// Three-way diff: compute agent-only changes
	const agentDiff = computeAgentOnlyDiff(oldContent, newContent, pending, file)

	// Only record if there's remaining agent diff
	if (agentDiff) {
		const action: FileChangeAction = {
			kind: 'file_change',
			source: 'agent',
			file: relativePath,
			changeType,
			diff: agentDiff,
		}
		logActionAndObservation(action)
	}

	pendingUserEdits.delete(relativePath)
}

function handleScrollObservation(observation: Observation): void {
	if (!recording.isRecording) {return}

	const editor = vscode.window.activeTextEditor
	if (!editor) {return}

	logObservation(observation)
}

function handleTerminalViewportChange(_viewport: TerminalViewport): void {
	if (!recording.isRecording) {return}

	logObservation(captureObservation())
	resetViewportChanged()
}

function createRecordingFolder(folderPath: string): void {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true })
    }
}

export async function startRecording(): Promise<void> {
    if (recording.isRecording) {
        notificationWithProgress('Already recording')
        logToOutput('Already recording', 'info')
        return
    }

    const exportPath = getExportPath()
    if (!exportPath) {
        return
    }

	// Add to gitignore if configured
    if (
        getConfig().get<boolean>('export.addToGitignore') &&
        getConfig().get<string>('export.exportPath')?.startsWith('${workspaceFolder}')
    ) {
        await addToGitignore()
    }

	// Initialize recording state
    recording.startDateTime = new Date()
	recording.endDateTime = null
	recording.sequence = 0
	recording.events = []
	recording.sessionId = vscode.env.sessionId
	previousFile = null
	pendingEditFile = null
	panicButtonPressCount = 0
	timer = 0

	// Reset capture module states
	resetObservationState()
	resetTerminalState()
	resetFilesystemState()
	resetGitState()
	pendingUserEdits.clear()

	// Create recording folder
	const baseFilePath = generateBaseFilePath(recording.startDateTime, false, undefined, recording.sessionId)
    if (!baseFilePath) {
        return
    }
    const folderPath = path.dirname(path.join(exportPath, baseFilePath))
    createRecordingFolder(folderPath)

	// Initialize capture modules with callbacks
	initializeViewportCapture(extContext, handleScrollObservation)
	initializeTerminalCapture(extContext, {
		onFocus: handleTerminalFocus,
		onCommand: handleTerminalCommand,
	}, handleTerminalViewportChange)
	await initializeFilesystemWatcher(extContext, handleFileChange)

	// Subscribe to VS Code events
	subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(handleTextDocumentChange)
	)
	subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(handleSelectionChange)
	)
	subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(handleActiveEditorChange)
	)

    recording.isRecording = true

	// Start timer
    intervalId = setInterval(() => {
		timer++
        updateStatusBarItem()
    }, 1000)

	// Capture initial observation
	const initialObservation = captureObservation()
	logObservation(initialObservation)

	// Set up upload interval
	uploadIntervalId = setInterval(async () => {
		await uploadRecording()
	}, 5 * 60 * 1000) // 5 minutes

    notificationWithProgress('Recording started')
	logToOutput('Recording started (v2.0)', 'info')

    updateStatusBarItem()
    updatePanicButton()
    actionsProvider.setRecordingState(true)

	// Set current file
	const editor = vscode.window.activeTextEditor
	if (editor) {
		previousFile = vscode.workspace.asRelativePath(editor.document.fileName)
		actionsProvider.setCurrentFile(editor.document.fileName)
                }
            }

export async function stopRecording(force = false): Promise<void> {
    if (!recording.isRecording) {
        notificationWithProgress('Not recording')
        return
    }

    recording.isRecording = false
	recording.endDateTime = new Date()

	// Clear intervals
	if (intervalId) {
    clearInterval(intervalId)
		intervalId = null
	}
	if (uploadIntervalId) {
		clearInterval(uploadIntervalId)
		uploadIntervalId = null
	}
    if (panicButtonTimeoutId) {
        clearTimeout(panicButtonTimeoutId)
        panicButtonTimeoutId = undefined
    }

	// Dispose subscriptions
	for (const subscription of subscriptions) {
		subscription.dispose()
	}
	subscriptions.length = 0

	timer = 0
	panicButtonPressCount = 0

    updateStatusBarItem()
    updatePanicButton()
    actionsProvider.setRecordingState(false)

    if (force) {
        notificationWithProgress('Recording cancelled')
        logToOutput('Recording cancelled', 'info')
		recording.events = []
        return
    }

	// Save recording
	await saveRecording()

    notificationWithProgress('Recording finished')
	logToOutput('Recording finished (v2.0)', 'info')
}


async function saveRecording(): Promise<void> {
	const exportPath = getExportPath()
	if (!exportPath || !recording.startDateTime) {
        return
    }

	const baseFilePath = generateBaseFilePath(recording.startDateTime, false, undefined, recording.sessionId)
	if (!baseFilePath) {
        return
    }

	const session: RecordingSession = {
		version: '2.0',
		sessionId: recording.sessionId,
		startTime: recording.startDateTime.getTime(),
		events: recording.events,
	}

	const jsonContent = JSON.stringify(session, null, 2)
	const filePath = path.join(exportPath, `${baseFilePath}.json`)

        try {
            const directory = path.dirname(filePath)
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true })
            }
		await fs.promises.writeFile(filePath, jsonContent)
		logToOutput(`Recording saved to ${filePath}`, 'info')
        } catch (err) {
		logToOutput(`Failed to save recording: ${err}`, 'error')
}

	// Refresh the recordFiles view
	vscode.commands.executeCommand('crowd-code.refreshRecordFiles')
}

async function uploadRecording(): Promise<void> {
	if (!recording.isRecording) {return}
	if (!hasConsent()) {return}
	if (typeof CROWD_CODE_API_GATEWAY_URL !== 'string' || !CROWD_CODE_API_GATEWAY_URL.trim()) {
        return
    }

    const exportPath = getExportPath()
	if (!exportPath || !recording.startDateTime) {
        return
    }

	const baseFilePath = generateBaseFilePath(recording.startDateTime, false, undefined, recording.sessionId)
	if (!baseFilePath) {
        return
    }

	const session: RecordingSession = {
		version: '2.0',
		sessionId: recording.sessionId,
		startTime: recording.startDateTime.getTime(),
		events: recording.events,
	}

	const jsonContent = JSON.stringify(session)
	const extensionVersion = extContext.extension.packageJSON.version as string
	const userId = extContext.globalState.get<string>('userId')

	try {
		const payload = {
			fileName: `${baseFilePath}.json`,
			content: jsonContent,
			version: extensionVersion,
			userId,
		}
		await axios.post(CROWD_CODE_API_GATEWAY_URL, payload)
		logToOutput(`Successfully uploaded recording`, 'info')
	} catch (error: unknown) {
		if (axios.isAxiosError(error)) {
			logToOutput(`Error uploading recording: ${error.message}`, 'error')
		}
	}
}


export function updateStatusBarItem(): void {
    if (recording.isRecording) {
        if (getConfig().get('appearance.showTimer') === false) {
            statusBarItem.text = '$(debug-stop)'
			statusBarItem.tooltip = 'Current time: ' + formatDisplayTime(timer)
		} else {
			statusBarItem.text = '$(debug-stop) ' + formatDisplayTime(timer)
            statusBarItem.tooltip = 'Stop Recording'
        }
        statusBarItem.command = commands.stopRecording
        statusBarItem.show()
    } else {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
            statusBarItem.hide()
            return
        }
        if (getConfig().get('appearance.minimalMode') === true) {
            statusBarItem.text = '$(circle-large-filled)'
        } else {
            statusBarItem.text = '$(circle-large-filled) Start Recording'
        }
        statusBarItem.tooltip = 'Start Recording'
        statusBarItem.command = commands.startRecording
        statusBarItem.show()
    }
}


export function updatePanicButton(): void {
    if (!recording.isRecording) {
        if (panicStatusBarItem) {
            panicStatusBarItem.hide()
        }
        return
    }

    if (!panicStatusBarItem) {
		panicStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 8999)
        extContext.subscriptions.push(panicStatusBarItem)
    }

	const secondsToRemove = (panicButtonPressCount + 1) * 10
    panicStatusBarItem.text = '$(refresh)'
	panicStatusBarItem.tooltip = `Remove last ${secondsToRemove} seconds of recording`
    panicStatusBarItem.command = commands.panicButton
    panicStatusBarItem.show()
}

export async function panicButton(): Promise<void> {
    if (!recording.isRecording) {
        vscode.window.showWarningMessage('No active recording to remove data from')
        return
    }

    if (!recording.startDateTime) {
        vscode.window.showErrorMessage('Recording start time not available')
        return
    }

	const secondsToRemove = (panicButtonPressCount + 1) * 10
	const cutoffTime = Date.now() - (secondsToRemove * 1000)

	// Remove events after cutoff time
	const originalCount = recording.events.length
	recording.events = recording.events.filter(event => event.timestamp < cutoffTime)
	const removedCount = originalCount - recording.events.length

	// Update sequence to match
	if (recording.events.length > 0) {
		recording.sequence = recording.events[recording.events.length - 1].sequence
	} else {
		recording.sequence = 0
	}

        panicButtonPressCount++
        
	// Reset timeout
        if (panicButtonTimeoutId) {
            clearTimeout(panicButtonTimeoutId)
        }
        panicButtonTimeoutId = setTimeout(() => {
            panicButtonPressCount = 0
            updatePanicButton()
        }, PANIC_BUTTON_TIMEOUT)
        
        updatePanicButton()
                
                vscode.window.showInformationMessage(
		`Removed ${removedCount} events (last ${secondsToRemove} seconds)`,
                    'Dismiss'
                )
            }
