import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { contributes } from '../package.json'

interface DefaultConfiguration {
	[key: string]: (typeof defaultConfiguration)[keyof typeof defaultConfiguration]
}

const defaultConfiguration = contributes.configuration.properties

export const outputChannel = vscode.window.createOutputChannel('crowd-code')

/**
 * Retrieves the configuration object for the 'vsCodeRecorder' extension.
 *
 * @returns The configuration object for the 'vsCodeRecorder' extension.
 */
export function getConfig() {
	return vscode.workspace.getConfiguration('vsCodeRecorder')
}

/**
 * Creates a directory at the specified path if it does not already exist.
 *
 * @param path - The path of the directory to create.
 * @returns Void.
 */
export async function createPath(path: string) {
	// If the setting is enabled and the path is inside the workspace, add it to .gitignore
	if (
		getConfig().get<boolean>('export.addToGitignore') &&
		getConfig().get<string>('export.exportPath')?.startsWith('${workspaceFolder}')
	) {
		await addToGitignore()
	}

	if (!fs.existsSync(path)) {
		fs.mkdirSync(path)
	}
}

/**
 * Retrieves the export path for the crowd-code extension, handling various scenarios such as:
 * - If no export path is specified, it prompts the user to reset to default or open the settings.
 * - If the export path starts with '${workspaceFolder}', it replaces it with the actual workspace path.
 * - If the export path does not exist and the 'export.createPathOutsideWorkspace' setting is false, it prompts the user to reset to default or open the settings.
 * - It trims, normalizes, and updates the export path in the extension settings.
 *
 * @returns The normalized and updated export path, or `undefined` if an error occurred.
 */
export function getExportPath(): string | undefined {
	const exportPath = getConfig().get<string>('export.exportPath')
	let outputExportPath = exportPath
	const resetToDefaultMessage = 'Reset to default'
	const openSettingsMessage = 'Open Settings'
	const cancelMessage = 'Cancel'

	/**
	 * Handles the user's selection when prompted to reset the export path to the default or open the settings.
	 *
	 * @param selection - The user's selection, which can be 'Reset to default', 'Open Settings', or 'Cancel'.
	 * @returns Void.
	 */
	function handleSelection(selection: string | undefined) {
		if (selection === resetToDefaultMessage) {
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
		const exportPathNotFoundMessage = 'No export path specified'
		vscode.window
			.showErrorMessage(
				exportPathNotFoundMessage,
				resetToDefaultMessage,
				openSettingsMessage,
				cancelMessage
			)
			.then(selection => handleSelection(selection))
		logToOutput(exportPathNotFoundMessage, 'error')
		return
	}

	if (outputExportPath?.startsWith('${workspaceFolder}')) {
		const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath
		if (!workspacePath) {
			const errorMessage = 'No workspace folder found'
			vscode.window.showErrorMessage(errorMessage)
			logToOutput(errorMessage, 'error')
			return
		}
		outputExportPath = outputExportPath.replace('${workspaceFolder}', workspacePath)
		createPath(outputExportPath)
	} else {
		if (
			!fs.existsSync(outputExportPath) &&
			getConfig().get<boolean>('export.createPathOutsideWorkspace', false) === false
		) {
			const exportPathNotFoundMessage = 'Export path does not exist'
			vscode.window
				.showErrorMessage(
					exportPathNotFoundMessage,
					resetToDefaultMessage,
					openSettingsMessage,
					cancelMessage
				)
				// deepcode ignore PromiseNotCaughtGeneral: catch method not available
				.then(selection => handleSelection(selection))
			logToOutput(exportPathNotFoundMessage, 'error')
			return
		}
		createPath(outputExportPath)
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

export function setDefaultOptions() {
	const config = getConfig()
	for (const [key, value] of Object.entries(defaultConfiguration)) {
		const configKey = key.replace('vsCodeRecorder.', '')
		if ('default' in value) {
			config.update(configKey, value.default, vscode.ConfigurationTarget.Workspace)
		}
	}
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
 * Generates a file name based on the current date and time.
 * @param date - The date to use for generating the file name.
 * @param isExport - Whether the file is being exported.
 * @param customName - Optional custom name for the folder.
 * @returns The generated file name.
 */
export function generateBaseFilePath(
	date: Date | null,
	isExport = false,
	customName?: string, 
	sessionId?: string
): string | undefined {
	if (!date) {
		return
	}
	const year = date.getFullYear()
	const month = (date.getMonth() + 1).toString().padStart(2, '0')
	const day = date.getDate().toString().padStart(2, '0')
	const hours = date.getHours().toString().padStart(2, '0')
	const minutes = date.getMinutes().toString().padStart(2, '0')
	const seconds = date.getSeconds().toString().padStart(2, '0')
	const milliseconds = date.getMilliseconds().toString().padStart(2, '0')

	const timestamp = `${year}_${month}_${day}-${hours}.${minutes}.${seconds}.${milliseconds}`
	const default_name = sessionId ? `crowd-code-${sessionId}-${timestamp}` : `crowd-code-${timestamp}`
	const folderName = customName ? `${customName}-${timestamp}` : default_name
	const fileName = isExport ? 'recording' : 'source'

	return `${folderName}/${fileName}`
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

/**
 * Adds the export path to .gitignore if it doesn't exist.
 * @returns true if the path was added, false if it already exists or if there was an error
 */
export async function addToGitignore(): Promise<boolean> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace found')
		return false
	}

	const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore')
	const exportPath = getConfig().get<string>('export.exportPath')

	if (!exportPath) {
		vscode.window.showErrorMessage('No export path specified')
		return false
	}

	// Get the relative path from workspace folder
	let relativePath = exportPath
	if (exportPath.startsWith('${workspaceFolder}')) {
		relativePath = exportPath.replace('${workspaceFolder}', '').replace(/\\/g, '/')
	}
	// Remove leading and trailing slashes
	relativePath = relativePath.replace(/^\/+|\/+$/g, '')

	try {
		let content = ''
		if (fs.existsSync(gitignorePath)) {
			content = fs.readFileSync(gitignorePath, 'utf8')
			// Check if the path is already in .gitignore
			if (content.split('\n').some(line => line.trim() === relativePath)) {
				vscode.window.showInformationMessage('Export path already in .gitignore')
				return false
			}
			// Add a newline if the file doesn't end with one
			if (!content.endsWith('\n')) {
				content += '\n'
			}
		}
		content = `${content}${relativePath}\n`
		fs.writeFileSync(gitignorePath, content)
		vscode.window.showInformationMessage('Export path added to .gitignore')
		return true
	} catch (err) {
		console.error('Error updating .gitignore:', err)
		vscode.window.showErrorMessage('Error updating .gitignore')
		return false
	}
}
