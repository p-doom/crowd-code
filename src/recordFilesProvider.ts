import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getExportPath } from './utilities'

export class RecordFile extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command,
		public readonly isFolder: boolean = false
	) {
		super(label, collapsibleState)

		if (isFolder) {
			this.iconPath = new vscode.ThemeIcon('folder')
			this.contextValue = 'folder'
		} else {
			this.iconPath = new vscode.ThemeIcon('file')
			this.contextValue = 'file'
		}
	}
}

export class RecordFilesProvider implements vscode.TreeDataProvider<RecordFile> {
	private _onDidChangeTreeData: vscode.EventEmitter<RecordFile | undefined | null> =
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
		const exportPath = getExportPath()
		if (!exportPath) {
			return []
		}

		try {
			// If no element is provided, show both folders and files in the root
			if (!element) {
				const items = fs.readdirSync(exportPath)
				const folders: RecordFile[] = []
				const files: RecordFile[] = []

				for (const item of items) {
					const itemPath = path.join(exportPath, item)
					const isDirectory = fs.statSync(itemPath).isDirectory()

					if (isDirectory && item.startsWith('vs-code-recorder-')) {
						folders.push(
							new RecordFile(item, vscode.TreeItemCollapsibleState.Collapsed, undefined, true)
						)
					} else if (
						!isDirectory &&
						(item.endsWith('.json') || item.endsWith('.srt') || item.endsWith('.csv')) &&
						item.startsWith('vs-code-recorder-')
					) {
						files.push(
							new RecordFile(item, vscode.TreeItemCollapsibleState.None, {
								command: 'vscode.open',
								title: 'Open File',
								arguments: [vscode.Uri.file(itemPath)],
							})
						)
					}
				}

				// Sort folders and files in descending order (newest first)
				folders.sort((a, b) => b.label.localeCompare(a.label))
				files.sort((a, b) => b.label.localeCompare(a.label))

				return [...folders, ...files]
			}

			// If an element is provided, show its contents
			const folderPath = path.join(exportPath, element.label)
			const files = fs
				.readdirSync(folderPath)
				.filter(file => file.endsWith('.json') || file.endsWith('.srt') || file.endsWith('.csv'))
				.map(
					file =>
						new RecordFile(file, vscode.TreeItemCollapsibleState.None, {
							command: 'vscode.open',
							title: 'Open File',
							arguments: [vscode.Uri.file(path.join(folderPath, file))],
						})
				)
			return files
		} catch (err) {
			console.error('Error reading directory:', err)
			return []
		}
	}
}
