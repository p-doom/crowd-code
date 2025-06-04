import * as vscode from 'vscode'
import { getExportPath, logToOutput, outputChannel, addToGitignore } from './utilities'
import {
	updateStatusBarItem,
	startRecording,
	stopRecording,
	isCurrentFileExported,
	commands,
	recording,
	addToFileQueue,
	buildCsvRow,
	appendToFile,
} from './recording'
import { ChangeType } from './types'
import { RecordFilesProvider } from './recordFilesProvider'
import type { RecordFile } from './recordFilesProvider'
import { ActionsProvider } from './actionsProvider'
import * as fs from 'node:fs'
import * as path from 'node:path'

export let statusBarItem: vscode.StatusBarItem
export let extContext: vscode.ExtensionContext
export let actionsProvider: ActionsProvider

function onConfigurationChange(event: vscode.ConfigurationChangeEvent) {
	if (event.affectsConfiguration('vsCodeRecorder')) {
		updateStatusBarItem()
		getExportPath()
	}
}

/**
 * Gets the full path for a file or folder
 * @param item - The tree item representing the file or folder
 * @param exportPath - The base export path
 * @returns The full path to the file or folder
 */
function getFullPath(item: RecordFile, exportPath: string): string {
	// If the item has a parent path (file inside a folder), construct the full path
	if (item.parentPath) {
		return path.join(exportPath, item.parentPath, item.label)
	}
	// Otherwise, it's a root item
	return path.join(exportPath, item.label)
}

/**
 * Deletes a file or folder recursively
 * @param filePath - The path to the file or folder to delete
 */
async function deleteFileOrFolder(filePath: string): Promise<void> {
	try {
		const stat = fs.statSync(filePath)
		if (stat.isDirectory()) {
			// Delete directory and its contents recursively
			fs.rmSync(filePath, { recursive: true, force: true })
		} else {
			// Delete single file
			fs.unlinkSync(filePath)
		}
	} catch (err) {
		console.error('Error deleting file or folder:', err)
		throw err
	}
}

export function activate(context: vscode.ExtensionContext): void {
	extContext = context
	outputChannel.show()
	logToOutput(vscode.l10n.t('Activating VS Code Recorder'), 'info')

	// Register Record Files Provider
	const recordFilesProvider = new RecordFilesProvider()
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('recordFiles', recordFilesProvider)
	)

	// Register Actions Provider
	actionsProvider = new ActionsProvider()
	context.subscriptions.push(vscode.window.registerTreeDataProvider('actions', actionsProvider))

	// Register refresh command
	context.subscriptions.push(
		vscode.commands.registerCommand('vs-code-recorder.refreshRecordFiles', () => {
			recordFilesProvider.refresh()
		})
	)

	// Register delete command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'vs-code-recorder.deleteRecordFile',
			async (item: RecordFile) => {
				const exportPath = getExportPath()
				if (!exportPath) {
					return
				}

				const result = await vscode.window.showWarningMessage(
					vscode.l10n.t('Are you sure you want to delete {name}?', { name: item.label }),
					vscode.l10n.t('Yes'),
					vscode.l10n.t('No')
				)

				if (result === vscode.l10n.t('Yes')) {
					try {
						const itemPath = getFullPath(item, exportPath)
						await deleteFileOrFolder(itemPath)
						recordFilesProvider.refresh()
					} catch (err) {
						vscode.window.showErrorMessage(`Error deleting ${item.label}: ${err}`)
					}
				}
			}
		)
	)

	// Register reveal in explorer command
	context.subscriptions.push(
		vscode.commands.registerCommand('vs-code-recorder.revealInExplorer', (item: RecordFile) => {
			const exportPath = getExportPath()
			if (!exportPath) {
				return
			}

			const itemPath = getFullPath(item, exportPath)
			vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(itemPath))
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.startRecording, () => {
			startRecording()
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.stopRecording, () => {
			stopRecording()
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.openSettings, () => {
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'@ext:MattiaConsiglio.vs-code-recorder'
			)
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand('vs-code-recorder.addToGitignore', async () => {
			await addToGitignore()
		})
	)

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChange))

	vscode.window.onDidChangeActiveTextEditor(editor => {
		updateStatusBarItem()
		if (editor && recording.isRecording) {
			if (isCurrentFileExported()) {
				return
			}
			const editorText = vscode.window.activeTextEditor?.document.getText()
			recording.sequence++
			addToFileQueue(
				buildCsvRow({
					sequence: recording.sequence,
					rangeOffset: 0,
					rangeLength: 0,
					text: editorText ?? '',
					type: ChangeType.TAB,
				})
			)
			appendToFile()
			actionsProvider.setCurrentFile(editor.document.fileName)
		}
	})

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9000)
	updateStatusBarItem()
	context.subscriptions.push(statusBarItem)
	startRecording().catch(err => logToOutput(`Autostart recording failed unexpectedly: ${err}`, 'error'));
}

export function deactivate(): void {
	logToOutput(vscode.l10n.t('Deactivating VS Code Recorder'), 'info')
	if (recording.isRecording) {
		stopRecording()
	}
	statusBarItem.dispose()
}
