import "dotenv/config";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { BrowserUse, BrowserUseClient } from "browser-use-sdk";
import OpenAI from "openai";

// --- Config ---
const DUST_API_KEY = process.env.DUST_API_KEY!;
const DUST_WORKSPACE_ID = process.env.DUST_WORKSPACE_ID!;
const DUST_AGENT_SID = process.env.DUST_AGENT_SID!;
const DUST_BASE_URL = "https://dust.tt";

const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const DATA_DIR = path.resolve("./data");
const PROFILES_PATH = path.join(DATA_DIR, "profiles.json");
const SYSTEM_PROMPT_PATH = path.join(DATA_DIR, "dust-system-prompt.md");

// --- OpenAI Client ---
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// --- Data helpers ---
function readJSON(filePath: string): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function writeJSON(filePath: string, data: any) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- Dust API ---
async function createDustConversation(message: string, userId: string) {
  const res = await fetch(
    `${DUST_BASE_URL}/api/v1/w/${DUST_WORKSPACE_ID}/assistant/conversations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DUST_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          content: message,
          mentions: [{ configurationId: DUST_AGENT_SID }],
          context: {
            username: userId,
            timezone: "Europe/Paris",
            origin: "api" as const,
          },
        },
        blocking: true,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dust API error ${res.status}: ${text}`);
  }

  return res.json();
}

// --- Build Dust prompt from user profile ---
function buildDustPrompt(
  profile: Record<string, any>,
  request?: string,
): string {
  let systemPrompt = "";
  try {
    systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
  } catch {
    systemPrompt = "You are a meal planning assistant. Generate a meal plan.";
  }

  const profileSummary = Object.entries(profile)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n");

  let prompt = `${systemPrompt}\n\n## User Profile\n${profileSummary}`;

  if (request) {
    prompt += `\n\n## User Request\n${request}`;
  } else {
    prompt += "\n\n## Task\nGenerate a weekly meal plan based on the profile above.";
  }

  return prompt;
}

// --- Parse Dust structured response ---
function parseDustResponse(content: string): {
  meal_plan: Record<string, any>;
  ingredients: any[];
  message: string;
} {
  try {
    const jsonMatch = content.match(/```json?\s*([\s\S]*?)```/);
    const raw = jsonMatch ? jsonMatch[1].trim() : content.trim();
    const parsed = JSON.parse(raw);
    return {
      meal_plan: parsed.meal_plan || parsed.data?.meal_plan || {},
      ingredients: parsed.ingredients || parsed.data?.ingredients || [],
      message:
        parsed.text || parsed.message || "Here's your meal plan!",
    };
  } catch {
    return {
      meal_plan: {},
      ingredients: [],
      message: "Failed to parse meal plan response.",
    };
  }
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
async function fillShoppingCart(products: Array<{ name: string; quantity: string }>) {
  const client = new BrowserUseClient({ apiKey: BROWSER_USE_API_KEY });

  const shop = {
    name: "Carrefour",
    profileId: "20569cab-609c-43b5-9d1f-141322e6b7bd",
    startUrl: "https://www.carrefour.fr"
  }

  try {
    const session = await client.sessions.createSession({
      profileId: shop.profileId,
      proxyCountryCode: BrowserUse.ProxyCountryCode.Fr,
      startUrl: shop.startUrl
    });

    let addedProducts = [];
    let failedProducts = [];

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

    for (let product of products) {
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
      } catch (e) {
        console.error(`[${product.name}] Failed to add:`, e);
        failedProducts.push({ ...product });
      }
    }

    return {
      success: true,
      added_products: addedProducts,
      failed_products: failedProducts
    };
  } catch (error: any) {
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

const IngredientSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
});

// --- MCP Server ---
const server = new McpServer(
  { name: "meal-planner", version: "0.0.1" },
  { capabilities: {} },
)
  // ── accept-plan (headless: print shopping list when user accepts plan) ──
  .registerTool(
    "accept-plan",
    {
      description:
        "Call this ONLY when the user has accepted the final meal plan (e.g. says they like it, will use it, or confirms). Pass the ingredients from the plan you just showed — the same ingredients you used in the last show-plan call (from chat history). Do not call before the user has accepted the plan.",
      inputSchema: {
        ingredients: z
          .array(IngredientSchema)
          .describe("Ingredients from the accepted plan: { name, quantity, unit }"),
      },
    },
    async ({ ingredients }) => ({
      content: [
        {
          type: "text" as const,
          text: "SHOPPING LIST: " + JSON.stringify(ingredients, null, 2),
        },
      ],
    }),
  )
  // ── fill-cart (headless tool) ──
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
    },
    async ({ products }) => {
      const result = await fillShoppingCart(products);

      if (result.success) {
        const addedCount = result.added_products?.length || 0;
        const failedCount = result.failed_products?.length || 0;

        let message = `Shopping cart update complete:\n`;

        if (addedCount > 0) {
          message += `✅ Successfully added ${addedCount} item${addedCount === 1 ? '' : 's'}`;
          if (addedCount <= 3) {
            const addedNames = result.added_products?.map(p => p.name).join(', ');
            message += `: ${addedNames}`;
          }
          message += '\n';
        }

        if (failedCount > 0) {
          message += `❌ Failed to add ${failedCount} item${failedCount === 1 ? '' : 's'}`;
          if (failedCount <= 3) {
            const failedNames = result.failed_products?.map(p => p.name).join(', ');
            message += `: ${failedNames}`;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: message.trim(),
            },
          ],
          isError: failedCount === products.length, // Only error if ALL failed
        };
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fill shopping cart: ${result.error}`,
            },
          ],
          isError: true,
        };
      }
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
