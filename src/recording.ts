import * as fs from 'node:fs'
import * as util from 'node:util'
import * as path from 'node:path'
import * as vscode from 'vscode'
import * as readline from 'node:readline'
import axios from 'axios';
import {
    getEditorFileName,
    escapeString,
    getEditorLanguage,
    notificationWithProgress,
    generateBaseFilePath,
    formatDisplayTime,
    getExportPath,
    logToOutput,
    formatSrtTime,
    getConfig,
    removeDoubleQuotes,
    unescapeString,
    addToGitignore,
} from './utilities'
import { type File, ChangeType, type CSVRowBuilder, type Change, type Recording } from './types'
import { extContext, statusBarItem, actionsProvider } from './extension'

export const commands = {
    openSettings: 'crowd-code.openSettings',
    startRecording: 'crowd-code.startRecording',
    stopRecording: 'crowd-code.stopRecording',
    panicButton: 'crowd-code.panicButton',
}

export const recording: Recording = {
    isRecording: false,
    timer: 0,
    startDateTime: null,
    endDateTime: null,
    sequence: 0,
    customFolderName: '',
    activatedFiles: new Set<string>(),
}

let intervalId: NodeJS.Timeout
const fileQueue: File[] = []
let isAppending = false

let uploadIntervalId: NodeJS.Timeout;
const sessionUuid = vscode.env.sessionId;

let panicStatusBarItem: vscode.StatusBarItem | undefined;
let panicButtonPressCount = 0;
let panicButtonTimeoutId: NodeJS.Timeout | undefined;
let accumulatedRemovedContent: Array<{content: string, sequence: number}> = []; // Store content with sequence numbers

const API_GATEWAY_URL = 'https://knm3fmbwbi.execute-api.us-east-1.amazonaws.com/v1/recordings';
const PANIC_BUTTON_TIMEOUT = 3000; // 3 seconds timeout for successive presses

/**
 * Builds a CSV row with the given parameters.
 *
 * @param {CSVRowBuilder} sequence - The sequence number of the change.
 * @param {CSVRowBuilder} rangeOffset - The offset of the changed range.
 * @param {CSVRowBuilder} rangeLength - The length of the changed range.
 * @param {CSVRowBuilder} text - The text of the change.
 * @param {string} type - The type of the change (optional, defaults to 'content').
 * @return {string} A CSV row string with the provided information.
 */
export function buildCsvRow({
    sequence,
    rangeOffset,
    rangeLength,
    text,
    type = ChangeType.CONTENT,
}: CSVRowBuilder): string | undefined {
    if (!recording.startDateTime) {
        return
    }

    const time = new Date().getTime() - recording.startDateTime.getTime()

    if (type === ChangeType.HEADING) {
        return 'Sequence,Time,File,RangeOffset,RangeLength,Text,Language,Type\n'
    }

    if (type === ChangeType.TERMINAL_FOCUS || type === ChangeType.TERMINAL_COMMAND || type === ChangeType.TERMINAL_OUTPUT) {
        return `${sequence},${time},"TERMINAL",${rangeOffset},${rangeLength},"${escapeString(text)}",,${type}\n`
    }

    const editorFileName = getEditorFileName()
    return `${sequence},${time},"${editorFileName}",${rangeOffset},${rangeLength},"${escapeString(text)}",${getEditorLanguage()},${type}\n`
}

/**
 * Checks if the current file being edited is within the configured export path.
 * This is used to determine if the current file should be recorded or not.
 *
 * @returns {boolean} `true` if the current file is within the export path, `false` otherwise.
 */
export function isCurrentFileExported(): boolean {
    const editor = vscode.window.activeTextEditor
    const filename = editor?.document.fileName.replaceAll('\\', '/')
    const exportPath = getExportPath()
    if (!editor || !filename || !exportPath) {
        return false
    }
    return filename.startsWith(exportPath)
}

const onChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
    if (!recording.isRecording) {
        return
    }

    if (isCurrentFileExported()) {
        return
    }
    const editor = vscode.window.activeTextEditor
    if (editor && event.document === editor.document) {
        for (const change of event.contentChanges) {
            recording.sequence++
            addToFileQueue(
                buildCsvRow({
                    sequence: recording.sequence,
                    rangeOffset: change.rangeOffset,
                    rangeLength: change.rangeLength,
                    text: change.text,
                })
            )
            appendToFile()
        }
    }
})

/**
 * Creates the recording folder if it doesn't exist.
 * @param folderPath - The path to the recording folder.
 */
function createRecordingFolder(folderPath: string): void {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true })
    }
}

/**
 * Starts the recording process and initializes necessary variables.
 */
export async function startRecording(): Promise<void> {
    if (recording.isRecording) {
        notificationWithProgress('Already recording')
        logToOutput('Already recording', 'info')
        return
    }
    const exportPath = getExportPath()
    if (!exportPath) {
        return
    }

    // If the setting is enabled and the path is inside the workspace, add it to .gitignore
    if (
        getConfig().get<boolean>('export.addToGitignore') &&
        getConfig().get<string>('export.exportPath')?.startsWith('${workspaceFolder}')
    ) {
        await addToGitignore()
    }

    recording.startDateTime = new Date()
    recording.activatedFiles = new Set<string>()

    // Ask for folder name if enabled in settings
    let customFolderName: string | undefined
    if (getConfig().get('recording.askFolderName')) {
        customFolderName = await vscode.window.showInputBox({
            prompt: 'Enter a name for the recording folder',
            placeHolder: 'Enter recording folder name',
        })
        if (!customFolderName) {
            stopRecording(true)
            return
        }
        recording.customFolderName = customFolderName
    }

    const baseFilePath = generateBaseFilePath(recording.startDateTime, false, recording.customFolderName, sessionUuid)
    if (!baseFilePath) {
        stopRecording(true)
        return
    }

    // Create the recording folder
    const folderPath = path.dirname(path.join(exportPath, baseFilePath))
    createRecordingFolder(folderPath)

    recording.isRecording = true
    recording.timer = 0
    recording.endDateTime = null
    recording.sequence = 0
    panicButtonPressCount = 0 // Reset panic button counter for new recording
    accumulatedRemovedContent = [] // Clear accumulated content for new recording
    if (panicButtonTimeoutId) {
        clearTimeout(panicButtonTimeoutId)
        panicButtonTimeoutId = undefined
    }
    intervalId = setInterval(() => {
        recording.timer++
        updateStatusBarItem()
    }, 1000)
    notificationWithProgress('Recording started')
    logToOutput('Recording started', 'info')

    // Only log initial editor content if there's an active text editor
    const editorText = vscode.window.activeTextEditor?.document.getText()
    const activeEditorUri = vscode.window.activeTextEditor?.document.uri.toString()

    if (editorText !== undefined && activeEditorUri) {
        recording.sequence++
        const csvRow = {
            sequence: recording.sequence,
            rangeOffset: 0,
            rangeLength: 0,
            text: editorText,
            type: ChangeType.TAB,
        }
        addToFileQueue(buildCsvRow({ ...csvRow, type: ChangeType.HEADING }))
        addToFileQueue(buildCsvRow(csvRow))
        appendToFile()
        recording.activatedFiles.add(activeEditorUri)
        actionsProvider.setCurrentFile(vscode.window.activeTextEditor?.document.fileName || '')
    } else {
        // If no active editor, just add the header row
        recording.sequence++
        addToFileQueue(buildCsvRow({ 
            sequence: recording.sequence,
            rangeOffset: 0,
            rangeLength: 0,
            text: '',
            type: ChangeType.HEADING 
        }))
        appendToFile()
    }

    extContext.subscriptions.push(onChangeSubscription)
    updateStatusBarItem()
    updatePanicButton()
    actionsProvider.setRecordingState(true)

    // Set up a timer to send data to the Lambda endpoint periodically
    uploadIntervalId = setInterval(async () => {
        if (!exportPath) {
            return;
        }

        const filePath = path.join(exportPath, `${baseFilePath}.csv`);
        const extensionVersion = extContext.extension.packageJSON.version as string;
        const userId = extContext.globalState.get<string>('userId');

        try {
            const fileContent = await fs.promises.readFile(filePath, 'utf-8');

            if (fileContent) {
                const payload = {
                    fileName: `${baseFilePath}.csv`,
                    content: fileContent,
                    version: extensionVersion,
                    userId: userId
                };
                await axios.post(API_GATEWAY_URL, payload);
                console.log(`Successfully sent ${payload.fileName} to Lambda endpoint.`);
            }
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                console.warn(`File not found at ${filePath}. It might be created on first write.`);
            } else {
                console.error(`Error sending data to Lambda: ${error.message}`);
                if (axios.isAxiosError(error) && error.response) {
                    console.error("Lambda response status:", error.response.status);
                    console.error("Lambda response data:", error.response.data);
                }
            }
        }
    }, 5 * 60 * 1000); // 5 minutes
}

/**
 * Stops the recording process and finalizes the recording data.
 * @param context - The extension context.
 */
export function stopRecording(force = false): Promise<void> | void {
    if (!recording.isRecording) {
        notificationWithProgress('Not recording')
        return
    }

    recording.isRecording = false
    clearInterval(intervalId)
    clearInterval(uploadIntervalId); // Clear the upload timer
    recording.timer = 0
    recording.activatedFiles?.clear()
    panicButtonPressCount = 0 // Reset panic button counter when recording stops
    accumulatedRemovedContent = [] // Clear accumulated content when recording stops
    if (panicButtonTimeoutId) {
        clearTimeout(panicButtonTimeoutId)
        panicButtonTimeoutId = undefined
    }
    const index = extContext.subscriptions.indexOf(onChangeSubscription)
    if (index !== -1) {
        extContext.subscriptions.splice(index, 1)
    }
    updateStatusBarItem()
    updatePanicButton()
    actionsProvider.setRecordingState(false)
    if (force) {
        notificationWithProgress('Recording cancelled')
        logToOutput('Recording cancelled', 'info')
        recording.customFolderName = undefined
        return
    }
    notificationWithProgress('Recording finished')
    logToOutput('Recording finished', 'info')
    recording.endDateTime = new Date()
    return processCsvFile().then(() => {
        // Reset customFolderName after processing is complete
        recording.customFolderName = undefined
    }).catch(err => {
        logToOutput(`Error processing CSV file during stop: ${String(err)}`, 'error')
        recording.customFolderName = undefined
    });
}

/**
 * Appends data from the file queue to the appropriate file in the workspace.
 */
export async function appendToFile(): Promise<void> {
    if (isAppending) {
        return
    }
    isAppending = true

    const exportPath = getExportPath()
    if (!exportPath) {
        logToOutput('Export path not available in appendToFile, stopping recording.', 'error')
        stopRecording(true)
        isAppending = false
        return
    }

    while (fileQueue.length > 0) {
        const itemToAppend = fileQueue.shift()
        if (!itemToAppend) {
            continue
        }

        const filePath = path.join(exportPath, itemToAppend.name)

        try {
            const directory = path.dirname(filePath)
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true })
            }
            await fs.promises.appendFile(filePath, itemToAppend.content)
        } catch (err) {
            logToOutput(
                `Failed to append to file ${filePath}: ${err}. Item dropped. Content: ${itemToAppend.content.substring(0, 100)}...`,
                'error'
            )
        }
    }
    isAppending = false
}

/**
 * Appends an SRT line to the file queue for the previous change.
 *
 * This function is responsible for generating the SRT format line for the previous change and adding it to the file queue.
 * It checks if the SRT export format is enabled, and if so, it generates the SRT line for the previous change and adds it to the file queue.
 *
 * @param processedChanges - An array of processed changes.
 * @param i - The index of the current change in the processedChanges array.
 * @param exportInSrt - A boolean indicating whether the SRT export format is enabled.
 */
function addToSRTFile(processedChanges: Change[], i: number, exportInSrt: boolean) {
    if (!exportInSrt) {
        return
    }
    if (i === 0) {
        return
    }
    addToFileQueue(
        addSrtLine(
            processedChanges[i - 1].sequence,
            processedChanges[i - 1].startTime,
            processedChanges[i - 1].endTime,
            JSON.stringify({
                text: processedChanges[i - 1].text,
                file: processedChanges[i - 1].file,
                language: processedChanges[i - 1].language,
            })
        ),
        'srt',
        true
    )
}

/**
 * Returns the new text content based on the change type and the previous change.
 * @param type - The type of the change.
 * @param text - The text of the change.
 * @param previousChange - The previous change.
 * @param rangeOffset - The offset of the range.
 * @param rangeLength - The length of the range.
 */
function getNewTextContent(
    type: string,
    text: string,
    previousChange: Change | null,
    rangeOffset: number,
    rangeLength: number
): string {
    if (type === ChangeType.TAB) {
        return text
    }
    if (!previousChange) {
        return ''
    }
    return getUpdatedText(previousChange.text, rangeOffset, rangeLength, text)
}

/**
 * Processes a single CSV line and returns the processed change
 */
async function processCSVLine(line: string, previousChange: Change | null): Promise<Change | null> {
    const lineArr = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)

    if (Number.isNaN(Number.parseInt(lineArr[0]))) {
        return null
    }

    const time = Number.parseInt(lineArr[1])
    const file = removeDoubleQuotes(lineArr[2])
    const rangeOffset = Number.parseInt(lineArr[3])
    const rangeLength = Number.parseInt(lineArr[4])
    const text = unescapeString(removeDoubleQuotes(lineArr[5]))
    const language = lineArr[6]
    const type = lineArr[7]

    const newText = getNewTextContent(type, text, previousChange, rangeOffset, rangeLength)

    /**
     * Skip exporting changes with the same values to the previous change.
     */
    if (
        previousChange &&
        time === previousChange.startTime &&
        file === previousChange.file &&
        newText === previousChange.text &&
        language === previousChange.language
    ) {
        return null
    }

    return {
        sequence: previousChange ? previousChange.sequence + 1 : 1,
        file,
        startTime: time,
        endTime: 0,
        language,
        text: newText,
    }
}

/**
 * Returns the updated text content based on the previous text, range offset, range length, and new text.
 * @param previousText - The previous text.
 * @param rangeOffset - The offset of the range.
 * @param rangeLength - The length of the range.
 * @param newText - The new text.
 */
function getUpdatedText(
    previousText: string,
    rangeOffset: number,
    rangeLength: number,
    newText: string
): string {
    const textArray = previousText.split('')
    textArray.splice(rangeOffset, rangeLength, newText)
    return textArray.join('')
}

/**
 * Processes the CSV file and generates the necessary output files.
 */
async function processCsvFile(): Promise<void> {
    if (!validateRecordingState()) {
        return
    }

    const exportFormats = getConfig().get<string[]>('export.exportFormats', [])
    if (exportFormats.length === 0) {
        logToOutput('No export formats specified', 'info')
        vscode.window.showWarningMessage('No export formats specified')
        return
    }

    const exportPath = getExportPath()
    if (!exportPath) {
        return
    }

    if (!recording.startDateTime) {
        return
    }

    // Use the same custom folder name for reading the source file
    const baseFilePathSource = generateBaseFilePath(
        recording.startDateTime,
        false,
        recording.customFolderName,
        sessionUuid
    )
    if (!baseFilePathSource) {
        return
    }

    const filePath = path.join(exportPath, `${baseFilePathSource}.csv`)

    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Source file not found: ${filePath}`)
        }

        const processedChanges: Change[] = []

        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Number.POSITIVE_INFINITY,
        })

        for await (const line of rl) {
            const previousChange = processedChanges[processedChanges.length - 1]
            const change = await processCSVLine(line, previousChange)

            if (change) {
                if (previousChange) {
                    previousChange.endTime = change.startTime
                    if (exportFormats.includes('SRT')) {
                        addToSRTFile(processedChanges, processedChanges.length, true)
                    }
                }
                processedChanges.push(change)
            }
        }

        rl.close();

        return finalizeRecording(processedChanges, exportFormats);

    } catch (err) {
        vscode.window.showErrorMessage(`Error processing recording: ${err}`)
        logToOutput('Error processing CSV file: ' + String(err), 'error')
        return Promise.resolve(); // Resolve even on error after showing message
    }
}

function validateRecordingState(): boolean {
    if (!vscode.workspace.workspaceFolders) {
        logToOutput(
            'No workspace folder found. To process the recording is needed a workspace folder',
            'error'
        )
        return false
    }
    if (!recording.endDateTime || !recording.startDateTime) {
        logToOutput('Recording date time is not properly set', 'error')
        return false
    }
    return true
}

function finalizeRecording(processedChanges: Change[], exportFormats: string[]): Promise<void> {
    const lastChange = processedChanges[processedChanges.length - 1]
    if (lastChange && recording.endDateTime && recording.startDateTime) {
        lastChange.endTime = recording.endDateTime.getTime() - recording.startDateTime.getTime()
        if (exportFormats.includes('SRT')) {
            addToSRTFile(processedChanges, processedChanges.length, true)
        }
    }
    if (exportFormats.includes('JSON')) {
        addToFileQueue(JSON.stringify(processedChanges), 'json', true)
    }
    return appendToFile().then(() => {
        // Refresh the recordFiles view after export is complete
        vscode.commands.executeCommand('crowd-code.refreshRecordFiles')
    })
}

/**
 * Adds a line to the SRT file format.
 * @param sequence - The sequence number of the change.
 * @param start - The start time of the change.
 * @param end - The end time of the change.
 * @param text - The text of the change.
 * @returns A string representing a line in the SRT file format.
 */
function addSrtLine(sequence: number, start: number, end: number, text: string): string {
    return `${sequence}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n\n`
}

/**
 * Adds content to the file queue.
 * @param content - The content to add.
 * @param fileExtension - The file extension (optional, defaults to 'csv').
 */
export function addToFileQueue(
    content: string | undefined,
    fileExtension = 'csv',
    isExport = false
): void {
    if (!content) {
        return
    }
    if (!recording.startDateTime) {
        return
    }
    // Use the same custom name throughout the recording session
    const baseFilePath = generateBaseFilePath(recording.startDateTime, isExport, recording.customFolderName, sessionUuid)
    if (!baseFilePath) {
        return
    }
    fileQueue.push({
        name: `${baseFilePath}.${fileExtension}`,
        content: content,
    })
}

/**
 * Updates the status bar item with the current recording status and time.
 */
export function updateStatusBarItem(): void {
    if (recording.isRecording) {
        if (getConfig().get('appearance.showTimer') === false) {
            statusBarItem.text = '$(debug-stop)'
            statusBarItem.tooltip = 'Current time: ' + formatDisplayTime(recording.timer)
        }
        if (getConfig().get('appearance.showTimer') === true) {
            statusBarItem.text = '$(debug-stop) ' + formatDisplayTime(recording.timer)
            statusBarItem.tooltip = 'Stop Recording'
        }
        statusBarItem.command = commands.stopRecording
        statusBarItem.show()
    } else {
        const editor = vscode.window.activeTextEditor
        if (!editor) {
            statusBarItem.hide()
            return
        }
        if (getConfig().get('appearance.minimalMode') === true) {
            statusBarItem.text = '$(circle-large-filled)'
        } else {
            statusBarItem.text = '$(circle-large-filled) Start Recording'
        }
        statusBarItem.tooltip = 'Start Recording'
        statusBarItem.command = commands.startRecording
        statusBarItem.show()
    }
}

/**
 * Creates and updates the panic button status bar item.
 */
export function updatePanicButton(): void {
    if (!recording.isRecording) {
        if (panicStatusBarItem) {
            panicStatusBarItem.hide()
        }
        return
    }

    // Create panic button if it doesn't exist
    if (!panicStatusBarItem) {
        panicStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 8999) // Position it to the left of the recording button
        extContext.subscriptions.push(panicStatusBarItem)
    }

    const secondsToRemove = (panicButtonPressCount + 1) * 10 // Show what the next press will remove
    panicStatusBarItem.text = '$(refresh)'
    panicStatusBarItem.tooltip = `Remove last ${secondsToRemove} seconds of recording (click again within 3 seconds to remove more)`
    panicStatusBarItem.command = commands.panicButton
    panicStatusBarItem.show()
}

/**
 * Deletes the last N seconds of recording data from the CSV file.
 * This is a "panic button" feature that allows users to quickly remove recent sensitive data.
 * Each successive press within 3 seconds removes more time: 10s, 20s, 30s, etc.
 * After 3 seconds of inactivity, the next press will be treated as a fresh press (10s).
 */
export async function panicButton(): Promise<void> {
    if (!recording.isRecording) {
        vscode.window.showWarningMessage('No active recording to remove data from')
        logToOutput('No active recording to remove data from', 'info')
        return
    }

    if (!recording.startDateTime) {
        vscode.window.showErrorMessage('Recording start time not available')
        logToOutput('Recording start time not available', 'error')
        return
    }

    const exportPath = getExportPath()
    if (!exportPath) {
        vscode.window.showErrorMessage('Export path not available')
        logToOutput('Export path not available', 'error')
        return
    }

    const baseFilePath = generateBaseFilePath(recording.startDateTime, false, recording.customFolderName, sessionUuid)
    if (!baseFilePath) {
        vscode.window.showErrorMessage('Could not generate file path')
        logToOutput('Could not generate file path', 'error')
        return
    }

    const filePath = path.join(exportPath, `${baseFilePath}.csv`)

    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            vscode.window.showWarningMessage('No recording file found to remove data from')
            logToOutput('No recording file found to remove data from', 'info')
            return
        }

        // Read the file
        const content = fs.readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')
        
        if (lines.length <= 1) {
            vscode.window.showWarningMessage('Recording file is empty, nothing to remove')
            logToOutput('Recording file is empty, nothing to remove', 'info')
            return
        }

        // Calculate how many lines to remove (10 seconds per press)
        const linesToRemove = Math.min((panicButtonPressCount + 1) * 10, lines.length - 1)
        const newLines = lines.slice(0, lines.length - linesToRemove)
        
        // Capture the lines that will be removed for display
        const removedLines = lines.slice(lines.length - linesToRemove)

        // Write back to file
        fs.writeFileSync(filePath, newLines.join('\n'))

        // Update panic button state
        panicButtonPressCount++
        
        // Set up timeout to reset the counter after 3 seconds of inactivity
        if (panicButtonTimeoutId) {
            clearTimeout(panicButtonTimeoutId)
        }
        panicButtonTimeoutId = setTimeout(() => {
            panicButtonPressCount = 0
            accumulatedRemovedContent = [] // Clear accumulated content
            updatePanicButton()
        }, PANIC_BUTTON_TIMEOUT)
        
        updatePanicButton()

        const secondsToRemove = panicButtonPressCount * 10
        const actualLinesRemoved = lines.length - newLines.length
        
        // Accumulate removed content and show immediate popup
        if (removedLines.length > 0) {
            const nonEmptyLines = removedLines.filter(line => line.trim())
            if (nonEmptyLines.length > 0) {
                // Create a simple, readable summary of removed content
                const contentSummary = nonEmptyLines.map(line => {
                    // Extract just the text content from CSV for cleaner display
                    const parts = line.split(',')
                    if (parts.length >= 6) {
                        const textContent = parts[5].replace(/^"|"$/g, '') // Remove quotes
                        // Clean up common escape sequences
                        const cleanText = textContent
                            .replace(/\\n/g, '\n')
                            .replace(/\\t/g, '\t')
                            .replace(/\\r/g, '\r')
                        return { content: cleanText, sequence: Number.parseInt(parts[0]) }
                    }
                    return { content: line, sequence: Number.parseInt(line.split(',')[0]) }
                }).filter(item => item.content.trim().length > 0)
                
                // Add to accumulated content
                accumulatedRemovedContent.push(...contentSummary)
                
                // Sort by sequence number to show in original file order
                const sortedContent = accumulatedRemovedContent.sort((a, b) => a.sequence - b.sequence)
                
                // Show immediate popup with accumulated content
                const totalContent = sortedContent.map(item => item.content).join(' ')
                const summaryText = totalContent.length > 100 
                    ? totalContent.substring(0, 100) + '...' 
                    : totalContent
                
                vscode.window.showInformationMessage(
                    `Removed content: "${summaryText}"`,
                    'Dismiss'
                )
            }
        }

    } catch (error) {
        const errorMessage = `Error during panic button operation: ${error}`
        vscode.window.showErrorMessage(errorMessage)
        logToOutput(errorMessage, 'error')
    }
}