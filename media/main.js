const vscode = acquireVsCodeApi()

function startRecording() {
	vscode.postMessage({ type: 'startRecording' })
}

function stopRecording() {
	vscode.postMessage({ type: 'stopRecording' })
}
