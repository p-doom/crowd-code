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
	const publisher = 'pdoom-org'
	const extensionName = 'crowd-code'

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
				if (file !== '.vscode') {
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

	test('Should create recording folder when recording starts', async () => {
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)

		// Wait for folder creation
		await waitMs(1000)

		const items = fs.readdirSync(workspaceFolder)
		const recordingFolder = items.find(item => {
			const itemPath = path.join(workspaceFolder, item)
			return fs.statSync(itemPath).isDirectory() && item.startsWith('crowd-code-')
		})

		assert.ok(recordingFolder, 'Recording folder should be created')

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

	test('Should record file changes and verify JSON export', async () => {
		// Create and write to new file using VS Code API
		const testFileUri = vscode.Uri.file(path.join(workspaceFolder, 'test.txt'))
		const initialContent = 'This is an example recording'
		await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(''))

		// Open file in VS Code
		const doc = await vscode.workspace.openTextDocument(testFileUri)
		const editor = await vscode.window.showTextDocument(doc)

		// Start recording
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)
		await waitMs(1000)

		// Make edits
		await editor.edit(editBuilder => {
			editBuilder.insert(new vscode.Position(0, 0), initialContent)
		})
		await waitMs(1000)

		// Select text to remove
		const textToRemove = 'n example'
		const startPos = initialContent.indexOf(textToRemove)
		await editor.edit(editBuilder => {
			editBuilder.replace(
				new vscode.Range(
					new vscode.Position(0, startPos),
					new vscode.Position(0, startPos + textToRemove.length)
				),
				''
			)
		})
		await waitMs(1000)

		// Stop recording and wait for export
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)
		await waitMs(1000)

		// Verify JSON export
		const items = fs.readdirSync(workspaceFolder)
		const recordingFolder = items.find(item => {
			const itemPath = path.join(workspaceFolder, item)
			return fs.statSync(itemPath).isDirectory() && item.startsWith('crowd-code-')
		})

		assert.ok(recordingFolder, 'Recording folder should be created')

		const recordingFolderPath = path.join(workspaceFolder, recordingFolder)
		const files = fs.readdirSync(recordingFolderPath)
		const jsonFile = files.find(f => f.endsWith('.json'))

		assert.ok(jsonFile, 'JSON file should be created')
		
		const jsonContent = JSON.parse(fs.readFileSync(path.join(recordingFolderPath, jsonFile), 'utf-8'))
		assert.strictEqual(jsonContent.version, '2.0', 'JSON should have version 2.0')
		assert.ok(Array.isArray(jsonContent.events), 'JSON should have events array')
		
		// Verify recording captured the text changes
		const editEvents = jsonContent.events.filter((event: any) => event.action?.type === 'edit')
		assert.ok(editEvents.length > 0, 'Should have edit events')
	})
})
