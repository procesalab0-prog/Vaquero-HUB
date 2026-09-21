import { CustomerPwa } from "./customer-pwa";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function CustomerPage() {
  const privacyNoticeVersion =
    process.env.CUSTOMER_PRIVACY_NOTICE_VERSION?.trim() ?? "";
  const privacyNoticeUrl =
    process.env.CUSTOMER_PRIVACY_NOTICE_URL?.trim() ?? "";

  return (
    <CustomerPwa
      configured={isSupabaseConfigured()}
      phoneOtpEnabled={process.env.CUSTOMER_PHONE_OTP_ENABLED === "true"}
      privacyNoticeVersion={privacyNoticeVersion}
      privacyNoticeUrl={privacyNoticeUrl}
    />
  );
}
