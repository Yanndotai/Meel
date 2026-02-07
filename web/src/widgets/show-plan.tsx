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

const POLL_INITIAL_DELAY_MS = 2_000;

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

  if (r.structuredContent != null) {
    const parsed = fromPayload(r.structuredContent);
    if (parsed) return parsed;
  }
  const content0 = Array.isArray(r.content) ? r.content[0] : undefined;
  if (content0 != null && typeof content0 === "object" && "structuredContent" in content0) {
    const parsed = fromPayload((content0 as { structuredContent: unknown }).structuredContent);
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
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (fillCartJobId == null || fillCartStatus !== "shopping") return;

    // #region agent log
    fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "show-plan.tsx:poll-effect:run",
        message: "polling effect running (single-call + retry)",
        data: { fillCartJobId, fillCartStatus },
        timestamp: Date.now(),
        hypothesisId: "H3",
      }),
    }).catch(() => {});
    // #endregion

    let cancelled = false;

    const pollOnce = async () => {
      try {
        // #region agent log
        fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "show-plan.tsx:poll:call",
            message: "calling check_fill_cart_progress (server long-polls)",
            data: { jobId: fillCartJobId },
            timestamp: Date.now(),
            hypothesisId: "H2_H3",
          }),
        }).catch(() => {});
        // #endregion
        const result = await callProgressToolAsync({ jobId: fillCartJobId });
        if (cancelled) return;

        const data = extractProgressFromToolResult(result);

        // #region agent log
        fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "show-plan.tsx:poll:result",
            message: "check_fill_cart_progress result",
            data: {
              hasData: !!data,
              status: data?.status ?? null,
              resultKeys: result != null && typeof result === "object" ? Object.keys(result as object) : [],
            },
            timestamp: Date.now(),
            hypothesisId: "H4_H5",
          }),
        }).catch(() => {});
        // #endregion

        if (!data || data.status === "not_found") {
          pollTimeoutRef.current = setTimeout(pollOnce, 1000);
          return;
        }

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
          return;
        }

        // Still started/running (server returned after 50s timeout): call once more
        pollTimeoutRef.current = setTimeout(pollOnce, 1000);
      } catch (err) {
        // #region agent log
        fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location: "show-plan.tsx:poll:catch",
            message: "callProgressToolAsync threw",
            data: {
              errMessage: err instanceof Error ? err.message : String(err),
              cancelled,
            },
            timestamp: Date.now(),
            hypothesisId: "H2",
          }),
        }).catch(() => {});
        // #endregion
        if (cancelled) return;
        pollTimeoutRef.current = setTimeout(pollOnce, 1000);
      }
    };

    const initialTimeoutId = setTimeout(() => {
      if (!cancelled) pollOnce();
    }, POLL_INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(initialTimeoutId);
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [
    fillCartJobId,
    fillCartStatus,
    sendFollowUp,
    callProgressToolAsync,
  ]);

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

      // #region agent log
      const resultPayloadForLog = result as Record<string, unknown> & {
        structuredContent?: unknown;
        _meta?: { taskId?: string };
      };
      const jobIdFromMeta = resultPayloadForLog?._meta?.taskId;
      const jobIdFromStructured = (resultPayloadForLog?.structuredContent as { jobId?: string } | undefined)?.jobId;
      fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "show-plan.tsx:handleLooksPerfect:after fill-cart",
          message: "fill-cart result received",
          data: {
            resultKeys: result != null && typeof result === "object" ? Object.keys(result as object) : [],
            hasMeta: !!resultPayloadForLog?._meta,
            jobIdFromMeta: jobIdFromMeta ?? null,
            jobIdFromStructured: jobIdFromStructured ?? null,
          },
          timestamp: Date.now(),
          hypothesisId: "H1",
        }),
      }).catch(() => {});
      // #endregion

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
          status={fillCartStatus === "error" ? "error" : fillCartStatus}
          products={fillCartProducts}
          progress={fillCartProgress}
          result={fillCartResult}
          errorMessage={fillCartErrorMessage}
          onTryAgain={
            fillCartStatus === "error" ? handleFillCartTryAgain : undefined
          }
        />
      )}
    </div>
  );
}

export default ShowPlan;

mountWidget(<ShowPlan />);
