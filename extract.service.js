import pdf from "pdf-parse";
import XLSX from "xlsx";

const emailRegex = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;
const trailingJunkRegex = /[),.;:!?'"<>}\]]+$/;

const normalizeText = (value = "") => {
    return String(value)
        .normalize("NFKC")
        .replace(/\u00a0/g, " ")
        .replace(/\s+@\s+/g, "@")
        .replace(/\s+\.\s+/g, ".")
        .replace(/mailto:/gi, " ");
};

const cleanEmail = (value = "") => {
    return String(value)
        .trim()
        .replace(/^mailto:/i, "")
        .replace(trailingJunkRegex, "")
        .toLowerCase();
};

const addEmailsFromText = (emails, value) => {
    const text = normalizeText(value);
    const found = text.match(emailRegex) || [];

    for (const item of found) {
        const email = cleanEmail(item);

        if (emailRegex.test(email)) {
            emails.add(email);
        }

        emailRegex.lastIndex = 0;
    }
};

const addEmailsFromWorkbook = (emails, buffer) => {
    const workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
        cellFormula: true,
        cellHTML: false,
        cellNF: false,
        cellText: true,
    });

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            blankrows: false,
            defval: "",
            raw: false,
        });

        addEmailsFromText(emails, sheetName);
        addEmailsFromText(emails, XLSX.utils.sheet_to_csv(sheet));

        for (const row of rows) {
            addEmailsFromText(emails, row.join(" "));
        }

        for (const [cellRef, cell] of Object.entries(sheet)) {
            if (cellRef.startsWith("!") || !cell) continue;

            addEmailsFromText(emails, cell.v);
            addEmailsFromText(emails, cell.w);
            addEmailsFromText(emails, cell.f);
            addEmailsFromText(emails, cell.h);

            if (cell.l) {
                addEmailsFromText(emails, cell.l.Target);
                addEmailsFromText(emails, cell.l.Tooltip);
            }
        }
    }
};

export async function extractEmailsFromFiles(files = []) {
    const emails = new Set();

    for (const file of files) {
        const name = String(file.filename || "").toLowerCase();
        const buffer = file.buffer;

        if (!Buffer.isBuffer(buffer)) {
            console.warn(`Failed to parse ${name || "file"}: missing file buffer`);
            continue;
        }

        try {
            if (name.endsWith(".pdf")) {
                const data = await pdf(buffer);
                addEmailsFromText(emails, data.text);
            } else if (name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".csv")) {
                addEmailsFromWorkbook(emails, buffer);
            } else {
                addEmailsFromText(emails, buffer.toString("utf8"));
            }
        } catch (err) {
            console.warn(`Failed to parse ${name || "file"}: ${err.message}`);
        }
    }

    return Array.from(emails).sort();
}

export default extractEmailsFromFiles;
