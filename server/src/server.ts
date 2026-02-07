import "dotenv/config";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import { BrowserUse, BrowserUseClient } from "browser-use-sdk";
import OpenAI from "openai";

const BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
          structuredContent: {
            added_products: result.added_products,
            failed_products: result.failed_products,
            cart_url: "https://www.carrefour.fr/mon-panier",
          },
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
