import * as assert from 'node:assert'
import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { setDefaultOptions, getConfig } from '../utilities'
import { statusBarItem } from '../extension'

/**
 * Waits for the specified number of milliseconds and then resolves the returned Promise.
 * @param ms - The number of milliseconds to wait. Defaults to 500 ms.
 * @returns A Promise that resolves after the specified number of milliseconds.
 */
const waitMs = (ms = 500) => new Promise(resolve => setTimeout(resolve, ms))

suite('Recording Tests', () => {
	const publisher = 'MattiaConsiglio'
	const extensionName = 'vs-code-recorder'

	let workspaceFolder: string

	let statusBarSpy: vscode.StatusBarItem

	vscode.window.showInformationMessage('Start all tests.')

	setup(async () => {
		// biome-ignore lint/style/noNonNullAssertion: the workspace folder is created by the test suite
		workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath
		setDefaultOptions()
		// set workspace export path
		getConfig().update(
			'export.exportPath',
			'${workspaceFolder}',
			vscode.ConfigurationTarget.Workspace
		)
		statusBarSpy = statusBarItem
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)
	})

	teardown(async () => {
		// First ensure recording is stopped
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)

		// Add small delay to ensure VS Code releases file handles
		await vscode.commands.executeCommand('workbench.action.closeAllEditors')
		await waitMs(100)

		if (workspaceFolder) {
			const files = fs.readdirSync(workspaceFolder)
			for (const file of files) {
				if (file.endsWith('.csv') || file.endsWith('.json') || file.endsWith('.srt')) {
					fs.unlinkSync(path.join(workspaceFolder, file))
				}
			}
		}
	})

	test('Should be visible the status bar item', async () => {
		// Wait for status bar item to be created
		await waitMs()

		assert.strictEqual(
			statusBarSpy.text.includes('$(circle-large-filled)'),
			true,
			'Should be visible the circle icon'
		)
		assert.strictEqual(
			statusBarSpy.tooltip?.toString().includes('Start Recording'),
			true,
			'The tooltip should be "Start Recording"'
		)
	})

	test('Should start recording when start command is executed', async () => {
		// Execute start recording command
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)

		// Get status bar state through the extension's status bar item
		assert.strictEqual(
			statusBarSpy.text.includes('$(debug-stop)'),
			true,
			'Should be visible the stop icon'
		)
		assert.strictEqual(
			statusBarSpy.tooltip?.toString().includes('Stop Recording'),
			true,
			"Status bar item tooltip should be 'Stop Recording'"
		)
	})

	test('Should create CSV file when recording starts', async () => {
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)

		// Wait for file creation
		await waitMs(1000)

		const files = fs.readdirSync(workspaceFolder)
		const csvFile = files.find(file => file.endsWith('.csv'))

		assert.ok(csvFile, 'CSV file should be created')

		// Cleanup
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)
	})

	test('Should stop recording when stop command is executed', async () => {
		// Start recording first
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)
		await waitMs(1000)

		// Stop recording
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)

		// Check status bar
		assert.strictEqual(statusBarSpy.text.includes('$(circle-large-filled)'), true)
		assert.strictEqual(statusBarSpy.tooltip?.toString().includes('Start Recording'), true)
	})

	test('Should generate output files when stopping recording', async () => {
		// Configure export formats
		await vscode.workspace
			.getConfiguration('vsCodeRecorder.export')
			.update('exportFormats', ['JSON', 'SRT'])

		// Start and stop recording
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)
		await waitMs(1000)
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)
		await waitMs()

		// Check for output files
		const files = fs.readdirSync(workspaceFolder)
		const jsonFile = files.find(file => file.endsWith('.json'))
		const srtFile = files.find(file => file.endsWith('.srt'))

		assert.ok(jsonFile, 'JSON file should be created')
		assert.ok(srtFile, 'SRT file should be created')
	})
})
