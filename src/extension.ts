/* eslint-disable @typescript-eslint/semi */
import * as fs from 'fs'
import * as util from 'util'
import * as path from 'path'
import * as vscode from 'vscode'
import * as readline from 'readline'

interface File {
	name: string
	content: string
}

let recording = false
let statusBarItem: vscode.StatusBarItem
const startRecordingCommand = 'vs-code-recorder.startRecording'
const stopRecordingCommand = 'vs-code-recorder.stopRecording'
let timer = 0
let intervalId: NodeJS.Timeout
let startDateTime: Date
let endDateTime: Date | null
const fileQueue: File[] = []
let sequence = 0
let fileName: string
let config = vscode.workspace.getConfiguration('vsCodeRecorder')

enum ChangeType {
	CONTENT = 'content',
	TAB = 'tab',
}

/**
 * Generates a unique file name based on the current date and time.
 * @returns A string representing the generated file name.
 */
function generateFileName(): string {
	const date = new Date()
	return `vs-code-recorder-${date.getFullYear()}_${date.getMonth()}_${date.getDate()}-${date.getHours()}.${date.getMinutes()}.${date.getSeconds()}.${date.getMilliseconds()}`
}

/**
 * Retrieves the language identifier of the currently active text editor.
 *
 * @return {string|undefined} The language identifier of the active text editor, or undefined if no editor is active.
 */
function getEditorLanguage(): string {
	const editor = vscode.window.activeTextEditor
	if (editor) {
		console.log(editor.document.languageId)
		return editor.document.languageId
	}
	return ''
}

interface CSVRowBuilder {
	sequence: number
	rangeOffset: number
	rangeLength: number
	text: string
	type?: string
}

/**
 * Builds a CSV row with the given parameters.
 *
 * @param {CSVRowBuilder} sequence - The sequence number of the change.
 * @param {CSVRowBuilder} rangeOffset - The offset of the changed range.
 * @param {CSVRowBuilder} rangeLength - The length of the changed range.
 * @param {CSVRowBuilder} text - The text of the change.
 * @param {string} type - The type of the change (optional, defaults to 'content').
 * @return {string} A CSV row string with the provided information.
 */
function buildCsvRow({
	sequence,
	rangeOffset,
	rangeLength,
	text,
	type = ChangeType.CONTENT,
}: CSVRowBuilder): string {
	const time = new Date().getTime() - startDateTime.getTime()
	return `${sequence},${time},"${getEditorFileName()}",${rangeOffset},${rangeLength},"${escapeString(
		text
	)}",${getEditorLanguage()},${type}\n`
}

/**
 * Gets the relative path of the active text editor's file.
 * @returns A string representing the relative path of the active text editor's file.
 */
function getEditorFileName(): string {
	return vscode.workspace.asRelativePath(vscode.window.activeTextEditor?.document.fileName ?? '')
}

const onChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
	if (!recording) {
		return
	}
	const editor = vscode.window.activeTextEditor
	if (editor && event.document === editor.document) {
		event.contentChanges.forEach(change => {
			sequence++
			addToFileQueue(
				buildCsvRow({
					sequence,
					rangeOffset: change.rangeOffset,
					rangeLength: change.rangeLength,
					text: change.text,
				})
			)
			appendToFile()
		})
	}
})

/**
 * Starts the recording process and initializes necessary variables.
 * @param context - The extension context.
 */
async function startRecording(context: vscode.ExtensionContext): Promise<void> {
	if (recording) {
		notificationWithProgress('Already recording')
		return
	}
	recording = true
	timer = 0
	startDateTime = new Date()
	endDateTime = null
	sequence = 0
	intervalId = setInterval(() => {
		timer++
		updateStatusBarItem()
	}, 1000)
	notificationWithProgress('Recording started')

	const editorText = vscode.window.activeTextEditor?.document.getText()
	const heading = 'Sequence,Time,File,RangeOffset,RangeLength,Text,Language,Type\n'
	sequence++
	fileName = generateFileName()
	addToFileQueue(heading)
	addToFileQueue(
		buildCsvRow({
			sequence,
			rangeOffset: 0,
			rangeLength: 0,
			text: editorText ?? '',
			type: ChangeType.TAB,
		})
	)
	appendToFile()
	context.subscriptions.push(onChangeSubscription)
	updateStatusBarItem()
}

/**
 * Stops the recording process and finalizes the recording data.
 * @param context - The extension context.
 */
function stopRecording(context: vscode.ExtensionContext): void {
	if (!recording) {
		notificationWithProgress('Not recording')
		return
	}
	recording = false
	clearInterval(intervalId)
	timer = 0
	const index = context.subscriptions.indexOf(onChangeSubscription)
	if (index !== -1) {
		context.subscriptions.splice(index, 1)
	}
	notificationWithProgress('Recording finished')
	endDateTime = new Date()
	processCsvFile()
	updateStatusBarItem()
}

/**
 * Updates the status bar item with the current recording status and time.
 */ function updateStatusBarItem(): void {
	const editor = vscode.window.activeTextEditor
	if (!editor) {
		statusBarItem.hide()
		return
	}
	if (recording) {
		if (config.get('showTimer') === false) {
			statusBarItem.text = `$(debug-stop)`
			statusBarItem.tooltip = `Stop Recording\nCurrent time: ${formatDisplayTime(timer)}`
		}
		if (config.get('showTimer') === true) {
			statusBarItem.text = `$(debug-stop) ${formatDisplayTime(timer)}`
			statusBarItem.tooltip = `Stop Recording`
		}
		statusBarItem.command = stopRecordingCommand
	} else {
		if (config.get('minimalMode') === true) {
			statusBarItem.text = `$(circle-large-filled)`
		} else {
			statusBarItem.text = `$(circle-large-filled) Start Recording`
		}
		statusBarItem.tooltip = 'Start Recording'
		statusBarItem.command = startRecordingCommand
	}
	statusBarItem.show()
}

/**
 * Displays a notification with progress in VS Code.
 * @param title - The title of the notification.
 */
function notificationWithProgress(title: string): void {
	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: title,
			cancellable: false,
		},
		progress => {
			return new Promise<void>(resolve => {
				const times = 1.5 * 1000
				const timeout = 50
				const increment = (100 / times) * timeout
				for (let i = 0; i <= times; i++) {
					setTimeout(() => {
						progress.report({ increment: increment })
						if (i === times / timeout) {
							resolve()
						}
					}, timeout * i)
				}
			})
		}
	)
}

/**
 * Formats a time value in seconds to a display string.
 * @param seconds - The number of seconds.
 * @returns A string representing the formatted time.
 */
function formatDisplayTime(seconds: number): string {
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const remainingSeconds = seconds % 60

	let timeString = ''

	if (hours > 0) {
		timeString += `${hours.toString().padStart(2, '0')}:`
	}

	timeString += `${minutes.toString().padStart(2, '0')}:${remainingSeconds
		.toString()
		.padStart(2, '0')}`

	return timeString
}

/**
 * Formats a time value in milliseconds to an SRT time string.
 * @param milliseconds - The number of milliseconds.
 * @returns A string representing the formatted SRT time.
 */
function formatSrtTime(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000)
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const remainingSeconds = seconds % 60
	const remainingMilliseconds = milliseconds % 1000

	return `${hours.toString().padStart(2, '0')}:${minutes
		.toString()
		.padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')},${remainingMilliseconds
		.toString()
		.padStart(3, '0')}`
}

const appendFile = util.promisify(fs.appendFile)

/**
 * Appends data from the file queue to the appropriate file in the workspace.
 */
async function appendToFile(): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders

	if (workspaceFolders) {
		const workspacePath = workspaceFolders[0].uri.fsPath
		const recorderPath = path.join(workspacePath, '/vs-code-recorder/')

		// Create the directory if it does not exist
		if (!fs.existsSync(recorderPath)) {
			fs.mkdirSync(recorderPath, { recursive: true })
		}

		while (fileQueue.length) {
			const filePath = path.join(recorderPath, fileQueue[0].name)
			await addToFile(filePath, fileQueue[0].content)
		}
	} else {
		console.error('No workspace folder found')
	}
}

/**
 * Appends text to a file at the specified file path.
 * @param filePath - The path to the file.
 * @param text - The text to append.
 */
async function addToFile(filePath: string, text: string): Promise<void> {
	try {
		await appendFile(filePath, text)
		fileQueue.shift()
	} catch (err) {
		console.error('Failed to append to file:', err)
	}
}

/**
 * Escapes special characters in a string for CSV compatibility.
 * @param editorText - The text to escape.
 * @returns A string with escaped characters.
 */
function escapeString(editorText: string | undefined): string {
	if (editorText === undefined) {
		return ''
	}
	return editorText
		.replace(/"/g, '""')
		.replace(/\r\n/g, '\\r\\n')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t')
}

interface Change {
	sequence: number
	file: string
	startTime: number
	endTime: number
	language: string
	text: string
}

/**
 * Processes the CSV file and generates the necessary output files.
 */
async function processCsvFile(): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders
	if (!workspaceFolders) {
		console.error('No workspace folder found')
		return
	}

	const exportFormats = config.get('exportFormats', ['JSON', 'SRT'])

	if (exportFormats.length === 0) {
		return
	}

	const workspacePath = workspaceFolders[0].uri.fsPath
	const filePath = path.join(workspacePath, '/vs-code-recorder/', fileName + '.csv')
	const fileStream = fs.createReadStream(filePath)
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	})
	let i = 0
	const processedChanges: Change[] = []
	for await (const line of rl) {
		const lineArr = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)

		const sequence = parseInt(lineArr[0])
		if (isNaN(sequence)) {
			continue
		}
		const time = parseInt(lineArr[1])
		const file = removeDoubleQuotes(lineArr[2])
		const rangeOffset = parseInt(lineArr[3])
		const rangeLength = parseInt(lineArr[4])
		const text = unescapeString(removeDoubleQuotes(lineArr[5]))
		const language = lineArr[6]
		const type = lineArr[7]

		let newText = ''
		if (type === ChangeType.TAB) {
			newText = text
		} else {
			const newTextSplit = processedChanges[i - 1].text.split('')
			newTextSplit.splice(rangeOffset, rangeLength, text)
			newText = newTextSplit.join('')
		}
		processedChanges.push({ sequence, file, startTime: time, endTime: 0, language, text: newText })
		if (exportFormats.includes('SRT')) {
			if (i > 0) {
				processedChanges[i - 1].endTime = time
				addToFileQueue(
					addSrtLine(
						processedChanges[i - 1].sequence,
						processedChanges[i - 1].startTime,
						processedChanges[i - 1].endTime,
						JSON.stringify({
							text: processedChanges[i - 1].text,
							file: processedChanges[i - 1].file,
						})
					),
					'srt'
				)
			}
		}
		i++
	}
	processedChanges[i - 1].endTime = endDateTime!.getTime() - startDateTime.getTime()
	if (exportFormats.includes('SRT')) {
		addToFileQueue(
			addSrtLine(
				processedChanges[i - 1].sequence,
				processedChanges[i - 1].startTime,
				processedChanges[i - 1].endTime,
				JSON.stringify({ text: processedChanges[i - 1].text, file: processedChanges[i - 1].file })
			),
			'srt'
		)
	}

	if (exportFormats.includes('JSON')) {
		addToFileQueue(JSON.stringify(processedChanges), 'json')
	}
	appendToFile()
	rl.close()
}

/**
 * Removes double quotes at the start and end of a text string.
 * @param text - The text to process.
 * @returns A string without surrounding double quotes.
 */
function removeDoubleQuotes(text: string): string {
	return text.replace(/^"(.*)"$/, '$1')
}

/**
 * Unescape special characters in a string.
 * @param text - The text to unescape.
 * @returns A string with unescaped characters.
 */
function unescapeString(text: string): string {
	return text
		.replace(/""/g, '"')
		.replace(/\\r\\n/g, '\r\n')
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r')
		.replace(/\\t/g, '\t')
}

/**
 * Adds a line to the SRT file format.
 * @param sequence - The sequence number of the change.
 * @param start - The start time of the change.
 * @param end - The end time of the change.
 * @param text - The text of the change.
 * @returns A string representing a line in the SRT file format.
 */
function addSrtLine(sequence: number, start: number, end: number, text: string): string {
	return `${sequence}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n\n`
}

/**
 * Adds content to the file queue.
 * @param content - The content to add.
 * @param fileExtension - The file extension (optional, defaults to 'csv').
 */
function addToFileQueue(content: string, fileExtension: string = 'csv'): void {
	fileQueue.push({
		name: fileName + '.' + fileExtension,
		content: content,
	})
}

function onConfigurationChange(event: vscode.ConfigurationChangeEvent) {
	if (event.affectsConfiguration('vsCodeRecorder')) {
		config = vscode.workspace.getConfiguration('vsCodeRecorder')
		updateStatusBarItem()
	}
}

/**
 * Activates the VS Code extension and sets up commands and event listeners.
 * @param context - The extension context.
 */
export function activate(context: vscode.ExtensionContext): void {
	console.log('Activating VS Code Recorder')

	context.subscriptions.push(
		vscode.commands.registerCommand(startRecordingCommand, () => {
			startRecording(context)
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(stopRecordingCommand, () => {
			stopRecording(context)
		})
	)

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChange))

	vscode.window.onDidChangeActiveTextEditor(editor => {
		updateStatusBarItem()
		if (editor && recording) {
			const editorText = vscode.window.activeTextEditor?.document.getText()
			sequence++
			addToFileQueue(
				buildCsvRow({
					sequence,
					rangeOffset: 0,
					rangeLength: 0,
					text: editorText ?? '',
					type: ChangeType.TAB,
				})
			)
			appendToFile()
		}
	})

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9000)
	updateStatusBarItem()
	context.subscriptions.push(statusBarItem)
}

/**
 * Deactivates the VS Code extension.
 */
export function deactivate(): void {
	console.log('Deactivating VS Code Recorder')
}
