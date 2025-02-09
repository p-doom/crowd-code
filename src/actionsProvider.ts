import * as vscode from 'vscode'
import { commands } from './recording'
import { getConfig } from './utilities'

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

	constructor() {
		// Update timer every second when recording
		setInterval(() => {
			if (this._isRecording) {
				this._timer++
				this.refresh()
			}
		}, 1000)
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
			const currentFile = new ActionItem(
				`${vscode.l10n.t('Current File: {fileName}', {
					fileName: vscode.workspace.asRelativePath(this._currentFile),
				})}`,
				vscode.TreeItemCollapsibleState.None,
				undefined,
				'file'
			)

			items.push(currentFile)
		}

		return items
	}
}
