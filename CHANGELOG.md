# Change Log

All notable changes to the "vs-code-recorder" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## 1.1.1

### Changed

- Updated README.md with new features documentation and improved usage instructions.

## 1.1.0

### Added

- Language locale support. Now available in English and Italian. (Fell free to contribute to add more languages!)
- Added recording side panel to show the recording progress and manage the recordings.
- Added option to set custom folder names for recordings with timestamp appended.
- Added option to automatically add export path to .gitignore and a button to manually add it.

### Fixed

- Skip exporting changes with the same values to the previous change.
- Offset by 1 ms the `startTime` and `endTime` to avoid the overlap of the changes.

### Changed

- Added automated tests.
- Refactored code.

## 1.0.11

### Changed

- Code refactoring.

## 1.0.10

### Changed

- Settings sorting.

## 1.0.9

### Added

- Add educational category for the extension.

## 1.0.8

### Added

- Output folder options for SRT and JSON files.
- Option to create path outside of workspace.
- Command to open the extension settings.
- Log to output channel.
- Link to VS Code Recorder Player web app.

### Fixed

- Prevent to record the files in the export folder.

## 1.0.7 (skipped public release)

### Fixed

- Fix end time in SRT export

## 1.0.6

### Changed

- Referenced changelog for release notes

### Fixed

- Actually add code language recording to SRT export

## 1.0.5

### Changed

- Updated CHANGELOG.md

## 1.0.4

### Added

- Export settings. Now you can choose in which format you want to export the data (SRT or JSON or both).
- Minimal mode. This will display only the icons.
- Setting for displaying the timer while recording.

### Changed

- Update README.md

## 1.0.3

### Added

- Code language recording

### Changed

- Code cleanup
- Update README.md

## 1.0.2

### Changed

- Update README.md

## 1.0.1

### Fixed

- Fix sequence number to start at 0 every recording

## 1.0.0

Initial release of VS Code Recorder Extension.
