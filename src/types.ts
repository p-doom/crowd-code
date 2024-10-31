export interface File {
	name: string
	content: string
}

export enum ChangeType {
	CONTENT = 'content',
	TAB = 'tab',
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
	fileName: string
	sequence: number
}
