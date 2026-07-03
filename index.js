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
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
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
  <title>Bulk Mail Sender</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --ink: #172033;
      --muted: #607086;
      --line: #d9e0ea;
      --accent: #0f766e;
      --accent-dark: #0b5f59;
      --danger: #b42318;
      --success: #067647;
      --shadow: 0 18px 50px rgba(23, 32, 51, 0.12);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
    }

    .app {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }

    h1 {
      margin: 0;
      font-size: clamp(28px, 4vw, 44px);
      line-height: 1.05;
      letter-spacing: 0;
    }

    .status {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: #fff;
      white-space: nowrap;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.85fr);
      gap: 20px;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }

    form.panel {
      padding: 22px;
    }

    .preview {
      padding: 20px;
      position: sticky;
      top: 20px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 700;
      color: #263248;
    }

    input,
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 13px 14px;
      font: inherit;
      color: var(--ink);
      background: #fbfcfe;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }

    textarea {
      min-height: 180px;
      resize: vertical;
      line-height: 1.5;
    }

    input:focus,
    textarea:focus {
      border-color: var(--accent);
      background: #fff;
      box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.14);
    }

    .field {
      margin-bottom: 18px;
    }

    .hint {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }

    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-top: 22px;
    }

    button {
      border: 0;
      border-radius: 8px;
      min-height: 46px;
      padding: 0 18px;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }

    .send {
      color: #fff;
      background: var(--accent);
    }

    .send:hover {
      background: var(--accent-dark);
    }

    .clear {
      color: #344054;
      background: #edf2f7;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }

    .recipient-list {
      display: grid;
      gap: 8px;
      max-height: 320px;
      min-height: 120px;
      overflow-y: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfcfe;
      margin-bottom: 18px;
    }

    .recipient-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-height: 38px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }

    .recipient-email {
      overflow-wrap: anywhere;
      font-size: 14px;
      line-height: 1.35;
    }

    .recipient-state {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      min-height: 28px;
      border-radius: 999px;
      color: var(--muted);
      background: #edf2f7;
      font-weight: 800;
      font-size: 15px;
    }

    .recipient-row.sending .recipient-state {
      color: #8a4b00;
      background: #fff4d6;
    }

    .recipient-row.sent .recipient-state {
      color: var(--success);
      background: #ecfdf3;
    }

    .recipient-row.bad .recipient-state,
    .recipient-row.failed .recipient-state {
      color: var(--danger);
      background: #fff1f0;
    }

    .message-preview {
      border-top: 1px solid var(--line);
      padding-top: 18px;
    }

    .subject-preview,
    .body-preview {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .subject-preview {
      font-weight: 800;
      margin-bottom: 10px;
    }

    .body-preview {
      color: #35445a;
      line-height: 1.55;
      max-height: 280px;
      overflow: auto;
    }

    .notice {
      min-height: 46px;
      display: flex;
      align-items: center;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid transparent;
      color: var(--muted);
      background: #f8fafc;
      line-height: 1.4;
    }

    .notice.error {
      border-color: #fecdca;
      background: #fff1f0;
      color: var(--danger);
    }

    .notice.success {
      border-color: #abefc6;
      background: #ecfdf3;
      color: var(--success);
    }

    @media (max-width: 820px) {
      .topbar,
      .actions {
        align-items: stretch;
        flex-direction: column;
      }

      .grid {
        grid-template-columns: 1fr;
      }

      .preview {
        position: static;
      }
    }

    @media (max-width: 520px) {
      .app {
        width: min(100% - 20px, 1120px);
        padding: 18px 0;
      }

      form.panel,
      .preview {
        padding: 16px;
      }

      .recipient-list {
        max-height: 260px;
      }

      button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <h1>Bulk Mail Sender</h1>
      <div class="status" id="configStatus">Mail service: ${isMailConfigured ? "ready" : "not configured"}</div>
    </header>

    <section class="grid">
      <form class="panel" id="mailForm">
        <div class="field">
          <label for="recipients">Recipients</label>
          <textarea id="recipients" name="recipients" placeholder="person1@example.com, person2@example.com"></textarea>
          <div class="hint">Use commas, spaces, semicolons, or new lines. Duplicate addresses are sent only once.</div>
        </div>

        <div class="field">
          <label for="fileInput">Upload files (PDF, XLSX, CSV)</label>
          <input id="fileInput" name="files" type="file" multiple accept=".pdf,.xls,.xlsx,.csv,text/csv" />
          <div class="hint">Select one or more PDF/Excel/CSV files to extract emails.</div>
        </div>

        <div class="field">
          <label for="subject">Subject</label>
          <input id="subject" name="subject" type="text" placeholder="Quick update" />
        </div>

        <div class="field">
          <label for="message">Message</label>
          <textarea id="message" name="message" placeholder="Hello,"></textarea>
        </div>

        <div class="actions">
          <button class="clear" type="button" id="clearButton">Clear</button>
          <button class="clear" type="button" id="extractButton">Extract emails</button>
          <button class="send" type="submit" id="sendButton">Send to recipients</button>
        </div>
      </form>

      <aside class="panel preview">
        <div class="notice" id="notice">Write a message, add recipients, then send once.</div>
        <div class="recipient-list" id="recipientList"></div>

        <div class="message-preview">
          <div class="subject-preview" id="subjectPreview">Subject preview</div>
          <div class="body-preview" id="bodyPreview">Message preview</div>
        </div>
      </aside>
    </section>
  </main>

  <script>
    const form = document.querySelector("#mailForm");
    const recipientsInput = document.querySelector("#recipients");
    const subjectInput = document.querySelector("#subject");
    const messageInput = document.querySelector("#message");
    const sendButton = document.querySelector("#sendButton");
    const clearButton = document.querySelector("#clearButton");
    const notice = document.querySelector("#notice");
    const recipientList = document.querySelector("#recipientList");
    const subjectPreview = document.querySelector("#subjectPreview");
    const bodyPreview = document.querySelector("#bodyPreview");
    const fileInput = document.querySelector("#fileInput");
    const extractButton = document.querySelector("#extractButton");
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

    const updatePreview = () => {
      const emails = parseRecipients(recipientsInput.value);
      const valid = emails.filter((email) => emailPattern.test(email));
      const invalid = emails.filter((email) => !emailPattern.test(email));

      subjectPreview.textContent = subjectInput.value.trim() || "Subject preview";
      bodyPreview.textContent = messageInput.value.trim() || "Message preview";

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
    };

    [recipientsInput, subjectInput, messageInput].forEach((input) => {
      input.addEventListener("input", updatePreview);
    });

    clearButton.addEventListener("click", () => {
      form.reset();
      setNotice("Write a message, add recipients, then send once.");
      updatePreview();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const recipients = parseRecipients(recipientsInput.value);
      const invalid = recipients.filter((email) => !emailPattern.test(email));
      const subject = subjectInput.value.trim();
      const message = messageInput.value.trim();

      if (!recipients.length) {
        setNotice("Add at least one recipient email address.", "error");
        return;
      }

      if (invalid.length) {
        setNotice("Fix invalid email addresses before sending.", "error");
        return;
      }

      if (!subject || !message) {
        setNotice("Subject and message are required.", "error");
        return;
      }

      sendButton.disabled = true;
      extractButton.disabled = true;
      sendButton.textContent = "Sending...";
      setNotice("Sending one by one...");

      try {
        const failed = [];

        for (const recipient of recipients) {
          setRecipientState(recipient, "sending", "...");
          setNotice("Sending to " + recipient);

          const response = await fetch("/api/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipients: [recipient], subject, message }),
          });
          const result = await response.json();

          if (!response.ok) {
            setRecipientState(recipient, "failed", "!");
            failed.push(recipient);
            continue;
          }

          setRecipientState(recipient, "sent", "✓");
        }

        if (failed.length) {
          setNotice("Some emails failed. Check the marked email rows.", "error");
        } else {
          setNotice("All emails sent successfully.", "success");
        }
      } catch (error) {
        setNotice(error.message, "error");
      } finally {
        sendButton.disabled = false;
        extractButton.disabled = false;
        sendButton.textContent = "Send to recipients";
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

    const body = await readJsonBody(request);
    const recipients = Array.isArray(body.recipients)
      ? [...new Set(body.recipients.map((email) => String(email).trim().toLowerCase()).filter(Boolean))]
      : parseRecipients(body.recipients);
    const subject = String(body.subject || "").trim();
    const message = String(body.message || "").trim();
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
    });

    sendJson(response, 200, { sent: recipients });
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
