import "@/index.css";

import { useRef, useCallback } from "react";
import { mountWidget } from "skybridge/web";
import { useToolInfo, useSendFollowUpMessage } from "../helpers";
import { CardRenderer, type CardConfig } from "../components/card-renderer";

function FourCards() {
  const { output, isSuccess } = useToolInfo<"four-cards">();
  const sendFollowUp = useSendFollowUpMessage();
  const answers = useRef<Record<string, string>>({});

  const cards = (isSuccess && output ? (output as { cards: CardConfig[] }).cards : []);
  const questionCount = cards.filter((c) => c.type === "question").length;

  const handleAnswer = useCallback(
    (question: string, answer: string) => {
      answers.current[question] = answer;
      const answered = Object.keys(answers.current).length;
      if (answered >= questionCount) {
        const summary = Object.entries(answers.current)
          .map(([q, a]) => `${q}: ${a}`)
          .join("\n");
        sendFollowUp(summary);
      }
    },
    [questionCount, sendFollowUp],
  );

  if (!isSuccess || !output) return null;

  return (
    <div className="layout-quad">
      {cards.map((card, i) => (
        <CardRenderer key={i} card={card} onAnswer={handleAnswer} />
      ))}
    </div>
  );
}

export default FourCards;

mountWidget(<FourCards />);
