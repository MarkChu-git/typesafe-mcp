interface EmailParams {
  to: string;
  subject: string;
  body: string;
}

export const emailService = {
  async send(params: EmailParams): Promise<{ success: boolean }> {
    // Stub implementation - would connect to email provider
    console.log(`Sending email to ${params.to}: ${params.subject}`);
    return { success: true };
  },
};
