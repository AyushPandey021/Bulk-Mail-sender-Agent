import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config();

const hasMailConfig =
    process.env.GOOGLE_USER_EMAIL &&
    process.env.EMIAL_PASSWORD;

const transporter = hasMailConfig ? nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.GOOGLE_USER_EMAIL,
        pass: process.env.EMIAL_PASSWORD,
    },
}) : null;

const hasMultipleRecipients = (to = "") => /[,;\n\r]/.test(String(to));

export async function sendEmail({ to, subject, html, text }) {
    if (!transporter) {
        console.warn("Email not sent: mail service is not configured");
        return;
    }

    if (hasMultipleRecipients(to)) {
        throw new Error("Grouped recipients are not allowed. Send one email per recipient.");
    }

    const mailOptions = {
        from: process.env.GOOGLE_USER_EMAIL,
        to: String(to).trim(),
        subject,
        html,
        text,
    };
    return transporter.sendMail(mailOptions);
}

export async function sendEmailsSeparately({ recipients, subject, html, text }) {
    for (const recipient of recipients) {
        await sendEmail({
            to: recipient,
            subject,
            html,
            text,
        });
    }
}

export default sendEmail;
