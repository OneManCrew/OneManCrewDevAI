/**
 * Notification Service
 * Sends OS notifications with sound when the app window is not focused
 * and an agent needs user intervention.
 */

import api from './electronBridge';
import log from './logger';

/**
 * Notify the user that an agent needs their attention.
 * Only sends an OS notification if the app window is NOT focused.
 * Always flashes the taskbar.
 *
 * @param {string} agentName - Display name of the agent (e.g. "Backend Engineer")
 * @param {string} message - Short description of what's needed
 * @param {object} [options] - Extra options
 * @param {boolean} [options.silent=false] - If true, suppress notification sound
 * @param {boolean} [options.force=false] - If true, send notification even if window is focused
 */
export async function notifyUserAttentionNeeded(agentName, message, options = {}) {
  const { silent = false, force = false } = options;
  log.info('notificationService', 'notifyUserAttentionNeeded', { agentName, message: message.substring(0, 80) });

  try {
    const focused = await api.isWindowFocused();
    log.debug('notificationService', 'Window focus check', { focused, force });

    if (!focused || force) {
      // Send OS notification with sound
      await api.showNotification({
        title: `🔔 ${agentName} needs your attention`,
        body: message,
        silent,
      });

      // Flash the taskbar icon
      await api.flashFrame();
    }
  } catch (err) {
    log.error('notificationService', 'Failed to send notification', err);
  }
}

/**
 * Pre-built notification for when an agent's work is complete and needs approval.
 */
export async function notifyAgentComplete(agentName) {
  await notifyUserAttentionNeeded(
    agentName,
    `${agentName} has finished and is waiting for your approval to continue.`
  );
}

/**
 * Pre-built notification for when an agent encounters an error.
 */
export async function notifyAgentError(agentName, errorMsg) {
  await notifyUserAttentionNeeded(
    agentName,
    `Error: ${errorMsg || 'Something went wrong. Please check.'}`,
  );
}

/**
 * Pre-built notification for when a coding agent needs user input (e.g. install dependency).
 */
export async function notifyAgentNeedsInput(agentName, question) {
  await notifyUserAttentionNeeded(
    agentName,
    question || `${agentName} has a question and is waiting for your response.`,
  );
}
