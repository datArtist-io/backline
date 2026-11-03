"use client";
// One small pill in the top bar: the currency every price on the page is shown in.
import { CURRENCIES, useDisplayCurrency } from "@/lib/currency";

export default function CurrencySwitch() {
  const [c, set] = useDisplayCurrency();
  return (
    <label className="eq-cur" title="Show prices in">
      <span className="sr-only">Show prices in</span>
      <select value={c} onChange={(e) => set(e.target.value)}>
        {[...new Set([c, ...CURRENCIES])].map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="eq-cur-caret">▾</span>
    </label>
  );
}
