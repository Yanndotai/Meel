import "dotenv/config";
import { McpServer } from "skybridge/server";
import { z } from "zod";

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
