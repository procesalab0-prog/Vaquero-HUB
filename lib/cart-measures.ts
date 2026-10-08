import type { CartLine,ProductVariant } from "./domain";
import {measureLineCents,measureQuantityStep,parseMeasureQuantity,quantityUnit} from "./measure-units";

export function cartLineCents(line:Pick<CartLine,'variant'|'quantity'>) {
 const result=measureLineCents(Math.round(line.variant.price*100),line.quantity,quantityUnit(line.variant));
 if(result===null) throw new Error('INVALID_MEASURE_QUANTITY');
 return result;
}
export function changeCartQuantity(variant:ProductVariant,quantity:number,delta:number) {
 const next=Math.min(Math.round(quantity*1000)+Math.round(delta*1000),Math.round(variant.stock*1000))/1000;
 return next>0 && parseMeasureQuantity(String(next),quantityUnit(variant))!==null ? next:0;
}
/** Scanning one measured unit normally adds one; below one, show the remaining
 * measurable stock in the cart where it can be reviewed/edited before checkout. */
export function initialCartQuantity(variant:ProductVariant) {
 const value=Math.min(1,variant.stock);
 return parseMeasureQuantity(String(value),quantityUnit(variant))===null ? 0:value;
}
export function cartQuantityStep(variant:ProductVariant) {return measureQuantityStep(quantityUnit(variant));}
