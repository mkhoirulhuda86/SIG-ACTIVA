import PushNotifications from '@pusher/push-notifications-server';

const beamsClient = new PushNotifications({
  instanceId: process.env.BEAMS_INSTANCE_ID!,
  secretKey: process.env.BEAMS_PRIMARY_KEY!,
});

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  priority?: 'high' | 'medium' | 'low';
}

/**
 * Send a push notification to all subscribers of the given interest.
 * Default interest: 'all-users'
 */
export async function sendPushToAll(
  payload: PushPayload,
  interest = 'all-users'
) {
  try {
    await beamsClient.publishToInterests([interest], {
      web: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: '/icon-192x192.png',
        },
      },
    });
    console.log(`[Beams] Push notification sent to interest: ${interest}`);
  } catch (error) {
    console.error('[Beams] Failed to send push notification:', error);
    throw error;
  }
  return { interest };
}
