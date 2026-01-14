import * as vscode from 'vscode'
import { extContext } from './extension'
import { type ConsentStatus } from './types'

const CONSENT_KEY = 'dataCollectionConsent'

/**
 * Gets the current consent status from global state
 */
export function getConsentStatus(): ConsentStatus {
    return extContext.globalState.get<ConsentStatus>(CONSENT_KEY, 'pending')
}

/**
 * Sets the consent status in global state
 */
export function setConsentStatus(status: ConsentStatus): void {
    extContext.globalState.update(CONSENT_KEY, status)
	void vscode.workspace
		.getConfiguration('crowdCode')
		.update('consentStatus', status, vscode.ConfigurationTarget.Global)
}

/**
 * Checks if the user has given consent for data collection
 */
export function hasConsent(): boolean {
    return getConsentStatus() === 'accepted'
}

/**
 * Shows the consent dialog to the user
 */
export async function showConsentDialog(): Promise<boolean> {
	const consentItem: vscode.MessageItem = { title: 'Consent to data collection' }
	const declineItem: vscode.MessageItem = { title: 'Decline data collection' }

	for (;;) {
		const result = await vscode.window.showInformationMessage(
			'Please choose whether crowd-code may upload anonymized usage data.',
			{
				modal: true,
				detail:
					'We ask for your consent upon installation. You can revoke participation at any time; after that, recorded data stays solely on your device. If you close this dialog without deciding, uploads stay off until you choose.\n\n' +
					'Your trust matters. We anonymize the dataset before sharing it with the research community and strive for full transparency. Suggestions to improve the crowd-sourcing setup are welcome.',
			},
			consentItem,
			declineItem,
		)

		if (result === consentItem) {
			setConsentStatus('accepted')
			vscode.window.showInformationMessage('Thank you for your contribution! Data collection is now enabled. You can change this setting at any time.')
			return true
		}
		if (result === declineItem) {
			setConsentStatus('declined')
			return false
		}
		// Require an explicit choice when the modal is dismissed.
	}
}

/**
 * Shows the consent change dialog for users who want to modify their consent
 */
export async function showConsentChangeDialog(): Promise<void> {
    const currentStatus = getConsentStatus()
    
    if (currentStatus === 'pending') {
        // If consent is still pending, show the initial consent dialog
        await showConsentDialog()
        return
    }

    const currentStatusText = currentStatus === 'accepted' 
        ? 'Data collection enabled'
        : 'Data collection disabled'

    const changeAction = currentStatus === 'accepted'
        ? 'Disable data collection'
        : 'Enable data collection'

    const result = await vscode.window.showInformationMessage(
        currentStatusText,
        changeAction,
        'Cancel'
    )

    if (result === changeAction) {
        const newStatus: ConsentStatus = currentStatus === 'accepted' ? 'declined' : 'accepted'
        setConsentStatus(newStatus)
        vscode.window.showInformationMessage('Data collection preference updated')
    }
}

/**
 * Checks if consent is required and prompts the user if needed
 * Returns true if consent is given or already exists, false otherwise
 */
export async function ensureConsent(): Promise<boolean> {
    const status = getConsentStatus()
    
    if (status === 'pending') {
        return await showConsentDialog()
    }
    
    return status === 'accepted'
}

/**
 * Gets a human-readable status message for the current consent state
 */
export function getConsentStatusMessage(): string {
    const status = getConsentStatus()
    switch (status) {
        case 'accepted':
            return 'Data collection enabled'
        case 'declined':
            return 'Data collection disabled'
        case 'pending':
        default:
            return 'Data collection pending'
    }
} 

export function syncConsentSetting(): void {
	const status = getConsentStatus()
	void vscode.workspace
		.getConfiguration('crowdCode')
		.update('consentStatus', status, vscode.ConfigurationTarget.Global)
}
