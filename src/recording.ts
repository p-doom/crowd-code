import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import * as readline from 'node:readline'
import axios from 'axios'
import { hasConsent, showConsentChangeDialog } from './consent'
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
import { type File, ChangeType, type CSVRowBuilder, type Change, type Recording, type ConsentStatus } from './types'
import { extContext, statusBarItem, actionsProvider } from './extension'

export const commands = {
    openSettings: 'vs-code-recorder.openSettings',
    startRecording: 'vs-code-recorder.startRecording',
    stopRecording: 'vs-code-recorder.stopRecording',
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

const API_GATEWAY_URL = 'https://knm3fmbwbi.execute-api.us-east-1.amazonaws.com/v1/recordings';


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
    if (!vscode.window.activeTextEditor) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active text editor'))
        logToOutput(vscode.l10n.t('No active text editor'), 'info')
        return
    }
    
    if (recording.isRecording) {
        notificationWithProgress(vscode.l10n.t('Already recording'))
        logToOutput(vscode.l10n.t('Already recording'), 'info')
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
            prompt: vscode.l10n.t('Enter a name for the recording folder'),
            placeHolder: vscode.l10n.t('Enter recording folder name'),
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
    intervalId = setInterval(() => {
        recording.timer++
        updateStatusBarItem()
    }, 1000)
    notificationWithProgress(vscode.l10n.t('Recording started'))
    logToOutput(vscode.l10n.t('Recording started'), 'info')

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
        actionsProvider.setCurrentFile(vscode.window.activeTextEditor.document.fileName)
    }

    extContext.subscriptions.push(onChangeSubscription)
    updateStatusBarItem()
    actionsProvider.setRecordingState(true)

    // Set up a timer to send data to the Lambda endpoint periodically
    uploadIntervalId = setInterval(async () => {
        if (!exportPath) {
            return;
        }

        // Only upload data if user has given consent
        if (!hasConsent()) {
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
        notificationWithProgress(vscode.l10n.t('Not recording'))
        return
    }

    recording.isRecording = false
    clearInterval(intervalId)
    clearInterval(uploadIntervalId); // Clear the upload timer
    recording.timer = 0
    recording.activatedFiles?.clear()
    const index = extContext.subscriptions.indexOf(onChangeSubscription)
    if (index !== -1) {
        extContext.subscriptions.splice(index, 1)
    }
    updateStatusBarItem()
    actionsProvider.setRecordingState(false)
    if (force) {
        notificationWithProgress(vscode.l10n.t('Recording cancelled'))
        logToOutput(vscode.l10n.t('Recording cancelled'), 'info')
        recording.customFolderName = undefined
        return
    }
    notificationWithProgress(vscode.l10n.t('Recording finished'))
    logToOutput(vscode.l10n.t('Recording finished'), 'info')
    recording.endDateTime = new Date()
    return processCsvFile().then(() => {
        // Reset customFolderName after processing is complete
        recording.customFolderName = undefined
    }).catch(err => {
        logToOutput(vscode.l10n.t('Error processing CSV file during stop: {0}', String(err)), 'error')
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
        logToOutput(vscode.l10n.t('No export formats specified'), 'info')
        vscode.window.showWarningMessage(vscode.l10n.t('No export formats specified'))
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
        logToOutput(vscode.l10n.t('Error processing CSV file: {0}', String(err)), 'error')
        return Promise.resolve(); // Resolve even on error after showing message
    }
}

function validateRecordingState(): boolean {
    if (!vscode.workspace.workspaceFolders) {
        logToOutput(
            vscode.l10n.t(
                'No workspace folder found. To process the recording is needed a workspace folder'
            ),
            'error'
        )
        return false
    }
    if (!recording.endDateTime || !recording.startDateTime) {
        logToOutput(vscode.l10n.t('Recording date time is not properly set'), 'error')
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
        vscode.commands.executeCommand('vs-code-recorder.refreshRecordFiles')
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
    const editor = vscode.window.activeTextEditor
    if (!editor && !recording) {
        statusBarItem.hide()
        return
    }
    if (recording.isRecording) {
        if (getConfig().get('appearance.showTimer') === false) {
            statusBarItem.text = '$(debug-stop)'
            statusBarItem.tooltip = vscode.l10n.t('Current time: {0}', formatDisplayTime(recording.timer))
        }
        if (getConfig().get('appearance.showTimer') === true) {
            statusBarItem.text = `$(debug-stop) ${formatDisplayTime(recording.timer)}`
            statusBarItem.tooltip = vscode.l10n.t('Stop Recording')
        }
        statusBarItem.command = commands.stopRecording
    } else {
        if (getConfig().get('appearance.minimalMode') === true) {
            statusBarItem.text = '$(circle-large-filled)'
        } else {
            statusBarItem.text = `$(circle-large-filled) ${vscode.l10n.t('Start Recording')}`
        }
        statusBarItem.tooltip = vscode.l10n.t('Start Recording')
        statusBarItem.command = commands.startRecording
    }
    statusBarItem.show()
}