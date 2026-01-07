/**
 * Viewport Capture Module
 * Captures the current visible editor state (viewport content, cursor position, line ranges)
 */

import * as vscode from 'vscode'
import * as crypto from 'crypto'
import type { ViewportState, Observation } from '../types'
import { getTerminalStates } from './terminalCapture'

const POLL_INTERVAL_MS = 100 // 10Hz

let lastObservationHash: string | null = null
let viewportChanged = false

let onObservationCallback: ((observation: Observation) => void) | null = null

let visibleRangesDisposable: vscode.Disposable | null = null
let pollInterval: NodeJS.Timeout | null = null

/**
 * Compute a hash of the viewport state for deduplication
 */
function computeObservationHash(observation: Observation): string {
	const data = JSON.stringify({
		viewport: observation.viewport,
		terminalIds: observation.activeTerminals.map(t => t.id)
	})
	return crypto.createHash('md5').update(data).digest('hex')
}

/**
 * Capture the current viewport state from the active editor
 */
export function captureViewportState(): ViewportState | null {
	const editor = vscode.window.activeTextEditor
	if (!editor) {
		return null
	}

	const document = editor.document
	const visibleRanges = editor.visibleRanges

	if (visibleRanges.length === 0) {
		return null
	}

	const firstRange = visibleRanges[0]
	const lastRange = visibleRanges[visibleRanges.length - 1]
	
	const startLine = firstRange.start.line
	const endLine = lastRange.end.line

	const fullVisibleRange = new vscode.Range(
		new vscode.Position(startLine, 0),
		new vscode.Position(endLine, document.lineAt(endLine).text.length)
	)

	const content = document.getText(fullVisibleRange)

	const selection = editor.selection
	const cursorPosition = selection ? {
		line: selection.active.line,
		character: selection.active.character
	} : null

	const file = vscode.workspace.asRelativePath(document.fileName)

	return {
		file,
		startLine: startLine + 1,
		endLine: endLine + 1,
		content,
		cursorPosition
	}
}

/**
 * Capture a full observation (viewport + terminal states)
 */
export function captureObservation(): Observation {
	const viewport = captureViewportState()
	const activeTerminals = getTerminalStates()

	return {
		viewport,
		activeTerminals
	}
}

/**
 * Capture an observation immediately (for user actions)
 * Returns null if observation is identical to last one (deduplication)
 */
export function captureNow(): Observation | null {
	const observation = captureObservation()
	const hash = computeObservationHash(observation)

	if (hash === lastObservationHash) return null

	lastObservationHash = hash
	return observation
}

/**
 * Poll handler - captures observation if viewport changed
 */
function pollViewport(): void {
	if (!viewportChanged) return
	viewportChanged = false

	if (!onObservationCallback) return

	const observation = captureObservation()
	const hash = computeObservationHash(observation)
	if (hash === lastObservationHash) return

	lastObservationHash = hash
	onObservationCallback(observation)
}

/**
 * Initialize the viewport capture module
 */
export function initializeViewportCapture(
	context: vscode.ExtensionContext,
	onScrollObservation: (observation: Observation) => void
): void {
	onObservationCallback = onScrollObservation

	visibleRangesDisposable = vscode.window.onDidChangeTextEditorVisibleRanges(() => {
		viewportChanged = true
	})
	context.subscriptions.push(visibleRangesDisposable)

	pollInterval = setInterval(pollViewport, POLL_INTERVAL_MS)
}

/**
 * Cleanup the viewport capture module
 */
export function cleanupViewportCapture(): void {
	if (visibleRangesDisposable) {
		visibleRangesDisposable.dispose()
		visibleRangesDisposable = null
	}
	if (pollInterval) {
		clearInterval(pollInterval)
		pollInterval = null
	}
	lastObservationHash = null
	viewportChanged = false
}

/**
 * Reset the observation state (useful when switching recordings)
 */
export function resetObservationState(): void {
	lastObservationHash = null
	viewportChanged = false
}
