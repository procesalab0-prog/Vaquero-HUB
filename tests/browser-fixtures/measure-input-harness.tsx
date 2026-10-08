import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { MeasureQuantityInput } from "../../components/measure-quantity-input";

function Harness() {
  const [quantity, setQuantity] = useState(1);
  const [valid, setValid] = useState(true);
  return createElement(
    "main",
    null,
    createElement(MeasureQuantityInput, {
      value: quantity,
      unit: { code: "KILO", name: "Kilo", decimal_places: 3 },
      maximum: 2,
      label: "Kilos",
      onValue: setQuantity,
      onValidity: setValid,
    }),
    createElement("button", { disabled: !valid }, "Cobrar"),
    createElement("output", null, String(quantity)),
  );
}
createRoot(document.getElementById("root")!).render(createElement(Harness));
