import { useEffect, useState } from "react";
import type { BridgeClient } from "../bridge/client";

type FileEntry = { name: string; is_dir: boolean; size: number };

type Props = { client: BridgeClient };

export function FilesPanel({ client }: Props) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState("");

  const load = async (nextPath: string) => {
    const res = (await client.call("files.list", { path: nextPath })) as {
      path: string;
      entries: FileEntry[];
    };
    setPath(res.path);
    setEntries(res.entries);
    setContent("");
    setSelected("");
  };

  useEffect(() => {
    load("").catch(() => undefined);
  }, [client]);

  const openDir = (name: string) => {
    const next = path ? `${path}/${name}` : name;
    load(next).catch(() => undefined);
  };

  const readFile = async (name: string) => {
    const rel = path ? `${path}/${name}` : name;
    const res = (await client.call("files.read", { path: rel })) as {
      path: string;
      content: string;
    };
    setSelected(res.path);
    setContent(res.content);
  };

  return (
    <div className="panel files-panel">
      <div className="row">
        <button type="button" onClick={() => load("").catch(() => undefined)}>
          Workspace root
        </button>
        <span className="hint">{path || "/"}</span>
      </div>
      <ul className="file-list">
        {entries.map((e) => (
          <li key={e.name}>
            <button
              type="button"
              onClick={() => (e.is_dir ? openDir(e.name) : readFile(e.name))}
            >
              {e.is_dir ? "📁" : "📄"} {e.name}
              {!e.is_dir && <span className="hint"> ({e.size} B)</span>}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <>
          <p className="hint">{selected}</p>
          <pre className="file-content">{content}</pre>
        </>
      )}
    </div>
  );
}
