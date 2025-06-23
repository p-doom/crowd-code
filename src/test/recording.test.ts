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

	test('Should not generate output files when stopping recording', async () => {
		// Configure export formats (none)
		await getConfig().update('exportFormats', [])

		// Start and stop recording
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)
		await waitMs(1000)
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)
		await waitMs()

		// Check for output files
		const files = fs.readdirSync(workspaceFolder)
		const jsonFile = files.find(file => file.endsWith('.json'))
		const srtFile = files.find(file => file.endsWith('.srt'))

		assert.ok(!jsonFile, 'JSON file should NOT be created')
		assert.ok(!srtFile, 'SRT file should NOT be created')
	})

	test('Should generate JSON output file when stopping recording', async () => {
		// Configure export formats
		await getConfig().update('exportFormats', ['JSON'])

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
		assert.ok(!srtFile, 'SRT file should NOT be created')
	})

	test('Should generate SRT output file when stopping recording', async () => {
		// Configure export formats
		await getConfig().update('exportFormats', ['SRT'])

		// Start and stop recording
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)
		await waitMs(1000)
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)
		await waitMs()

		// Check for output files
		const files = fs.readdirSync(workspaceFolder)
		const jsonFile = files.find(file => file.endsWith('.json'))
		const srtFile = files.find(file => file.endsWith('.srt'))

		assert.ok(!jsonFile, 'JSON file should NOT be created')
		assert.ok(srtFile, 'SRT file should be created')
	})

	test('Should generate output files (JSON, SRT) when stopping recording', async () => {
		// Configure export formats
		await getConfig().update('exportFormats', ['JSON', 'SRT'])

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

	const testCsvFile = (csvPath: string, expectedLines: string[]) => {
		const csvContent = fs.readFileSync(csvPath, 'utf-8')
		const lines = csvContent.split('\n').filter(line => line.trim() !== '')

		assert.strictEqual(
			lines.length,
			expectedLines.length,
			'Number of lines in CSV file should match expected lines'
		)

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			let expectedLine = expectedLines[i]

			const timestampIndex = expectedLine.indexOf('%n')
			if (timestampIndex !== -1) {
				const commaIndex = expectedLine.indexOf(',', timestampIndex + 1)
				expectedLine = expectedLine.replace('%n', line.substring(0, commaIndex))
			}
			assert.strictEqual(
				lines[i],
				expectedLines[i],
				`Line ${i + 1} in CSV file should match expected line`
			)
		}
	}

	test('Should record file changes and verify exports', async () => {
		// Create and write to new file using VS Code API
		const testFileUri = vscode.Uri.file(path.join(workspaceFolder, 'test.txt'))
		const initialContent = 'This is an example recording'
		await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(''))

		// Open file in VS Code
		const doc = await vscode.workspace.openTextDocument(testFileUri)
		const editor = await vscode.window.showTextDocument(doc)

		// Start recording
		await vscode.commands.executeCommand(`${extensionName}.startRecording`)
		await waitMs()

		// Get CSV path
		const csvFilename = fs.readdirSync(workspaceFolder).find(f => f.endsWith('.csv'))

		assert.strictEqual(csvFilename !== undefined, true, 'CSV file should be created')

		if (csvFilename === undefined) {
			return
		}
		const csvPath = path.join(workspaceFolder, csvFilename)

		const csvExpectedLines = [
			'Sequence,Time,File,RangeOffset,RangeLength,Text,Language,Type',
			'1,%n,"test.txt",0,0,"",plaintext,tab',
		]
		testCsvFile(csvPath, csvExpectedLines)

		await editor.edit(editBuilder => {
			editBuilder.insert(new vscode.Position(0, 0), initialContent)
		})
		await waitMs(1000)

		csvExpectedLines.push('2,%n,"test.txt",0,0,"This is an example recording",plaintext,content')
		testCsvFile(csvPath, csvExpectedLines)

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

		csvExpectedLines.push('3,%n,"test.txt",0,0,"This is a recording",plaintext,content')
		testCsvFile(csvPath, csvExpectedLines)

		// Stop recording and wait for export
		await vscode.commands.executeCommand(`${extensionName}.stopRecording`)
		await waitMs(1000)

		// Verify exports
		const files = fs.readdirSync(workspaceFolder)
		const jsonFile = files.find(f => f.endsWith('.json'))
		const srtFile = files.find(f => f.endsWith('.srt'))

		if (jsonFile) {
			const jsonContent = JSON.parse(fs.readFileSync(path.join(workspaceFolder, jsonFile), 'utf-8'))
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			assert.ok(jsonContent.some((change: any) => change.text.includes(initialContent)))
			// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			assert.ok(jsonContent.some((change: any) => change.text.includes('This is a recording')))
		}

		if (srtFile) {
			const srtContent = fs.readFileSync(path.join(workspaceFolder, srtFile), 'utf-8')
			assert.ok(srtContent.includes(initialContent))
			assert.ok(srtContent.includes('This is a recording'))
		}
	})
})
