import { defineMessages } from "../../types";

/** Strings for the "WhatsApp" integration. Keep both locales in lockstep. */
export const whatsapp = defineMessages({
  en: {
    title: "WhatsApp",
    supplierName: "Supplier name",
    supplierPhone: "Supplier mobile",
    supplierNameHint: "Used in the prefilled order message.",
    supplierPhoneHint: "Enter a Saudi mobile number, such as 05XXXXXXXX.",
    invalidSaudiMobile: "Enter a valid Saudi mobile number.",
    messageWorker: "Message the worker",
    orderSupplier: "Order from supplier",
    supplierOrderIntro: (supplier: string, farm: string) =>
      "Hello" + (supplier ? " " + supplier : "") + ", please arrange the following for " + farm + ":",
    supplierOrderLine: (item: string, quantity: string, level: string) =>
      item + ": " + quantity + " (" + level + ")",
    quantityNotRecorded: "quantity not recorded",
    workerMessage: (worker: string) => "Hello " + worker + ", please call me when you have a moment.",
  },
  ar: {
    title: "واتساب",
    supplierName: "اسم المورّد",
    supplierPhone: "جوال المورّد",
    supplierNameHint: "يظهر في رسالة الطلب الجاهزة.",
    supplierPhoneHint: "أدخل رقم جوال سعودي، مثل 05XXXXXXXX.",
    invalidSaudiMobile: "أدخل رقم جوال سعودي صحيح.",
    messageWorker: "راسل العامل",
    orderSupplier: "اطلب من المورّد",
    supplierOrderIntro: (supplier: string, farm: string) =>
      "السلام عليكم" + (supplier ? " يا " + supplier : "") + "، نحتاج للمزرعة " + farm + ":",
    supplierOrderLine: (item: string, quantity: string, level: string) =>
      item + ": " + quantity + " (" + level + ")",
    quantityNotRecorded: "الكمية غير محددة",
    workerMessage: (worker: string) => "هلا " + worker + "، كلّمني إذا فضيت.",
  },
});
