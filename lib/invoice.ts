import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

  export type OrderForInvoice = {
  id: string
  status: string
  currency: string
  subtotal?: string | number
  tax?: string | number
  discount?: string | number
  shipping?: string | number
  total: string | number
  createdAt: string
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  customerAddress?: string | null
  paymentId?: string | null
  paymentMethod?: string | null
  paymentStatus?: string | null
  transactions?: Array<{ id: string; gateway?: string; amount?: string | number; status?: string; createdAt?: string }>
  user?: { email?: string | null } | null
  items?: Array<{
    id?: string
    quantity: number
    unitPrice?: string | number
    lineTotal?: string | number
    price?: string | number
    subtotal?: string | number
    product?: { name?: string | null } | null
  }>
}

// --- Helper: Get Logo ---
const getBase64ImageFromURL = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.setAttribute("crossOrigin", "anonymous")
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext("2d")
      ctx?.drawImage(img, 0, 0)
      const dataURL = canvas.toDataURL("image/png")
      resolve(dataURL)
    }
    img.onerror = (error) => reject(error)
    img.src = url
  })
}

// Converts numbers into English words (supports Indian Rupee & standard currency nomenclature)
export const convertNumberToWords = (amount: number, currency: string = "INR"): string => {
  if (isNaN(amount) || amount === 0) return "Zero Rupees Only"

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ]
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

  const numToWordsLessThanThousand = (num: number): string => {
    let str = ""
    if (num >= 100) {
      str += ones[Math.floor(num / 100)] + " Hundred "
      num %= 100
    }
    if (num > 0) {
      if (num < 20) {
        str += ones[num] + " "
      } else {
        str += tens[Math.floor(num / 10)] + " "
        if (num % 10 > 0) {
          str += ones[num % 10] + " "
        }
      }
    }
    return str.trim()
  }

  const integerPart = Math.floor(Math.abs(amount))
  const decimalPart = Math.round((Math.abs(amount) - integerPart) * 100)

  let words = ""
  let num = integerPart

  const crore = Math.floor(num / 10000000)
  num %= 10000000
  const lakh = Math.floor(num / 100000)
  num %= 100000
  const thousand = Math.floor(num / 1000)
  num %= 1000
  const hundred = num

  if (crore > 0) words += numToWordsLessThanThousand(crore) + " Crore "
  if (lakh > 0) words += numToWordsLessThanThousand(lakh) + " Lakh "
  if (thousand > 0) words += numToWordsLessThanThousand(thousand) + " Thousand "
  if (hundred > 0) words += numToWordsLessThanThousand(hundred) + " "

  words = words.trim() || "Zero"

  const isINR = !currency || currency.toUpperCase() === "INR"
  const majorUnit = isINR ? "Rupees" : currency.toUpperCase()
  const minorUnit = isINR ? "Paise" : "Cents"

  let result = `${words} ${majorUnit}`
  if (decimalPart > 0) {
    result += ` and ${numToWordsLessThanThousand(decimalPart)} ${minorUnit}`
  }
  return `${result} Only`
}

// Formats a date in Indian Standard Time (IST)
export const formatISTDate = (dateInput: string | Date | number): string => {
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })
}

// Formats a date and time in Indian Standard Time (IST)
export const formatISTDateTime = (dateInput: string | Date | number): string => {
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }) + " IST"
}

// User-facing invoice PDF generator (exact original format)
export const generateUserInvoicePDF = async (order: OrderForInvoice) => {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()

  try {
    // --- Add Logo ---
    try {
      const logoData = await getBase64ImageFromURL("/primaryLogo.png")
      doc.addImage(logoData, "PNG", 15, 10, 40, 15)
    } catch (err) {
      console.warn("Could not load logo", err)
      doc.setFontSize(22)
      doc.setTextColor(74, 29, 31) // #4A1D1F
      doc.text("ZIPLY5", 15, 20)
    }

    // --- Header Info ---
    doc.setFontSize(24)
    doc.setTextColor(74, 29, 31)
    doc.text("INVOICE", pageWidth - 15, 20, { align: "right" })

    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    const createdOn = formatISTDate(order.createdAt)
    doc.text(`Order ID: ${order.id}`, pageWidth - 15, 28, { align: "right" })
    doc.text(`Date: ${createdOn}`, pageWidth - 15, 33, { align: "right" })
    doc.text(`Status: ${order.status.toUpperCase()}`, pageWidth - 15, 38, { align: "right" })

    // --- Divider ---
    doc.setDrawColor(232, 220, 200) // #E8DCC8
    doc.line(15, 45, pageWidth - 15, 45)

    // --- Customer Details ---
    doc.setFontSize(12)
    doc.setTextColor(74, 29, 31)
    doc.text("BILL TO:", 15, 55)

    doc.setFontSize(10)
    doc.setTextColor(42, 24, 16) // #2A1810
    doc.text(order.customerName ?? "-", 15, 62)
    doc.text(order.customerPhone ?? "-", 15, 67)
    doc.text(order.customerEmail ?? order.user?.email ?? "-", 15, 72)

    const addressLines = doc.splitTextToSize(order.customerAddress ?? "-", 80)
    doc.text(addressLines, 15, 77)

    // --- Items Table ---
    // Dynamically calculate table start based on address height
    const addressHeight = addressLines.length * 5
    const tableStartY = Math.max(95, 77 + addressHeight + 10)

    const tableData = (order.items ?? []).map((item) => [
      item.product?.name ?? "Product",
      item.quantity.toString(),
      `${order.currency} ${Number(item.unitPrice ?? item.price ?? 0).toFixed(2)}`,
      `${order.currency} ${Number(item.lineTotal ?? item.subtotal ?? Number(item.unitPrice ?? item.price ?? 0) * Number(item.quantity ?? 0)).toFixed(2)}`
    ])

    autoTable(doc, {
      startY: tableStartY,
      head: [["Product Details", "Qty", "Unit Price", "Subtotal"]],
      body: tableData,
      headStyles: {
        fillColor: [123, 48, 16],
        textColor: [255, 255, 255],
        fontSize: 10,
        fontStyle: "bold",
      },
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { halign: "left", cellWidth: 25 },
        2: { halign: "left", cellWidth: 35 },
        3: { halign: "left", cellWidth: 35 },
      },
      alternateRowStyles: { fillColor: [253, 240, 230] }, // #FDF0E6
      margin: { left: 15, right: 15 },
    })

    // --- Summary ---
    const finalY = (doc as any).lastAutoTable.finalY + 10
    const summaryX = pageWidth - 65 // Adjusted for better label alignment
    const valueX = pageWidth - 15 - 4 // Match table's internal padding (cellPadding: 4)

    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text("Subtotal:", summaryX, finalY)
    doc.text("Tax:", summaryX, finalY + 7)
    doc.text("Discount:", summaryX, finalY + 14)
    doc.text("Shipping:", summaryX, finalY + 21)

    // --- Line above Total ---
    doc.setDrawColor(232, 220, 200) // #E8DCC8
    doc.setLineWidth(0.5)
    doc.line(summaryX, finalY + 25, pageWidth - 15, finalY + 25)

    doc.setFontSize(11)
    doc.setTextColor(74, 29, 31)
    doc.text("Total:", summaryX, finalY + 31)

    doc.setFontSize(10)
    doc.setTextColor(42, 24, 16)
    doc.text(`${order.currency} ${Number(order.subtotal ?? 0).toFixed(2)}`, valueX, finalY, { align: "right" })
    doc.text(`${order.currency} ${Number(order.tax ?? 0).toFixed(2)}`, valueX, finalY + 7, { align: "right" })
    doc.text(`- ${order.currency} ${Number(order.discount ?? 0).toFixed(2)}`, valueX, finalY + 14, { align: "right" })
    doc.text(`${order.currency} ${Number(order.shipping ?? 0).toFixed(2)}`, valueX, finalY + 21, { align: "right" })

    doc.setFontSize(11)
    doc.setTextColor(123, 48, 16)
    doc.setFont("helvetica", "bold")
    doc.text(`${order.currency} ${Number(order.total).toFixed(2)}`, valueX, finalY + 31, { align: "right" })

    // --- Footer ---
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(150, 150, 150)
    doc.text("Thank you for shopping with Ziply5!", pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: "center" })

    doc.save(`invoice-${order.id}.pdf`)
    return true
  } catch (error) {
    console.error("PDF generation error", error)
    return false
  }
}

// Generates admin invoice in simple black and white format matching the operational wireframe.
export const generateAdminInvoicePDF = async (order: OrderForInvoice) => {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()

  const getBase64ImageFromURL = (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.setAttribute("crossOrigin", "anonymous")
      img.onload = () => {
        const canvas = document.createElement("canvas")
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext("2d")
        ctx?.drawImage(img, 0, 0)
        resolve(canvas.toDataURL("image/png"))
      }
      img.onerror = (error) => reject(error)
      img.src = url
    })
  }

  try {
    // Top Left: Brand Logo in original colors
    try {
      const logoData = await getBase64ImageFromURL("/primaryLogo.png")
      doc.addImage(logoData, "PNG", 15, 12, 38, 14)
    } catch {
      doc.setFontSize(20)
      doc.setTextColor(74, 29, 31)
      doc.text("ZIPLY5", 15, 22)
    }

    // Top Right: INVOICE and Invoice date
    doc.setFont("helvetica", "bold")
    doc.setFontSize(20)
    doc.setTextColor(0, 0, 0)
    doc.text("INVOICE", pageWidth - 15, 20, { align: "right" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9.5)
    doc.setTextColor(60, 60, 60)
    const invoiceDate = formatISTDate(new Date())
    doc.text(`Invoice date: ${invoiceDate}`, pageWidth - 15, 27, { align: "right" })

    // Divider under header
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.3)
    doc.line(15, 33, pageWidth - 15, 33)

    // Row 1: Customer Details (Left) vs Billing Address (Right)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    doc.text("Customer Details", 15, 41)
    doc.text("Billing Address", pageWidth - 15, 41, { align: "right" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(40, 40, 40)
    doc.text(`Name: ${order.customerName ?? "-"}`, 15, 47)
    doc.text(`Contact: ${order.customerPhone ?? "-"}`, 15, 52)
    doc.text(`Email: ${order.customerEmail ?? order.user?.email ?? "-"}`, 15, 57)

    const billingLines = doc.splitTextToSize(order.customerAddress ?? "-", 85)
    doc.text(billingLines, pageWidth - 15, 47, { align: "right" })

    // Row 2: Order Information (Left) vs Shipping Address (Right)
    const row2Y = Math.max(65, 47 + billingLines.length * 4.5 + 4)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    doc.text("Order Information", 15, row2Y)
    doc.text("Shipping Address", pageWidth - 15, row2Y, { align: "right" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(40, 40, 40)
    const orderDate = formatISTDateTime(order.createdAt)
    doc.text(`Order ID: ${order.id}`, 15, row2Y + 6)
    doc.text(`Order Date: ${orderDate}`, 15, row2Y + 11)
    doc.text(`Order Status: ${order.status.toUpperCase()}`, 15, row2Y + 16)

    const shippingLines = doc.splitTextToSize(order.customerAddress ?? "-", 85)
    doc.text(shippingLines, pageWidth - 15, row2Y + 6, { align: "right" })

    // Middle Section: Product details heading and black & white table
    const tableStartY = Math.max(row2Y + 26, row2Y + 6 + shippingLines.length * 4.5 + 8)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(10.5)
    doc.setTextColor(0, 0, 0)
    doc.text("Product details", 15, tableStartY - 3)

    const tableData = (order.items ?? []).map((item) => {
      const unit = Number(item.unitPrice ?? item.price ?? 0)
      const qty = Number(item.quantity ?? 1)
      const line = Number(item.lineTotal ?? item.subtotal ?? unit * qty)
      return [
        item.product?.name ?? "Product",
        qty.toString(),
        `${order.currency || "INR"} ${unit.toFixed(2)}`,
        `${order.currency || "INR"} ${line.toFixed(2)}`,
      ]
    })

    autoTable(doc, {
      startY: tableStartY,
      head: [["Product Details", "Qty", "Unit Price", "Subtotal"]],
      body: tableData,
      headStyles: {
        fillColor: [245, 245, 245],
        textColor: [0, 0, 0],
        fontSize: 9,
        fontStyle: "bold",
        lineColor: [0, 0, 0],
        lineWidth: 0.2 ,
      },
      styles: {
        fontSize: 8.5,
        cellPadding: 3.5,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
      },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { halign: "left", cellWidth: 25 },
        2: { halign: "left", cellWidth: 35 },
        3: { halign: "left", cellWidth: 35 },
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin: { left: 15, right: 15 },
    })

    // Financial summary under the table (pure black & white)
    const finalY = (doc as any).lastAutoTable.finalY + 8
    const summaryX = pageWidth - 65
    const valueX = pageWidth - 15 - 4

    // Amount in Words (left side)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(0, 0, 0)
    doc.text("Amount in Words:", 15, finalY)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(40, 40, 40)
    const amountInWords = convertNumberToWords(Number(order.total), order.currency)
    const wordsLines = doc.splitTextToSize(amountInWords, summaryX - 25)
    doc.text(wordsLines, 15, finalY + 5)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(80, 80, 80)
    doc.text("Subtotal:", summaryX, finalY)
    doc.text("Tax:", summaryX, finalY + 5.5)
    doc.text("Discount:", summaryX, finalY + 11)
    doc.text("Shipping:", summaryX, finalY + 16.5)

    doc.setDrawColor(0, 0, 0)
    doc.setLineWidth(0.3)
    doc.line(summaryX, finalY + 20.5, pageWidth - 15, finalY + 20.5)

    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(0, 0, 0)
    doc.text("Total:", summaryX, finalY + 26)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(0, 0, 0)
    doc.text(`${order.currency || "INR"} ${Number(order.subtotal ?? 0).toFixed(2)}`, valueX, finalY, { align: "right" })
    doc.text(`${order.currency || "INR"} ${Number(order.tax ?? 0).toFixed(2)}`, valueX, finalY + 5.5, { align: "right" })
    doc.text(`- ${order.currency || "INR"} ${Number(order.discount ?? 0).toFixed(2)}`, valueX, finalY + 11, { align: "right" })
    doc.text(`${order.currency || "INR"} ${Number(order.shipping ?? 0).toFixed(2)}`, valueX, finalY + 16.5, { align: "right" })

    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.text(`${order.currency || "INR"} ${Number(order.total).toFixed(2)}`, valueX, finalY + 26, { align: "right" })

    // Payment Table below Total Amount
    const primaryTx = order.transactions?.[0]
    const paymentIdText = order.paymentId || primaryTx?.id || "—"
    const paymentDateText = primaryTx?.createdAt
      ? formatISTDateTime(primaryTx.createdAt)
      : formatISTDateTime(order.createdAt)
    const paymentModeText = (order.paymentMethod || primaryTx?.gateway || "—").toUpperCase()
    const paymentStatusText = (order.paymentStatus || primaryTx?.status || "PENDING").toUpperCase()

    const paymentTableStartY = finalY + 34

    autoTable(doc, {
      startY: paymentTableStartY,
      head: [["Payment ID", "Date and Time", "Mode of Payment", "Payment Status"]],
      body: [[paymentIdText, paymentDateText, paymentModeText, paymentStatusText]],
      headStyles: {
        fillColor: [245, 245, 245],
        textColor: [0, 0, 0],
        fontSize: 8.5,
        fontStyle: "bold",
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
      },
      styles: {
        fontSize: 8,
        cellPadding: 3,
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.2,
      },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 45 },
        2: { cellWidth: 40 },
        3: { cellWidth: 40 },
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin: { left: 15, right: 15 },
    })

    // Footer: Copyright text & Terms and Conditions hyperlink
    const pageHeight = doc.internal.pageSize.getHeight()
    const totalPages = (doc.internal as any).getNumberOfPages ? (doc.internal as any).getNumberOfPages() : 1

    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)

      // Footer subtle divider line
      doc.setDrawColor(220, 220, 220)
      doc.setLineWidth(0.2)
      doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15)

      // Copyright notice (Left aligned)
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(110, 110, 110)
      doc.text(
        `© ${new Date().getFullYear()} Sai Venkata Rama Agro Farms Pvt Ltd All Rights Reserved.`,
        15,
        pageHeight - 10,
      );

      // Terms & Conditions Hyperlink (Right aligned)
      const termsText = "Terms & Conditions"
      const termsUrl = typeof window !== "undefined" && window.location?.origin
        ? `${window.location.origin}/terms`
        : "https://ziply5.com/terms"

      doc.setFontSize(8)
      doc.setTextColor(30, 30, 30)
      const termsWidth = doc.getTextWidth(termsText)
      const termsX = pageWidth - 15 - termsWidth
      doc.textWithLink(termsText, termsX, pageHeight - 10, { url: termsUrl })
      doc.setDrawColor(100, 100, 100)
      doc.setLineWidth(0.2)
      doc.line(termsX, pageHeight - 9.3, termsX + termsWidth, pageHeight - 9.3)
      if (typeof doc.link === "function") {
        doc.link(termsX, pageHeight - 13, termsWidth, 5, { url: termsUrl })
      }
    }

    doc.save(`admin-invoice-${order.id}.pdf`)
    return true
  } catch (error) {
    console.error("Admin PDF generation error", error)
    return false
  }
}

// Backward compatibility alias for customer invoice
export const generateInvoicePDF = generateUserInvoicePDF
