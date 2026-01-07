/**
 * crowd-code Extension Entry Point
 * Version 2.0 - State-based observation-action capture
 */

import * as vscode from 'vscode'
import * as crypto from 'crypto'
import { getExportPath, logToOutput, outputChannel, addToGitignore } from './utilities'
import {
	startRecording,
	stopRecording,
	updateStatusBarItem,
	panicButton,
	commands,
	recording,
} from './recording'
import { RecordFilesProvider, type RecordFile } from './recordFilesProvider'
import { ActionsProvider } from './actionsProvider'
import {
	cleanupViewportCapture,
	cleanupTerminalCapture,
	cleanupFilesystemWatcher,
} from './capture'
import { initializeGitProvider, cleanupGitProvider } from './gitProvider'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { showConsentChangeDialog, ensureConsent } from './consent'

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
 */
function getFullPath(item: RecordFile, exportPath: string): string {
	if (item.parentPath) {
		return path.join(exportPath, item.parentPath, item.label)
	}
	return path.join(exportPath, item.label)
}

/**
 * Deletes a file or folder recursively
 */
async function deleteFileOrFolder(filePath: string): Promise<void> {
	try {
		const stat = fs.statSync(filePath)
		if (stat.isDirectory()) {
			fs.rmSync(filePath, { recursive: true, force: true })
		} else {
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
	logToOutput('Activating crowd-code v2.0', 'info')

	// Generate anonymous user ID
	const userName = process.env.USER || process.env.USERNAME || 'coder'
	const machineId = vscode.env.machineId ?? null
	const rawId = `${machineId}:${userName}`
	const anonUserId = crypto.createHash('sha256').update(rawId).digest('hex')

	extContext.globalState.update('userId', anonUserId)

	// Register userID display command
	context.subscriptions.push(
		vscode.commands.registerCommand('crowd-code.showUserId', () => {
			const userId = extContext.globalState.get<string>('userId')
			if (!userId) {
				vscode.window.showWarningMessage(
					'User ID not registered yet. Please wait a few seconds until the extension is fully activated.'
				)
				return
			}
			vscode.window.showInformationMessage(`Your User ID is: ${userId}`)
		})
	)

	// Register Record Files Provider
	const recordFilesProvider = new RecordFilesProvider()
	context.subscriptions.push(vscode.window.registerTreeDataProvider('recordFiles', recordFilesProvider))

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
		vscode.commands.registerCommand('crowd-code.deleteRecordFile', async (item: RecordFile) => {
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
		})
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

	// Register recording commands
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
			vscode.commands.executeCommand('workbench.action.openSettings', '@ext:pdoom-org.crowd-code')
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

	// Listen for configuration changes
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onConfigurationChange))

	// Initialize git provider (detects git operations for annotation)
	initializeGitProvider(context)

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9000)
	updateStatusBarItem()
	context.subscriptions.push(statusBarItem)

	// Ensure consent is obtained when the extension is first activated
	await ensureConsent()

	// Autostart recording regardless of consent. The consent only gates data upload.
	logToOutput('Autostarting recording...', 'info')
	startRecording().catch((err) => logToOutput(`Autostart recording failed unexpectedly: ${err}`, 'error'))
}

export function deactivate(): void {
	logToOutput('Deactivating crowd-code v2.0', 'info')

	if (recording.isRecording) {
		stopRecording()
	}

	// Cleanup all modules
	cleanupViewportCapture()
	cleanupTerminalCapture()
	cleanupFilesystemWatcher()
	cleanupGitProvider()

	statusBarItem.dispose()
}
