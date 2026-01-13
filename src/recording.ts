/**
 * Recording Orchestrator for crowd-code 2.0
 * Integrates viewport, terminal, filesystem, and deduplication modules
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
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
	RecordingChunk,
	Observation,
	Action,
	EditAction,
	EditReason,
	SelectionAction,
	TabSwitchAction,
	TerminalFocusAction,
	TerminalCommandAction,
	FileChangeAction,
	WorkspaceSnapshotEvent,
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
	getFileCacheSnapshot,
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
let saveIntervalId: NodeJS.Timeout | null = null
let saveInFlight: Promise<void> | null = null
let timer = 0
let previousFile: string | null = null
let panicStatusBarItem: vscode.StatusBarItem | undefined
let panicButtonPressCount = 0
let panicButtonTimeoutId: NodeJS.Timeout | undefined
let chunkIndex = 0

const CROWD_CODE_API_GATEWAY_URL = process.env.CROWD_CODE_API_GATEWAY_URL
const PANIC_BUTTON_TIMEOUT = 3000
const MAX_BUFFER_SIZE_PER_FILE = 1000 // Prevent unbounded growth
const PERIODIC_SAVE_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
const SNAPSHOT_PART_SIZE_BYTES = 5 * 1024 * 1024 // 5MB gateway-safe part size

interface PendingEdit {
	rangeOffset: number
	rangeLength: number
	text: string
}
const pendingUserEdits = new Map<string, PendingEdit[]>()

// Flag to track pending edit observation (set by handleTextDocumentChange, cleared by handleSelectionChange)
// This coordinates the two handlers: edit logs action, then selection captures observation
let pendingEditFile: string | null = null

// Agent batch tracking for workspace snapshots
// Reset on any user action
let agentBatchActive = false

const gzipAsync = promisify(gzip)
let snapshotCounter = 0

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

/**
 * Write a compressed snapshot to disk and upload parts
 * Returns the snapshot ID for reference in events
 */
async function writeCompressedSnapshot(
	baseFolder: string,
	snapshot: Record<string, string>
): Promise<string> {
	snapshotCounter++
	const snapshotId = `snapshot_${String(snapshotCounter).padStart(3, '0')}`

	const snapshotsDir = path.join(baseFolder, 'snapshots')
	if (!fs.existsSync(snapshotsDir)) {
		fs.mkdirSync(snapshotsDir, { recursive: true })
	}

	const json = JSON.stringify(snapshot)
	const compressed = await gzipAsync(json, { level: 6 })
	const filePath = path.join(snapshotsDir, `${snapshotId}.json.gz`)

	const exportPath = getExportPath()
	await writeAndUploadSnapshotParts(filePath, compressed, exportPath)
	return snapshotId
}

async function writeAndUploadSnapshotParts(
	filePath: string,
	compressed: Buffer,
	exportPath: string | undefined
): Promise<void> {
	let partIndex = 1
	for (let offset = 0; offset < compressed.length; offset += SNAPSHOT_PART_SIZE_BYTES) {
		const chunk = compressed.subarray(offset, offset + SNAPSHOT_PART_SIZE_BYTES)
		const partPath = `${filePath}.part${String(partIndex).padStart(3, '0')}`
		await fs.promises.writeFile(partPath, chunk)

		// Upload part immediately after writing
		if (exportPath) {
			const relativePath = path.relative(exportPath, partPath)
			await uploadGzipFile(partPath, relativePath)
		}
		partIndex++
	}
}

/**
 * Heuristic to check if content is text
 * Binary files contain null bytes, text files don't
 */
function isTextContent(content: string): boolean {
	return !content.includes('\0')
}

/**
 * Log a workspace snapshot capturing the before-state of all files
 * Called on first agent edit in a batch to be able to reconstruct what the LLM saw
 */
async function logWorkspaceSnapshot(changedFile: string, oldContent: string): Promise<void> {
	if (!recording.isRecording || !recording.startDateTime) {return}

	const snapshot = getFileCacheSnapshot()
	const beforeState: Record<string, string> = {}

	for (const [filePath, content] of snapshot) {
		if (isTextContent(content)) {
			beforeState[filePath] = content
		}
	}

	beforeState[changedFile] = oldContent

	const exportPath = getExportPath()
	if (!exportPath) {return}

	const baseFilePath = generateBaseFilePath(
		recording.startDateTime,
		false,
		undefined,
		recording.sessionId
	)
	if (!baseFilePath) {return}

	const baseFolder = path.join(exportPath, path.dirname(baseFilePath))
	const snapshotId = await writeCompressedSnapshot(baseFolder, beforeState)

	recording.sequence++
	const event: WorkspaceSnapshotEvent = {
		sequence: recording.sequence,
		timestamp: Date.now(),
		type: 'workspace_snapshot',
		snapshotId,
	}
	recording.events.push(event)
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

	// User activity resets agent batch
	agentBatchActive = false

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

	// User activity resets agent batch
	agentBatchActive = false

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

	// User activity resets agent batch
	agentBatchActive = false

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

	// User activity resets agent batch
	agentBatchActive = false

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

	// User activity resets agent batch
	agentBatchActive = false

	const action: TerminalCommandAction = {
		kind: 'terminal_command',
		source: 'user',
		terminalId,
		terminalName,
		command,
	}

	logActionAndObservation(action)
}


export async function handleFileChange(
	file: string,
	changeType: 'create' | 'change' | 'delete',
	oldContent: string | null,
	newContent: string | null
): Promise<void> {
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

	const maybeSnapshotAgentBatch = async (): Promise<void> => {
		if (!agentBatchActive && oldContent !== null) {
			agentBatchActive = true
			await logWorkspaceSnapshot(file, oldContent)
		}
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
		if (source === 'agent') {
			await maybeSnapshotAgentBatch()
		}
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
		await maybeSnapshotAgentBatch()
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
	agentBatchActive = false
	snapshotCounter = 0
	chunkIndex = 0

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

	// Periodic save and upload
	saveIntervalId = setInterval(() => {
		if (saveInFlight) {return}
		saveInFlight = saveAndUploadChunk(true).finally(() => {
			saveInFlight = null
		})
	}, PERIODIC_SAVE_INTERVAL_MS)

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
	if (saveIntervalId) {
		clearInterval(saveIntervalId)
		saveIntervalId = null
	}
    if (panicButtonTimeoutId) {
        clearTimeout(panicButtonTimeoutId)
        panicButtonTimeoutId = undefined
    }
	agentBatchActive = false

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

	// Save and upload final chunk
	if (saveInFlight) {
		await saveInFlight
	}
	await saveAndUploadChunk()

    notificationWithProgress('Recording finished')
	logToOutput('Recording finished (v2.0)', 'info')
}


/**
 * Save current events as a compressed chunk file.
 * Returns the file path of the saved chunk, or null if nothing was saved.
 */
async function saveChunk(log = true): Promise<string | null> {
	// Skip if no events to save
	if (recording.events.length === 0) {
		return null
	}

	const exportPath = getExportPath()
	if (!exportPath) {
		if (log) {
			logToOutput('Cannot save chunk: no export path configured', 'error')
		}
		return null
	}
	if (!recording.startDateTime) {
		if (log) {
			logToOutput('Cannot save chunk: no start time', 'error')
		}
		return null
	}

	const baseFilePath = generateBaseFilePath(recording.startDateTime, false, undefined, recording.sessionId)
	if (!baseFilePath) {
		if (log) {
			logToOutput('Cannot save chunk: failed to generate file path', 'error')
		}
		return null
	}

	const chunk: RecordingChunk = {
		version: '2.0',
		sessionId: recording.sessionId,
		startTime: recording.startDateTime.getTime(),
		chunkIndex,
		events: recording.events,
	}

	const jsonContent = JSON.stringify(chunk)
	const chunkFileName = `${baseFilePath}_chunk_${String(chunkIndex).padStart(3, '0')}.json.gz`
	const filePath = path.join(exportPath, chunkFileName)

	try {
		const directory = path.dirname(filePath)
		if (!fs.existsSync(directory)) {
			fs.mkdirSync(directory, { recursive: true })
		}

		const compressed = await gzipAsync(jsonContent, { level: 6 })
		await fs.promises.writeFile(filePath, compressed)

		if (log) {
			logToOutput(`Chunk ${chunkIndex} saved to ${filePath} (${recording.events.length} events)`, 'info')
		}

		// Clear events and increment chunk counter after successful save
		recording.events = []
		chunkIndex++

		// Refresh the recordFiles view
		vscode.commands.executeCommand('crowd-code.refreshRecordFiles')

		return filePath
	} catch (err) {
		logToOutput(`Failed to save chunk: ${err}`, 'error')
		return null
	}
}

/**
 * Upload a compressed file (chunk or snapshot part) using S3 presigned URLs.
 * Two-step process: 1) Request presigned URL from Lambda, 2) Upload directly to S3
 */
async function uploadGzipFile(filePath: string, relativePath: string): Promise<void> {
	if (!hasConsent()) {return}
	if (typeof CROWD_CODE_API_GATEWAY_URL !== 'string' || !CROWD_CODE_API_GATEWAY_URL.trim()) {
		return
	}

	try {
		const compressedData = await fs.promises.readFile(filePath)

		const extensionVersion = extContext.extension.packageJSON.version as string
		const userId = extContext.globalState.get<string>('userId')

		const response = await axios.post(CROWD_CODE_API_GATEWAY_URL, {
			fileName: relativePath,
			version: extensionVersion,
			userId: userId ?? '',
		}, {
			headers: {
				'Content-Type': 'application/json',
			},
			timeout: 10000,
		})

		const { uploadUrl } = response.data
		if (!uploadUrl || typeof uploadUrl !== 'string') {
			throw new Error('Invalid presigned URL received from server')
		}

		await axios.put(uploadUrl, compressedData, {
			headers: {
				'Content-Type': 'application/gzip',
			},
			timeout: 60000,
			maxBodyLength: Infinity,
			maxContentLength: Infinity,
		})

		logToOutput(`Successfully uploaded: ${relativePath}`, 'info')
	} catch (error: unknown) {
		if (axios.isAxiosError(error)) {
			if (error.response) {
				logToOutput(`Error uploading ${relativePath}: ${error.response.status} - ${error.response.data}`, 'error')
			} else if (error.request) {
				logToOutput(`Error uploading ${relativePath}: No response received`, 'error')
			} else {
				logToOutput(`Error uploading ${relativePath}: ${error.message}`, 'error')
			}
		} else {
			logToOutput(`Error uploading ${relativePath}: ${error}`, 'error')
		}
	}
}

/**
 * Save current events as a chunk and immediately upload it.
 * This is the main entry point for periodic saves.
 */
async function saveAndUploadChunk(log = true): Promise<void> {
	const chunkFilePath = await saveChunk(log)
	if (chunkFilePath) {
		const exportPath = getExportPath()
		if (exportPath) {
			const relativePath = path.relative(exportPath, chunkFilePath)
			await uploadGzipFile(chunkFilePath, relativePath)
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
