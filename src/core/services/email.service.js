import { Resend } from 'resend';
import { config } from '../../config.js';

let _resend = null;
function getClient() {
  if (!_resend) _resend = new Resend(config.resendApiKey);
  return _resend;
}

export async function sendVerificationEmail(toEmail, firstName, verifyUrl) {
  if (!config.resendApiKey) {
    if (config.nodeEnv === 'production') {
      throw new Error('RESEND_API_KEY is required to send verification email');
    }
    console.log('');
    console.log('----------------------------------------------------------');
    console.log(`  [EMAIL VERIFY] No RESEND_API_KEY set — dev console only`);
    console.log(`  To: ${toEmail}`);
    console.log(`  Verify URL: ${verifyUrl}`);
    console.log('----------------------------------------------------------');
    console.log('');
    return;
  }

  await getClient().emails.send({
    from: config.emailFrom,
    to: toEmail,
    subject: 'Verify your Moifone account',
    html: buildVerifyHtml(firstName, verifyUrl),
  });
}

export async function sendPasswordResetEmail(toEmail, firstName, otp) {
  if (!config.resendApiKey) {
    if (config.nodeEnv === 'production') {
      throw new Error('RESEND_API_KEY is required to send password reset email');
    }
    console.log('');
    console.log('----------------------------------------------------------');
    console.log(`  [PASSWORD RESET] OTP for ${toEmail}: ${otp}`);
    console.log('----------------------------------------------------------');
    console.log('');
    return;
  }

  await getClient().emails.send({
    from: config.emailFrom,
    to: toEmail,
    subject: 'Your Moifone password reset code',
    html: buildOtpHtml(firstName, otp),
  });
}

function buildVerifyHtml(firstName, verifyUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#7b1e3a;padding:28px 40px">
            <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Moifone</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px">
            <p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Verify your email address</p>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6">
              Hi ${firstName}, your Moifone workspace is ready. Click the button below to verify your email and activate your account.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:8px;background:#7b1e3a">
                  <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">
                    Verify email address
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6">
              This link expires in 24 hours. If you did not create a Moifone account, ignore this email.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6">
            <p style="margin:0;font-size:12px;color:#d1d5db">
              Or copy this link into your browser:<br>
              <span style="color:#7b1e3a;word-break:break-all">${verifyUrl}</span>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildOtpHtml(firstName, otp) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#7b1e3a;padding:28px 40px">
            <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">Moifone</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px">
            <p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827">Password reset code</p>
            <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6">
              Hi ${firstName}, use the code below to reset your Moifone password. It expires in 15 minutes.
            </p>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:24px;text-align:center">
              <p style="margin:0;font-size:36px;font-weight:700;color:#7b1e3a;letter-spacing:8px">${otp}</p>
            </div>
            <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6">
              If you did not request a password reset, ignore this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
