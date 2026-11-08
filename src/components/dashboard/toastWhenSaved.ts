import { toast } from "@/components/ui";
import { savedForSure } from "@/store/account";

/**
 * Says it worked only once it has: in account mode that waits for the server. A save that fails
 * is reported by the account banner instead, which keeps retrying.
 */
export function toastWhenSaved(message: string) {
  void savedForSure().then((saved) => {
    if (saved) toast(message);
  });
}
