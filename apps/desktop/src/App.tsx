import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Bubble from "./Bubble";
import ChatApp from "./ChatApp";

function App() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(getCurrentWindow().label);
  }, []);

  if (label === "chat") return <ChatApp />;
  if (label === "bubble") return <Bubble />;
  return null;
}

export default App;
