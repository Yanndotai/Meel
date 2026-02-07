import "@/index.css";

import { useState, useEffect, useRef } from "react";
import { mountWidget } from "skybridge/web";
import { useToolInfo, useSendFollowUpMessage, useCallTool } from "../helpers";
import {
  MealPlanCard,
  IngredientsCard,
  ActionCard,
  FillCartProgress,
  type DayMeals,
  type Ingredient,
  type FillCartProduct,
  type FillCartResult,
} from "../components/cards";

interface ShowPlanOutput {
  meal_plan: Record<string, DayMeals>;
  ingredients: Ingredient[];
  message: string;
}

const SIMULATED_STEP_MS = 2000;

function ShowPlan() {
  const { output, isSuccess } = useToolInfo<"show-plan">();
  const sendFollowUp = useSendFollowUpMessage();
  const { callToolAsync } = useCallTool("fill-cart");

  const [fillCartStatus, setFillCartStatus] = useState<
    "idle" | "shopping" | "done"
  >("idle");
  const [fillCartProducts, setFillCartProducts] = useState<FillCartProduct[]>([]);
  const [simulatedCompleted, setSimulatedCompleted] = useState(0);
  const [fillCartResult, setFillCartResult] = useState<FillCartResult | null>(
    null,
  );
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  if (!isSuccess || !output) return null;

  const data = output as ShowPlanOutput;

  const handleLooksPerfect = async () => {
    // #region agent log
    fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "show-plan.tsx:handleLooksPerfect:entry",
        message: "handleLooksPerfect called",
        data: { ingredientsCount: data.ingredients?.length ?? 0 },
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
    // #endregion
    const products: FillCartProduct[] = data.ingredients.map((i) => ({
      name: i.name,
      quantity: `${i.quantity} ${i.unit}`,
    }));

    setFillCartProducts(products);
    setFillCartStatus("shopping");
    setSimulatedCompleted(0);

    progressIntervalRef.current = setInterval(() => {
      setSimulatedCompleted((n) => Math.min(n + 1, products.length));
    }, SIMULATED_STEP_MS);

    // #region agent log
    fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "show-plan.tsx:before callToolAsync",
        message: "calling fill-cart",
        data: { productsCount: products.length },
        timestamp: Date.now(),
        hypothesisId: "H2",
      }),
    }).catch(() => {});
    // #endregion
    try {
      const result = await callToolAsync({ products });

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setSimulatedCompleted(products.length);
      // #region agent log
      fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "show-plan.tsx:callToolAsync resolved",
          message: "fill-cart call succeeded",
          data: { hasResult: !!result },
          timestamp: Date.now(),
          hypothesisId: "H3",
        }),
      }).catch(() => {});
      // #endregion
      const resultPayload = result as {
        content?: Array<{ type?: string; text?: string }>;
        structuredContent?: FillCartResult;
        text?: string;
      };
      const resultText =
        resultPayload?.content?.[0]?.text ??
        resultPayload?.text ??
        "Cart updated.";

      setFillCartResult(resultPayload?.structuredContent ?? null);
      setFillCartStatus("done");
      sendFollowUp(resultText);
      return true;
    } catch (err) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setFillCartStatus("idle");
      setFillCartProducts([]);
      setFillCartResult(null);
      // #region agent log
      fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "show-plan.tsx:callToolAsync catch",
          message: "fill-cart call failed",
          data: {
            errName: err instanceof Error ? err.name : "unknown",
            errMessage: err instanceof Error ? err.message : String(err),
          },
          timestamp: Date.now(),
          hypothesisId: "H2",
        }),
      }).catch(() => {});
      // #endregion
      console.error("fill-cart call failed:", err);
      sendFollowUp(
        `Looks perfect! Please add these to my cart: ${JSON.stringify(products)}`,
      );
    }
  };

  return (
    <div className="layout-trio">
      <MealPlanCard meal_plan={data.meal_plan} />
      <IngredientsCard ingredients={data.ingredients} />
      {fillCartStatus === "idle" ? (
        <ActionCard
          sendFollowUp={sendFollowUp}
          onLooksPerfect={handleLooksPerfect}
        />
      ) : (
        <FillCartProgress
          status={fillCartStatus}
          products={fillCartProducts}
          simulatedCompleted={simulatedCompleted}
          result={fillCartResult}
        />
      )}
    </div>
  );
}

export default ShowPlan;

mountWidget(<ShowPlan />);
