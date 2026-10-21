import { isDeepStrictEqual } from "node:util";
import { TEST_ORIGIN } from "./client.mjs";
export function validateAvailability(receipt, packet, expected) {
  if (
    !receipt ||
    receipt.protocol !== packet.protocol ||
    receipt.origin !== TEST_ORIGIN ||
    receipt.trial_id !== packet.trial_id ||
    receipt.synthetic !== true ||
    receipt.restored !== true ||
    receipt.barcode !== expected.barcode ||
    receipt.woo_product_id !== expected.woo_product_id ||
    receipt.woo_variation_id !== expected.woo_variation_id ||
    !isDeepStrictEqual(receipt.quantities, packet.quantities) ||
    !receipt.before?.variation ||
    !receipt.before?.parent ||
    receipt.before.variation.manage_stock !== false ||
    receipt.before.variation.quantity !== null ||
    !isDeepStrictEqual(receipt.before, receipt.after)
  )
    throw Error("AVAILABILITY_RECEIPT_CHANGED");
  return receipt;
}
export async function processAvailability({ id, actorId, client, rpc }) {
  await client.availabilityPreflight();
  const input = { id, actor_id: actorId };
  const claim = await rpc("INIT", input);
  if (claim.state === "VERIFIED")
    return validateAvailability(claim.receipt, claim.packet, claim.expected);
  let receipt = await client.readAvailability(id);
  if (!receipt && claim.dispatch === true) {
    try {
      receipt = await client.applyAvailability(claim.packet);
    } catch {
      receipt = await client.readAvailability(id);
    }
  }
  validateAvailability(receipt, claim.packet, claim.expected);
  const observed = validateAvailability(
    await client.readAvailability(id),
    claim.packet,
    claim.expected,
  );
  if (!isDeepStrictEqual(receipt, observed))
    throw Error("AVAILABILITY_OBSERVATION_CHANGED");
  await rpc("FINISH", { ...input, receipt: observed });
  return observed;
}
