import 'dotenv/config';
import { readFileSync } from 'fs';
import { Resend } from 'resend';

// ---- EDIT THESE ----
const TO_EMAIL = 'khaled@rainlight.ae';
const FROM_EMAIL = 'noreply@deynoqr.com';
const FIRST_NAME = 'there';
const SUBJECT = 'QR payment account created successfully';
const MESSAGE = 'Your QR payment account has been created successfully.';
const LOGO_PATH = 'C:\\Users\\LAPTOP SHOP\\Downloads\\deynoqrl.jpeg';
// ---------------------

const logoBase64 = readFileSync(LOGO_PATH).toString('base64');

if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY missing in .env');
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY);

function buildHtml(firstName, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#7b1e3a;padding:24px 40px">
            <img src="cid:logo" alt="Deynoqr" style="height:36px;display:block" />
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px">
            <p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">${SUBJECT}</p>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6">
              Hi ${firstName}, ${message}
            </p>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:0 0 24px">
              <p style="margin:0;font-size:14px;color:#374151;line-height:1.6">
                It will take up to <strong>24 hours</strong> to fully activate and appear in your QR Menu System. No action is needed on your part &mdash; it will go live automatically once activation completes.
              </p>
            </div>
            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">
              If you have any questions, just reply to this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6">
            <p style="margin:0;font-size:12px;color:#d1d5db">DeynoQR &mdash; QR Menu System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const result = await resend.emails.send({
  from: FROM_EMAIL,
  to: TO_EMAIL,
  subject: SUBJECT,
  html: buildHtml(FIRST_NAME, MESSAGE),
  attachments: [
    {
      filename: 'logo.jpeg',
      content: logoBase64,
      contentId: 'logo',
    },
  ],
});

if (result.error) {
  console.error('Send failed:', result.error);
  process.exit(1);
}

console.log('Sent. id:', result.data?.id);
