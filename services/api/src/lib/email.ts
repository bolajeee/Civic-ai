export async function sendPasswordResetEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Password reset email is not configured');
    }
    console.info(`[development] Password reset code for ${email}: ${code}`);
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Reset your CivicAI password',
      text: `Your CivicAI password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
      html: `<p>Your CivicAI password reset code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Password reset email failed (${response.status}): ${detail.slice(0, 200)}`);
  }
}
