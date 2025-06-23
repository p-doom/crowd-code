export type ConsentStatus = 'pending' | 'accepted' | 'declined'

export interface File {
	name: string
	content: string
}

export enum ChangeType {
	HEADING = 'heading',
	CONTENT = 'content',
	TAB = 'tab',
	TERMINAL_FOCUS = 'terminal_focus',
	TERMINAL_COMMAND = 'terminal_command',
	TERMINAL_OUTPUT = 'terminal_output',
	SELECTION_KEYBOARD = 'selection_keyboard',
	SELECTION_MOUSE = 'selection_mouse',
	SELECTION_COMMAND = 'selection_command',
	GIT_BRANCH_CHECKOUT = 'git_branch_checkout',
}

export interface CSVRowBuilder {
	sequence: number
	rangeOffset: number
	rangeLength: number
	text: string
	type?: string
}

export interface Change {
	sequence: number
	file: string
	startTime: number
	endTime: number
	language: string
	text: string
}

export interface Recording {
	isRecording: boolean
	timer: number
	startDateTime: Date | null
	endDateTime: Date | null
	sequence: number
	customFolderName?: string
	activatedFiles?: Set<string>
}
