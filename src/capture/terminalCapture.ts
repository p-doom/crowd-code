/**
 * Terminal History Capture Module
 * Maintains per-terminal buffers of recent commands and outputs
 */

import * as vscode from 'vscode'
import type { TerminalState, TerminalEntry } from '../types'

// Configuration
const MAX_ENTRIES_PER_TERMINAL = 50
const MAX_OUTPUT_SIZE_BYTES = 100 * 1024 // 100KB per terminal

// Per-terminal state storage
// Key: unique terminal ID (not name, since names can be duplicated)
const terminalBuffers = new Map<string, TerminalEntry[]>()
const terminalNames = new Map<string, string>()

// Counter for generating unique terminal IDs when processId is not available
let terminalIdCounter = 0

// Map vscode.Terminal to our internal ID
const terminalIdMap = new WeakMap<vscode.Terminal, string>()

// Disposables
let terminalFocusDisposable: vscode.Disposable | null = null
let terminalExecutionDisposable: vscode.Disposable | null = null
let terminalCloseDisposable: vscode.Disposable | null = null

// Callbacks for terminal events
let onTerminalFocusCallback: ((terminalId: string, terminalName: string) => void) | null = null
let onTerminalCommandCallback: ((terminalId: string, terminalName: string, command: string) => void) | null = null
let onTerminalOutputCallback: ((terminalId: string, terminalName: string, output: string) => void) | null = null

export interface TerminalCallbacks {
	onFocus: (terminalId: string, terminalName: string) => void
	onCommand: (terminalId: string, terminalName: string, command: string) => void
	onOutput: (terminalId: string, terminalName: string, output: string) => void
}

/**
 * Get or create a unique ID for a terminal
 */
function getTerminalId(terminal: vscode.Terminal): string {
	let id = terminalIdMap.get(terminal)
	if (!id) {
		// Try to use processId if available, otherwise generate a unique ID
		id = `terminal-${++terminalIdCounter}`
		terminalIdMap.set(terminal, id)
		terminalNames.set(id, terminal.name)
		terminalBuffers.set(id, [])
	}
	return id
}

/**
 * Add an entry to a terminal's buffer
 */
function addTerminalEntry(terminalId: string, entry: TerminalEntry): void {
	let buffer = terminalBuffers.get(terminalId)
	if (!buffer) {
		buffer = []
		terminalBuffers.set(terminalId, buffer)
	}

	buffer.push(entry)

	// Enforce max entries limit
	while (buffer.length > MAX_ENTRIES_PER_TERMINAL) {
		buffer.shift()
	}

	// Enforce max size limit
	let totalSize = 0
	for (const e of buffer) {
		totalSize += e.content.length
	}
	while (totalSize > MAX_OUTPUT_SIZE_BYTES && buffer.length > 1) {
		const removed = buffer.shift()
		if (removed) {
			totalSize -= removed.content.length
		}
	}
}

/**
 * Get the current state of all tracked terminals
 */
export function getTerminalStates(): TerminalState[] {
	const states: TerminalState[] = []

	for (const [id, entries] of terminalBuffers) {
		const name = terminalNames.get(id) || 'Unknown'
		states.push({
			id,
			name,
			recentHistory: [...entries] // Return a copy
		})
	}

	return states
}

/**
 * Get the state of a specific terminal by ID
 */
export function getTerminalState(terminalId: string): TerminalState | null {
	const entries = terminalBuffers.get(terminalId)
	const name = terminalNames.get(terminalId)

	if (!entries || !name) {
		return null
	}

	return {
		id: terminalId,
		name,
		recentHistory: [...entries]
	}
}

/**
 * Initialize the terminal capture module
 */
export function initializeTerminalCapture(
	context: vscode.ExtensionContext,
	callbacks: TerminalCallbacks
): void {
	onTerminalFocusCallback = callbacks.onFocus
	onTerminalCommandCallback = callbacks.onCommand
	onTerminalOutputCallback = callbacks.onOutput
	// Handle terminal focus changes
	terminalFocusDisposable = vscode.window.onDidChangeActiveTerminal((terminal) => {
		if (!terminal) {
			return
		}

		const id = getTerminalId(terminal)
		const name = terminal.name
		terminalNames.set(id, name)

		if (onTerminalFocusCallback) {
			onTerminalFocusCallback(id, name)
		}
	})
	context.subscriptions.push(terminalFocusDisposable)

	// Handle terminal command execution
	terminalExecutionDisposable = vscode.window.onDidStartTerminalShellExecution(async (event) => {
		const terminal = event.terminal
		const id = getTerminalId(terminal)
		const name = terminal.name
		const command = event.execution.commandLine.value

		// Add command to buffer
		addTerminalEntry(id, {
			type: 'command',
			content: command,
			timestamp: Date.now()
		})

		if (onTerminalCommandCallback) {
			onTerminalCommandCallback(id, name, command)
		}

		// Read and capture output
		const stream = event.execution.read()
		for await (const data of stream) {
			addTerminalEntry(id, {
				type: 'output',
				content: data,
				timestamp: Date.now()
			})

			if (onTerminalOutputCallback) {
				onTerminalOutputCallback(id, name, data)
			}
		}
	})
	context.subscriptions.push(terminalExecutionDisposable)

	// Handle terminal close
	terminalCloseDisposable = vscode.window.onDidCloseTerminal((terminal) => {
		const id = terminalIdMap.get(terminal)
		if (id) {
			// Clean up terminal state
			terminalBuffers.delete(id)
			terminalNames.delete(id)
		}
	})
	context.subscriptions.push(terminalCloseDisposable)

	// Initialize existing terminals
	for (const terminal of vscode.window.terminals) {
		getTerminalId(terminal)
	}
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

	terminalBuffers.clear()
	terminalNames.clear()
	terminalIdCounter = 0
}

/**
 * Reset terminal state (useful when starting a new recording)
 */
export function resetTerminalState(): void {
	// Keep the terminal ID mappings but clear the buffers
	for (const [id] of terminalBuffers) {
		terminalBuffers.set(id, [])
	}
}

