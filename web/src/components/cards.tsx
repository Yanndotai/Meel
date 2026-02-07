import { useState, type ReactNode } from "react";

/* ── Types ── */

export interface Meal {
  name: string;
  prep_time: number;
  calories: number;
}

export interface DayMeals {
  lunch: Meal;
  dinner: Meal;
}

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
}

/* ── Primitives ── */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="card-header">
      <h2 className="card-title">{title}</h2>
      {detail && <span className="card-detail">{detail}</span>}
    </div>
  );
}

/* ── Meal Plan Card ── */

export function MealPlanCard({
  meal_plan,
}: {
  meal_plan: Record<string, DayMeals>;
}) {
  const days = Object.entries(meal_plan);

  const totalCals = days.reduce(
    (sum, [, m]) => sum + m.lunch.calories + m.dinner.calories,
    0,
  );
  const avgCals = Math.round(totalCals / days.length);

  const totalPrep = days.reduce(
    (sum, [, m]) => sum + m.lunch.prep_time + m.dinner.prep_time,
    0,
  );
  const avgPrep = Math.round(totalPrep / days.length);

  return (
    <Card>
      <CardHeader title="Meal Plan" detail={`${days.length} days`} />

      <div className="stats-bar">
        <div className="stat">
          <span className="stat-value">~{avgCals.toLocaleString()}</span>
          <span className="stat-label">cal / day</span>
        </div>
        <div className="stat">
          <span className="stat-value">{avgPrep} min</span>
          <span className="stat-label">avg prep</span>
        </div>
      </div>

      <div className="days-grid">
        {days.map(([day, meals]) => (
          <div key={day} className="day-card">
            <div className="day-name">{day}</div>
            <div className="meal-item">
              <span className="meal-type">Lunch</span>
              <span className="meal-name">{meals.lunch.name}</span>
              <div className="meal-meta">
                <span className="badge">{meals.lunch.calories} cal</span>
                <span className="badge">{meals.lunch.prep_time} min</span>
              </div>
            </div>
            <div className="meal-divider" />
            <div className="meal-item">
              <span className="meal-type">Dinner</span>
              <span className="meal-name">{meals.dinner.name}</span>
              <div className="meal-meta">
                <span className="badge">{meals.dinner.calories} cal</span>
                <span className="badge">{meals.dinner.prep_time} min</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Ingredients Card ── */

export function IngredientsCard({
  ingredients,
}: {
  ingredients: Ingredient[];
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader
        title="Shopping List"
        detail={`${ingredients.length - checked.size} left`}
      />
      <div className="ingredients-list">
        {ingredients.map((ing, i) => (
          <div
            key={i}
            className={`ingredient-row ${checked.has(i) ? "checked" : ""}`}
            onClick={() => toggle(i)}
          >
            <div
              className={`ingredient-check ${checked.has(i) ? "ingredient-check--done" : ""}`}
            >
              {checked.has(i) && (
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2.5 6L5 8.5L9.5 3.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <span className="ingredient-name">{ing.name}</span>
            <span className="ingredient-qty">
              {ing.quantity} {ing.unit}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Action Card ── */

interface Action {
  label: string;
  message: string;
  variant?: "primary" | "secondary";
}

const DEFAULT_ACTIONS: Action[] = [
  { label: "Swap a meal", message: "Swap a meal", variant: "secondary" },
  { label: "Change portions", message: "Change portions", variant: "secondary" },
  { label: "Looks perfect", message: "Looks perfect!", variant: "primary" },
];

export function ActionCard({
  actions = DEFAULT_ACTIONS,
  sendFollowUp,
}: {
  actions?: Action[];
  sendFollowUp?: (prompt: string) => Promise<void>;
}) {
  const [sent, setSent] = useState(false);

  const handleClick = async (action: Action) => {
    if (sent || !sendFollowUp) return;
    setSent(true);
    await sendFollowUp(action.message);
  };

  return (
    <Card className="card-action">
      <p className="action-text">Want to adjust anything?</p>
      <div className="action-buttons">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`btn btn-${action.variant || "secondary"}${sent ? " btn--disabled" : ""}`}
            onClick={() => handleClick(action)}
            disabled={sent}
          >
            {action.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
