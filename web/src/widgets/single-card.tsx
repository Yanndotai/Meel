import "@/index.css";

import { mountWidget } from "skybridge/web";
import { useToolInfo } from "../helpers";
import { CardRenderer, type CardConfig } from "../components/card-renderer";

function SingleCard() {
  const { output, isSuccess } = useToolInfo<"single-card">();

  if (!isSuccess || !output) return null;

  const { cards } = output as { cards: CardConfig[] };

  return (
    <div className="layout-single">
      <CardRenderer card={cards[0]} />
    </div>
  );
}

export default SingleCard;

mountWidget(<SingleCard />);
