import 'dotenv/config';
import { Resend } from 'resend';

const to = process.argv[2];
const subject = process.argv[3] || 'Test email';
const body = process.argv[4] || 'This is a test email from Moifone.';

if (!to) {
  console.error('Usage: node scripts/send-test-email.js <to@email.com> ["Subject"] ["Body"]');
  process.exit(1);
}

if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY missing in .env');
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY);

const result = await resend.emails.send({
  from: process.env.EMAIL_FROM || 'noreply@moifone.com',
  to,
  subject,
  html: `<p>${body}</p>`,
});

if (result.error) {
  console.error('Send failed:', result.error);
  process.exit(1);
}

console.log('Sent. id:', result.data?.id);
