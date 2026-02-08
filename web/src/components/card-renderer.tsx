import { QuestionCard } from "./question-card";
import { InfoCard } from "./info-card";

interface QuestionCardConfig {
  type: "question";
  question: string;
  select_type: "single" | "multi";
  options: { label: string; value: string; icon?: string; description?: string }[];
}

interface InfoCardConfig {
  type: "info";
  title: string;
  items: { label: string; value: string }[];
}

export type CardConfig = QuestionCardConfig | InfoCardConfig;

export function CardRenderer({
  card,
  onAnswer,
}: {
  card: CardConfig;
  onAnswer?: (question: string, answer: string) => void;
}) {
  switch (card.type) {
    case "question":
      return (
        <QuestionCard
          question={card.question}
          select_type={card.select_type}
          options={card.options}
          onAnswer={onAnswer}
        />
      );
    case "info":
      return <InfoCard title={card.title} items={card.items} />;
  }
}
