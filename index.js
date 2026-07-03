import http from "http";
import dotenv from "dotenv";
import Busboy from "busboy";

dotenv.config();

for (const key of [
  "GOOGLE_USER_EMAIL",
  "EMIAL_PASSWORD",
]) {
  if (process.env[key]) {
    process.env[key] = process.env[key].trim();
  }
}

const { sendEmailsSeparately } = await import("./mail.service.js");
const { extractEmailsFromFiles } = await import("./extract.service.js");

const PORT = Number(process.env.PORT || 3000);
const mailConfigKeys = [
  "GOOGLE_USER_EMAIL",
  "EMIAL_PASSWORD",
];
const isMailConfigured = mailConfigKeys.every((key) => Boolean(process.env[key]));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseRecipients = (value = "") => {
  const raw = String(value || "")
    .split(/[\s,;]+/)
    .map((email) => String(email).trim().toLowerCase())
    .filter(Boolean);

  // Only keep valid email addresses so the frontend count/manifest matches
  // what will actually be sent.
  return [...new Set(raw.filter((email) => emailPattern.test(email)))];
};

const readJsonBody = (request) => {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON request."));
      }
    });

    request.on("error", reject);
  });
};

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
};

const readMultipartSendBody = (request) => {
  return new Promise((resolve, reject) => {
    const fields = {};
    const attachments = [];
    const busboy = Busboy({
      headers: request.headers,
      limits: {
        files: 10,
        fileSize: 25 * 1024 * 1024,
      },
    });

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (fieldname, file, info) => {
      if (fieldname !== "attachments") {
        file.resume();
        return;
      }

      const chunks = [];
      const filename = info?.filename || "";

      file.on("data", (chunk) => {
        chunks.push(chunk);
      });

      file.on("limit", () => {
        reject(new Error(`Attachment is too large: ${filename || "file"}`));
        file.resume();
      });

      file.on("end", () => {
        if (filename && chunks.length) {
          attachments.push({
            filename,
            content: Buffer.concat(chunks),
            contentType: info?.mimeType || undefined,
          });
        }
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => {
      resolve({ ...fields, attachments });
    });

    request.pipe(busboy);
  });
};

const escapeHtml = (value = "") => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mail Manifest</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #eef1f5;
      --panel: #ffffff;
      --ink: #1b2430;
      --muted: #5c6b7a;
      --faint: #8a97a6;
      --line: #d7dee6;
      --line-soft: #e6ebf1;
      --accent: #1e3a5f;
      --accent-dark: #142944;
      --accent-soft: #eaf0f7;
      --stamp: #c1392b;
      --stamp-soft: #fdecea;
      --success: #2f7d5c;
      --success-soft: #eaf7f1;
      --mono: "SFMono-Regular", ui-monospace, "Roboto Mono", Menlo, Consolas, monospace;
      --sans: "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
      --serif: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
      --shadow: 0 12px 32px rgba(20, 28, 44, 0.10);
      --radius: 10px;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--sans);
      font-size: 14px;
      color: var(--ink);
      background:
        radial-gradient(circle at 100% 0%, rgba(30, 58, 95, 0.05), transparent 45%),
        var(--bg);
    }

    .app {
      width: min(1040px, calc(100% - 28px));
      margin: 0 auto;
      padding: 24px 0 32px;
    }

    /* ---- header / postmark ---- */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .postmark {
      position: relative;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 2px solid var(--accent);
      flex: none;
      display: grid;
      place-items: center;
    }

    .postmark::before {
      content: "";
      position: absolute;
      inset: 5px;
      border-radius: 50%;
      border: 1px dashed var(--accent);
      opacity: 0.55;
    }

    .postmark svg { width: 18px; height: 18px; }

    h1 {
      margin: 0;
      font-family: var(--serif);
      font-weight: 700;
      font-size: 22px;
      letter-spacing: 0.2px;
      line-height: 1.1;
    }

    .eyebrow {
      margin: 0;
      font-size: 11px;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 600;
    }

    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 30px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      background: var(--panel);
      white-space: nowrap;
    }

    .status-chip .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: ${isMailConfigured ? "var(--success)" : "var(--stamp)"};
      flex: none;
    }

    /* ---- layout ---- */
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr);
      gap: 16px;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    form.panel { padding: 18px; }

    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      min-width: 0;
    }

    fieldset:disabled .field { opacity: 0.55; }

    .section-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      margin: 0 0 10px;
    }

    .section-label::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--line-soft);
    }

    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 600;
      color: #263248;
      font-size: 13px;
    }

    input[type="text"],
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      font: inherit;
      color: var(--ink);
      background: #fbfcfe;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    #recipients { font-family: var(--mono); font-size: 12.5px; min-height: 84px; }
    #message { min-height: 130px; line-height: 1.5; }

    textarea { resize: vertical; }

    input[type="text"]:focus,
    textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .file-drop {
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 9px 12px;
      background: #fbfcfe;
    }

    .file-drop input[type="file"] {
      font: inherit;
      font-size: 12.5px;
      color: var(--muted);
      max-width: 100%;
    }

    .field { margin-bottom: 14px; }
    .field:last-of-type { margin-bottom: 0; }

    .hint {
      margin-top: 6px;
      color: var(--faint);
      font-size: 12px;
      line-height: 1.4;
    }

    .divider {
      height: 1px;
      background: var(--line-soft);
      margin: 16px 0;
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 16px;
      flex-wrap: wrap;
    }

    .actions-left { display: flex; gap: 8px; }

    button {
      border: 0;
      border-radius: 8px;
      height: 38px;
      padding: 0 14px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s, transform 0.05s;
    }

    button:active { transform: translateY(1px); }

    .send {
      color: #fff;
      background: var(--accent);
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .send:hover:not(:disabled) { background: var(--accent-dark); }

    .ghost {
      color: #344054;
      background: var(--accent-soft);
    }

    .ghost:hover:not(:disabled) { background: #dee9f3; }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .spinner {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.4);
      border-top-color: #fff;
      animation: spin 0.7s linear infinite;
      display: none;
    }

    .send.busy .spinner { display: inline-block; }

    @keyframes spin { to { transform: rotate(360deg); } }

    .lock-note {
      display: none;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      color: var(--stamp);
      font-weight: 600;
      margin-top: 10px;
      padding: 8px 10px;
      background: var(--stamp-soft);
      border-radius: 8px;
    }

    .lock-note.show { display: flex; }

    /* ---- preview / manifest column ---- */
    .preview {
      padding: 16px;
      position: sticky;
      top: 16px;
    }

    .notice {
      min-height: 40px;
      display: flex;
      align-items: center;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--line-soft);
      color: var(--muted);
      background: #f8fafc;
      line-height: 1.4;
      font-size: 12.5px;
      margin-bottom: 12px;
    }

    .notice.error { border-color: #f3c8c4; background: var(--stamp-soft); color: var(--stamp); }
    .notice.success { border-color: #bfe3d1; background: var(--success-soft); color: var(--success); }

    .manifest-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .manifest-head .section-label { margin: 0; }

    .count-badge {
      font-family: var(--mono);
      font-size: 11px;
      color: var(--muted);
    }

    .recipient-list {
      display: grid;
      gap: 6px;
      max-height: 260px;
      min-height: 100px;
      overflow-y: auto;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 8px;
      background: #fbfcfe;
      margin-bottom: 16px;
    }

    .recipient-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 6px 9px;
      border: 1px solid var(--line-soft);
      border-radius: 7px;
      background: #fff;
    }

    .recipient-email {
      overflow-wrap: anywhere;
      font-family: var(--mono);
      font-size: 12px;
      line-height: 1.3;
    }

    .recipient-state {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      min-height: 24px;
      border-radius: 50%;
      color: var(--faint);
      background: var(--accent-soft);
      font-weight: 800;
      font-size: 12px;
    }

    .recipient-row.sending { border-color: #f3d9a6; }
    .recipient-row.sending .recipient-state { color: #8a4b00; background: #fff4d6; }

    .recipient-row.sent { border-color: #bfe3d1; }
    .recipient-row.sent .recipient-state { color: var(--success); background: var(--success-soft); }

    .recipient-row.bad,
    .recipient-row.failed { border-color: #f3c8c4; }
    .recipient-row.bad .recipient-state,
    .recipient-row.failed .recipient-state { color: var(--stamp); background: var(--stamp-soft); }

    .attachment-list {
      display: grid;
      gap: 6px;
      max-height: 120px;
      overflow-y: auto;
      margin-bottom: 16px;
    }

    .attachment-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 6px 9px;
      border: 1px solid var(--line-soft);
      border-radius: 7px;
      background: #fff;
      color: var(--muted);
      font-size: 12px;
    }

    .attachment-icon {
      color: var(--accent);
      font-weight: 800;
    }

    .attachment-name {
      overflow-wrap: anywhere;
    }

    .message-preview {
      border-top: 1px solid var(--line-soft);
      padding-top: 14px;
    }

    .subject-preview,
    .body-preview {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .subject-preview {
      font-family: var(--serif);
      font-weight: 700;
      font-size: 15px;
      margin-bottom: 8px;
      color: var(--ink);
    }

    .body-preview {
      color: #35445a;
      line-height: 1.5;
      font-size: 12.5px;
      max-height: 220px;
      overflow: auto;
    }

    @media (max-width: 820px) {
      .grid { grid-template-columns: 1fr; }
      .preview { position: static; }
    }

    @media (max-width: 520px) {
      .app { width: min(100% - 20px, 1040px); padding: 16px 0 24px; }
      form.panel, .preview { padding: 14px; }
      .recipient-list { max-height: 220px; }
      .actions { flex-direction: column-reverse; align-items: stretch; }
      .actions-left { justify-content: stretch; }
      .actions-left button { flex: 1; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div class="brand">
        <span class="postmark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1e3a5f" stroke-width="1.6">
            <path d="M3 6.5h18v11H3z" stroke-linejoin="round" />
            <path d="M3 6.5l9 7 9-7" stroke-linejoin="round" />
          </svg>
        </span>
        <div>
          <p class="eyebrow">Bulk dispatch</p>
          <h1>Mail Manifest</h1>
        </div>
      </div>
      <div class="status-chip"><span class="dot"></span>${isMailConfigured ? "Sender ready" : "Not configured"}</div>
    </header>

    <section class="grid">
      <form class="panel" id="mailForm">
        <fieldset id="formFields">
          <p class="section-label">Recipients</p>
          <div class="field">
            <label for="recipients">Addresses</label>
            <textarea id="recipients" name="recipients" placeholder="person1@example.com, person2@example.com"></textarea>
            <div class="hint">Commas, spaces, semicolons, or new lines all work. Duplicates are sent once.</div>
          </div>

          <div class="field">
            <label for="fileInput">Or extract from a file</label>
            <div class="file-drop">
              <input id="fileInput" name="files" type="file" multiple accept=".pdf,.xls,.xlsx,.csv,text/csv" />
            </div>
            <div class="hint">PDF, XLSX, or CSV — addresses found inside will be pulled out automatically.</div>
          </div>

          <div class="divider"></div>

          <p class="section-label">Message</p>
          <div class="field">
            <label for="subject">Subject</label>
            <input id="subject" name="subject" type="text" placeholder="Quick update" />
          </div>

          <div class="field">
            <label for="message">Body</label>
            <textarea id="message" name="message" placeholder="Hello,"></textarea>
          </div>

          <div class="field">
            <label for="attachmentInput">Attach documents</label>
            <div class="file-drop">
              <input id="attachmentInput" name="attachments" type="file" multiple accept=".pdf,.doc,.docx,.txt,.rtf,.odt,.xls,.xlsx,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
            </div>
            <div class="hint">Attach PDF, document, resume, spreadsheet, or text files to every email.</div>
          </div>
        </fieldset>

        <div class="actions">
          <div class="actions-left">
            <button class="ghost" type="button" id="clearButton">Clear</button>
            <button class="ghost" type="button" id="extractButton">Extract emails</button>
          </div>
          <button class="send" type="submit" id="sendButton">
            <span class="spinner"></span>
            <span class="sendLabel">Send to recipients</span>
          </button>
        </div>

        <div class="lock-note" id="lockNote">Sending in progress — fields are locked until it finishes.</div>
      </form>

      <aside class="panel preview">
        <div class="notice" id="notice">Write a message, add recipients, then send once.</div>

        <div class="manifest-head">
          <p class="section-label">Manifest</p>
          <span class="count-badge" id="countBadge">0 addresses</span>
        </div>
        <div class="recipient-list" id="recipientList"></div>

        <div class="manifest-head">
          <p class="section-label">Attachments</p>
        </div>
        <div class="attachment-list" id="attachmentList"></div>

        <div class="message-preview">
          <div class="subject-preview" id="subjectPreview">Subject preview</div>
          <div class="body-preview" id="bodyPreview">Message preview</div>
        </div>
      </aside>
    </section>
  </main>

  <script>
    const form = document.querySelector("#mailForm");
    const formFields = document.querySelector("#formFields");
    const recipientsInput = document.querySelector("#recipients");
    const subjectInput = document.querySelector("#subject");
    const messageInput = document.querySelector("#message");
    const sendButton = document.querySelector("#sendButton");
    const sendLabel = sendButton.querySelector(".sendLabel");
    const clearButton = document.querySelector("#clearButton");
    const extractButton = document.querySelector("#extractButton");
    const fileInput = document.querySelector("#fileInput");
    const attachmentInput = document.querySelector("#attachmentInput");
    const notice = document.querySelector("#notice");
    const recipientList = document.querySelector("#recipientList");
    const attachmentList = document.querySelector("#attachmentList");
    const countBadge = document.querySelector("#countBadge");
    const subjectPreview = document.querySelector("#subjectPreview");
    const bodyPreview = document.querySelector("#bodyPreview");
    const lockNote = document.querySelector("#lockNote");
    const emailPattern = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

    const parseRecipients = (value) => {
      return [...new Set(value.split(/[\\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
    };

    const setNotice = (message, type = "") => {
      notice.textContent = message;
      notice.className = "notice" + (type ? " " + type : "");
    };

    const setRecipientState = (email, state, symbol) => {
      const row = recipientList.querySelector('[data-email="' + CSS.escape(email) + '"]');
      if (!row) return;

      row.className = "recipient-row " + state;
      row.querySelector(".recipient-state").textContent = symbol;
    };

    // Locks every editable field for the duration of a send so the
    // in-flight message can't be changed mid-dispatch.
    const setSendingLock = (isSending) => {
      formFields.disabled = isSending;
      clearButton.disabled = isSending;
      extractButton.disabled = isSending;
      sendButton.disabled = isSending;
      sendButton.classList.toggle("busy", isSending);
      sendLabel.textContent = isSending ? "Sending..." : "Send to recipients";
      lockNote.classList.toggle("show", isSending);
    };

    const updatePreview = () => {
      const emails = parseRecipients(recipientsInput.value);
      const attachments = Array.from(attachmentInput.files || []);

      subjectPreview.textContent = subjectInput.value.trim() || "Subject preview";
      bodyPreview.textContent = messageInput.value.trim() || "Message preview";
      countBadge.textContent = emails.length + (emails.length === 1 ? " address" : " addresses");

      recipientList.innerHTML = "";

      if (!emails.length) {
        const empty = document.createElement("div");
        empty.className = "recipient-row";
        empty.innerHTML = '<span class="recipient-email">No email selected</span><span class="recipient-state">-</span>';
        recipientList.appendChild(empty);
        return;
      }

      emails.forEach((email) => {
        const isValid = emailPattern.test(email);
        const row = document.createElement("div");
        row.className = "recipient-row" + (isValid ? "" : " bad");
        row.dataset.email = email;

        const emailText = document.createElement("span");
        emailText.className = "recipient-email";
        emailText.textContent = email;

        const state = document.createElement("span");
        state.className = "recipient-state";
        state.textContent = isValid ? "-" : "!";

        row.appendChild(emailText);
        row.appendChild(state);
        recipientList.appendChild(row);
      });

      attachmentList.innerHTML = "";

      if (!attachments.length) {
        const empty = document.createElement("div");
        empty.className = "attachment-row";
        empty.innerHTML = '<span class="attachment-icon">-</span><span class="attachment-name">No document attached</span>';
        attachmentList.appendChild(empty);
        return;
      }

      attachments.forEach((file) => {
        const row = document.createElement("div");
        row.className = "attachment-row";

        const icon = document.createElement("span");
        icon.className = "attachment-icon";
        icon.textContent = "+";

        const name = document.createElement("span");
        name.className = "attachment-name";
        name.textContent = file.name;

        row.appendChild(icon);
        row.appendChild(name);
        attachmentList.appendChild(row);
      });
    };

    [recipientsInput, subjectInput, messageInput, attachmentInput].forEach((input) => {
      input.addEventListener("input", updatePreview);
      input.addEventListener("change", updatePreview);
    });

    clearButton.addEventListener("click", () => {
      form.reset();
      setNotice("Write a message, add recipients, then send once.");
      updatePreview();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const recipients = parseRecipients(recipientsInput.value);

      // parseRecipients already filters invalid emails.
      const subject = subjectInput.value.trim();
      const message = messageInput.value.trim();

      if (!recipients.length) {
        setNotice("Add at least one recipient email address.", "error");
        return;
      }

      // Validate on the client too (the backend will validate as well).
      const invalid = recipients.filter((email) => !emailPattern.test(email));
      if (invalid.length) {
        setNotice("Fix invalid email addresses before sending.", "error");
        return;
      }


      if (!subject || !message) {
        setNotice("Subject and message are required.", "error");
        return;
      }

      // Freeze the subject/body/recipients now, so what gets sent is exactly
      // what the manifest showed the moment "Send" was pressed.
      const lockedSubject = subject;
      const lockedMessage = message;
      const lockedAttachments = Array.from(attachmentInput.files || []);

      setSendingLock(true);
      setNotice("Sending one by one...");

      try {
        const failed = [];

        for (const recipient of recipients) {
          setRecipientState(recipient, "sending", "...");
          setNotice("Sending to " + recipient);

          const formData = new FormData();
          formData.append("recipients", JSON.stringify([recipient]));
          formData.append("subject", lockedSubject);
          formData.append("message", lockedMessage);
          lockedAttachments.forEach((file) => {
            formData.append("attachments", file, file.name);
          });

          const response = await fetch("/api/send", {
            method: "POST",
            body: formData,
          });
          const result = await response.json();

          if (!response.ok) {
            setRecipientState(recipient, "failed", "!");
            failed.push(recipient);
            continue;
          }

          setRecipientState(recipient, "sent", "\\u2713");
        }

        if (failed.length) {
          setNotice("Some emails failed. Check the marked email rows.", "error");
        } else {
          setNotice("All emails sent successfully.", "success");
        }
      } catch (error) {
        setNotice(error.message, "error");
      } finally {
        setSendingLock(false);
      }
    });

    extractButton.addEventListener("click", async () => {
      const files = fileInput.files;
      if (!files || files.length === 0) {
        setNotice("Select at least one file to extract from.", "error");
        return;
      }

      extractButton.disabled = true;
      extractButton.textContent = "Extracting...";
      setNotice("Extracting emails from files...");

      try {
        const formData = new FormData();
        for (const f of files) formData.append("files", f);

        const res = await fetch("/api/extract", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Extraction failed");

        if (Array.isArray(data.emails) && data.emails.length) {
          recipientsInput.value = data.emails.join(", ");
          updatePreview();
          setNotice("Extracted emails are ready to send.", "success");
        } else {
          setNotice("No emails found in uploaded files.", "error");
        }
      } catch (err) {
        setNotice(err.message || "Extraction error", "error");
      } finally {
        extractButton.disabled = false;
        extractButton.textContent = "Extract emails";
      }
    });

    updatePreview();
  </script>
</body>
</html>`;

const handleSend = async (request, response) => {
  try {
    if (!isMailConfigured) {
      sendJson(response, 500, {
        error: "Gmail email/password environment variables are missing. Check your .env file.",
      });
      return;
    }

    const contentType = request.headers["content-type"] || "";
    const body = contentType.includes("multipart/form-data")
      ? await readMultipartSendBody(request)
      : await readJsonBody(request);
    const parsedRecipients = typeof body.recipients === "string" && body.recipients.trim().startsWith("[")
      ? JSON.parse(body.recipients)
      : body.recipients;
    const recipients = Array.isArray(parsedRecipients)
      ? [...new Set(parsedRecipients.map((email) => String(email).trim().toLowerCase()).filter(Boolean))]
      : parseRecipients(parsedRecipients);
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const invalid = recipients.filter((email) => !emailPattern.test(email));

    if (!recipients.length) {
      sendJson(response, 400, { error: "At least one recipient is required." });
      return;
    }

    if (invalid.length) {
      sendJson(response, 400, { error: `Invalid email address: ${invalid[0]}` });
      return;
    }

    if (!subject || !message) {
      sendJson(response, 400, { error: "Subject and message are required." });
      return;
    }

    const html = escapeHtml(message).replaceAll("\\n", "<br />");

    await sendEmailsSeparately({
      recipients,
      subject,
      text: message,
      html,
      attachments,
    });

    sendJson(response, 200, {
      sent: recipients,
      attachments: attachments.map((attachment) => attachment.filename),
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unable to send email." });
  }
};

const handleExtract = (request, response) => {
  return new Promise((resolve) => {
    try {
      const contentType = request.headers["content-type"] || "";

      if (!contentType.includes("multipart/form-data")) {
        sendJson(response, 400, { error: "Upload files as multipart/form-data." });
        resolve();
        return;
      }

      const fileEntries = [];
      const busboy = Busboy({
        headers: request.headers,
        limits: {
          files: 20,
          fileSize: 25 * 1024 * 1024,
        },
      });

      busboy.on("file", (fieldname, file, info) => {
        if (fieldname !== "files") {
          file.resume();
          return;
        }

        const chunks = [];
        const filename = info?.filename || "file";

        file.on("data", (chunk) => {
          chunks.push(chunk);
        });

        file.on("limit", () => {
          console.warn(`Upload skipped because it is too large: ${filename}`);
          chunks.length = 0;
          file.resume();
        });

        file.on("end", () => {
          if (chunks.length) {
            fileEntries.push({
              filename,
              buffer: Buffer.concat(chunks),
            });
          }
        });
      });

      busboy.on("error", (err) => {
        sendJson(response, 500, { error: err.message || "Failed to parse uploaded files." });
        resolve();
      });

      busboy.on("finish", async () => {
        try {
          const emails = await extractEmailsFromFiles(fileEntries);
          sendJson(response, 200, { emails, count: emails.length });
        } catch (procErr) {
          sendJson(response, 500, { error: procErr.message || "Extraction failed." });
        }

        resolve();
      });

      request.pipe(busboy);
    } catch (err) {
      sendJson(response, 500, { error: err.message || "Extraction failed." });
      resolve();
    }
  });
};

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page);
    return;
  }

  if (request.method === "POST" && request.url === "/api/send") {
    await handleSend(request, response);
    return;
  }

  if (request.method === "POST" && request.url === "/api/extract") {
    await handleExtract(request, response);
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the other server or set PORT to a different number in .env.`);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Bulk Mail Sender is running at http://localhost:${PORT}`);
  console.log(`Mail service: ${isMailConfigured ? "ready" : "not configured"}`);
});
