# VS Code Recorder Extension

This extension provides functionality to record changes made in the active text editor in Visual Studio Code. The changes are recorded in a CSV file and can be processed to generate output files in SRT and JSON formats.

## Features

The VS Code Recorder Extension is designed to track and record changes made in the active text editor. It captures every change, including text insertions, deletions, and modifications, and records them in a CSV file. This file can then be processed to generate output files in SRT and JSON formats, providing a detailed log of changes made during a coding session.

## Usage

![VS Code Recorder Extension](img/preview.gif)

To use the extension, click on "Start recording" in the status bar (on the right) and begin working in your text editor. The extension will automatically start recording changes. When you're done, stop the recording and the extension will finalize the data and save it to a CSV (source), JSON and SRT file.

Choose the format in which you want to export the data (SRT or JSON or both).

## Output

The recorded changes are saved in a CSV file in your workspace.

Then, this file is processed to generate output files in SRT and JSON formats, providing a detailed and accessible log of your coding session.

## Requirements

This extension requires Visual Studio Code to run. No additional dependencies are needed.

## Extension Settings

This extension does not contribute any additional settings to VS Code.

## Known Issues

There are currently no known issues with this extension.

## Support me 💸

If you like this extension, please consider [supporting me](https://www.paypal.com/donate/?hosted_button_id=D5EUDQ5VEJCSL)!

## Release Notes

### 1.0.5

- Actually add code language recording to SRT export

### 1.0.4

- Add export settings. Now you can choose in which format you want to export the data (SRT or JSON or both).
- Add minimal mode. This will display only the icons.
- Add setting for displaying the timer while recording.
- Update README.md

### 1.0.3

- Add code language recording
- Code cleanup
- Update README.md

### 1.0.2

- Update README.md

### 1.0.1

- Fix sequence number to start at 0 every recording
- Update README.md

### 1.0.0

Initial release of VS Code Recorder Extension.

---

**Enjoy!**
