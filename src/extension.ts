import * as vscode from 'vscode'
import * as crypto from 'crypto'
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
	panicButton,
} from './recording'
import { ChangeType, CSVRowBuilder } from './types'
import { RecordFilesProvider, type RecordFile } from './recordFilesProvider'
import { ActionsProvider } from './actionsProvider'
import { initializeGitProvider, cleanupGitProvider } from './gitProvider'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { showConsentChangeDialog, ensureConsent, hasConsent } from './consent'

export let statusBarItem: vscode.StatusBarItem
export let extContext: vscode.ExtensionContext
export let actionsProvider: ActionsProvider

function onConfigurationChange(event: vscode.ConfigurationChangeEvent) {
	if (event.affectsConfiguration('crowdCode')) {
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	extContext = context
	outputChannel.show()
	logToOutput('Activating crowd-code', 'info')

	// Save anonUserId globally for user to copy
	const userName = process.env.USER || process.env.USERNAME || "coder";
	const machineId = vscode.env.machineId ?? null;
	const rawId = `${machineId}:${userName}`;
	const anonUserId = crypto.createHash('sha256').update(rawId).digest('hex') as string;

	extContext.globalState.update('userId', anonUserId);

	// Register userID display
	context.subscriptions.push(
		vscode.commands.registerCommand('crowd-code.showUserId', () => {
			const userId = extContext.globalState.get<string>('userId');
			if (!userId) {
				vscode.window.showWarningMessage("User ID not registered yet. Please wait a few seconds until the extension is fully activated.");
				return;
			}
			vscode.window.showInformationMessage(`Your User ID is: ${userId}`);
		}))


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
		vscode.commands.registerCommand('crowd-code.refreshRecordFiles', () => {
			recordFilesProvider.refresh()
		})
	)

	// Register delete command
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'crowd-code.deleteRecordFile',
			async (item: RecordFile) => {
				const exportPath = getExportPath()
				if (!exportPath) {
					return
				}

				const result = await vscode.window.showWarningMessage(
					`Are you sure you want to delete ${item.label}?`,
					'Yes',
					'No'
				)

				if (result === 'Yes') {
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
		vscode.commands.registerCommand('crowd-code.revealInExplorer', (item: RecordFile) => {
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
		vscode.commands.registerCommand(commands.panicButton, () => {
			panicButton()
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.openSettings, () => {
			vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'@ext:MattiaConsiglio.crowd-code'
			)
		})
	)

	context.subscriptions.push(
		vscode.commands.registerCommand('crowd-code.addToGitignore', async () => {
			await addToGitignore()
		})
	)

	// Register consent management command
	context.subscriptions.push(
		vscode.commands.registerCommand('crowd-code.consent', async () => {
			await showConsentChangeDialog()
		})
	)


	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChange))

	vscode.window.onDidChangeActiveTextEditor(editor => {
		updateStatusBarItem()
		if (editor && recording.isRecording) {
			if (isCurrentFileExported()) {
				return
			}
			const currentFileUri = editor.document.uri.toString()
			let tabEventText = ''

			if (recording.activatedFiles) {
				if (!recording.activatedFiles.has(currentFileUri)) {
					tabEventText = editor.document.getText()
					recording.activatedFiles.add(currentFileUri)
				}
			} else {
				throw new Error("Warning: recording.activatedFiles was not available during TAB event logging.")
			}

			recording.sequence++
			addToFileQueue(
				buildCsvRow({
					sequence: recording.sequence,
					rangeOffset: 0,
					rangeLength: 0,
					text: tabEventText,
					type: ChangeType.TAB,
				})
			)
			appendToFile()
			actionsProvider.setCurrentFile(editor.document.fileName)
		}
	})

	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (recording.isRecording && event.textEditor === vscode.window.activeTextEditor) {
				if (isCurrentFileExported()) {
					return
				}

				const editor = event.textEditor
				// For simplicity, we'll log the primary selection.
				const selection = event.selections[0]
				if (!selection) {
					return
				}

				const selectedText = editor.document.getText(selection)
				let changeType: string

				switch (event.kind) {
					case vscode.TextEditorSelectionChangeKind.Keyboard:
						changeType = ChangeType.SELECTION_KEYBOARD
						break
					case vscode.TextEditorSelectionChangeKind.Mouse:
						changeType = ChangeType.SELECTION_MOUSE
						break
					case vscode.TextEditorSelectionChangeKind.Command:
						changeType = ChangeType.SELECTION_COMMAND
						break
					default:
						throw new TypeError("Unknown selection change kind.")
				}

				recording.sequence++
				const csvRowParams: CSVRowBuilder = {
					sequence: recording.sequence,
					rangeOffset: editor.document.offsetAt(selection.start),
					rangeLength: editor.document.offsetAt(selection.end) - editor.document.offsetAt(selection.start),
					text: selectedText,
					type: changeType,
				}
				addToFileQueue(buildCsvRow(csvRowParams))
				appendToFile()
				actionsProvider.setCurrentFile(editor.document.fileName)
			}
		})
	)

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTerminal((terminal: vscode.Terminal | undefined) => {
			if (terminal && recording.isRecording) {
				if (isCurrentFileExported()) {
					return
				}
				recording.sequence++
				addToFileQueue(
					buildCsvRow({
						sequence: recording.sequence,
						rangeOffset: 0,
						rangeLength: 0,
						text: terminal.name,
						type: ChangeType.TERMINAL_FOCUS,
					})
				)
				appendToFile()
				actionsProvider.setCurrentFile(`Terminal: ${terminal.name}`)
			}
		})
	)

	context.subscriptions.push(
		vscode.window.onDidStartTerminalShellExecution(async (event: vscode.TerminalShellExecutionStartEvent) => {
			if (recording.isRecording) {
				if (isCurrentFileExported()) {
					return
				}
				const commandLine = event.execution.commandLine.value
				recording.sequence++
				addToFileQueue(
					buildCsvRow({
						sequence: recording.sequence,
						rangeOffset: 0,
						rangeLength: 0,
						text: commandLine,
						type: ChangeType.TERMINAL_COMMAND,
					})
				)
				appendToFile()

				const stream = event.execution.read()
				for await (const data of stream) {
					recording.sequence++
					addToFileQueue(
						buildCsvRow({ sequence: recording.sequence, rangeOffset: 0, rangeLength: 0, text: data, type: ChangeType.TERMINAL_OUTPUT })
					)
					appendToFile()
				}
			}
		})
	)

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9000)
	updateStatusBarItem()
	context.subscriptions.push(statusBarItem)

	// Ensure consent is obtained when the extension is first activated
	await ensureConsent()

	// Autostart recording regardless of consent. The consent only gates data upload.
	startRecording().catch(err => logToOutput(`Autostart recording failed unexpectedly: ${err}`, 'error'))

	// Initialize git provider for branch checkout detection
	initializeGitProvider()
}

export function deactivate(): void {
	logToOutput('Deactivating crowd-code', 'info')
	if (recording.isRecording) {
		stopRecording()
	}
	cleanupGitProvider()
	statusBarItem.dispose()
}
