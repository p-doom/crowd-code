/* eslint-disable @typescript-eslint/semi */
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode'

let recording = false
let myStatusBarItem: vscode.StatusBarItem
const startRecordingCommand = 'vs-code-recorder.startRecording'
const stopRecordingCommand = 'vs-code-recorder.stopRecording'
let timer = 0
let intervalId: NodeJS.Timeout

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
			startRecording()
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(stopRecordingCommand, () => {
			stopRecording()
		})
	)
	const disposable3 = vscode.commands.registerCommand('vs-code-recorder.init', () => {})

	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			// Code to handle changes in the focused tab
			const fileName = editor.document.fileName
			console.log('Focused tab changed', fileName)
		}
	})

	let disposable4 = vscode.workspace.onDidChangeTextDocument(event => {
		const editor = vscode.window.activeTextEditor
		if (editor && event.document === editor.document) {
			const editor = vscode.window.activeTextEditor
			if (editor && event.document === editor.document) {
				console.log('Documento modificato:', event.document.uri.toString())

				event.contentChanges.forEach(change => {
					console.log('Modifica:', change)
				})
			}
		}
	})

	context.subscriptions.push(disposable3, disposable4)

	myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	myStatusBarItem.show()
	updateStatusBarItem()
	context.subscriptions.push(myStatusBarItem)
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('Deactivating VS Code Recorder')
}

function startRecording() {
	if (recording) {
		notificationWithProgress('Already recording')
		return
	}
	recording = true
	timer = 0
	intervalId = setInterval(() => {
		timer++
		updateStatusBarItem()
	}, 1000)
	notificationWithProgress('Recording started')
	updateStatusBarItem()
}

function stopRecording() {
	if (!recording) {
		notificationWithProgress('Not recording')
		return
	}
	recording = false
	clearInterval(intervalId as NodeJS.Timeout)
	timer = 0
	notificationWithProgress('Recording finished')
	updateStatusBarItem()
}

function updateStatusBarItem(): void {
	if (recording) {
		myStatusBarItem.text = `$(debug-stop) ${formatTime(timer)}`
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

function formatTime(seconds: number): string {
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
