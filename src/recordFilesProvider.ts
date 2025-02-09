import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getExportPath } from './utilities'

export class RecordFile extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState)
	}
}

export class RecordFilesProvider implements vscode.TreeDataProvider<RecordFile> {
	private readonly _onDidChangeTreeData: vscode.EventEmitter<RecordFile | undefined | null> =
		new vscode.EventEmitter<RecordFile | undefined | null>()
	readonly onDidChangeTreeData: vscode.Event<RecordFile | undefined | null> =
		this._onDidChangeTreeData.event

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined)
	}

	getTreeItem(element: RecordFile): vscode.TreeItem {
		return element
	}

	async getChildren(element?: RecordFile): Promise<RecordFile[]> {
		if (element) {
			return []
		}

		const exportPath = getExportPath()
		if (!exportPath) {
			return []
		}

		try {
			const files = fs.readdirSync(exportPath)
			return files
				.filter(file => file.startsWith('vs-code-recorder-'))
				.map(file => {
					const filePath = path.join(exportPath, file)
					return new RecordFile(file, vscode.TreeItemCollapsibleState.None, {
						command: 'vscode.open',
						title: 'Open File',
						arguments: [vscode.Uri.file(filePath)],
					})
				})
		} catch (err) {
			console.error('Error reading directory:', err)
			return []
		}
	}
}
