# VS Code Recorder Extension

This extension provides functionality to record changes made in the active text editor in Visual Studio Code. The changes are recorded in a CSV file and can be processed to generate output files in SRT and JSON formats.

## Features

The VS Code Recorder Extension is designed to track and record changes made in the active text editor. It captures every change, including text insertions, deletions, and modifications, and records them in a CSV file. This file can then be processed to generate output files in SRT and JSON formats, providing a detailed log of changes made during a coding session.

## Usage

To use the extension, click on "Start recording" in the status bar (on the right) and begin working in your text editor. The extension will automatically start recording changes. When you're done, stop the recording and the extension will finalize the data and save it to a CSV, JSON and SRT file.

## Output

The recorded changes are saved in a CSV file in your workspace.

Then, this file is processed to generate output files in SRT and JSON formats, providing a detailed and accessible log of your coding session.

## Requirements

This extension requires Visual Studio Code to run. No additional dependencies are needed.

## Extension Settings

This extension does not contribute any additional settings to VS Code.

## Known Issues

There are currently no known issues with this extension.

## Release Notes

### 1.0.1

- Fix sequence number to start at 0 every recording
- Update README.md

### 1.0.0

Initial release of VS Code Recorder Extension.

---

**Enjoy!**
