import * as vscode from 'vscode'
import { getExportPath, logToOutput, outputChannel } from './utilities'
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

export let statusBarItem: vscode.StatusBarItem
export let extContext: vscode.ExtensionContext

function onConfigurationChange(event: vscode.ConfigurationChangeEvent) {
	if (event.affectsConfiguration('vsCodeRecorder')) {
		updateStatusBarItem()
		getExportPath()
	}
}

export function activate(context: vscode.ExtensionContext): void {
	extContext = context
	outputChannel.show()
	logToOutput(vscode.l10n.t('Activating VS Code Recorder'), 'info')

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
				'@ext:mattiaconsiglio.vs-code-recorder'
			)
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
		}
	})

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9000)
	updateStatusBarItem()
	context.subscriptions.push(statusBarItem)
}

export function deactivate(): void {
	logToOutput(vscode.l10n.t('Deactivating VS Code Recorder'), 'info')
	statusBarItem.dispose()
}
