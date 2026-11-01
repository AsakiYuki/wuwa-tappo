import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StudioLayout } from "./studio-layout";
import "../../assets/ui/application/styles.css";
import "../styles/studio.scss";

function StudioApp() {
  useEffect(() => {
    void import("./studio-controller").then(({ mountStudioController }) => {
      mountStudioController();
    });
  }, []);

  return <StudioLayout />;
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Studio root element is missing");

createRoot(rootElement).render(<StudioApp />);
