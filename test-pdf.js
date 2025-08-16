#!/usr/bin/env node

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import config from './src/config.json' with { type: 'json' };

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

async function generateTestPDFs() {
  const outputDir = './test-output';

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Generating test PDFs...');

  for (let i = 0; i < config.clients.length; i++) {
    const client = config.clients[i];
    const invoice_number = 1000 + i; // Test invoice numbers

    try {
      const pdfBytes = await create_invoice_pdf(
        invoice_number,
        client.name,
        client.details,
        client.payment_details,
        client.services || []
      );

      const filename = `test-invoice-${invoice_number}-${client.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, pdfBytes);
      console.log(`✓ Generated: ${filepath}`);
    } catch (error) {
      console.error(`✗ Failed to generate PDF for ${client.name}:`, error);
    }
  }

  console.log(`\nTest PDFs saved to: ${path.resolve(outputDir)}`);
}

// Run the test
generateTestPDFs().catch(console.error);
