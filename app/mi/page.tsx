import { CustomerPwa } from "./customer-pwa";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function CustomerPage() {
  return <CustomerPwa configured={isSupabaseConfigured()} phoneOtpEnabled={process.env.CUSTOMER_PHONE_OTP_ENABLED === "true"} />;
}
