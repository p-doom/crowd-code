/* eslint-disable @typescript-eslint/semi */
import * as fs from 'fs'
import * as util from 'util'
import * as path from 'path'
import * as vscode from 'vscode'
import * as readline from 'readline'
import {
	getEditorFileName,
	escapeString,
	getEditorLanguage,
	notificationWithProgress,
	generateFileName,
	formatDisplayTime,
	getExportPath,
	logToOutput,
	formatSrtTime,
	outputChannel,
	getConfig,
	removeDoubleQuotes,
	unescapeString,
} from './utilities'

interface File {
	name: string
	content: string
}

enum ChangeType {
	CONTENT = 'content',
	TAB = 'tab',
}

interface CSVRowBuilder {
	sequence: number
	rangeOffset: number
	rangeLength: number
	text: string
	type?: string
}

interface Change {
	sequence: number
	file: string
	startTime: number
	endTime: number
	language: string
	text: string
}

let recording = false
let statusBarItem: vscode.StatusBarItem
const startRecordingCommand = 'vs-code-recorder.startRecording'
const stopRecordingCommand = 'vs-code-recorder.stopRecording'
const openSettingsCommand = 'vs-code-recorder.openSettings'
let timer = 0
let intervalId: NodeJS.Timeout
let startDateTime: Date
let endDateTime: Date | null
const fileQueue: File[] = []
let sequence = 0
let fileName: string
let extContext: vscode.ExtensionContext

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

function isCurrentFileExported() {
	const editor = vscode.window.activeTextEditor
	if (!editor) {
		return false
	}
	const filename = vscode.window.activeTextEditor?.document.fileName
	if (!filename) {
		return false
	}
	const exportPath = getExportPath()
	if (!exportPath) {
		return false
	}
	return filename.startsWith(exportPath)
}

const onChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
	if (!recording) {
		return
	}

	if (isCurrentFileExported()) {
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
async function startRecording(): Promise<void> {
	if (recording) {
		notificationWithProgress('Already recording')
		logToOutput('Already recording', 'info')
		return
	}
	const exportPath = getExportPath()
	if (!exportPath) {
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
	logToOutput('Recording started', 'info')

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
	extContext.subscriptions.push(onChangeSubscription)
	updateStatusBarItem()
}

/**
 * Stops the recording process and finalizes the recording data.
 * @param context - The extension context.
 */
function stopRecording(force = false): void {
	if (!recording) {
		notificationWithProgress('Not recording')
		return
	}
	recording = false
	clearInterval(intervalId)
	timer = 0
	const index = extContext.subscriptions.indexOf(onChangeSubscription)
	if (index !== -1) {
		extContext.subscriptions.splice(index, 1)
	}
	updateStatusBarItem()
	if (force) {
		notificationWithProgress('Recording cancelled')
		logToOutput('Recording cancelled', 'info')

		return
	}
	notificationWithProgress('Recording finished')
	logToOutput('Recording finished', 'info')
	endDateTime = new Date()
	processCsvFile()
}

/**
 * Updates the status bar item with the current recording status and time.
 */ function updateStatusBarItem(): void {
	const editor = vscode.window.activeTextEditor
	if (!editor && !recording) {
		statusBarItem.hide()
		return
	}
	if (recording) {
		if (getConfig().get('appearance.showTimer') === false) {
			statusBarItem.text = `$(debug-stop)`
			statusBarItem.tooltip = `Stop Recording\nCurrent time: ${formatDisplayTime(timer)}`
		}
		if (getConfig().get('appearance.showTimer') === true) {
			statusBarItem.text = `$(debug-stop) ${formatDisplayTime(timer)}`
			statusBarItem.tooltip = `Stop Recording`
		}
		statusBarItem.command = stopRecordingCommand
	} else {
		if (getConfig().get('appearance.minimalMode') === true) {
			statusBarItem.text = `$(circle-large-filled)`
		} else {
			statusBarItem.text = `$(circle-large-filled) Start Recording`
		}
		statusBarItem.tooltip = 'Start Recording'
		statusBarItem.command = startRecordingCommand
	}
	statusBarItem.show()
}

const appendFile = util.promisify(fs.appendFile)

/**
 * Appends data from the file queue to the appropriate file in the workspace.
 */
async function appendToFile(): Promise<void> {
	const exportPath = getExportPath()
	if (!exportPath) {
		stopRecording(true)
		return
	}

	while (fileQueue.length) {
		const filePath = path.join(exportPath, fileQueue[0].name)
		await addToFile(filePath, fileQueue[0].content)
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

function addToSRTFile(processedChanges: Change[], i: number, exportInSrt: boolean) {
	if (!exportInSrt) {
		return
	}
	if (i === 0) {
		return
	}
	addToFileQueue(
		addSrtLine(
			processedChanges[i - 1].sequence,
			processedChanges[i - 1].startTime,
			processedChanges[i - 1].endTime,
			JSON.stringify({
				text: processedChanges[i - 1].text,
				file: processedChanges[i - 1].file,
				language: processedChanges[i - 1].language,
			})
		),
		'srt'
	)
}

/**
 * Processes the CSV file and generates the necessary output files.
 */
async function processCsvFile(): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders
	if (!workspaceFolders) {
		logToOutput('No workspace folder found', 'error')
		return
	}

	const exportFormats = getConfig().get<string[]>('export.exportFormats', [])
	const exportInSrt = exportFormats.includes('SRT')

	if (exportFormats.length === 0) {
		logToOutput('No export formats specified', 'info')
		vscode.window.showErrorMessage('No export formats specified')
		return
	}

	const exportPath = getExportPath()
	if (!exportPath) {
		return
	}
	const filePath = path.join(exportPath, fileName + '.csv')
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
		if (i > 0) {
			processedChanges[i - 1].endTime = time
			addToSRTFile(processedChanges, i, exportInSrt)
		}
		i++
	}
	processedChanges[i - 1].endTime = endDateTime!.getTime() - startDateTime.getTime()
	addToSRTFile(processedChanges, i, exportInSrt)

	if (exportFormats.includes('JSON')) {
		addToFileQueue(JSON.stringify(processedChanges), 'json')
	}
	appendToFile()
	rl.close()
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
		updateStatusBarItem()
		getExportPath()
	}
}

/**
 * Activates the VS Code extension and sets up commands and event listeners.
 * @param context - The extension context.
 */
export function activate(context: vscode.ExtensionContext): void {
	extContext = context
	outputChannel.show()
	logToOutput('Activating VS Code Recorder', 'info')

	context.subscriptions.push(
		vscode.commands.registerCommand(startRecordingCommand, () => {
			startRecording()
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(stopRecordingCommand, () => {
			stopRecording()
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(openSettingsCommand, () => {
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'@ext:mattiaconsiglio.vs-code-recorder'
			)
		})
	)

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChange))

	vscode.window.onDidChangeActiveTextEditor(editor => {
		updateStatusBarItem()
		if (editor && recording) {
			if (isCurrentFileExported()) {
				return
			}
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
	logToOutput('Deactivating VS Code Recorder', 'info')
	statusBarItem.dispose()
}
