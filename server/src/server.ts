import "dotenv/config";
import { McpServer } from "skybridge/server";
import { z } from "zod";
import fs from "fs";
import path from "path";

// --- Config ---
const DUST_API_KEY = process.env.DUST_API_KEY!;
const DUST_WORKSPACE_ID = process.env.DUST_WORKSPACE_ID!;
const DUST_AGENT_SID = process.env.DUST_AGENT_SID!;
const DUST_BASE_URL = "https://dust.tt";

const DATA_DIR = path.resolve("./data");
const PROFILES_PATH = path.join(DATA_DIR, "profiles.json");
const SYSTEM_PROMPT_PATH = path.join(DATA_DIR, "dust-system-prompt.md");

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

// --- MCP Server ---
const server = new McpServer(
  { name: "meal-planner", version: "0.0.1" },
  { capabilities: {} },
)
  // ── get-profile (headless tool) ──
  .registerTool(
    "get-profile",
    {
      description:
        "Retrieve the user's saved preferences. Returns known fields and a list of missing fields. IMPORTANT: After calling this, you MUST use 'single-card' or 'two-cards' to ask the user about missing fields using interactive question cards. NEVER ask questions as plain text — always use the card widgets. If the profile is complete (no missing fields), call 'show-plan' directly.",
      inputSchema: {
        user_id: z.string().describe("Unique user identifier"),
      },
    },
    async ({ user_id }) => {
      const profiles = readJSON(PROFILES_PATH);
      const profile = profiles[user_id] || {};

      const allFields = [
        "diet",
        "household_size",
        "budget",
        "allergies",
        "cuisine_preferences",
        "cooking_time",
        "days",
      ];
      const known = Object.keys(profile);
      const missing = allFields.filter((f) => !known.includes(f));

      return {
        structuredContent: { profile, missing_fields: missing },
        content: [
          {
            type: "text" as const,
            text: missing.length === 0
              ? "Profile is complete. Ready to generate a meal plan."
              : `Profile has ${known.length}/${allFields.length} fields. Missing: ${missing.join(", ")}`,
          },
        ],
      };
    },
  )
  // ── save-preferences (headless tool) ──
  .registerTool(
    "save-preferences",
    {
      description:
        "Save or update user preferences after the user answers a question. Merges new values into the existing profile. After saving, call 'single-card' or 'two-cards' to ask the next missing field, or call 'show-plan' if all fields are filled.",
      inputSchema: {
        user_id: z.string().describe("Unique user identifier"),
        preferences: z
          .record(z.string(), z.any())
          .describe("Key-value pairs to save (e.g. { diet: 'vegetarian', household_size: 2 })"),
      },
    },
    async ({ user_id, preferences }) => {
      const profiles = readJSON(PROFILES_PATH);
      profiles[user_id] = { ...profiles[user_id], ...preferences };
      writeJSON(PROFILES_PATH, profiles);

      return {
        content: [
          {
            type: "text" as const,
            text: `Saved preferences for ${user_id}: ${Object.keys(preferences).join(", ")}`,
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
        "REQUIRED for asking questions. Render a single full-width interactive card. Use type 'question' with clickable options for user input, or type 'info' for a read-only summary. When the user clicks an option, their selection is automatically sent back as a follow-up message. You MUST use this tool (or two-cards) instead of asking questions in plain text. Provide 3-5 options with emoji icons and short labels.",
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
        "Render two interactive cards side by side. Best used as: question card (left) + info summary card (right) showing known preferences. When the user clicks an option, their selection is automatically sent back as a follow-up message. You MUST use this tool (or single-card) instead of asking questions in plain text.",
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
        "Generate and display a complete meal plan. The server reads the user profile, calls Dust to generate the plan, and renders MealPlanCard + IngredientsCard + ActionCard. Use this once the profile is complete.",
      inputSchema: {
        user_id: z
          .string()
          .describe("User identifier — server reads profile and generates plan"),
        request: z
          .string()
          .optional()
          .describe("Optional adjustment like 'swap Monday lunch' or 'more vegetarian options'"),
      },
    },
    async ({ user_id, request }) => {
      const profiles = readJSON(PROFILES_PATH);
      const profile = profiles[user_id] || {};
      const prompt = buildDustPrompt(profile, request);

      try {
        const data = await createDustConversation(prompt, user_id);
        const turns = data.conversation.content;
        const lastTurn = turns[turns.length - 1];
        const agentMsg = lastTurn.find(
          (m: any) => m.type === "agent_message",
        );
        const agentContent = agentMsg?.content || "";
        const parsed = parseDustResponse(agentContent);

        return {
          structuredContent: {
            meal_plan: parsed.meal_plan,
            ingredients: parsed.ingredients,
            message: parsed.message,
          },
          content: [
            {
              type: "text" as const,
              text: parsed.message,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error generating meal plan: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

export default server;
export type AppType = typeof server;
