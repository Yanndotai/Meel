import "@/index.css";

import { useState } from "react";
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
  /** Server's public URL so recipe images load in ChatGPT iframe. */
  app_base_url?: string;
}

interface ProgressPayload {
  status:
    | "started"
    | "running"
    | "completed"
    | "failed"
    | "not_found";
  added_products: FillCartProduct[];
  failed_products: FillCartProduct[];
  cart_url: string | null;
  error: string | null;
  current_product: string | null;
}

function extractProgressFromToolResult(result: unknown): ProgressPayload | null {
  if (result == null || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;

  const fromPayload = (p: unknown): ProgressPayload | null => {
    if (p == null || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    const status = o.status;
    if (typeof status !== "string") return null;
    return {
      status: status as ProgressPayload["status"],
      added_products: Array.isArray(o.added_products) ? o.added_products as FillCartProduct[] : [],
      failed_products: Array.isArray(o.failed_products) ? o.failed_products as FillCartProduct[] : [],
      cart_url: o.cart_url != null ? String(o.cart_url) : null,
      error: o.error != null ? String(o.error) : null,
      current_product: o.current_product != null ? String(o.current_product) : null,
    };
  };

  // Try top-level result as payload (host may forward tool output at root)
  const atRoot = fromPayload(r);
  if (atRoot) return atRoot;

  if (r.structuredContent != null) {
    const parsed = fromPayload(r.structuredContent);
    if (parsed) return parsed;
  }
  const content0 = Array.isArray(r.content) ? r.content[0] : undefined;
  if (content0 != null && typeof content0 === "object") {
    if ("structuredContent" in content0) {
      const parsed = fromPayload((content0 as { structuredContent: unknown }).structuredContent);
      if (parsed) return parsed;
    }
    // content[0] itself might be the payload
    const parsed = fromPayload(content0);
    if (parsed) return parsed;
  }
  if (r.result != null) {
    const parsed = fromPayload(r.result);
    if (parsed) return parsed;
  }
  const text =
    (content0 != null && typeof content0 === "object" && "text" in content0
      ? (content0 as { text: unknown }).text
      : r.text) as string | undefined;
  if (typeof text === "string") {
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      try {
        const json = JSON.parse(line) as unknown;
        const parsed = fromPayload(json);
        if (parsed) return parsed;
      } catch {
        continue;
      }
    }
    // Try to find a JSON object anywhere in the text (e.g. embedded in markdown or prose)
    const objectMatch = text.match(/\{[\s\S]*?"status"[\s\S]*?"added_products"[\s\S]*?\}/);
    if (objectMatch) {
      try {
        const json = JSON.parse(objectMatch[0]) as unknown;
        const parsed = fromPayload(json);
        if (parsed) return parsed;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function ShowPlan() {
  const { output, isSuccess } = useToolInfo<"show-plan">();
  const sendFollowUp = useSendFollowUpMessage();
  const { callToolAsync } = useCallTool("fill-cart");
  const { callToolAsync: callProgressToolAsync } =
    useCallTool("check_fill_cart_progress");

  const [fillCartStatus, setFillCartStatus] = useState<
    "idle" | "shopping" | "done" | "error"
  >("idle");
  const [fillCartProducts, setFillCartProducts] = useState<FillCartProduct[]>([]);
  const [fillCartResult, setFillCartResult] = useState<FillCartResult | null>(
    null,
  );
  const [fillCartProgress, setFillCartProgress] = useState<{
    added_products: FillCartProduct[];
    failed_products: FillCartProduct[];
  }>({ added_products: [], failed_products: [] });
  const [fillCartJobId, setFillCartJobId] = useState<string | null>(null);
  const [fillCartErrorMessage, setFillCartErrorMessage] = useState<
    string | null
  >(null);

  const handleUpdateProgress = async () => {
    if (fillCartJobId == null) return;
    try {
      const result = await callProgressToolAsync({ jobId: fillCartJobId });
      const data = extractProgressFromToolResult(result);
      if (!data || data.status === "not_found") return;

      setFillCartProgress({
        added_products: data.added_products ?? [],
        failed_products: data.failed_products ?? [],
      });

      if (data.status === "completed" || data.status === "failed") {
        setFillCartResult({
          added_products: data.added_products ?? [],
          failed_products: data.failed_products ?? [],
          cart_url: data.cart_url ?? undefined,
        });
        setFillCartStatus("done");
        setFillCartJobId(null);
        const added = (data.added_products ?? []).length;
        const failed = (data.failed_products ?? []).length;
        if (data.status === "failed" && data.error) {
          sendFollowUp(`Cart fill failed: ${data.error}`);
        } else if (failed > 0) {
          sendFollowUp(
            `Cart ready with ${added} item${added === 1 ? "" : "s"} added. ${failed} item${failed === 1 ? "" : "s"} could not be added.`,
          );
        } else {
          sendFollowUp(
            `Cart ready with ${added} item${added === 1 ? "" : "s"} added.`,
          );
        }
      }
    } catch (err) {
      console.error("[fill-cart] Update progress failed:", err);
    }
  };

  if (!isSuccess || !output) return null;

  const data = output as ShowPlanOutput;

  const handleLooksPerfect = async () => {
    const products: FillCartProduct[] = data.ingredients.map((i) => ({
      name: i.name,
      quantity: `${i.quantity} ${i.unit}`,
    }));

    setFillCartProducts(products);
    setFillCartStatus("shopping");
    setFillCartResult(null);
    setFillCartProgress({ added_products: [], failed_products: [] });
    setFillCartJobId(null);
    setFillCartErrorMessage(null);

    try {
      const result = await callToolAsync({ products });

      const resultPayload = result as Record<string, unknown> & {
        content?: Array<{ type?: string; text?: string; structuredContent?: unknown }>;
        structuredContent?: { jobId?: string } & Partial<FillCartResult>;
        text?: string;
      };

      const jobId =
        (resultPayload as { _meta?: { taskId?: string } })?._meta?.taskId ??
        resultPayload?.structuredContent?.jobId ??
        (typeof (resultPayload as { jobId?: string })?.jobId === "string"
          ? (resultPayload as { jobId?: string }).jobId
          : undefined) ??
        (resultPayload?.content?.[0] as { structuredContent?: { jobId?: string } } | undefined)
          ?.structuredContent?.jobId;

      if (jobId) {
        setFillCartJobId(jobId);
        return true;
      }

      const legacyResult = resultPayload?.structuredContent as
        | FillCartResult
        | undefined;
      if (
        legacyResult &&
        Array.isArray(legacyResult.added_products) &&
        Array.isArray(legacyResult.failed_products)
      ) {
        setFillCartResult(legacyResult);
        setFillCartStatus("done");
        const resultText =
          resultPayload?.content?.[0]?.text ??
          resultPayload?.text ??
          "Cart updated.";
        sendFollowUp(resultText);
        return true;
      }

      setFillCartStatus("error");
      setFillCartErrorMessage(
        (resultPayload?.content?.[0] as { text?: string } | undefined)?.text ??
          (resultPayload?.text as string | undefined) ??
          "Could not start cart fill.",
      );
      sendFollowUp(
        (resultPayload?.content?.[0] as { text?: string } | undefined)?.text ??
          (resultPayload?.text as string | undefined) ??
          "Could not start cart fill.",
      );
    } catch (err) {
      setFillCartStatus("error");
      setFillCartResult(null);
      setFillCartErrorMessage("Something went wrong. You can try again.");
      console.error("fill-cart call failed:", err);
      sendFollowUp(
        `Looks perfect! Please add these to my cart: ${JSON.stringify(products)}`,
      );
    }
  };

  const handleFillCartTryAgain = () => {
    setFillCartStatus("idle");
    setFillCartProducts([]);
    setFillCartResult(null);
    setFillCartProgress({ added_products: [], failed_products: [] });
    setFillCartJobId(null);
    setFillCartErrorMessage(null);
  };

  const imageBaseUrl = data.app_base_url || (typeof window !== "undefined" ? window.location.origin : "");

  return (
    <div className="layout-trio">
      <MealPlanCard meal_plan={data.meal_plan} imageBaseUrl={imageBaseUrl} />
      <IngredientsCard ingredients={data.ingredients} />
      {fillCartStatus === "idle" ? (
        <ActionCard
          sendFollowUp={sendFollowUp}
          onLooksPerfect={handleLooksPerfect}
        />
      ) : (
        <FillCartProgress
          status={fillCartStatus === "error" ? "error" : fillCartStatus}
          products={fillCartProducts}
          progress={fillCartProgress}
          result={fillCartResult}
          errorMessage={fillCartErrorMessage}
          onTryAgain={
            fillCartStatus === "error" ? handleFillCartTryAgain : undefined
          }
          onUpdate={
            fillCartStatus === "shopping" && fillCartJobId != null
              ? handleUpdateProgress
              : undefined
          }
        />
      )}
    </div>
  );
}

export default ShowPlan;

mountWidget(<ShowPlan />);
