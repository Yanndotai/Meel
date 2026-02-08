import { useState } from "react";
import { useSendFollowUpMessage } from "../helpers";
import { Card } from "./cards";

interface Option {
  label: string;
  value: string;
  icon?: string;
  description?: string;
}

interface QuestionCardProps {
  question: string;
  select_type: "single" | "multi";
  options: Option[];
  onAnswer?: (question: string, answer: string) => void;
}

export function QuestionCard({
  question,
  select_type,
  options,
  onAnswer,
}: QuestionCardProps) {
  const sendFollowUp = useSendFollowUpMessage();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState(false);

  const submit = (answer: string) => {
    if (onAnswer) {
      onAnswer(question, answer);
    } else {
      sendFollowUp(answer);
    }
  };

  const handleSelect = (option: Option) => {
    if (sent) return;

    if (select_type === "single") {
      setSelected(new Set([option.value]));
      setSent(true);
      submit(option.label);
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(option.value)) next.delete(option.value);
        else next.add(option.value);
        return next;
      });
    }
  };

  const handleConfirm = () => {
    if (sent || selected.size === 0) return;
    setSent(true);
    const labels = options
      .filter((o) => selected.has(o.value))
      .map((o) => o.label);
    submit(labels.join(", "));
  };

  return (
    <Card>
      <div className="question-card">
        <h2 className="question-title">{question}</h2>
        <div className="question-options">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`option-card${selected.has(option.value) ? " selected" : ""}${sent ? " disabled" : ""}`}
              onClick={() => handleSelect(option)}
              disabled={sent}
            >
              {option.icon && <span className="option-icon">{option.icon}</span>}
              <div className="option-content">
                <span className="option-label">{option.label}</span>
                {option.description && (
                  <span className="option-description">{option.description}</span>
                )}
              </div>
            </button>
          ))}
        </div>
        {select_type === "multi" && !sent && (
          <button
            type="button"
            className="btn btn-primary confirm-btn"
            onClick={handleConfirm}
            disabled={selected.size === 0}
          >
            Confirm ({selected.size} selected)
          </button>
        )}
        {sent && <div className="question-sent">Sent</div>}
      </div>
    </Card>
  );
}
