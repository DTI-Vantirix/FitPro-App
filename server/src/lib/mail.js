// Outgoing email. With RESEND_API_KEY set, mail goes through Resend's HTTP API;
// otherwise it is printed to the server console, which is what you want locally.
// Any provider with an HTTP API slots in here.
export async function sendMail(config, { to, subject, text }) {
  if (!config.mail.resendApiKey) {
    if (config.production) console.warn('[mail] RESEND_API_KEY is not set; email was not sent to', to);
    else console.log(`\n[mail] to=${to}\n[mail] subject=${subject}\n${text}\n`);
    return { delivered: false };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.mail.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.mail.from, to: [to], subject, text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.error('[mail] provider rejected message', res.status, await res.text().catch(() => ''));
    return { delivered: false };
  }
  return { delivered: true };
}
