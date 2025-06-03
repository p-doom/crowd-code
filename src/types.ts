export interface File {
	name: string
	content: string
}

export enum ChangeType {
	CONTENT = 'content',
	TAB = 'tab',
	SELECTION_KEYBOARD = 'selection_keyboard',
	SELECTION_MOUSE = 'selection_mouse',
	SELECTION_COMMAND = 'selection_command',
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
}
