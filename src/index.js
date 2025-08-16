import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import config from './config.json';

export default {
  async fetch(request, env, ctx) {
    return await handleRequest(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    return await handleRequest(event, env, ctx);
  },
};

function validateConfig() {
  const errors = [];

  // Validate company config
  if (!config.company?.name) errors.push('config.company.name is required');
  if (!config.company?.details || !Array.isArray(config.company.details)) errors.push('config.company.details must be an array');

  // Validate clients array
  if (!config.clients || !Array.isArray(config.clients) || config.clients.length === 0) {
    errors.push('config.clients must be a non-empty array');
    return errors;
  }

  // Validate each client
  config.clients.forEach((client, index) => {
    const prefix = `config.clients[${index}]`;
    if (!client.name) errors.push(`${prefix}.name is required`);
    if (!client.details || !Array.isArray(client.details)) errors.push(`${prefix}.details must be an array`);
    if (!client.email_to || !Array.isArray(client.email_to) || client.email_to.length === 0) {
      errors.push(`${prefix}.email_to must be a non-empty array`);
    }
    if (!client.email_cc || !Array.isArray(client.email_cc)) errors.push(`${prefix}.email_cc must be an array`);
    if (!client.payment_details || !Array.isArray(client.payment_details)) errors.push(`${prefix}.payment_details must be an array`);
    if (!client.services || !Array.isArray(client.services)) errors.push(`${prefix}.services must be an array`);

    // Validate services
    client.services?.forEach((service, serviceIndex) => {
      const servicePrefix = `${prefix}.services[${serviceIndex}]`;
      if (!service.description) errors.push(`${servicePrefix}.description is required`);
      if (typeof service.quantity !== 'number') errors.push(`${servicePrefix}.quantity must be a number`);
      if (typeof service.unit_price !== 'number') errors.push(`${servicePrefix}.unit_price must be a number`);
      if (typeof service.tax_rate !== 'number') errors.push(`${servicePrefix}.tax_rate must be a number`);
    });
  });

  return errors;
}

async function handleRequest(request, env, ctx) {
  // Failsafe: Only allow execution during scheduled cron runs
  if (request && request.method) {
    // This is an HTTP request, not a cron trigger, don't process it
    return new Response('This worker only runs on a schedule.', { status: 400 });
  }

  // Validate configuration
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    const errorMessage = `Configuration validation failed:\n${configErrors.join('\n')}`;
    console.error(errorMessage);
    return new Response('Configuration error', { status: 500 });
  }

  const num_invoices = config.clients.length;

  // Get the last invoice number from KV, default to 0 if not found
  let last_invoice_number;
  try {
    const last_invoice_number_str = await env.INVOICES_KV.get("LAST_INVOICE_NUMBER");
    last_invoice_number = last_invoice_number_str ? parseInt(last_invoice_number_str, 10) : 0;
  } catch (error) {
    const errorMessage = `Failed to read last invoice number from KV: ${error.message}`;
    console.error(errorMessage);
    await send_system_error_notification(env, errorMessage);
    return new Response('KV read error', { status: 500 });
  }

  // Reserve the next block of invoice numbers
  const next_invoice_number_start = last_invoice_number + 1;
  const next_invoice_number_end = last_invoice_number + num_invoices;

  try {
    await env.INVOICES_KV.put("LAST_INVOICE_NUMBER", next_invoice_number_end.toString());
  } catch (error) {
    const errorMessage = `Failed to update invoice number counter in KV: ${error.message}. Cannot proceed to prevent duplicate invoice numbers.`;
    console.error(errorMessage);
    await send_system_error_notification(env, errorMessage);
    return new Response('KV write error', { status: 500 });
  }

  for (let i = 0; i < config.clients.length; i++) {
    const client = config.clients[i];
    const invoice_number = next_invoice_number_start + i;

    try {
      const pdfBytes = await create_invoice_pdf(
        invoice_number,
        client.name,
        client.details,
        client.payment_details,
        client.services || []
      );

      const email_sent = await send_invoice_email(
        env,
        pdfBytes,
        client.email_to,
        client.email_cc,
        invoice_number
      );

      if (email_sent) {
        console.log(`Successfully sent invoice ${invoice_number} for ${client.name}.`);
        await store_invoice(env, "sent", invoice_number, pdfBytes);
      } else {
        console.error(`Failed to send invoice ${invoice_number} for ${client.name}. The invoice number has been used and will not be reused.`);
        await store_invoice(env, "failed", invoice_number, pdfBytes);
      }
    } catch (error) {
      console.error(`Failed to generate PDF for invoice ${invoice_number} (${client.name}):`, error);
      await send_error_notification(env, error.message, invoice_number, client.name);
    }
  }

  return new Response("OK");
}

async function create_invoice_pdf(invoice_number, client_name, client_details, payment_details, services = []) {
  // Layout constants
  const MARGINS = { left: 50, right: 50 };
  const ROW_HEIGHT = 40;
  const ROW_SPACING = 40;
  const COLUMN_POSITIONS = [50, 250, 330, 410, 470];
  const PAYMENT_DETAILS_Y = 150;

  const now = new Date();
  const creation_date = now.toISOString().split('T')[0];
  const due_date = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Header with company name and invoice details
  page.drawText(config.company.name, { x: MARGINS.left, y: height - 65, font: boldFont, size: 18 });
  page.drawText(`Invoice #${invoice_number.toString().padStart(4, '0')}`, { x: width - 154, y: height - 65, font: boldFont, size: 18 });
  page.drawText(`Issued on: ${creation_date}`, { x: width - 148, y: height - 85, font, size: 11 });
  page.drawText(`Due by: ${due_date}`, { x: width - 135, y: height - 100, font, size: 11 });

  // From section
  const fromStartY = height - 135;
  page.drawText("From", { x: MARGINS.left, y: fromStartY, font: boldFont, size: 11 });
  page.drawText(config.company.name, { x: MARGINS.left, y: fromStartY - 20, font, size: 11 });
  config.company.details.forEach((line, index) => {
    page.drawText(line, { x: MARGINS.left, y: fromStartY - 35 - (index * 15), font, size: 11 });
  });

  // To section
  const toStartY = fromStartY;
  page.drawText("To", { x: 300, y: toStartY, font: boldFont, size: 11 });
  page.drawText(client_name, { x: 300, y: toStartY - 20, font, size: 11 });
  client_details.forEach((line, index) => {
    page.drawText(line, { x: 300, y: toStartY - 35 - (index * 15), font, size: 11 });
  });

  // Services table
  const tableStartY = height - 295;
  const tableHeaders = ['Product', 'Quantity', 'Unit Price', 'Tax', 'Total'];
  const columnWidths = [200, 80, 80, 60, 80];
  const columnX = COLUMN_POSITIONS;

  // Table header
  page.drawRectangle({ x: 45, y: tableStartY - 5, width: 510, height: 25, color: rgb(0.9, 0.9, 0.9) });
  tableHeaders.forEach((header, index) => {
    page.drawText(header, { x: columnX[index], y: tableStartY + 6, font: boldFont, size: 10 });
  });

  // Table rows
  let currentY = tableStartY - 35;
  let subtotal = 0;
  let totalTax = 0;

  services.forEach((service, rowIndex) => {
    const lineTotal = service.quantity * service.unit_price;
    const tax = lineTotal * service.tax_rate;
    const total = lineTotal + tax;

    subtotal += lineTotal;
    totalTax += tax;

    // Alternating row colors
    if (rowIndex % 2 === 0) {
      page.drawRectangle({ x: 45, y: currentY - 5, width: 510, height: ROW_HEIGHT, color: rgb(0.98, 0.98, 0.98) });
    }

    page.drawText(`${service.description}`, { x: columnX[0], y: currentY + 17, font, size: 10 });
    page.drawText(`${service.period || ''}`, { x: columnX[0], y: currentY + 17 - 12, font, size: 8, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(`${service.quantity}`, { x: columnX[1], y: currentY + 12, font, size: 10 });
    page.drawText(`$ ${service.unit_price.toFixed(2)}`, { x: columnX[2], y: currentY + 12, font, size: 10 });
    page.drawText(`$ ${tax.toFixed(2)}`, { x: columnX[3], y: currentY + 12, font, size: 10 });
    page.drawText(`$ ${total.toFixed(2)}`, { x: columnX[4], y: currentY + 12, font, size: 10 });

    currentY -= ROW_SPACING;
  });

  // Invoice Summary
  const summaryStartY = currentY - 30;
  const summaryX = 350;

  page.drawText("Invoice Summary", { x: summaryX, y: summaryStartY, font: boldFont, size: 12 });

  page.drawText("Subtotal", { x: summaryX, y: summaryStartY - 25, font, size: 10 });
  page.drawText(`$ ${subtotal.toFixed(2)}`, { x: summaryX + 100, y: summaryStartY - 25, font, size: 10 });

  page.drawText("Tax", { x: summaryX, y: summaryStartY - 40, font, size: 10 });
  page.drawText(`$ ${totalTax.toFixed(2)}`, { x: summaryX + 100, y: summaryStartY - 40, font, size: 10 });

  page.drawText("Total", { x: summaryX, y: summaryStartY - 55, font: boldFont, size: 10 });
  page.drawText(`$ ${(subtotal + totalTax).toFixed(2)}`, { x: summaryX + 100, y: summaryStartY - 55, font: boldFont, size: 10 });

  // Payment Details  
  const paymentDetailsY = PAYMENT_DETAILS_Y;
  page.drawText("Payment details", { x: MARGINS.left, y: paymentDetailsY, font: boldFont, size: 12 });

  payment_details.forEach((line, index) => {
    page.drawText(line, { x: MARGINS.left, y: paymentDetailsY - 20 - (index * 15), font, size: 10 });
  });

  return await pdfDoc.save();
}

function uint8ArrayToBase64(uint8Array) {
  // Process in chunks to avoid call stack limits
  const chunkSize = 0x8000; // 32KB chunks
  let binaryString = '';

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binaryString += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binaryString);
}

async function send_invoice_email(env, pdf_content, to_emails, cc_emails, invoice_number) {
  const now = new Date();
  const month = now.toLocaleString('default', { month: 'long' });
  const year = now.getFullYear();

  const email_message = {
    "from": env.FROM_EMAIL,
    "to": to_emails.join(", "),
    "cc": cc_emails.join(", "),
    "bcc": env.FROM_EMAIL,
    "subject": `Invoice for ${month} ${year}`,
    "textbody": `Hi.\n\nAttached to this email is the invoice for ${month} ${year}.\n\nThanks!\n\n--\n\nSantiago`,
    "attachments": [
      {
        "name": `techops-invoice-${invoice_number}.pdf`,
        "content": uint8ArrayToBase64(pdf_content),
        "content_type": "application/pdf",
      }
    ],
  };

  const resp = await fetch("https://app.mailpace.com/api/v1/send", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "MailPace-Server-Token": env.MAILPACE_API_TOKEN,
    },
    body: JSON.stringify(email_message),
  });

  if (resp.status === 200) {
    console.log("Email sent successfully!");
    return true;
  } else {
    console.log(`Failed to send email. Status: ${resp.status}, Body: ${await resp.text()}`);
    return false;
  }
}

async function store_invoice(env, status, invoice_number, pdf_content) {
  try {
    const path = `${status}/techops-invoice-${invoice_number}.pdf`;
    await env.R2_BUCKET.put(path, pdf_content);
    console.log(`Stored **${status}** invoice ${invoice_number} in R2 bucket at ${path}.`);
  } catch (e) {
    console.error(`Failed to store invoice ${invoice_number} in R2 bucket. Error: ${e}`);
  }
}

async function send_error_notification(env, error_message, invoice_number, client_name) {
  const now = new Date();
  const timestamp = now.toISOString();

  const email_message = {
    "from": env.FROM_EMAIL,
    "to": env.FROM_EMAIL,
    "subject": `Invoice Generation Error - Invoice ${invoice_number}`,
    "textbody": `PDF generation failed for invoice ${invoice_number} (${client_name}) at ${timestamp}.\n\nError: ${error_message}\n\nPlease investigate and manually generate the invoice if needed.`,
  };

  try {
    const resp = await fetch("https://app.mailpace.com/api/v1/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "MailPace-Server-Token": env.MAILPACE_API_TOKEN,
      },
      body: JSON.stringify(email_message),
    });

    if (resp.status === 200) {
      console.log(`Error notification sent for invoice ${invoice_number}`);
    } else {
      console.error(`Failed to send error notification for invoice ${invoice_number}`);
    }
  } catch (e) {
    console.error(`Failed to send error notification for invoice ${invoice_number}: ${e}`);
  }
}

async function send_system_error_notification(env, error_message) {
  const now = new Date();
  const timestamp = now.toISOString();

  const email_message = {
    "from": env.FROM_EMAIL,
    "to": env.FROM_EMAIL,
    "subject": `Critical System Error - Invoice Worker`,
    "textbody": `A critical system error occurred in the invoice worker at ${timestamp}.\n\nError: ${error_message}\n\nThe worker has stopped execution to prevent data corruption. Please investigate immediately.`,
  };

  try {
    const resp = await fetch("https://app.mailpace.com/api/v1/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "MailPace-Server-Token": env.MAILPACE_API_TOKEN,
      },
      body: JSON.stringify(email_message),
    });

    if (resp.status === 200) {
      console.log(`System error notification sent`);
    } else {
      console.error(`Failed to send system error notification`);
    }
  } catch (e) {
    console.error(`Failed to send system error notification: ${e}`);
  }
}
