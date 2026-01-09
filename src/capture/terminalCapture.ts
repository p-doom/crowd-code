/**
 * Terminal Viewport Capture Module
 * Captures the terminal viewport (last ~TERMINAL_VIEWPORT_LINES lines) to simulate human observation
 */

import * as vscode from 'vscode'

const TERMINAL_VIEWPORT_LINES = 20
const POLL_INTERVAL_MS = 100 // 10Hz

const terminalContent = new Map<string, string>()
const terminalNames = new Map<string, string>()

let terminalIdCounter = 0

const terminalIdMap = new WeakMap<vscode.Terminal, string>()

let activeTerminalId: string | null = null

let outputChanging = false
let terminalViewportChanged = false
let pollInterval: ReturnType<typeof setInterval> | null = null

let terminalFocusDisposable: vscode.Disposable | null = null
let terminalExecutionDisposable: vscode.Disposable | null = null
let terminalCloseDisposable: vscode.Disposable | null = null

let onViewportObservationCallback: ((viewport: TerminalViewport) => void) | null = null

export interface TerminalViewport {
	id: string
	name: string
	viewport: string[]
}

export interface TerminalCallbacks {
	onFocus: (terminalId: string, terminalName: string) => void
	onCommand: (terminalId: string, terminalName: string, command: string) => void
	onOutput: (terminalId: string, terminalName: string, output: string) => void
}

let onTerminalFocusCallback: ((terminalId: string, terminalName: string) => void) | null = null
let onTerminalCommandCallback: ((terminalId: string, terminalName: string, command: string) => void) | null = null
let onTerminalOutputCallback: ((terminalId: string, terminalName: string, output: string) => void) | null = null

/**
 * Get or create a unique ID for a terminal
 */
function getTerminalId(terminal: vscode.Terminal): string {
	let id = terminalIdMap.get(terminal)
	if (!id) {
		id = `terminal-${++terminalIdCounter}`
		terminalIdMap.set(terminal, id)
		terminalNames.set(id, terminal.name)
		terminalContent.set(id, '')
	}
	return id
}

/**
 * Extract the terminal viewport
 */
function extractViewport(terminalId: string): string[] {
	const content = terminalContent.get(terminalId)
	if (!content) {
		return []
	}
	const lines = content.split('\n')
	return lines.slice(-TERMINAL_VIEWPORT_LINES)
}

/**
 * Get the active terminal's viewport
 * Returns null if no terminal is focused
 */
export function getActiveTerminalViewport(): TerminalViewport | null {
	if (!activeTerminalId) {
		return null
	}

	const name = terminalNames.get(activeTerminalId)
	if (!name) {
		return null
	}

	return {
		id: activeTerminalId,
		name,
		viewport: extractViewport(activeTerminalId)
	}
}

/**
 * Append content to a terminal's buffer, keeping only the last TERMINAL_VIEWPORT_LINES lines
 */
function appendTerminalContent(terminalId: string, content: string): void {
	const existing = terminalContent.get(terminalId) ?? ''
	const combined = existing + content
	const lines = combined.split('\n')
	
	if (lines.length > TERMINAL_VIEWPORT_LINES) {
		terminalContent.set(terminalId, lines.slice(-TERMINAL_VIEWPORT_LINES).join('\n'))
	} else {
		terminalContent.set(terminalId, combined)
	}
	
	terminalViewportChanged = true
}

/**
 * Poll handler - captures terminal viewport if changed
 */
function pollTerminalViewport(): void {
	if (!activeTerminalId || !outputChanging || !terminalViewportChanged) {
		return
	}
	terminalViewportChanged = false

	if (!onViewportObservationCallback) {
		return
	}

	const viewport = getActiveTerminalViewport()
	if (!viewport) {
		return
	}

	onViewportObservationCallback(viewport)
}

/**
 * Initialize the terminal capture module
 */
export function initializeTerminalCapture(
	context: vscode.ExtensionContext,
	callbacks: TerminalCallbacks,
	onViewportObservation?: (viewport: TerminalViewport) => void
): void {
	onTerminalFocusCallback = callbacks.onFocus
	onTerminalCommandCallback = callbacks.onCommand
	onTerminalOutputCallback = callbacks.onOutput
	onViewportObservationCallback = onViewportObservation ?? null

	if (terminalExecutionDisposable) {
		return
	}

	terminalFocusDisposable = vscode.window.onDidChangeActiveTerminal((terminal) => {
		if (!terminal) {
			activeTerminalId = null
			return
		}

		const id = getTerminalId(terminal)
		const name = terminal.name
		terminalNames.set(id, name)
		activeTerminalId = id

		if (onViewportObservationCallback) {
			const viewport = getActiveTerminalViewport()
			if (viewport) {
				onViewportObservationCallback(viewport)
			}
		}

		if (onTerminalFocusCallback) {
			onTerminalFocusCallback(id, name)
		}
	})
	context.subscriptions.push(terminalFocusDisposable)

	terminalExecutionDisposable = vscode.window.onDidStartTerminalShellExecution(async (event) => {
		const terminal = event.terminal
		const id = getTerminalId(terminal)
		const name = terminal.name
		const command = event.execution.commandLine.value

		appendTerminalContent(id, `$ ${command}\n`)

		if (onTerminalCommandCallback) {
			onTerminalCommandCallback(id, name, command)
		}

		outputChanging = true

		// Read and capture output
		const stream = event.execution.read()
		for await (const data of stream) {
			appendTerminalContent(id, data)

			if (onTerminalOutputCallback) {
				onTerminalOutputCallback(id, name, data)
			}
		}

		outputChanging = false
	})
	context.subscriptions.push(terminalExecutionDisposable)

	terminalCloseDisposable = vscode.window.onDidCloseTerminal((terminal) => {
		const id = terminalIdMap.get(terminal)
		if (id) {
			terminalContent.delete(id)
			terminalNames.delete(id)
			if (activeTerminalId === id) {
				activeTerminalId = null
			}
		}
	})
	context.subscriptions.push(terminalCloseDisposable)

	for (const terminal of vscode.window.terminals) {
		getTerminalId(terminal)
	}

	if (vscode.window.activeTerminal) {
		activeTerminalId = getTerminalId(vscode.window.activeTerminal)
	}

	pollInterval = setInterval(pollTerminalViewport, POLL_INTERVAL_MS)
}

/**
 * Cleanup the terminal capture module
 */
export function cleanupTerminalCapture(): void {
	if (terminalFocusDisposable) {
		terminalFocusDisposable.dispose()
		terminalFocusDisposable = null
	}
	if (terminalExecutionDisposable) {
		terminalExecutionDisposable.dispose()
		terminalExecutionDisposable = null
	}
	if (terminalCloseDisposable) {
		terminalCloseDisposable.dispose()
		terminalCloseDisposable = null
	}
	if (pollInterval) {
		clearInterval(pollInterval)
		pollInterval = null
	}

	terminalContent.clear()
	terminalNames.clear()
	activeTerminalId = null
	outputChanging = false
	terminalViewportChanged = false
	terminalIdCounter = 0
}

/**
 * Reset terminal state (useful when starting a new recording)
 */
export function resetTerminalState(): void {
	for (const id of terminalContent.keys()) {
		terminalContent.set(id, '')
	}
	terminalViewportChanged = false
}
