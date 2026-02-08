import "dotenv/config";
import { randomUUID } from "node:crypto";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { BrowserUse, BrowserUseClient } from "browser-use-sdk";
import OpenAI from "openai";

const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Fill-cart progress store (in-memory, TTL 1 hour) ---
const FILL_CART_PROGRESS_TTL_MS = 60 * 60 * 1000;

export type FillCartProgressProduct = { name: string; quantity: string };

export type FillCartProgressState = {
  status: "started" | "running" | "completed" | "failed";
  added_products: FillCartProgressProduct[];
  failed_products: FillCartProgressProduct[];
  cart_url: string | null;
  error: string | null;
  current_product: string | null;
  updatedAt: number;
};

const fillCartProgressStore = new Map<string, FillCartProgressState>();

function updateFillCartProgress(
  jobId: string,
  update: Partial<Omit<FillCartProgressState, "updatedAt">>,
): void {
  const existing = fillCartProgressStore.get(jobId);
  if (!existing) return;
  const updatedAt = Date.now();
  fillCartProgressStore.set(jobId, { ...existing, ...update, updatedAt });
}

export function getFillCartProgress(jobId: string): FillCartProgressState | null {
  const entry = fillCartProgressStore.get(jobId);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > FILL_CART_PROGRESS_TTL_MS) {
    fillCartProgressStore.delete(jobId);
    return null;
  }
  return entry;
}

// --- OpenAI Translation ---
async function translateToFrench(productName: string): Promise<string[]> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2-chat-latest",
      messages: [
        {
          role: "system",
          content: `You are a translation assistant helping customers find products at Carrefour, a French grocery store.
When given a product name in English, provide the 3 most relevant French translations that would help someone search for this product at Carrefour.
Sort them by relevance.
The translations should be practical search terms that would work in a grocery store context.`
        },
        {
          role: "user",
          content: `Translate ${productName} to French for searching at Carrefour grocery store`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "translations",
          strict: true,
          schema: {
            type: "object",
            properties: {
              translations: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 3,
                description: "Array of French translations for the product"
              }
            },
            required: ["translations"],
            additionalProperties: false
          }
        }
      }
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      return [productName]; // Fallback to original name
    }

    const parsed = JSON.parse(content);
    if (parsed.translations && Array.isArray(parsed.translations) && parsed.translations.length > 0) {
      return parsed.translations;
    }

    return [productName]; // Fallback to original name
  } catch (error) {
    console.error(`Failed to translate "${productName}":`, error);
    return [productName]; // Fallback to original name on error
  }
}

// --- Browser Use API ---
type FillCartProgressCallback = (update: Partial<FillCartProgressState>) => void;

async function fillShoppingCart(
  products: Array<{ name: string; quantity: string }>,
  options?: { onProgress: FillCartProgressCallback },
) {
  const client = new BrowserUseClient({ apiKey: BROWSER_USE_API_KEY });
  const onProgress = options?.onProgress;

  const shop = {
    name: "Carrefour",
    profileId: "20569cab-609c-43b5-9d1f-141322e6b7bd",
    startUrl: "https://www.carrefour.fr",
  };

  try {
    const session = await client.sessions.createSession({
      profileId: shop.profileId,
      proxyCountryCode: BrowserUse.ProxyCountryCode.Fr,
      startUrl: shop.startUrl
    });

    let addedProducts: Array<{ name: string; quantity: string }> = [];
    let failedProducts: Array<{ name: string; quantity: string }> = [];

    const initialTaskDesc = `
    If you are asked to choose a new address or resume shopping, choose option called "Choisir un autre Drive ou une autre adresse de livraison", 
    than choose "Livraison", use "16 Boulevard Haussmann, 75009 Paris", wait up to 10 seconds and select address if asked.
    For date, choose 11th February, any time after 10:00 AM.

    IF you are not asked anything, report success.
    `

    const initialTask = await client.tasks.createTask({
          task: initialTaskDesc,
          sessionId: session.id,
          maxSteps: 10
        });

        await initialTask.complete();

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const nextProduct = products[i + 1]?.name ?? null;
      onProgress?.({ status: "running", current_product: product.name });

      // Get French translations from OpenAI
      const translations = await translateToFrench(product.name);

      const taskDescription = `
      Go to ${shop.startUrl} and search for "${product.name}". 
      Make all searches in French. French translation of the "${product.name}" might be "${translations.join('","')}". Start searching with them, starting with the first.
        Add to cart at least ${product.quantity} amount of the product.
        If the product cannot be delivered, find another option of the same product. Report success only if the product is added to the cart.
        `;
      try {
        const task = await client.tasks.createTask({
          task: taskDescription,
          sessionId: session.id,
          maxSteps: 4,
          llm: "browser-use-2.0"
        });

        // Get final result
        const result = await task.complete();
        console.log(`[${product.name}] Task completed:`, result.status);

        addedProducts.push({ ...product });
        onProgress?.({
          added_products: [...addedProducts],
          failed_products: [...failedProducts],
          current_product: nextProduct,
        });
      } catch (e) {
        console.error(`[${product.name}] Failed to add:`, e);
        failedProducts.push({ ...product });
        onProgress?.({
          added_products: [...addedProducts],
          failed_products: [...failedProducts],
          current_product: nextProduct,
        });
      }
    }

    // Final step: go to "my cart" so we can capture the session-specific cart URL
    let cartUrl: string | null = null;
    try {
      const goToCartTask = await client.tasks.createTask({
        task: "Navigate to my cart. Open the shopping cart / panier page and stay on it. Do not add or remove items. Just go to the cart.",
        sessionId: session.id,
        maxSteps: 5,
        llm: "browser-use-2.0",
      });
      const cartResult = await goToCartTask.complete();
      const steps = cartResult?.steps;
      if (steps?.length && steps[steps.length - 1]?.url) {
        cartUrl = steps[steps.length - 1].url;
        console.log("[fill-cart] Cart URL captured:", cartUrl);
      }
    } catch (e) {
      console.error("[fill-cart] Failed to navigate to cart:", e);
    }

    onProgress?.({
      status: "completed",
      added_products: addedProducts,
      failed_products: failedProducts,
      cart_url: cartUrl,
      current_product: null,
    });

    return {
      success: true,
      added_products: addedProducts,
      failed_products: failedProducts,
      cart_url: cartUrl,
    };
  } catch (error: any) {
    onProgress?.({
      status: "failed",
      error: error.message,
      current_product: null,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

// --- Shared Zod Schemas ---
const OptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
});

const CardConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("question"),
    question: z.string(),
    select_type: z.enum(["single", "multi"]),
    options: z.array(OptionSchema),
  }),
  z.object({
    type: z.literal("info"),
    title: z.string(),
    items: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
]);

const MealSchema = z.object({
  name: z.string(),
  prep_time: z.number(),
  calories: z.number(),
});

const DayMealsSchema = z.object({
  lunch: MealSchema,
  dinner: MealSchema,
});

const ShowPlanInputSchema = z.object({
  meal_plan: z.record(z.string(), DayMealsSchema),
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
    }),
  ),
  message: z.string(),
});

// --- MCP Server ---
const server = new McpServer(
  { name: "meal-planner", version: "0.0.1" },
  { capabilities: {} },
)
  // ── fill-cart (headless tool; callable from widget "Looks perfect" button) ──
  .registerTool(
    "fill-cart",
    {
      description:
        "Automatically fill an online grocery shopping cart with the specified products using browser automation. This tool uses AI-powered browser control to navigate to a grocery store website and add items to the cart.",
      inputSchema: {
        products: z
          .array(
            z.object({
              name: z.string().describe("Product name (e.g., 'Chicken breast', 'Olive oil')"),
              quantity: z.string().describe("Quantity with unit (e.g., '500g', '1L', '6 pieces')"),
            }),
          )
          .describe("Array of products to add to the cart")
      },
      _meta: {
        ui: { visibility: ["model", "app"] as const },
        "openai/toolInvocation/invoking":
          "Starting to add items to your cart…",
        "openai/toolInvocation/invoked":
          "Cart fill started. Track progress in the plan above.",
      },
    },
    async ({ products }) => {
      const jobId = randomUUID();
      // #region agent log
      console.log("[fill-cart] invoked", { jobId, productsCount: products?.length ?? 0 });
      fetch("http://127.0.0.1:7247/ingest/47f13895-01ff-45bb-8d2b-39b520b23527", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "server.ts:fill-cart:entry",
          message: "fill-cart invoked",
          data: { jobId, productsCount: products?.length ?? 0 },
          timestamp: Date.now(),
          hypothesisId: "H1",
        }),
      }).catch(() => {});
      // #endregion
      const now = Date.now();
      fillCartProgressStore.set(jobId, {
        status: "started",
        added_products: [],
        failed_products: [],
        cart_url: null,
        error: null,
        current_product: null,
        updatedAt: now,
      });

      void fillShoppingCart(products, {
        onProgress: (update) => updateFillCartProgress(jobId, update),
      });

      return {
        structuredContent: {
          jobId,
          status: "started",
        },
        content: [
          {
            type: "text" as const,
            text: "Started adding items to your cart. You can track progress in the plan.",
          },
        ],
        _meta: { taskId: jobId },
      };
    },
  )
  // ── check_fill_cart_progress (widget-only: manual "Update" button) ──
  .registerTool(
    "check_fill_cart_progress",
    {
      description:
        "Check progress of a fill-cart job. Used by the show-plan widget when the user clicks Update to refresh cart status.",
      inputSchema: {
        jobId: z.string().describe("Fill-cart job ID returned when the job was started"),
      },
      _meta: {
        ui: { visibility: ["app"] as const },
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Checking cart progress…",
        "openai/toolInvocation/invoked": "Progress updated.",
      },
    },
    async ({ jobId }) => {
      const progress = getFillCartProgress(jobId);

      // #region agent log
      console.log("[check_fill_cart_progress] invoked", {
        jobId,
        progressFound: !!progress,
        status: progress?.status ?? null,
      });

      if (!progress) {
        const payload = {
          status: "not_found" as const,
          error: "Job not found or expired",
          added_products: [] as FillCartProgressProduct[],
          failed_products: [] as FillCartProgressProduct[],
          cart_url: null as string | null,
          current_product: null as string | null,
        };
        return {
          structuredContent: payload,
          content: [
            {
              type: "text" as const,
              text: `Job not found or expired.\n${JSON.stringify(payload)}`,
            },
          ],
        };
      }

      const payload = {
        status: progress.status,
        added_products: progress.added_products,
        failed_products: progress.failed_products,
        cart_url: progress.cart_url,
        error: progress.error,
        current_product: progress.current_product,
      };
      const addedNames = progress.added_products.map((p) => p.name).join(", ");
      const humanText =
        progress.status === "completed" || progress.status === "failed"
          ? `Cart ${progress.status}. ${progress.added_products.length} added, ${progress.failed_products.length} failed.`
          : progress.added_products.length > 0
            ? `Added: ${addedNames || "—"}. ${progress.current_product ? `Now: ${progress.current_product}` : ""}`
            : progress.current_product
              ? `Adding: ${progress.current_product}`
              : `Progress: ${progress.status}.`;

      return {
        structuredContent: payload,
        content: [
          {
            type: "text" as const,
            text: `${humanText}\n${JSON.stringify(payload)}`,
          },
        ],
      };
    },
  )
  // ── single-card (widget: 1 card full width) ──
  .registerWidget(
    "single-card",
    { description: "Display a single card — question or info" },
    {
      description:
        "Use this to ask one preference question at a time. Chat history is your session storage: use it to track what the user has already answered and only ask for missing topics. When the user clicks an option, their selection is sent back as a follow-up message; then ask the next question or call show-plan if all are answered. Cover exactly these 7 topics (in any order): (1) What kind of diet do you follow? (2) How many people are you cooking for? (3) What's your rough weekly food budget? (4) Any allergies or foods you avoid? (5) Any favorite cuisines or flavors you love? (6) How much time do you want to spend cooking on a typical day? (7) Which days do you want to plan meals for? Use type 'question' with clickable options (3-5 options with emoji icons and short labels) or type 'info' for a read-only summary. You MUST use this tool (or two-cards) instead of asking in plain text.",
      inputSchema: {
        cards: z
          .array(CardConfigSchema)
          .length(1)
          .describe("Array with exactly 1 card config"),
      },
    },
    async ({ cards }) => ({
      structuredContent: { cards },
      content: [
        { type: "text" as const, text: "Displaying card." },
      ],
    }),
  )
  // ── two-cards (widget: 2 cards side by side) ──
  .registerWidget(
    "two-cards",
    { description: "Display two cards side by side" },
    {
      description:
        "Render two cards side by side: question card (left) + optional info card (right) summarizing preferences already known from the conversation. Chat history is your session storage: use it to know what's been answered. Cover the same 7 topics as single-card: (1) What kind of diet do you follow? (2) How many people are you cooking for? (3) What's your rough weekly food budget? (4) Any allergies or foods you avoid? (5) Any favorite cuisines or flavors you love? (6) How much time do you want to spend cooking on a typical day? (7) Which days do you want to plan meals for? When the user clicks an option, their selection is sent back as a follow-up; then ask the next question or call show-plan if all are answered. You MUST use this tool (or single-card) instead of asking in plain text.",
      inputSchema: {
        cards: z
          .array(CardConfigSchema)
          .length(2)
          .describe("Array with exactly 2 card configs"),
      },
    },
    async ({ cards }) => ({
      structuredContent: { cards },
      content: [
        { type: "text" as const, text: "Displaying cards." },
      ],
    }),
  )
  // ── show-plan (widget: meal plan + ingredients + action) ──
  .registerWidget(
    "show-plan",
    { description: "Display the generated meal plan with shopping list" },
    {
      description:
        "Display a meal plan. You must generate the plan and ingredients yourself from the current conversation (diet, household size, budget, allergies, cuisines, cooking time, days). Then call this tool with the structured data to render it. Shape: meal_plan is an object keyed by day name (e.g. Monday, Tuesday), each value has lunch and dinner, each meal has name (string), prep_time (number, minutes), calories (number). ingredients is an array of { name, quantity, unit }. message is a short friendly text.",
      inputSchema: {
        meal_plan: ShowPlanInputSchema.shape.meal_plan.describe(
          "Day names -> { lunch: { name, prep_time, calories }, dinner: { name, prep_time, calories } }",
        ),
        ingredients: ShowPlanInputSchema.shape.ingredients.describe(
          "Aggregated shopping list: { name, quantity, unit }",
        ),
        message: ShowPlanInputSchema.shape.message.describe(
          "Short friendly message about the plan",
        ),
      },
    },
    async ({ meal_plan, ingredients, message }) => {
      const parsed = ShowPlanInputSchema.safeParse({
        meal_plan,
        ingredients,
        message,
      });
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid show-plan input: ${parsed.error.message}`,
            },
          ],
          isError: true,
        };
      }
      const { meal_plan: mp, ingredients: ing, message: msg } = parsed.data;
      return {
        structuredContent: {
          meal_plan: mp,
          ingredients: ing,
          message: msg,
        },
        content: [{ type: "text" as const, text: msg }],
      };
    },
  );

export default server;
export type AppType = typeof server;
