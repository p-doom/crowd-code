/* eslint-disable @typescript-eslint/semi */
import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

export const outputChannel = vscode.window.createOutputChannel('VS Code Recorder')

export function getConfig() {
	return vscode.workspace.getConfiguration('vsCodeRecorder')
}

export function createPath(path: string) {
	if (!fs.existsSync(path)) {
		fs.mkdirSync(path)
	}
}

export function getExportPath(): string | void {
	const exportPath = getConfig().get<string>('export.exportPath')
	let outputExportPath = exportPath

	function handleSelection(selection: string | undefined) {
		if (selection === 'Reset to default') {
			getConfig().update('export.exportPath', undefined, vscode.ConfigurationTarget.Global)
		}
		if (selection === 'Open Settings') {
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'vsCodeRecorder.export.exportPath'
			)
		}
	}

	if (!outputExportPath) {
		vscode.window
			.showErrorMessage(' No export path specified', 'Reset to default', 'Open Settings', 'Cancel')
			// deepcode ignore PromiseNotCaughtGeneral: catch method not available
			.then(selection => handleSelection(selection))
		logToOutput('No export path specified', 'error')
		return
	}

	if (outputExportPath?.startsWith('${workspaceFolder}')) {
		const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath
		if (!workspacePath) {
			vscode.window.showErrorMessage('No workspace folder found')

			logToOutput('No workspace folder found', 'error')
			return
		}
		outputExportPath = outputExportPath.replace('${workspaceFolder}', workspacePath)
		createPath(outputExportPath)
	} else {
		if (
			!fs.existsSync(outputExportPath) &&
			getConfig().get<boolean>('export.createPathOutsideWorkspace', false) === false
		) {
			vscode.window
				.showErrorMessage(
					'Export path does not exist',
					'Reset to default',
					'Open Settings',
					'Cancel'
				)
				// deepcode ignore PromiseNotCaughtGeneral: catch method not available
				.then(selection => handleSelection(selection))
			logToOutput('Export path does not exist', 'error')
			return
		} else {
			createPath(outputExportPath)
		}
	}

	outputExportPath = outputExportPath.trim()
	outputExportPath = outputExportPath.replaceAll('\\', '/')
	if (!outputExportPath.endsWith('/')) {
		outputExportPath += '/'
	}
	if (!exportPath?.startsWith('${workspaceFolder}')) {
		getConfig().update('export.exportPath', outputExportPath, vscode.ConfigurationTarget.Global)
	}
	if (path.sep === '/') {
		outputExportPath = outputExportPath.replaceAll('/', path.sep)
	}
	return outputExportPath
}

/**
 * Logs a message to the output channel with a timestamp and type.
 *
 * @param {string} message - The message to be logged.
 * @param {'info' | 'success' | 'error'} [type='info'] - The type of the log message.
 */
export function logToOutput(message: string, type: 'info' | 'success' | 'error' = 'info') {
	const time = new Date().toLocaleTimeString()

	outputChannel.appendLine(`${time} [${type}] ${message}`)
	console.log(message)
}

/**
 * Generates a unique file name based on the current date and time.
 * @returns A string representing the generated file name.
 */
export function generateFileName(): string {
	const date = new Date()
	return `vs-code-recorder-${date.getFullYear()}_${date.getMonth()}_${date.getDate()}-${date.getHours()}.${date.getMinutes()}.${date.getSeconds()}.${date.getMilliseconds()}`
}

/**
 * Retrieves the language identifier of the currently active text editor.
 *
 * @return {string} The language identifier of the active text editor
 */
export function getEditorLanguage(): string {
	const editor = vscode.window.activeTextEditor
	if (editor) {
		console.log(editor.document.languageId)
		return editor.document.languageId
	}
	return ''
}

/**
 * Gets the relative path of the active text editor's file.
 * @returns A string representing the relative path of the active text editor's file.
 */
export function getEditorFileName(): string {
	return vscode.workspace.asRelativePath(vscode.window.activeTextEditor?.document.fileName ?? '')
}

/**
 * Displays a notification with progress in VS Code.
 * @param title - The title of the notification.
 */
export function notificationWithProgress(title: string): void {
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
export function formatDisplayTime(seconds: number): string {
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
export function formatSrtTime(milliseconds: number): string {
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

/**
 * Escapes special characters in a string for CSV compatibility.
 * @param editorText - The text to escape.
 * @returns A string with escaped characters.
 */
export function escapeString(editorText: string | undefined): string {
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

/**
 * Removes double quotes at the start and end of a text string.
 * @param text - The text to process.
 * @returns A string without surrounding double quotes.
 */
export function removeDoubleQuotes(text: string): string {
	return text.replace(/^"(.*)"$/, '$1')
}

/**
 * Unescape special characters in a string.
 * @param text - The text to unescape.
 * @returns A string with unescaped characters.
 */
export function unescapeString(text: string): string {
	return text
		.replace(/""/g, '"')
		.replace(/\\r\\n/g, '\r\n')
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r')
		.replace(/\\t/g, '\t')
}
