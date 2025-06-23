import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getConfig } from './utilities'
import { commands } from './recording'

export class ActionItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command,
		public readonly iconId?: string
	) {
		super(label, collapsibleState)
		if (iconId) {
			this.iconPath = new vscode.ThemeIcon(iconId)
		}
	}
}

export class ActionsProvider implements vscode.TreeDataProvider<ActionItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<ActionItem | undefined | null> =
		new vscode.EventEmitter<ActionItem | undefined | null>()
	readonly onDidChangeTreeData: vscode.Event<ActionItem | undefined | null> =
		this._onDidChangeTreeData.event

	private _timer = 0
	private _isRecording = false
	private _currentFile = ''
	private _gitignoreWatcher: vscode.FileSystemWatcher | undefined

	constructor() {
		// Update timer every second when recording
		setInterval(() => {
			if (this._isRecording) {
				this._timer++
				this.refresh()
			}
		}, 1000)

		// Watch for .gitignore changes
		this.setupGitignoreWatcher()
	}

	private setupGitignoreWatcher() {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (workspaceFolder) {
			this._gitignoreWatcher?.dispose()
			this._gitignoreWatcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(workspaceFolder, '.gitignore')
			)

			this._gitignoreWatcher.onDidCreate(() => this.refresh())
			this._gitignoreWatcher.onDidChange(() => this.refresh())
			this._gitignoreWatcher.onDidDelete(() => this.refresh())
		}
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined)
	}

	getTreeItem(element: ActionItem): vscode.TreeItem {
		return element
	}

	setRecordingState(isRecording: boolean): void {
		this._isRecording = isRecording
		if (!isRecording) {
			this._timer = 0
			this._currentFile = ''
		}
		this.refresh()
	}

	setCurrentFile(fileName: string): void {
		this._currentFile = fileName
		this.refresh()
	}

	formatTime(seconds: number): string {
		const hours = Math.floor(seconds / 3600)
		const minutes = Math.floor((seconds % 3600) / 60)
		const remainingSeconds = seconds % 60
		return `${hours.toString().padStart(2, '0')}:${minutes
			.toString()
			.padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
	}

	private shouldShowGitignoreButton(): boolean {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			return false
		}

		const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore')
		const exportPath = getConfig().get<string>('export.exportPath')

		if (!exportPath) {
			return false
		}

		// If .gitignore doesn't exist, show the button
		if (!fs.existsSync(gitignorePath)) {
			return false
		}

		// Get the relative path from workspace folder
		let relativePath = exportPath
		if (exportPath.startsWith('${workspaceFolder}')) {
			relativePath = exportPath.replace('${workspaceFolder}', '').replace(/\\/g, '/')
		}
		// Remove leading and trailing slashes
		relativePath = relativePath.replace(/^\/+|\/+$/g, '')

		// Check if the path is already in .gitignore
		const content = fs.readFileSync(gitignorePath, 'utf8')
		return !content.split('\n').some(line => line.trim() === relativePath)
	}

	async getChildren(element?: ActionItem): Promise<ActionItem[]> {
		if (element) {
			return []
		}

		const items: ActionItem[] = []

		// Record/Stop button
		const recordButton = new ActionItem(
			this._isRecording ? 'Stop Recording' : 'Start Recording',
			vscode.TreeItemCollapsibleState.None,
			{
				command: this._isRecording ? commands.stopRecording : commands.startRecording,
				title: this._isRecording ? 'Stop Recording' : 'Start Recording',
			},
			this._isRecording ? 'debug-stop' : 'record'
		)
		items.push(recordButton)

		// Timer (only when recording or when showTimer is enabled)
		if (this._isRecording || getConfig().get('appearance.showTimer')) {
			const timer = new ActionItem(
				this.formatTime(this._timer),
				vscode.TreeItemCollapsibleState.None,
				undefined,
				'watch'
			)
			items.push(timer)
		}

		// Current file (only when recording)
		if (this._isRecording && this._currentFile) {
			const prefix = this._currentFile.startsWith('Terminal:') ? '' : 'Current File: '
			const displayedFile = this._currentFile.startsWith('Terminal:') ? this._currentFile : vscode.workspace.asRelativePath(this._currentFile)
			const currentFile = new ActionItem(
				`${prefix}${displayedFile}`,
				vscode.TreeItemCollapsibleState.None,
				undefined,
				'file'
			)
			items.push(currentFile)
		}

		// Add to .gitignore action (only if .gitignore exists and path is not already in it)
		if (this.shouldShowGitignoreButton()) {
			const addToGitignoreButton = new ActionItem(
				'Add to .gitignore',
				vscode.TreeItemCollapsibleState.None,
				{
					command: 'crowd-code.addToGitignore',
					title: 'Add to .gitignore',
				},
				'git-ignore'
			)
			items.push(addToGitignoreButton)
		}

		return items
	}

	dispose() {
		this._gitignoreWatcher?.dispose()
	}
}
