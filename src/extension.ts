/* eslint-disable @typescript-eslint/semi */
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { on } from 'events'
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
let myStatusBarItem: vscode.StatusBarItem
const startRecordingCommand = 'vs-code-recorder.startRecording'
const stopRecordingCommand = 'vs-code-recorder.stopRecording'
let timer = 0
let intervalId: NodeJS.Timeout
let startDateTime: Date
let endDateTime: Date | null
const fileQueue: File[] = []
let sequence = 0
let fileName: string

enum ChangeType {
	CONTENT = 'content',
	TAB = 'tab',
}

function generateFileName() {
	const date = new Date()
	return `vs-code-recorder-${date.getFullYear()}_${date.getMonth()}_${date.getDate()}-${date.getHours()}.${date.getMinutes()}.${date.getSeconds()}.${date.getMilliseconds()}`
}

/**
 * Builds a CSV row with the given parameters.
 * @param sequence - The sequence number of the change.
 * @param rangeOffset - The offset of the changed range.
 * @param rangeLength - The length of the changed range.
 * @param text - The text of the change.
 * @param type - The type of the change (optional, defaults to 'content').
 * @returns A CSV row string with the provided information.
 */
function buildCsvRow(
	sequence: number,
	rangeOffset: number,
	rangeLength: number,
	text: string,
	type: string = ChangeType.CONTENT
) {
	const time = new Date().getTime() - startDateTime.getTime()
	return `${sequence},${time},"${getEditorFileName()}",${rangeOffset},${rangeLength},"${escapeString(
		text
	)}",${type}\n`
}

function getEditorFileName() {
	return vscode.workspace.asRelativePath(vscode.window.activeTextEditor?.document.fileName || '')
}

const onChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
	if (!recording) {
		return
	}
	const editor = vscode.window.activeTextEditor
	if (editor && event.document === editor.document) {
		const editor = vscode.window.activeTextEditor
		if (editor && event.document === editor.document) {
			// console.log('Documento modificato:', event.document.uri.toString())
			// console.log('date diff:', new Date().getTime() - startDateTime.getTime())

			event.contentChanges.forEach(change => {
				sequence++

				addToFileQueue(buildCsvRow(sequence, change.rangeOffset, change.rangeLength, change.text))
				appendToFile()
			})
		}
	}
})

async function startRecording(context: vscode.ExtensionContext) {
	if (recording) {
		notificationWithProgress('Already recording')
		return
	}
	recording = true
	timer = 0
	startDateTime = new Date()
	endDateTime = null
	intervalId = setInterval(() => {
		timer++
		updateStatusBarItem()
	}, 1000)
	notificationWithProgress('Recording started')

	//get editor current text
	const editorText = vscode.window.activeTextEditor?.document.getText()
	//get editor file name
	const editorFileName = vscode.workspace.asRelativePath(
		vscode.window.activeTextEditor?.document.fileName || ''
	)
	const heading = 'Sequence,Time,File,RangeOffset,RangeLength,Text,Type\n'
	sequence++
	fileName = generateFileName()
	addToFileQueue(heading)
	addToFileQueue(buildCsvRow(sequence, 0, 0, editorText || '', ChangeType.TAB))
	appendToFile()
	context.subscriptions.push(onChangeSubscription)
	updateStatusBarItem()
}

function stopRecording(context: vscode.ExtensionContext) {
	if (!recording) {
		notificationWithProgress('Not recording')
		return
	}
	recording = false
	clearInterval(intervalId as NodeJS.Timeout)
	timer = 0
	// Remove the subscription from the array
	const index = context.subscriptions.indexOf(onChangeSubscription)
	if (index !== -1) {
		context.subscriptions.splice(index, 1)
	}
	notificationWithProgress('Recording finished')
	endDateTime = new Date()
	processCsvFile()
	updateStatusBarItem()
}

function updateStatusBarItem(): void {
	if (recording) {
		myStatusBarItem.text = `$(debug-stop) ${formatDisplayTime(timer)}`
		myStatusBarItem.command = stopRecordingCommand
	} else {
		myStatusBarItem.text = `$(circle-large-filled) Start Recording`
		myStatusBarItem.command = startRecordingCommand
	}
}

function notificationWithProgress(title: string) {
	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: title,
			cancellable: false,
		},

		(progress, token) => {
			return new Promise<void>((resolve, reject) => {
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

function formatSrtTime(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000)
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const remainingSeconds = seconds % 60
	const remainingMilliseconds = milliseconds % 1000

	let timeString = ''

	timeString += `${hours.toString().padStart(2, '0')}:`

	timeString += `${minutes.toString().padStart(2, '0')}:${remainingSeconds
		.toString()
		.padStart(2, '0')},${remainingMilliseconds.toString().padStart(3, '0')}`

	return timeString
}

const appendFile = util.promisify(fs.appendFile)

async function appendToFile() {
	const workspaceFolders = vscode.workspace.workspaceFolders

	if (workspaceFolders) {
		const workspacePath = workspaceFolders[0].uri.fsPath
		while (fileQueue.length) {
			const filePath = path.join(workspacePath, fileQueue[0].name)
			await addToFile(filePath, fileQueue[0].content)
		}
	} else {
		console.error('No workspace folder found')
	}
}

async function addToFile(filePath: string, text: string) {
	try {
		await appendFile(filePath, text)
		fileQueue.shift()
		console.log('Successfully appended to file')
	} catch (err) {
		console.error('Failed to append to file:', err)
	}
}

function escapeString(editorText: string | undefined) {
	if (editorText === undefined) {
		return ''
	}
	// Replace double quotes with escaped double quotes
	const escapedText = editorText
		.replace(/"/g, '""')
		.replace(/\r\n/g, '\\r\\n')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t')
	return escapedText
}

const csvFile: string[] = []

interface Change {
	sequence: number
	startTime: number
	endTime: number
	text: string
}

async function processCsvFile() {
	const workspaceFolders = vscode.workspace.workspaceFolders
	if (!workspaceFolders) {
		console.error('No workspace folder found')
		return
	}
	const workspacePath = workspaceFolders[0].uri.fsPath
	const filePath = path.join(workspacePath, fileName + '.csv')
	const fileStream = fs.createReadStream(filePath)
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	})
	let i = 0
	const processedChanges: Change[] = []
	for await (const line of rl) {
		if (line === '') {
		}
		// Process each line of the CSV file here
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
		const type = lineArr[6]
		console.log({ sequence, time, file, rangeOffset, rangeLength, text })

		let newText = ''
		if (type === ChangeType.TAB) {
			newText = text
		} else {
			const newTextSplit = processedChanges[i - 1].text.split('')
			newTextSplit.splice(rangeOffset, rangeLength, text)
			newText = newTextSplit.join('')
		}
		processedChanges.push({ sequence, startTime: time, endTime: 0, text: newText })
		if (i > 0) {
			processedChanges[i - 1].endTime = time
			addToFileQueue(
				addSrtLine(
					processedChanges[i - 1].sequence,
					processedChanges[i - 1].startTime,
					processedChanges[i - 1].endTime,
					processedChanges[i - 1].text
				),
				'srt'
			)
		}
		i++
	}
	processedChanges[i - 1].endTime = endDateTime!.getTime() - startDateTime.getTime()
	addToFileQueue(
		addSrtLine(
			processedChanges[i - 1].sequence,
			processedChanges[i - 1].startTime,
			processedChanges[i - 1].endTime,
			processedChanges[i - 1].text
		),
		'srt'
	)

	console.log('Processed changes:', processedChanges)
	addToFileQueue(JSON.stringify(processedChanges), 'json')
	appendToFile()
	rl.close()
}

// remove double quotes at start and end of text
function removeDoubleQuotes(text: string) {
	return text.replace(/^"(.*)"$/, '$1')
}

function unescapeString(text: string) {
	return text
		.replace(/""/g, '"')
		.replace(/\\r\\n/g, '\r\n')
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r')
		.replace(/\\t/g, '\t')
}

function addSrtLine(sequence: number, start: number, end: number, text: string) {
	return `${sequence}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n\n`
}

function addToFileQueue(content: string, fileExtension: string = 'csv') {
	fileQueue.push({
		name: fileName + '.' + fileExtension,
		content: content,
	})
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Activating VS Code Recorder')

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
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
	context.subscriptions.push(vscode.commands.registerCommand('vs-code-recorder.init', () => {}))

	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor && recording) {
			// Code to handle changes in the focused tab
			const fileName = editor.document.fileName
			const editorText = vscode.window.activeTextEditor?.document.getText()
			sequence++
			addToFileQueue(buildCsvRow(sequence, 0, 0, editorText || '', ChangeType.TAB))
			appendToFile()
		}
	})

	myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	myStatusBarItem.show()
	updateStatusBarItem()
	context.subscriptions.push(myStatusBarItem)
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('Deactivating VS Code Recorder')
}
