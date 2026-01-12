/**
 * crowd-code 2.0 Type Definitions
 * Observation-Action schema for state-based capture
 */


export type ConsentStatus = 'pending' | 'accepted' | 'declined'

export type ActionSource = 'user' | 'agent' | 'unknown' | 'git' | 'git_checkout'

export interface CursorPosition {
	line: number
	character: number
}

export interface ViewportState {
	file: string
	startLine: number
	endLine: number
	content: string
	cursorPosition: CursorPosition | null
}

export interface TerminalViewport {
	id: string
	name: string
	viewport: string[]
}

export interface Observation {
	viewport: ViewportState | null
	activeTerminal: TerminalViewport | null
}

export interface EditDiff {
	rangeOffset: number
	rangeLength: number
	text: string
}

export type EditReason = 'undo' | 'redo' | undefined

export interface EditAction {
	kind: 'edit'
	source: ActionSource
	file: string
	diff: EditDiff
	reason?: EditReason
}

export interface SelectionAction {
	kind: 'selection'
	source: ActionSource
	file: string
	selectionStart: CursorPosition
	selectionEnd: CursorPosition
	selectedText: string
}

export interface TabSwitchAction {
	kind: 'tab_switch'
	source: ActionSource
	file: string
	previousFile: string | null
}

export interface TerminalFocusAction {
	kind: 'terminal_focus'
	source: ActionSource
	terminalId: string
	terminalName: string
}

export interface TerminalCommandAction {
	kind: 'terminal_command'
	source: ActionSource
	terminalId: string
	terminalName: string
	command: string
}

export interface FileChangeAction {
	kind: 'file_change'
	source: ActionSource
	file: string
	changeType: 'create' | 'change' | 'delete'
	diff: string | null
}

export type Action =
	| EditAction
	| SelectionAction
	| TabSwitchAction
	| TerminalFocusAction
	| TerminalCommandAction
	| FileChangeAction

export interface ObservationEvent {
	sequence: number
	timestamp: number
	type: 'observation'
	observation: Observation
}

export interface ActionEvent {
	sequence: number
	timestamp: number
	type: 'action'
	action: Action
}

export interface WorkspaceSnapshotEvent {
	sequence: number
	timestamp: number
	type: 'workspace_snapshot'
	snapshotId: string
}

export type RecordingEvent = ObservationEvent | ActionEvent | WorkspaceSnapshotEvent

export interface RecordingSession {
	version: '2.0'
	sessionId: string
	startTime: number
	events: RecordingEvent[]
}

export interface RecordingChunk {
	version: '2.0'
	sessionId: string
	startTime: number
	chunkIndex: number
	events: RecordingEvent[]
}

export interface RecordingState {
	isRecording: boolean
	startDateTime: Date | null
	endDateTime: Date | null
	sequence: number
	sessionId: string
	events: RecordingEvent[]
}
