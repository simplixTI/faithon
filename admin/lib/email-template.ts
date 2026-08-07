/**
 * FaithOn magic-link email — editorial cream + gold, matches the site.
 * Fully inline styles, table-based layout for max email client support.
 */
export function magicLinkEmail(actionUrl: string): { html: string; text: string } {
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>Your FaithOn sign-in link</title>
</head>
<body style="margin:0;padding:0;background:#F4ECDF;font-family:Georgia,'Times New Roman',serif;color:#1A1714;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;line-height:1px;color:#F4ECDF;max-height:0;max-width:0;opacity:0;overflow:hidden;">A quiet moment awaits. Your FaithOn sign-in link is inside.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F4ECDF;">
<tr><td align="center" style="padding:56px 20px;">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#FBF6EC;border:1px solid rgba(26,23,20,0.08);border-radius:16px;box-shadow:0 6px 24px rgba(26,23,20,0.06);">
<tr><td align="center" style="padding:44px 44px 20px;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:500;letter-spacing:-0.02em;color:#1A1714;line-height:1;"><span style="color:#8E5F22;">&#10022;</span>&nbsp;faith<span style="font-weight:700;">on</span></div>
<div style="font-family:Arial,'Helvetica Neue',sans-serif;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#6E6358;margin-top:10px;">Admin&nbsp;&middot;&nbsp;Never face a difficult day alone</div>
</td></tr>
<tr><td align="center" style="padding:8px 44px 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="width:56px;height:1px;background:#B98238;line-height:1px;font-size:0;">&nbsp;</td></tr></table>
</td></tr>
<tr><td style="padding:36px 44px 12px;">
<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:500;line-height:1.25;color:#1A1714;letter-spacing:-0.01em;">A quiet moment awaits.</h1>
<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.65;color:#3A332C;">Follow the link below to sign in to your FaithOn Admin account. It expires shortly and can only be used once.</p>
</td></tr>
<tr><td align="center" style="padding:28px 44px 8px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#1A1714" style="background:#1A1714;border-radius:999px;">
<a href="${actionUrl}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:Arial,'Helvetica Neue',sans-serif;font-size:14px;font-weight:500;letter-spacing:0.04em;color:#FBF6EC;text-decoration:none;line-height:1;">Sign in to FaithOn Admin</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:20px 44px 16px;">
<p style="margin:0;font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;line-height:1.55;color:#6E6358;">If the button doesn&#39;t work, paste this URL into your browser:<br /><a href="${actionUrl}" style="color:#8E5F22;word-break:break-all;text-decoration:none;">${actionUrl}</a></p>
</td></tr>
<tr><td align="center" style="padding:12px 44px 36px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="width:40px;height:1px;background:rgba(185,130,56,0.5);line-height:1px;font-size:0;">&nbsp;</td></tr></table>
<p style="margin:16px 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:#8E5F22;">&ldquo;Be still, and know.&rdquo;</p>
</td></tr>
<tr><td style="padding:24px 44px 32px;border-top:1px solid rgba(26,23,20,0.08);">
<p style="margin:0 0 8px;font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;line-height:1.55;color:#6E6358;">If you didn&#39;t request this, you can safely ignore this email. No account will be created without you clicking the link above.</p>
<p style="margin:0;font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;line-height:1.55;color:#6E6358;">Access to this area is logged and audited. FaithOn is a <strong style="color:#3A332C;">SIMPLIX LLC</strong> project.</p>
</td></tr>
</table>
<p style="margin:20px 0 0;font-family:Arial,'Helvetica Neue',sans-serif;font-size:11px;color:#6E6358;">&copy; 2026 SIMPLIX LLC &middot; <a href="https://www.faithon.ai" style="color:#6E6358;text-decoration:underline;">faithon.ai</a></p>
</td></tr></table>
</body></html>`;

  const text = `FaithOn Admin — sign in

A quiet moment awaits.

Follow the link below to sign in. It expires shortly and can only be used once.

${actionUrl}

If you didn't request this, ignore this email. No account will be created without you clicking the link above.

FaithOn is a SIMPLIX LLC project. Access to this area is logged and audited.
faithon.ai`;

  return { html, text };
}
