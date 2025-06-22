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
    const consentItem: vscode.MessageItem = { title: vscode.l10n.t('Consent to data collection') }
    const declineItem: vscode.MessageItem = { title: vscode.l10n.t('Decline data collection'), isCloseAffordance: true }
    const learnMoreItem: vscode.MessageItem = { title: vscode.l10n.t('Learn more about data collection') }

    const result = await vscode.window.showInformationMessage(
        vscode.l10n.t('crowd-code collects anonymized usage data for research purposes. Your personal information is not collected, and the data is thoroughly anonymized before being shared with researchers. Do you consent to data collection?'),
        { modal: true },
        consentItem,
        declineItem,
        learnMoreItem
    )

    if (result === consentItem) {
        setConsentStatus('accepted')
        vscode.window.showInformationMessage(vscode.l10n.t('Thank you for your contribution! Data collection is now enabled. You can change this setting at any time.'))
        return true
    } else if (result === declineItem) {
        setConsentStatus('declined')
        return false
    } else if (result === learnMoreItem) {
        // Open privacy policy or documentation
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/p-doom/crowd-code#privacy'))
        // Show the dialog again after opening the link
        return showConsentDialog()
    }

    // User dismissed the dialog
    setConsentStatus('declined')
    return false
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
        ? vscode.l10n.t('Data collection enabled')
        : vscode.l10n.t('Data collection disabled')

    const changeAction = currentStatus === 'accepted'
        ? vscode.l10n.t('Disable data collection')
        : vscode.l10n.t('Enable data collection')

    const result = await vscode.window.showInformationMessage(
        currentStatusText,
        changeAction,
        vscode.l10n.t('Cancel')
    )

    if (result === changeAction) {
        const newStatus: ConsentStatus = currentStatus === 'accepted' ? 'declined' : 'accepted'
        setConsentStatus(newStatus)
        vscode.window.showInformationMessage(vscode.l10n.t('Data collection preference updated'))
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
            return vscode.l10n.t('Data collection enabled')
        case 'declined':
            return vscode.l10n.t('Data collection disabled')
        case 'pending':
        default:
            return vscode.l10n.t('Data collection pending')
    }
} 