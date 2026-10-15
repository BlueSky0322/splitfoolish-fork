import { notifications } from '@mantine/notifications';

// Saying that something went wrong, the same way everywhere

/** The error's own message (the server's, say), or `fallback` when it has none */
export const showError = (err: unknown, fallback: string) =>
  notifications.show({ color: 'red', message: err instanceof Error ? err.message : fallback });

/** Why something can't be done, as worked out here */
export const showRefusal = (message: string) => notifications.show({ color: 'red', message });
