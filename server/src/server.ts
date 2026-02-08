import "dotenv/config";
import { randomUUID } from "node:crypto";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { fal } from "@fal-ai/client";
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

// --- Fal AI (recipe images: nano-banana text-to-image) ---
const FAL_IMAGE_HOST_ALLOWLIST = [
  "fal.media",
  "fal.ai",
  "storage.googleapis.com", // Fal uses paths like /falserverless/...
];

function isAllowedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname === "storage.googleapis.com")
      return u.pathname.includes("falserverless");
    return FAL_IMAGE_HOST_ALLOWLIST.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

/** Fetch image from Fal and return a data URL (base64) for use in img src. */
export async function recipeImageToDataUrl(falImageUrl: string): Promise<string | null> {
  if (!isAllowedImageUrl(falImageUrl)) return null;
  try {
    const response = await fetch(falImageUrl, { redirect: "follow" });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${contentType.split(";")[0]};base64,${base64}`;
    console.log("[recipe-image] Encoded as data URL:", { falUrl: falImageUrl, contentType: contentType.split(";")[0], sizeBytes: buffer.length });
    return dataUrl;
  } catch (err) {
    console.warn("[recipe-image] Fetch/encode failed:", err);
    return null;
  }
}

export { isAllowedImageUrl };

async function generateRecipeImage(recipeName: string): Promise<string | null> {
  if (!process.env.FAL_KEY) {
    console.warn("[fal] FAL_KEY not set, skipping recipe image");
    return null;
  }
  console.log("[show-plan] Generating image for recipe:", recipeName);
  try {
    const result = await fal.subscribe("fal-ai/nano-banana", {
      input: {
        prompt: `Appetizing food photography of ${recipeName}, professional dish presentation, high quality`,
      },
    });
    const url = (result.data as { images?: Array<{ url?: string }> })?.images?.[0]?.url;
    if (!url) {
      console.warn("[fal] No image URL in response for:", recipeName);
      return null;
    }
    console.log("[show-plan] Fal image URL for", recipeName, "->", url);
    return url;
  } catch (err) {
    console.warn("[fal] Image generation failed for", recipeName, err);
    return null;
  }
}

const MealSchema = z.object({
  name: z.string(),
  prep_time: z.number(),
  calories: z.number(),
});

const DayMealsSchema = z.object({
  lunch: MealSchema.optional(),
  dinner: MealSchema.optional(),
});

type DayMealsParsed = z.infer<typeof DayMealsSchema>;

const ShowPlanInputSchema = z.object({
  meal_plan: z.record(z.string(), DayMealsSchema),
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unit: z.string(),
      estimated_price: z.number().optional(),
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
  // ── four-cards (widget: 4 cards in a 2x2 grid) — only card tool ──
  .registerWidget(
    "four-cards",
    { description: "Display four cards in a 2x2 grid (use for all preference questions)" },
    {
      description:
        "Render 4 cards in a 2x2 grid. This is the ONLY card tool: use it for all preference questions and info summaries. Always pass exactly 4 cards: use type 'question' for questions (3-5 options with emoji icons and short labels) and type 'info' for read-only summaries. If you have fewer than 4 items to show, fill the remaining slots with info cards (e.g. a short summary of what you're collecting) or extra questions. Chat history is your session storage. Only ask about topics NOT already answered or implied by the user's message. Possible topics: diet, household size, budget, allergies, favorite cuisines, cooking time. When the user submits all answers (message containing preference key-value pairs and 'Preferences confirmed' or 'show-plan tool'), you MUST call the show-plan tool to display the meal plan—never describe the plan in chat. If not all preferences are gathered yet, call four-cards again for remaining questions.",
      inputSchema: {
        cards: z
          .array(CardConfigSchema)
          .length(4)
          .describe("Array with exactly 4 card configs"),
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
        "Display the meal plan in the UI. You MUST call this tool (do not describe the plan in chat) whenever the user has confirmed their preferences and wants to see their meal plan—e.g. after they submit the four-cards form or say they want to see the plan. Generate the plan and ingredients from the conversation and pass them here. Only include the meals the user asked for (lunch only, dinner only, or both). Shape: meal_plan is an object keyed by day name, each value has optional lunch and/or dinner (include only what was requested), each meal has name (string), prep_time (number, minutes), calories (number). ingredients is an array of { name, quantity, unit, estimated_price }. Always include estimated_price in euros for each ingredient. message is a short friendly text.",
      inputSchema: {
        meal_plan: ShowPlanInputSchema.shape.meal_plan.describe(
          "Day names -> { lunch?: { name, prep_time, calories }, dinner?: { name, prep_time, calories } }. Only include meals the user requested.",
        ),
        ingredients: ShowPlanInputSchema.shape.ingredients.describe(
          "Aggregated shopping list: { name, quantity, unit, estimated_price }. estimated_price is the estimated cost in euros.",
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

      // Collect all meals and generate images in parallel
      type MealTriple = {
        day: string;
        mealType: "lunch" | "dinner";
        meal: { name: string; prep_time: number; calories: number };
      };
      const triples: MealTriple[] = [];
      for (const [day, dayMeals] of Object.entries(mp)) {
        if (dayMeals.lunch) triples.push({ day, mealType: "lunch", meal: dayMeals.lunch });
        if (dayMeals.dinner) triples.push({ day, mealType: "dinner", meal: dayMeals.dinner });
      }
      console.log("[show-plan] Recipe image generation: meals count =", triples.length);
      const falUrls = await Promise.all(
        triples.map(({ meal }) => generateRecipeImage(meal.name)),
      );
      const imageDataUrls = await Promise.all(
        falUrls.map((url) => (url ? recipeImageToDataUrl(url) : null)),
      );
      triples.forEach((t, i) => {
        const dataUrl = imageDataUrls[i];
        console.log("[show-plan] Image for", t.day, t.mealType, t.meal.name, "->", dataUrl ? `data:... (${dataUrl.length} chars)` : "(none)");
      });

      const meal_plan_enriched: Record<
        string,
        {
          lunch?: { name: string; prep_time: number; calories: number; image_url: string | null };
          dinner?: { name: string; prep_time: number; calories: number; image_url: string | null };
        }
      > = {};
      for (const [day, dayMeals] of Object.entries(mp) as [string, DayMealsParsed][]) {
        meal_plan_enriched[day] = {};
        if (dayMeals.lunch) {
          const i = triples.findIndex((t) => t.day === day && t.mealType === "lunch");
          meal_plan_enriched[day].lunch = {
            ...dayMeals.lunch,
            image_url: i >= 0 ? imageDataUrls[i] ?? null : null,
          };
        }
        if (dayMeals.dinner) {
          const i = triples.findIndex((t) => t.day === day && t.mealType === "dinner");
          meal_plan_enriched[day].dinner = {
            ...dayMeals.dinner,
            image_url: i >= 0 ? imageDataUrls[i] ?? null : null,
          };
        }
      }

      const appBaseUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
      return {
        structuredContent: {
          meal_plan: meal_plan_enriched,
          ingredients: ing,
          message: msg,
          app_base_url: appBaseUrl,
        },
        content: [{ type: "text" as const, text: msg }],
      };
    },
  );

export default server;
export type AppType = typeof server;
