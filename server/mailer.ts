// Почта: восстановление пароля. Без SMTP_URL письма не шлются — ссылку сброса выдаёт админ платформы.
type Transport = { sendMail: (m: { from: string; to: string; subject: string; text: string; html?: string }) => Promise<unknown> };

let transport: Transport | null | undefined;

export const mailConfigured = () => !!process.env.SMTP_URL;

async function getTransport(): Promise<Transport | null> {
  if (transport !== undefined) return transport;
  if (!process.env.SMTP_URL) return (transport = null);
  const nodemailer = await import("nodemailer");
  transport = nodemailer.createTransport(process.env.SMTP_URL) as unknown as Transport;
  return transport;
}

export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const t = await getTransport();
  if (!t) return false;
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || "Nexus RPG <no-reply@localhost>", to, subject, text });
    return true;
  } catch (e) {
    console.error("[mail]", e);
    return false;
  }
}
