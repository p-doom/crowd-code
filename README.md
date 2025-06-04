# ⚫ crowd-code

This extension provides functionality to record changes made in the active text editor in Visual Studio Code. The changes are recorded in a CSV file and can be processed to generate output files in SRT and JSON formats.

## 📚 Table of Contents

- [⚫ crowd-code](#-crowd-code)
  - [📚 Table of Contents](#-table-of-contents)
  - [📖 Usage](#-usage)
  - [📄 Output](#-output)
  - [▶️ Play it back!](#️-play-it-back)
  - [🔧 Extension Settings](#-extension-settings)
  - [⚙️ Requirements](#️-requirements)
  - [🐛 Known Issues](#-known-issues)
  - [🤝 Contributing](#-contributing)
  - [💸 Support me](#-support-me)
  - [📝 Release Notes](#-release-notes)

## 📖 Usage

![crowd-code Extension](https://raw.githubusercontent.com/mattia-consiglio/vs-code-recorder/main/img/preview.gif)

You can control the recording in two ways:

1. Using the status bar (on the right): Click on "Start recording" to begin and "Stop recording" to end.
2. Using the VS Code Recorder sidebar: Click on the extension icon in the activity bar to open the sidebar, where you can:
   - Start/Stop the recording
   - View the recording timer
   - See the current file being recorded
   - Manage your recorded files
   - Add the export path to .gitignore

The extension will automatically record changes in your text editor. When you stop the recording, it will finalize the data and save it to a CSV (source), JSON and SRT files.

You can customize the recording experience with these features:

- Choose the export formats (SRT or JSON or both)
- Set custom names for recording folders
- Automatically add the export path to .gitignore

You can also use the command palette to access the extension's features.
Available commands:

- `vs-code-recorder.startRecording`: Start the recording
- `vs-code-recorder.stopRecording`: Stop the recording
- `vs-code-recorder.openSettings`: Open the extension settings

## 📄 Output

The recorded changes are saved in a CSV file in your workspace.

Then, this file is processed to generate output files in SRT and JSON formats, providing a detailed and accessible log of your coding session.

## ▶️ Play it back!

- The output files can be played back in the [VS Code Recorder Player web app](https://github.com/mattia-consiglio/vs-code-recorder-player).
- 🚧 React component available soon...

## 🔧 Extension Settings

- `vsCodeRecorder.export.exportPath`: Set the export path. Use `${workspaceFolder}` to export to the workspace folder. In case the path does not exist in the workspace, it will be created.

  Default: `${workspaceFolder}/vs-code-recorder/`

- `vsCodeRecorder.export.createPathOutsideWorkspace`: Create the export path outside the workspace if it doesn't exist

  Default: `false`

- `vsCodeRecorder.export.addToGitignore`: Add the export path to .gitignore when creating the folder

  Default: `false`

- `vsCodeRecorder.export.exportFormats`: Enabled export formats (SRT or JSON or both)

  Default: `["JSON", "SRT"]`

- `vsCodeRecorder.recording.askFolderName`: Ask for a custom folder name before starting a recording

  Default: `false`

- `vsCodeRecorder.appearance.minimalMode`: Enable or disable the minimal mode

  Default: `false`

- `vsCodeRecorder.appearance.showTimer`: Enable or disable the display time

  Default: `true`

## ⚙️ Requirements

This extension requires Visual Studio Code, or any other editor that supports the VS Code API (like Cursor, VSCodium, Windsurf, etc.), to run. No additional dependencies are needed.

## 🐛 Known Issues

There are currently no known issues with this extension.

## 🤝 Contributing

If you'd like to contribute to this extension, please feel free to fork the repository and submit a pull request.

## 💸 Support me

If you like this extension, please consider [supporting me](https://www.paypal.com/donate/?hosted_button_id=D5EUDQ5VEJCSL)!

## 📝 Release Notes

See [CHANGELOG.md](CHANGELOG.md)

---

**😊 Enjoy!**
