export type TicketDeliveryEventInput = {
  saleId: string;
  channel: "NATIVE_SHARE" | "DOWNLOAD";
  status: "SHARED" | "DOWNLOADED" | "CANCELLED" | "FAILED";
  receiptKind: "SALE" | "GIFT";
};
