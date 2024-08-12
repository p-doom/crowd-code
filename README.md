# VS Code Recorder Extension

This extension provides functionality to record changes made in the active text editor in Visual Studio Code. The changes are recorded in a CSV file and can be processed to generate output files in SRT and JSON formats.

## Features

The VS Code Recorder Extension is designed to track and record changes made in the active text editor. It captures every change, including text insertions, deletions, and modifications, and records them in a CSV file. This file can then be processed to generate output files in SRT and JSON formats, providing a detailed log of changes made during a coding session.

## Usage

![VS Code Recorder Extension](https://raw.githubusercontent.com/mattia-consiglio/vs-code-recorder/main/img/preview.gif)

To use the extension, click on "Start recording" in the status bar (on the right) and begin working in your text editor. The extension will automatically start recording changes. When you're done, stop the recording and the extension will finalize the data and save it to a CSV (source), JSON and SRT file.

Choose the format in which you want to export the data (SRT or JSON or both).

## Output

The recorded changes are saved in a CSV file in your workspace.

Then, this file is processed to generate output files in SRT and JSON formats, providing a detailed and accessible log of your coding session.

## Play it back

The output files can be played back in the [VS Code Recorder Player web app](https://github.com/mattia-consiglio/vs-code-recorder-player).

## Requirements

This extension requires Visual Studio Code to run. No additional dependencies are needed.

## Extension Settings

- **Export Path**: Set the export path. Use `${workspaceFolder}` to export to the workspace folder. In case the path does not exist in the workspace, it will be created.
- **Export Formats**: Select the formats to export recording data (SRT or JSON or both)
- **Create Path Outside Workspace**: Create the export path outside the workspace
- **Minimal Mode**: Enable or disable the minimal mode
- **Display Time**: Enable or disable the display time
-

## Known Issues

There are currently no known issues with this extension.

## Support me 💸

If you like this extension, please consider [supporting me](https://www.paypal.com/donate/?hosted_button_id=D5EUDQ5VEJCSL)!

## Release Notes

See [CHANGELOG.md](CHANGELOG.md)

---

**Enjoy!**
