import { Resend } from 'resend';

export interface EmailServiceConfig {
	apiKey: string;
	fromEmail: string;
	fromName?: string;
}

export interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
	text?: string;
}

export interface SendOTPEmailParams {
	to: string;
	otp: string;
	expiresInMinutes: number;
}

export class EmailService {
	private resend: Resend;
	private fromEmail: string;
	private fromName: string;

	constructor(config: EmailServiceConfig) {
		this.resend = new Resend(config.apiKey);
		this.fromEmail = config.fromEmail;
		this.fromName = config.fromName || 'VibeSdk';
	}

	async sendEmail(params: SendEmailParams): Promise<void> {
		const { to, subject, html, text } = params;

		try {
			await this.resend.emails.send({
				from: `${this.fromName} <${this.fromEmail}>`,
				to: [to],
				subject,
				html,
				text,
			});
		} catch (error) {
			console.error('Failed to send email:', error);
			throw new Error('Failed to send email');
		}
	}

	async sendOTPEmail(params: SendOTPEmailParams): Promise<void> {
		const { to, otp, expiresInMinutes } = params;

		const html = this.generateOTPEmailHTML(otp, expiresInMinutes);
		const text = this.generateOTPEmailText(otp, expiresInMinutes);

		await this.sendEmail({
			to,
			subject: 'Your Verification Code',
			html,
			text,
		});
	}

	private generateOTPEmailHTML(otp: string, expiresInMinutes: number): string {
		return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Email Verification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 0;">
		<tr>
			<td align="center">
				<table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
					<tr>
						<td style="padding: 40px 40px 20px 40px;">
							<h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">Verify Your Email</h1>
						</td>
					</tr>
					<tr>
						<td style="padding: 0 40px 20px 40px;">
							<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #4a4a4a;">
								Use the verification code below to complete your sign-up:
							</p>
							<div style="background-color: #f8f9fa; border-radius: 6px; padding: 24px; text-align: center; margin: 20px 0;">
								<div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a; font-family: 'Courier New', monospace;">
									${otp}
								</div>
							</div>
							<p style="margin: 20px 0 0 0; font-size: 14px; line-height: 20px; color: #6b6b6b;">
								This code will expire in <strong>${expiresInMinutes} minutes</strong>.
							</p>
						</td>
					</tr>
					<tr>
						<td style="padding: 20px 40px 40px 40px; border-top: 1px solid #e5e5e5;">
							<p style="margin: 0; font-size: 12px; line-height: 18px; color: #999;">
								If you didn't request this code, you can safely ignore this email.
							</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>
		`.trim();
	}

	private generateOTPEmailText(otp: string, expiresInMinutes: number): string {
		return `
Verify Your Email

Use the verification code below to complete your sign-up:

${otp}

This code will expire in ${expiresInMinutes} minutes.

If you didn't request this code, you can safely ignore this email.
		`.trim();
	}
}
