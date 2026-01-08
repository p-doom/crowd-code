/**
 * Viewport Capture Module
 * Captures the current visible editor state (viewport content, cursor position, line ranges)
 */

import * as vscode from 'vscode'
import type { ViewportState, Observation } from '../types'
import { getActiveTerminalViewport } from './terminalCapture'

const POLL_INTERVAL_MS = 100 // 10Hz

let viewportChanged = false

let onObservationCallback: ((observation: Observation) => void) | null = null

let visibleRangesDisposable: vscode.Disposable | null = null
let pollInterval: NodeJS.Timeout | null = null

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
 * Capture a full observation (viewport + active terminal viewport)
 */
export function captureObservation(): Observation {
	const viewport = captureViewportState()
	const activeTerminal = getActiveTerminalViewport()

	return {
		viewport,
		activeTerminal
	}
}

/**
 * Poll handler - captures observation if viewport changed
 */
function pollViewport(): void {
	if (!viewportChanged) {
		return
	}
	viewportChanged = false

	if (!onObservationCallback) {
		return
	}

	onObservationCallback(captureObservation())
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
	viewportChanged = false
}

/**
 * Reset the observation state (useful when switching recordings)
 */
export function resetObservationState(): void {
	viewportChanged = false
}
