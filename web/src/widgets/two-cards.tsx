import "@/index.css";

import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../helpers";
import { CardRenderer, type CardConfig } from "../components/card-renderer";

function TwoCards() {
  const { output, isSuccess } = useToolInfo<"two-cards">();

  if (!isSuccess || !output) return null;

  const { cards } = output as { cards: CardConfig[] };

  return (
    <div className="layout-duo">
      <CardRenderer card={cards[0]} />
      <CardRenderer card={cards[1]} />
    </div>
  );
}

export default TwoCards;

mountWidget(<TwoCards />);
