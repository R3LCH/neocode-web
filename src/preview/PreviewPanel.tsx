import { useEffect, useState } from "react";
import type { BridgeClient } from "../bridge/client";
import type { DesignElement, PreviewState } from "@protocol/schema";

type Props = { client: BridgeClient };

export function PreviewPanel({ client }: Props) {
  const [url, setUrl] = useState("http://localhost:5173");
  const [state, setState] = useState<PreviewState | null>(null);
  const [elements, setElements] = useState<DesignElement[]>([]);
  const [selected, setSelected] = useState<DesignElement | null>(null);
  const [patchHtml, setPatchHtml] = useState("");

  useEffect(() => {
    return client.on((event, data) => {
      if (event === "preview.state") setState(data as PreviewState);
    });
  }, [client]);

  const open = async () => {
    await client.call("preview.open", { url: url.trim() });
    const s = (await client.call("preview.get")) as PreviewState;
    setState(s);
  };

  const toggleDesign = async () => {
    await client.call("preview.design_toggle");
    const s = (await client.call("preview.get")) as PreviewState;
    setState(s);
  };

  const scanDesign = async () => {
    const res = (await client.call("preview.design_scan")) as { elements: DesignElement[] };
    setElements(res.elements);
    setSelected(null);
    setPatchHtml("");
  };

  const applyPatch = async () => {
    if (!selected) return;
    await client.call("preview.design_patch", {
      selector: selected.selector,
      html: patchHtml,
    });
    const s = (await client.call("preview.get")) as PreviewState;
    setState(s);
    await scanDesign();
  };

  return (
    <div className="panel preview-panel">
      <div className="row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Preview URL" />
        <button type="button" onClick={open}>
          Open
        </button>
        <button type="button" onClick={toggleDesign}>
          {state?.design_mode ? "Design on" : "Design off"}
        </button>
        <button type="button" onClick={scanDesign}>
          Scan elements
        </button>
      </div>
      {state && (
        <>
          <p className="hint">{state.url}</p>
          <pre className="preview-text">{state.preview_text.slice(0, 8000)}</pre>
        </>
      )}
      {elements.length > 0 && (
        <div className="design-elements">
          <h3>Design elements</h3>
          <ul>
            {elements.map((el) => (
              <li key={el.selector}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(el);
                    setPatchHtml(el.html);
                  }}
                >
                  {el.tag} — {el.selector}
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <div className="design-patch">
              <p className="hint">Editing {selected.selector}</p>
              <textarea
                value={patchHtml}
                onChange={(e) => setPatchHtml(e.target.value)}
                rows={6}
              />
              <button type="button" onClick={applyPatch}>
                Apply patch
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
