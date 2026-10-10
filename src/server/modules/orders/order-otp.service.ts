import { otpService } from "../otp/otp.service"
import { smsService } from "../sms/sms.service"
import { formatOrderNumber } from "@/src/lib/orders/order-number"

export const orderOtpService = {
  async requestTransactionOtp(mobile: string, amount: number) {
    const code = await otpService.generate(mobile, "TRANSACTION")
    
    await smsService.send({
      mobile,
      templateKey: "PAYMENT_CONFIRM",
      variables: [code, amount.toString()],
      body: `${code} is your OTP to confirm the transaction amount of Rs.${amount}. Valid for 5 minutes. If not requested, please ignore. - Ziply5`
    })

    return { success: true }
  },

  async verifyTransaction(mobile: string, code: string) {
    return await otpService.verify(mobile, "TRANSACTION", code)
  },

  async sendOrderConfirmationSms(mobile: string, orderId: string, amount: number) {
    await smsService.send({
      mobile,
      templateKey: "ORDER_PAID",
      variables: [amount.toString(), formatOrderNumber(orderId)],
      body: `Thank you for payment of Rs.${amount} against OrderId - ${formatOrderNumber(orderId)} - Team Ziply5`
    }).catch(e => console.error("Order confirmation SMS failed", e))
  }
}
