# ⚫ crowd-code

To install the extension, simply follow the instructions at https://github.com/p-doom/crowd-code/releases.

This extension provides functionality to record IDE actions. Currently supported actions include text insertions, deletions, undo, redo, cursor movement (including VIM motions), file switches, git branch checkouts, terminal invocation and terminal command execution (both input and output). The changes are recorded and stored in JSON files. If you consent to participate in crowd-sourcing VS code actions, the JSON files are uploaded to an S3 bucket. We anonymize and clean the crowd-sourced dataset and periodically share it with the community. If you do not consent, no data will leave your machine, and the JSON files will solely be stored locally.

All uncaptured data is lost data. We want to crowd-source a dense dataset of IDE actions to eventually finetune models on. This would (to the best of our knowledge) constitute the first crowd-sourced dataset of dense IDE actions.

We thank Mattia Consiglio for his awesome work on the upstream repository, which made our lives infinitely easier.

## 📚 Table of Contents

- [⚫ crowd-code](#-crowd-code)
  - [📚 Table of Contents](#-table-of-contents)
  - [📖 Usage](#-usage)
  - [🔒 Privacy](#-privacy)
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

As soon as the extension activates, recording commences automatically. Recording automatically stops upon IDE closure.
Additionally, you can control the recording in three ways:

1. Using the status bar (on the right): Click on "Start recording" to begin and "Stop recording" to end.
2. Using the VS Code Recorder sidebar: Click on the extension icon in the activity bar to open the sidebar, where you can:
   - Start/Stop the recording
   - View the recording timer
   - See the current file being recorded
   - Manage your recorded files
   - Add the export path to .gitignore
   - Enable/disable participation in crowd-sourcing the dataset
3. Using the panic button: Click on "Panic button" to remove the last few actions from the captured dataset. This is useful to immediately remove sensitive data from the dataset.

The extension will automatically record changes in your text editor. When you stop the recording, it will finalize the data and save it to a JSON file.

You can customize the recording experience with these features:

- Set custom names for recording folders
- Automatically add the export path to .gitignore

You can also use the command palette to access the extension's features.
Available commands:

- `crowd-code.startRecording`: Start the recording
- `crowd-code.stopRecording`: Stop the recording
- `crowd-code.panicButton`: Remove the last few actions from the dataset
- `crowd-code.openSettings`: Open the extension settings
- `crowd-code.consent`: Manage data collection consent

## 🔒 Privacy

We ask for your consent in participating in crowd-sourcing upon installation of the extension. You can always revoke your participation, after which your recorded data will solely be stored on your device.

Your trust means a lot to us, and we will take great care in anonymizing the dataset before sharing it to the research community. At the same time, we strive for ultimate transparency. If you have suggestions on how we can improve our crowd-sourcing setting, we are more than happy to hear your feedback.


## 📄 Output

The recorded changes are saved in a JSON file at the configured export path (default: `${TMPDIR}/`), providing a detailed and accessible log of your coding session.

## ▶️ Play it back!

Playback is a feature by the upstream repository. We have not tested playback using our modified repository (e.g. cursor movement and terminal capture are not implemented upstream; chances are high that playback simply breaks using recordings captured by crowd-code). If you want to try this nonetheless:

- The output files can be played back in the [VS Code Recorder Player web app](https://github.com/mattia-consiglio/vs-code-recorder-player).
- 🚧 React component available soon...

## 🔧 Extension Settings

- `crowdCode.export.exportPath`: Set the export path. Use `${workspaceFolder}` to export to the workspace folder. In case the path does not exist in the workspace, it will be created.

  Default: `$TMPDIR/`

- `crowdCode.export.createPathOutsideWorkspace`: Create the export path outside the workspace if it doesn't exist

  Default: `true`

- `crowdCode.export.addToGitignore`: Add the export path to .gitignore when creating the folder

  Default: `false`

- `crowdCode.recording.askFolderName`: Ask for a custom folder name before starting a recording

  Default: `false`

- `crowdCode.appearance.minimalMode`: Enable or disable the minimal mode

  Default: `false`

- `crowdCode.appearance.showTimer`: Enable or disable the display time

  Default: `true`

## ⚙️ Requirements

This extension requires Visual Studio Code, or any other editor that supports the VS Code API (like Cursor, VSCodium, Windsurf, etc.), to run. No additional dependencies are needed.

## 🐛 Known Issues

There are currently no known issues with this extension.

## 🤝 Contributing

If you'd like to contribute to this extension, please feel free to fork the repository and submit a pull request.

## 💸 Support the upstream author

If you like this extension, please consider [supporting the author of the upstream repository](https://www.paypal.com/donate/?hosted_button_id=D5EUDQ5VEJCSL)!

## 📝 Release Notes

See [CHANGELOG.md](CHANGELOG.md)

---

**😊 Enjoy!**
