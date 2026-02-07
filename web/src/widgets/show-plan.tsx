import "@/index.css";

import { mountWidget } from "skybridge/web";
import { useToolInfo, useSendFollowUpMessage } from "../helpers";
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

  if (!isSuccess || !output) return null;

  const data = output as ShowPlanOutput;

  return (
    <div className="layout-trio">
      <MealPlanCard meal_plan={data.meal_plan} />
      <IngredientsCard ingredients={data.ingredients} />
      <ActionCard sendFollowUp={sendFollowUp} />
    </div>
  );
}

export default ShowPlan;

mountWidget(<ShowPlan />);
