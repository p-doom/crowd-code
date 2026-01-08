/**
 * Capture Module Index
 * Exports all capture-related functionality
 */

// Viewport capture
export {
	captureViewportState,
	captureObservation,
	initializeViewportCapture,
	cleanupViewportCapture,
	resetObservationState
} from './viewportCapture'

// Terminal capture
export {
	getActiveTerminalViewport,
	initializeTerminalCapture,
	cleanupTerminalCapture,
	resetTerminalState
} from './terminalCapture'
export type { TerminalCallbacks, TerminalViewport } from './terminalCapture'

// Filesystem watcher
export {
	initializeFilesystemWatcher,
	cleanupFilesystemWatcher,
	resetFilesystemState
} from './filesystemWatcher'
export type { FileChangeCallback } from './filesystemWatcher'
