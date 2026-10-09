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
    sku?: string | null
    hsnCode?: string | null
    hsn?: string | null
    product?: { name?: string | null; sku?: string | null; hsnCode?: string | null; hsn?: string | null } | null
    variant?: { sku?: string | null; name?: string | null; weight?: string | null } | null
  }>
}

// --- Helper: Get Logo Base64 ---
const getBase64ImageFromURL = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Logo load timeout")), 1500)
    const img = new Image()
    img.onload = () => {
      clearTimeout(timer)
      try {
        const canvas = document.createElement("canvas")
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext("2d")
        ctx?.drawImage(img, 0, 0)
        const dataURL = canvas.toDataURL("image/png")
        resolve(dataURL)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = (err) => {
      clearTimeout(timer)
      reject(err)
    }
    img.src = url
  })
}

const rupeeImageCache: Record<string, string> = {}

const getRupeeSymbolDataUrl = (color: string = "#111827", isBold: boolean = false): string => {
  try {
    const cacheKey = `${color}_${isBold ? "b" : "n"}`
    if (rupeeImageCache[cacheKey]) return rupeeImageCache[cacheKey]
    if (typeof document === "undefined") return ""
    const canvas = document.createElement("canvas")
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext("2d")
    if (!ctx) return ""
    ctx.fillStyle = color
    ctx.font = `${isBold ? "bold" : "bold"} 54px "Segoe UI", Roboto, Arial, sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("₹", 32, 32)
    const dataUrl = canvas.toDataURL("image/png")
    rupeeImageCache[cacheKey] = dataUrl
    return dataUrl
  } catch {
    return ""
  }
}

// Format invoice number: ziply5/26-27/001
export const formatInvoiceNumber = (orderId: string, createdAt?: string | Date): string => {
  const date = createdAt ? new Date(createdAt) : new Date()
  const year = date.getFullYear()
  const month = date.getMonth() // 0-indexed (3 = April)
  let startYear = year
  if (month < 3) {
    startYear = year - 1
  }
  const endYear = startYear + 1
  const fy = `${String(startYear).slice(-2)}-${String(endYear).slice(-2)}`
  
  const cleanId = orderId.replace(/[^0-9]/g, "")
  const seq = cleanId ? cleanId.slice(-3).padStart(3, "0") : "001"
  return `ziply5/${fy}/${seq}`
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

// Formats a date in YYYY-MM-DD format
export const formatInvoiceDate = (dateInput: string | Date | number): string => {
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return "—"
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export const formatISTDate = formatInvoiceDate

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

// Core Tax Invoice PDF Generator following reference layout
const generateTaxInvoice = async (order: OrderForInvoice, filenamePrefix: string = "invoice"): Promise<boolean> => {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth() // 210mm
  const margin = 12
  const contentWidth = pageWidth - margin * 2 // 186mm

  try {
    // 1. Header: Logo & Company Information
    let topY = 12

    // Try loading Ziply5 logo
    try {
      const logoData = await getBase64ImageFromURL("/primaryLogo.png")
      doc.addImage(logoData, "PNG", margin, topY, 42, 16)
    } catch {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(22)
      doc.setTextColor(123, 48, 16) // #7B3010
      doc.text("ZIPLY5", margin, topY + 12)
    }

    // Company Information (Top Right / Header)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    doc.setTextColor(30, 30, 30)
    doc.text("Sai Venkata Rama Agro Farms Pvt. Ltd.", pageWidth - margin, topY + 4, { align: "right" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(70, 70, 70)
    doc.text("Sy. 87/1, Thumaloor Road, Maheshwaram, Hyderabad, India - 501389", pageWidth - margin, topY + 9, { align: "right" })
    doc.text("GSTIN: 36ABGCS4924H1Z6   PAN: ABGCS4924H", pageWidth - margin, topY + 13.5, { align: "right" })
    doc.text("CIN: U01120TG2021PTC153389   FSSAI: 13626999000101", pageWidth - margin, topY + 18, { align: "right" })
    doc.text("Ph: +91-9063844105", pageWidth - margin, topY + 22.5, { align: "right" })

    topY += 28

    // 2. Banner Header: "TAX INVOICE"
    doc.setFillColor(243, 244, 246) // Light grey background box
    doc.rect(margin, topY, contentWidth, 8, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(11)
    doc.setTextColor(17, 24, 39)
    doc.text("TAX INVOICE", pageWidth / 2, topY + 5.5, { align: "center" })

    topY += 12

    // 3. Address & Invoice Details Grid Box
    const gridBoxHeight = 36
    doc.setDrawColor(209, 213, 219)
    doc.setLineWidth(0.3)
    doc.rect(margin, topY, contentWidth, gridBoxHeight)

    // Vertical Divider lines
    const col1Width = 62
    const col2Width = 62
    const col1Right = margin + col1Width
    const col2Right = col1Right + col2Width

    doc.line(col1Right, topY, col1Right, topY + gridBoxHeight)
    doc.line(col2Right, topY, col2Right, topY + gridBoxHeight)

    // Column 1: Buyer
    let col1Y = topY + 5
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(17, 24, 39)
    doc.text("Buyer:", margin + 4, col1Y)
    col1Y += 4.5

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(55, 65, 81)
    const buyerName = order.customerName || "Customer"
    doc.text(buyerName, margin + 4, col1Y)
    col1Y += 4

    const buyerAddressLines = doc.splitTextToSize(order.customerAddress || "—", col1Width - 8)
    doc.text(buyerAddressLines.slice(0, 3), margin + 4, col1Y)

    if (order.customerPhone) {
      doc.text(`Ph: ${order.customerPhone}`, margin + 4, topY + gridBoxHeight - 4)
    }

    // Column 2: Delivery Address
    let col2Y = topY + 5
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(17, 24, 39)
    doc.text("Delivery Address:", col1Right + 4, col2Y)
    col2Y += 4.5

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(55, 65, 81)
    doc.text(buyerName, col1Right + 4, col2Y)
    col2Y += 4

    const deliveryAddressLines = doc.splitTextToSize(order.customerAddress || "—", col2Width - 8)
    doc.text(deliveryAddressLines.slice(0, 3), col1Right + 4, col2Y)

    if (order.customerPhone) {
      doc.text(`Ph: ${order.customerPhone}`, col1Right + 4, topY + gridBoxHeight - 4)
    }

    // Column 3: Invoice Info Box
    const col3Y = topY + 5
    const invoiceNo = formatInvoiceNumber(order.id, order.createdAt)
    const invoiceDateStr = formatInvoiceDate(order.createdAt)
    const isCod = (order.paymentMethod || "").toLowerCase().includes("cod") || (order.paymentMethod || "").toLowerCase().includes("cash")
    const paymentMode = isCod ? "COD" : (order.paymentMethod || "Immediate").toUpperCase()
    const paymentTerms = isCod ? "COD" : "NEFT/RTGS/IMPS"

    const labelX = col2Right + 4
    const valueX = pageWidth - margin - 4

    const renderKeyValue = (label: string, value: string, yPos: number) => {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(17, 24, 39)
      doc.text(label, labelX, yPos)

      doc.setFont("helvetica", "normal")
      doc.setTextColor(55, 65, 81)
      doc.text(value, valueX, yPos, { align: "right" })
    }

    renderKeyValue("Invoice No.", invoiceNo, col3Y)
    renderKeyValue("Date", invoiceDateStr, col3Y + 6.5)
    renderKeyValue("Payment Mode", paymentMode, col3Y + 13)
    renderKeyValue("Payment Terms", paymentTerms, col3Y + 19.5)

    topY += gridBoxHeight + 6

    // 4. Products Table (HSN Code)
    const tableData = (order.items && order.items.length > 0 ? order.items : []).map((item, index) => {
      const sno = (index + 1).toString()
      const descName = item.product?.name || "Product"
      const variantInfo = item.variant?.weight || item.variant?.name
      const description = variantInfo ? `${descName} (${variantInfo})` : descName
      const hsn = item.hsnCode || item.hsn || item.product?.hsnCode || item.product?.hsn || "21069099"
      const qty = (item.quantity || 1).toString()
      const rateNum = Number(item.unitPrice ?? item.price ?? 0)
      const lineNum = Number(item.lineTotal ?? item.subtotal ?? rateNum * Number(qty))

      return [sno, description, hsn, qty, rateNum.toFixed(2), lineNum.toFixed(2)]
    })

    autoTable(doc, {
      startY: topY,
      head: [["S.No", "DESCRIPTION", "HSN", "QTY", "RATE", "AMOUNT"]],
      body: tableData,
      headStyles: {
        fillColor: [249, 250, 251],
        textColor: [17, 24, 39],
        fontSize: 8.5,
        fontStyle: "bold",
        lineColor: [209, 213, 219],
        lineWidth: 0.2,
      },
      styles: {
        fontSize: 8.5,
        cellPadding: 3,
        textColor: [55, 65, 81],
        lineColor: [209, 213, 219],
        lineWidth: 0.2,
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 14 },
        1: { halign: "left", cellWidth: "auto" },
        2: { halign: "center", cellWidth: 32 },
        3: { halign: "center", cellWidth: 16 },
        4: { halign: "right", cellWidth: 28 },
        5: { halign: "right", cellWidth: 28 },
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin: { left: margin, right: margin },
    })

    // 5. Calculations & Summary
    const tableFinalY = (doc as any).lastAutoTable.finalY + 4

    const subtotalVal = Number(order.subtotal ?? order.total ?? 0)
    const shippingVal = Number(order.shipping ?? 0)
    const totalVal = Number(order.total ?? subtotalVal + shippingVal)

    // Calculate tax breakdown (SGST 2.5% + CGST 2.5% = 5% GST inclusive standard)
    let taxVal = Number(order.tax ?? 0)
    if (taxVal <= 0 && subtotalVal > 0) {
      taxVal = Number((subtotalVal - subtotalVal / 1.05).toFixed(2))
    }
    const taxableVal = Math.max(0, Number((subtotalVal - taxVal).toFixed(2)))
    const sgstVal = Number((taxVal / 2).toFixed(2))
    const cgstVal = Number((taxVal / 2).toFixed(2))

    const summaryLabelX = pageWidth - margin - 80
    const summaryValueX = pageWidth - margin - 2

    let currentSummaryY = tableFinalY

    const renderSummaryLine = (label: string, amount: number, isBold: boolean = false) => {
      doc.setFont("helvetica", isBold ? "bold" : "normal")
      doc.setFontSize(isBold ? 9.5 : 8.5)
      doc.setTextColor(isBold ? 17 : 55, isBold ? 24 : 65, isBold ? 39 : 81)
      doc.text(label, summaryLabelX, currentSummaryY)

      const numStr = amount.toFixed(2)
      doc.text(numStr, summaryValueX, currentSummaryY, { align: "right" })

      const numWidth = doc.getTextWidth(numStr)
      const rupeeImg = getRupeeSymbolDataUrl(isBold ? "#111827" : "#374151", isBold)
      if (rupeeImg && rupeeImg.startsWith("data:image")) {
        const iconSize = isBold ? 3.8 : 3.3
        const rupeeX = summaryValueX - numWidth - iconSize - 0.8
        const rupeeY = currentSummaryY - (isBold ? 3.0 : 2.7)
        try {
          doc.addImage(rupeeImg, "PNG", rupeeX, rupeeY, iconSize, iconSize)
        } catch {
          // ignore addImage fallback
        }
      }
      currentSummaryY += 5
    }

    renderSummaryLine("Sub Total (incl. GST)", subtotalVal)
    renderSummaryLine("Taxable Value", taxableVal)
    renderSummaryLine("SGST @ 2.5%", sgstVal)
    renderSummaryLine("CGST @ 2.5%", cgstVal)
    renderSummaryLine("Shipping / Courier", shippingVal)

    // Line above Total
    doc.setDrawColor(209, 213, 219)
    doc.setLineWidth(0.3)
    doc.line(summaryLabelX, currentSummaryY - 1, pageWidth - margin, currentSummaryY - 1)
    currentSummaryY += 2

    // Total Invoice Value Box
    doc.setFillColor(249, 250, 251)
    doc.rect(summaryLabelX - 2, currentSummaryY - 4, 84, 7, "F")
    renderSummaryLine("Total Invoice Value", totalVal, true)

    // Amount Chargeable in words
    const amountInWords = convertNumberToWords(totalVal, order.currency)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(17, 24, 39)
    doc.text("Amount Chargeable (in words):", margin, tableFinalY)

    doc.setFont("helvetica", "normal")
    doc.setTextColor(55, 65, 81)
    const maxWordsWidth = Math.max(40, summaryLabelX - (margin + 48) - 4)
    const wordsLines = doc.splitTextToSize(amountInWords, maxWordsWidth)
    doc.text(wordsLines, margin + 48, tableFinalY)

    topY = Math.max(currentSummaryY + 6, tableFinalY + wordsLines.length * 4.5 + 4)

    // 6. Bank Details & Payment Section Box
    const bankBoxHeight = 36
    doc.setDrawColor(209, 213, 219)
    doc.setLineWidth(0.3)
    doc.rect(margin, topY, contentWidth, bankBoxHeight)

    const bankColWidth = 110
    const bankColRight = margin + bankColWidth
    doc.line(bankColRight, topY, bankColRight, topY + bankBoxHeight)

    // Bank Details (Left)
    let bY = topY + 5
    doc.setFont("helvetica", "bold")
    doc.setFontSize(9)
    doc.setTextColor(17, 24, 39)
    doc.text("Bank Details", margin + 4, bY)
    bY += 4.5

    const renderBankRow = (lbl: string, val: string) => {
      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(70, 70, 70)
      doc.text(lbl, margin + 4, bY)
      doc.setTextColor(30, 30, 30)
      doc.text(val, margin + 28, bY)
      bY += 4
    }

    renderBankRow("A/c Name:", "Sai Venkata Rama Agro Farms Pvt. Ltd.")
    renderBankRow("Bank:", "HDFC Bank")
    renderBankRow("Branch:", "Hyderguda")
    renderBankRow("A/c No.:", "50200060220792")
    renderBankRow("IFSC:", "HDFC0001996")

    // Payment Info / UPI QR Code Box (Right)
    const pX = bankColRight + 4
    let pY = topY + 6

    if (isCod) {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(9)
      doc.setTextColor(180, 83, 9) // Amber
      doc.text("Payment Mode: Cash on Delivery (COD)", pX, pY)
      pY += 5.5

      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(220, 38, 38) // Red
      doc.text("Status: Payment Pending", pX, pY)
      pY += 5.5

      doc.setFont("helvetica", "bold")
      doc.setFontSize(9)
      doc.setTextColor(17, 24, 39)
      doc.text("Payable Amount:", pX, pY)
      const lblW = doc.getTextWidth("Payable Amount:")
      const rImg = getRupeeSymbolDataUrl("#111827", true)
      let valX = pX + lblW + 1.5
      if (rImg && rImg.startsWith("data:image")) {
        try {
          doc.addImage(rImg, "PNG", valX, pY - 3.1, 3.8, 3.8)
          valX += 4.5
        } catch {
          // ignore
        }
      }
      doc.text(totalVal.toFixed(2), valX, pY)
      pY += 5.5

      doc.setFont("helvetica", "normal")
      doc.setFontSize(7.5)
      doc.setTextColor(100, 100, 100)
      doc.text("Please pay exact order total to courier agent upon delivery.", pX, pY)
    } else {
      doc.setFont("helvetica", "bold")
      doc.setFontSize(8.5)
      doc.setTextColor(17, 24, 39)
      doc.text("Scan to Pay (UPI)", pX, pY)
      pY += 4.5

      doc.setFont("helvetica", "normal")
      doc.setFontSize(8)
      doc.setTextColor(70, 70, 70)
      doc.text("UPI ID: 9908888296@hdfc", pX, pY)
      pY += 4.5

      doc.text(`Payment Mode: ${paymentMode}`, pX, pY)
      pY += 4.5

      if (order.paymentId || order.transactions?.[0]?.id) {
        const txId = order.paymentId || order.transactions?.[0]?.id || ""
        doc.text(`Txn ID: ${txId.slice(0, 24)}`, pX, pY)
      }
    }

    topY += bankBoxHeight + 8

    // 7. Declaration & Authorised Signatory
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(70, 70, 70)
    const declText = "We Declare that this Invoice shows the actual price of goods described and that all particulars are true & correct."
    const declLines = doc.splitTextToSize(declText, 105)
    doc.text(declLines, margin, topY)

    // Authorised Signatory (Right)
    const sigX = pageWidth - margin
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(17, 24, 39)
    doc.text("For Sai Venkata Rama Agro Farms Pvt. Ltd.", sigX, topY, { align: "right" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8.5)
    doc.text("Authorised Signatory", sigX, topY + 16, { align: "right" })

    // 8. Bottom Center Footer
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFont("helvetica", "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(120, 120, 120)
    doc.text("This is a computer-generated invoice.", pageWidth / 2, pageHeight - 8, { align: "center" })

    doc.save(`${filenamePrefix}-${invoiceNo.replace(/\//g, "-")}.pdf`)
    return true
  } catch (error) {
    console.error("PDF generation error", error)
    return false
  }
}

export const generateUserInvoicePDF = async (order: OrderForInvoice) => {
  return generateTaxInvoice(order, "invoice")
}

export const generateAdminInvoicePDF = async (order: OrderForInvoice) => {
  return generateTaxInvoice(order, "admin-invoice")
}

export const generateInvoicePDF = generateUserInvoicePDF
