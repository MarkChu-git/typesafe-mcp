interface QueueMessage {
  type: string;
  data: Record<string, unknown>;
}

export const notificationQueue = {
  async push(message: QueueMessage): Promise<void> {
    // Push message to queue for async processing
  },

  async pull(): Promise<QueueMessage | null> {
    // Pull next message from queue
    return null;
  },
};
