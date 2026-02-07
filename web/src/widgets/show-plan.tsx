import "@/index.css";

import { mountWidget } from "skybridge/web";
import { useToolInfo, useSendFollowUpMessage, useCallTool } from "../helpers";
import {
  MealPlanCard,
  IngredientsCard,
  ActionCard,
  type DayMeals,
  type Ingredient,
} from "../components/cards";

interface ShowPlanOutput {
  meal_plan: Record<string, DayMeals>;
  ingredients: Ingredient[];
  message: string;
}

function ShowPlan() {
  const { output, isSuccess } = useToolInfo<"show-plan">();
  const sendFollowUp = useSendFollowUpMessage();
  const { callTool } = useCallTool("accept-plan");

  if (!isSuccess || !output) return null;

  const data = output as ShowPlanOutput;

  const handleLooksPerfect = () => {
    callTool({ ingredients: data.ingredients });
  };

  return (
    <div className="layout-trio">
      <MealPlanCard meal_plan={data.meal_plan} />
      <IngredientsCard ingredients={data.ingredients} />
      <ActionCard
        sendFollowUp={sendFollowUp}
        onLooksPerfect={handleLooksPerfect}
      />
    </div>
  );
}

export default ShowPlan;

mountWidget(<ShowPlan />);
