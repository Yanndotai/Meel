# Meel - AI Meal Planning Assistant

## Project Overview

**Meel** is a conversational meal planning application built with the Skybridge framework. It combines an MCP (Model Context Protocol) server with interactive React widgets to create a ChatGPT-integrated meal planning experience. The app collects user preferences through interactive cards, generates personalized meal plans via the Dust AI platform, and presents them with shopping lists and interactive controls.

**Tech Stack:**
- **Framework:** Skybridge (MCP server + widget rendering)
- **Server:** Express + Node.js 24+ (TypeScript)
- **Frontend:** React 19 + Vite
- **AI Integration:** Dust AI API for meal plan generation
- **Schema Validation:** Zod
- **Data Storage:** JSON files (profiles.json, conversations.json)

## Architecture

### 5-Tool Pattern

The application follows a **5-tool architecture**:

1. **get-profile** (headless tool) - Retrieves user profile and identifies missing fields
2. **save-preferences** (headless tool) - Saves/updates user preferences
3. **fill-cart** (headless tool) - Automates filling an online grocery shopping cart using browser automation
4. **four-cards** (widget) - Displays four cards in a 2x2 grid (questions or info); use for all preference collection
5. **show-plan** (widget) - Generates and displays the complete meal plan with shopping list

### Key Principle: Card-First UI

**CRITICAL:** All user interactions MUST use the **four-cards** widget. Never ask questions in plain text. Always pass exactly 4 cards (use info cards to fill slots if needed). The cards automatically send user selections as follow-up messages.

## Directory Structure

```
/
├── server/src/           # MCP server logic
│   ├── index.ts         # Express app setup
│   ├── server.ts        # Tool/widget registration + Dust integration
│   └── middleware.ts    # MCP middleware
├── web/src/             # React widgets
│   ├── widgets/         # Widget entry points (must match tool names)
│   │   ├── four-cards.tsx
│   │   └── show-plan.tsx
│   ├── components/      # Shared React components
│   │   ├── card-renderer.tsx
│   │   ├── question-card.tsx
│   │   ├── info-card.tsx
│   │   └── cards.tsx    # MealPlanCard, IngredientsCard, ActionCard
│   ├── helpers.ts       # useToolInfo, useSendFollowUpMessage hooks
│   └── index.css        # Global styles
├── data/                # Runtime data storage
│   ├── profiles.json    # User preferences (diet, allergies, etc.)
│   ├── conversations.json
│   └── dust-system-prompt.md  # Dust AI system instructions
├── package.json
├── tsconfig.json
└── alpic.json          # Alpic deployment config
```

## Data Flow

### 1. Profile Collection Flow

```
User starts → get-profile → Check missing fields
  ↓
If missing fields → four-cards (question cards)
  ↓
User clicks option → Auto follow-up message sent
  ↓
save-preferences → Merge into profile
  ↓
Repeat until complete
```

### 2. Meal Plan Generation Flow

```
Profile complete → show-plan widget called
  ↓
Read user profile from profiles.json
  ↓
Build prompt from dust-system-prompt.md + profile
  ↓
Call Dust API (createDustConversation)
  ↓
Parse JSON response (meal_plan + ingredients)
  ↓
Render: MealPlanCard + IngredientsCard + ActionCard
```

### 3. Shopping Cart Automation Flow

```
User requests cart filling → fill-cart tool called
  ↓
Receive products array (name + amount)
  ↓
Build natural language task for Browser Use
  ↓
BrowserUseClient creates automation task
  ↓
AI-powered browser navigates to store and adds items
  ↓
Return success/failure status
```

## Key Files

### [server/src/server.ts](server/src/server.ts)

**Purpose:** Core MCP server definition
**Contains:**
- 6 tool/widget registrations
- Dust API integration (`createDustConversation`)
- Browser Use integration (`fillShoppingCart`)
- Profile management helpers (`readJSON`, `writeJSON`)
- Prompt building logic (`buildDustPrompt`)
- Response parsing (`parseDustResponse`)
- Zod schemas for card configurations

**Critical Functions:**
- `buildDustPrompt(profile, request)` - Constructs the Dust prompt from profile + system prompt
- `parseDustResponse(content)` - Extracts JSON from Dust markdown response
- `fillShoppingCart(products, storeUrl)` - Automates browser to fill shopping cart with products

### [server/src/index.ts](server/src/index.ts)

**Purpose:** Express app initialization
**Contains:**
- Server setup on port 3000
- MCP middleware mounting
- DevTools server (dev mode only)
- Widget dev server with HMR (dev mode only)
- Static asset serving (production)

### [web/src/widgets/show-plan.tsx](web/src/widgets/show-plan.tsx)

**Purpose:** Main meal plan display widget
**Uses:**
- `useToolInfo<"show-plan">()` - Gets structured output from server
- `useSendFollowUpMessage()` - Sends user actions back to ChatGPT
- Three card components: MealPlanCard, IngredientsCard, ActionCard

### [web/src/components/cards.tsx](web/src/components/cards.tsx)

**Purpose:** Meal plan UI components

**Components:**
1. **MealPlanCard** - Grid of days with lunch/dinner, stats (avg calories, prep time)
2. **IngredientsCard** - Interactive shopping list with checkboxes
3. **ActionCard** - Follow-up action buttons ("Swap a meal", "Looks perfect", etc.)

### [data/dust-system-prompt.md](data/dust-system-prompt.md)

**Purpose:** Instructions for Dust AI
**Format:** Specifies exact JSON structure for meal plan output
**Rules:**
- Must include all requested days (default Monday-Friday)
- Each day: lunch + dinner with name, prep_time, calories
- Aggregated ingredient list (no duplicates)
- Respects diet, allergies, budget, cooking time constraints

### [data/profiles.json](data/profiles.json)

**Purpose:** User preference storage
**Schema per user:**
```json
{
  "user_123": {
    "diet": "vegetarian",
    "household_size": 2,
    "budget": 80,
    "allergies": ["peanuts"],
    "cuisine_preferences": "Mediterranean",
    "cooking_time": 30,
    "days": 5
  }
}
```

## Environment Variables

Required in `.env` (see [.env.example](.env.example)):

```bash
# Dust AI Configuration
DUST_API_KEY=your_dust_api_key
DUST_WORKSPACE_ID=your_workspace_id
DUST_AGENT_SID=your_agent_sid

# Browser Use Configuration
BROWSER_USE_API_KEY=your_browser_use_api_key

# Environment
NODE_ENV=development  # or production
```

**Getting API Keys:**
- **Dust AI:** Sign up at [dust.tt](https://dust.tt) and create an agent
- **Browser Use:** Get your API key from [browseruse.com](https://www.browseruse.com)

## Development Workflow

### Start Dev Server

```bash
pnpm dev
```

- Server runs at http://localhost:3000
- MCP endpoint: http://localhost:3000/mcp
- DevTools UI: http://localhost:3000/
- Widget HMR enabled (edit widgets → instant reload)

### Connect to ChatGPT

1. Run `ngrok http 3000` to expose server
2. In ChatGPT: Settings → Connectors → Create
3. Add ngrok URL + `/mcp` (e.g., `https://abc123.ngrok-free.app/mcp`)
4. Fill-cart progress is updated manually: the widget shows an "Update" button that calls `check_fill_cart_progress` to refresh the shopping list and status.

### Add a New Widget

1. Register in [server/src/server.ts](server/src/server.ts):
   ```ts
   .registerWidget(
     "my-widget",
     { description: "..." },
     { description: "...", inputSchema: {...} },
     async (params) => ({ structuredContent: {...}, content: [...] })
   )
   ```

2. Create [web/src/widgets/my-widget.tsx](web/src/widgets/):
   ```tsx
   import { mountWidget } from "skybridge/web";
   import { useToolInfo } from "../helpers";

   function MyWidget() {
     const { output, isSuccess } = useToolInfo<"my-widget">();
     // render logic
   }

   export default MyWidget;
   mountWidget(<MyWidget />);
   ```

### Edit Server Code

After changes to [server/src/](server/src/):
- Server auto-restarts (nodemon)
- In ChatGPT: Settings → Connectors → [Your connector] → **Reload**

## Common Tasks

### Use the Shopping Cart Automation

The `fill-cart` tool automates filling an online grocery cart using AI-powered browser automation:

```typescript
// Example usage in ChatGPT flow
const products = [
  { name: "Chicken breast", amount: "500g" },
  { name: "Olive oil", amount: "1L" },
  { name: "Tomatoes", amount: "6" }
];

// Option 1: Let Browser Use find a suitable grocery store
await fillCart({ products });

// Option 2: Specify a specific store URL
await fillCart({
  products,
  store_url: "https://www.carrefour.fr"
});
```

**How it works:**
1. Creates a natural language task description from the products list
2. Uses BrowserUseClient to spawn an AI-controlled browser
3. Browser navigates to the store (or finds one if not specified)
4. AI agent searches for each product and adds it to cart
5. Returns success/failure status with optional output details

**Use cases:**
- After generating a meal plan, offer to fill the user's cart
- Automate weekly grocery shopping from saved meal plans
- Quick reordering of frequently used ingredients

### Modify Profile Fields

1. Update field list in [server/src/server.ts:157-165](server/src/server.ts#L157-L165)
2. Update card questions in ChatGPT's instructions or card definitions
3. Update [data/dust-system-prompt.md](data/dust-system-prompt.md) if needed

### Change Meal Plan Format

1. Modify JSON structure in [data/dust-system-prompt.md](data/dust-system-prompt.md)
2. Update Zod types in [web/src/widgets/show-plan.tsx](web/src/widgets/show-plan.tsx)
3. Adjust parsing in [server/src/server.ts:92-114](server/src/server.ts#L92-L114) (`parseDustResponse`)
4. Update card components in [web/src/components/cards.tsx](web/src/components/cards.tsx)

### Add New Card Types

1. Define Zod schema in [server/src/server.ts:124-136](server/src/server.ts#L124-L136)
2. Create component in [web/src/components/](web/src/components/)
3. Add case to [card-renderer.tsx](web/src/components/card-renderer.tsx)
4. Reference in `four-cards` widget

### Customize Styling

- Global styles: [web/src/index.css](web/src/index.css)
- CSS classes follow BEM-like convention (e.g., `card`, `card-header`, `card-title`)
- Key layouts: `layout-single`, `layout-duo`, `layout-trio`

## Important Patterns

### Tool Registration

```ts
server.registerTool(
  "tool-name",
  { description: "For ChatGPT context" },
  {
    description: "Detailed instructions for when to use this tool",
    inputSchema: { field: z.string().describe("...") }
  },
  async (params) => ({
    structuredContent: {...},  // For widgets
    content: [{ type: "text", text: "..." }],  // For ChatGPT
    isError?: boolean
  })
)
```

### Widget Registration

```ts
server.registerWidget(
  "widget-name",  // Must match filename in web/src/widgets/
  { description: "..." },
  { description: "...", inputSchema: {...} },
  async (params) => ({
    structuredContent: {...},  // Passed to useToolInfo()
    content: [{ type: "text", text: "..." }]
  })
)
```

### Widget Hook Usage

```tsx
function MyWidget() {
  const { output, input, isSuccess, error } = useToolInfo<"widget-name">();
  const sendFollowUp = useSendFollowUpMessage();

  if (!isSuccess || !output) return null;

  const handleAction = async () => {
    await sendFollowUp("User action message");
  };

  return <div>{/* render output */}</div>;
}

export default MyWidget;
mountWidget(<MyWidget />);
```

### Card Configuration Schema

```ts
type CardConfig =
  | {
      type: "question";
      question: string;
      select_type: "single" | "multi";
      options: {
        label: string;
        value: string;
        icon?: string;  // Emoji
        description?: string;
      }[];
    }
  | {
      type: "info";
      title: string;
      items: { label: string; value: string }[];
    };
```

## Deployment

### Via Alpic

1. Click "Deploy on Alpic" button in README
2. Configure environment variables in Alpic dashboard
3. Get production URL: `https://your-app-name.alpic.live`
4. Add to ChatGPT: Settings → Connectors → Create → use production URL

### Manual Production Build

```bash
pnpm build  # Creates dist/ with server + bundled widgets
pnpm start  # Runs production server
```

## Troubleshooting

### Widget not rendering
- Check filename matches widget name exactly (e.g., `four-cards.tsx` for `"four-cards"`)
- Verify `mountWidget()` is called at bottom of widget file
- Check browser console in DevTools UI

### Dust API errors
- Verify environment variables are set
- Check [data/dust-system-prompt.md](data/dust-system-prompt.md) instructions
- Review response parsing in `parseDustResponse()`

### Profile not saving
- Check [data/profiles.json](data/profiles.json) exists and is writable
- Verify `user_id` is consistent across calls
- Review `writeJSON()` function in [server/src/server.ts](server/src/server.ts)

### ChatGPT not calling tools
- Ensure connector is reloaded after server changes
- Check tool descriptions are clear and specific
- Verify ngrok tunnel is still active (they expire)

### Browser Use (fill-cart) errors
- Verify `BROWSER_USE_API_KEY` is set in `.env`
- Check that the store URL is accessible and valid
- Browser automation may fail if the website structure changes
- Review the task description for clarity
- Note: Browser Use tasks may take 30-60 seconds to complete

### Fill-cart progress (manual update)

After the user clicks **"Looks perfect"**, fill-cart runs in the background. The widget shows the shopping list and an **"Update"** button. Each click on Update calls `check_fill_cart_progress` with the current job ID and refreshes the list (added/failed items and "Buy now" when done). No automatic polling; updates are manual.

## Resources

- [Skybridge Documentation](https://docs.skybridge.tech)
- [Apps SDK Documentation](https://developers.openai.com/apps-sdk)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Alpic Documentation](https://docs.alpic.ai/)
- [Dust AI Platform](https://dust.tt)
- [Browser Use SDK](https://www.npmjs.com/package/browser-use-sdk)
- [Browser Use Documentation](https://www.browseruse.com)

---

**Last Updated:** 2026-02-07
**Framework Version:** Skybridge >=0.25.0 <1.0.0
**Node Version:** 24+
**Dependencies:**
- browser-use-sdk ^2.0.14
