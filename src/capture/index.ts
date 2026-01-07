/**
 * Capture Module Index
 * Exports all capture-related functionality
 */

// Viewport capture
export {
	captureViewportState,
	captureObservation,
	captureNow,
	initializeViewportCapture,
	cleanupViewportCapture,
	resetObservationState
} from './viewportCapture'

// Terminal capture
export {
	getTerminalStates,
	getTerminalState,
	initializeTerminalCapture,
	cleanupTerminalCapture,
	resetTerminalState
} from './terminalCapture'
export type { TerminalCallbacks } from './terminalCapture'

// Filesystem watcher
export {
	initializeFilesystemWatcher,
	cleanupFilesystemWatcher,
	resetFilesystemState
} from './filesystemWatcher'
export type { FileChangeCallback } from './filesystemWatcher'
