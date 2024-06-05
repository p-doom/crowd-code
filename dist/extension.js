/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.deactivate = exports.activate = void 0;
/* eslint-disable @typescript-eslint/semi */
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(__webpack_require__(1));
let recording = false;
let myStatusBarItem;
const startRecordingCommand = 'vs-code-recorder.startRecording';
const stopRecordingCommand = 'vs-code-recorder.stopRecording';
let timer = 0;
let intervalId;
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Activating VS Code Recorder');
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    context.subscriptions.push(vscode.commands.registerCommand(startRecordingCommand, () => {
        startRecording();
    }));
    context.subscriptions.push(vscode.commands.registerCommand(stopRecordingCommand, () => {
        stopRecording();
    }));
    const disposable3 = vscode.commands.registerCommand('vs-code-recorder.init', () => { });
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            // Code to handle changes in the focused tab
            const fileName = editor.document.fileName;
            console.log('Focused tab changed', fileName);
        }
    });
    let disposable4 = vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor && event.document === editor.document) {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                console.log('Documento modificato:', event.document.uri.toString());
                event.contentChanges.forEach(change => {
                    console.log('Modifica:', change);
                });
            }
        }
    });
    context.subscriptions.push(disposable3, disposable4);
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.show();
    updateStatusBarItem();
    context.subscriptions.push(myStatusBarItem);
}
exports.activate = activate;
// This method is called when your extension is deactivated
function deactivate() {
    console.log('Deactivating VS Code Recorder');
}
exports.deactivate = deactivate;
function startRecording() {
    if (recording) {
        notificationWithProgress('Already recording');
        return;
    }
    recording = true;
    timer = 0;
    intervalId = setInterval(() => {
        timer++;
        updateStatusBarItem();
    }, 1000);
    notificationWithProgress('Recording started');
    updateStatusBarItem();
}
function stopRecording() {
    if (!recording) {
        notificationWithProgress('Not recording');
        return;
    }
    recording = false;
    clearInterval(intervalId);
    timer = 0;
    notificationWithProgress('Recording finished');
    updateStatusBarItem();
}
function updateStatusBarItem() {
    if (recording) {
        myStatusBarItem.text = `$(debug-stop) ${formatTime(timer)}`;
        myStatusBarItem.command = stopRecordingCommand;
    }
    else {
        myStatusBarItem.text = `$(circle-large-filled) Start Recording`;
        myStatusBarItem.command = startRecordingCommand;
    }
}
function notificationWithProgress(title) {
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: title,
        cancellable: false,
    }, (progress, token) => {
        return new Promise((resolve, reject) => {
            const times = 1.5 * 1000;
            const timeout = 50;
            const increment = (100 / times) * timeout;
            for (let i = 0; i <= times; i++) {
                setTimeout(() => {
                    progress.report({ increment: increment });
                    if (i === times / timeout) {
                        resolve();
                    }
                }, timeout * i);
            }
        });
    });
}
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    let timeString = '';
    if (hours > 0) {
        timeString += `${hours.toString().padStart(2, '0')}:`;
    }
    timeString += `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    return timeString;
}


/***/ }),
/* 1 */
/***/ ((module) => {

module.exports = require("vscode");

/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__(0);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;
//# sourceMappingURL=extension.js.map