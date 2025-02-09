import * as vscode from 'vscode'
import * as path from 'node:path'
import { recording, commands } from './recording'
import { formatDisplayTime } from './utilities'

export class RecordFilesViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'vs-code-recorder.recordFiles'
	private _view?: vscode.WebviewView

	constructor(private readonly _extensionUri: vscode.Uri) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri],
		}

		// Aggiorna il contenuto ogni secondo per mostrare il timer
		setInterval(() => {
			if (this._view) {
				this._view.webview.html = this._getHtmlForWebview(webviewView.webview)
			}
		}, 1000)

		// Gestisce i messaggi dal webview
		webviewView.webview.onDidReceiveMessage(async data => {
			switch (data.type) {
				case 'startRecording':
					vscode.commands.executeCommand(commands.startRecording)
					break
				case 'stopRecording':
					vscode.commands.executeCommand(commands.stopRecording)
					break
			}
		})

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js')
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
		)

		const recordingStatus = recording.isRecording
			? `<div class="recording-status">
					<span class="recording-indicator"></span>
					Registrazione in corso: ${formatDisplayTime(recording.timer)}
				</div>`
			: ''

		const actionButton = recording.isRecording
			? `<button class="action-button stop" onclick="stopRecording()">
					<i class="codicon codicon-debug-stop"></i>
					Ferma Registrazione
				</button>`
			: `<button class="action-button start" onclick="startRecording()">
					<i class="codicon codicon-circle-large-filled"></i>
					Inizia Registrazione
				</button>`

		return `<!DOCTYPE html>
			<html lang="it">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleUri}" rel="stylesheet">
				<title>VS Code Recorder</title>
			</head>
			<body>
				<div class="container">
					${actionButton}
					${recordingStatus}
					<div class="recordings-list">
						<!-- Qui andrà la lista dei file registrati -->
					</div>
				</div>
				<script src="${scriptUri}"></script>
			</body>
			</html>`
	}
}
