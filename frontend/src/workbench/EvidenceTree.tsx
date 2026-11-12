import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { gateway, type Row } from "../gateway";
import { ChevronDown, ChevronRight, HardDrive, FolderOpen } from "../icons";
import { ErrorState, FileIcon } from "../ui";
import { useI18n } from "../i18n/I18nProvider";

type TreeProps = {
  caseId: string;
  evidence: Row[];
  evidenceId: string;
  folderId: string;
  selectedNode: Row | null;
  trail: Row[];
  revision: number;
  onOpen: (evidenceId: string, node: Row, trail: Row[]) => void;
  /** An expanded folder that quick triage left unlisted. */
  onPartial?: (evidenceId: string, node: Row) => void;
  onEvidence: (id: string) => void;
};

function treeKey(
  event: KeyboardEvent<HTMLDivElement>,
  toggle: ((open: boolean) => void) | undefined,
  open: () => void,
) {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    toggle?.(true);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    toggle?.(false);
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const items = Array.from(
      event.currentTarget
        .closest('[role="tree"]')
        ?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
    );
    const index = items.indexOf(event.currentTarget);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : index + (event.key === "ArrowDown" ? 1 : -1);
    items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
  }
}

function Branch({
  node,
  source,
  parents,
  props,
  root = false,
}: {
  node: Row;
  source: Row;
  parents: Row[];
  props: TreeProps;
  root?: boolean;
}) {
  const { m } = useI18n();
  const directory = ["ROOT", "DIRECTORY"].includes(node.node_type);
  const [expanded, setExpanded] = useState(root && directory);
  const [children, setChildren] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const request = useRef(0);
  const rowElement = useRef<HTMLDivElement>(null);
  const active =
    props.evidenceId === source.id &&
    (props.selectedNode?.id ?? props.folderId) === node.id;
  useEffect(() => {
    if (active)
      rowElement.current?.scrollIntoView?.({
        block: "nearest",
        inline: "nearest",
      });
  }, [active]);
  const ancestor =
    props.evidenceId === source.id && props.trail.some((n) => n.id === node.id);
  useEffect(() => {
    if (ancestor) setExpanded(true);
  }, [ancestor, props.folderId, props.selectedNode?.id]);
  async function load(next?: string | null) {
    const version = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const result = await gateway.call("files.list", {
        case_id: props.caseId,
        evidence_id: source.id,
        parent_node_id: node.id,
        directories_only: false,
        cursor: next ?? null,
        limit: 100,
      });
      if (version !== request.current) return;
      setChildren((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.page?.next_cursor ?? null);
      setLoaded(true);
    } catch (error) {
      if (version === request.current) setError(error);
    } finally {
      if (version === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (directory && expanded && node.is_partial)
      props.onPartial?.(source.id, node);
  }, [directory, expanded, node.is_partial, source.id, node.id]);
  useEffect(() => {
    if (directory && expanded) void load();
    return () => {
      request.current++;
    };
  }, [directory, expanded, props.caseId, source.id, node.id, props.revision]);
  const path = [...parents, node];
  const open = () => props.onOpen(source.id, node, path);
  const index = props.trail.findIndex((item) => item.id === node.id);
  const revealedChild =
    props.evidenceId === source.id
      ? ((index >= 0 ? props.trail[index + 1] : undefined) ??
        (props.selectedNode?.parent_node_id === node.id
          ? props.selectedNode
          : undefined))
      : undefined;
  const visibleChildren =
    revealedChild && !children.some((item) => item.id === revealedChild.id)
      ? [...children, revealedChild]
      : children;
  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-label={
        root
          ? m.workbench.tree.rootOf(node.display_path || "/")
          : node.original_name || "/"
      }
      aria-expanded={directory ? expanded : undefined}
      aria-selected={active}
      onKeyDown={(event) =>
        treeKey(event, directory ? setExpanded : undefined, open)
      }
    >
      <div
        ref={rowElement}
        className={`evidence-tree-row ${active ? "active" : ""}`}
        onClick={open}
      >
        {directory ? (
          <button
            tabIndex={-1}
            aria-label={(expanded
              ? m.workbench.tree.collapse
              : m.workbench.tree.expand)(
              root
                ? m.workbench.tree.sourceRoot(source.display_name)
                : node.original_name || "/",
            )}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="tree-leaf-indent" aria-hidden="true" />
        )}
        <FileIcon row={node} />
        <span title={node.display_path}>
          {root ? m.workbench.tree.root : node.original_name}
        </span>
      </div>
      {directory && expanded && (
        <div className="evidence-tree-children" role="group">
          {visibleChildren.map((child) => (
            <Branch
              key={child.id}
              node={child}
              source={source}
              parents={path}
              props={props}
            />
          ))}
          {busy && (
            <p className="tree-message" role="status">
              {m.workbench.tree.loadingItems}
            </p>
          )}
          {error != null && <ErrorState error={error} retry={() => load()} />}
          {!busy && !error && loaded && !visibleChildren.length && (
            <p className="tree-message">{m.workbench.tree.noChildren}</p>
          )}
          {cursor && (
            <button
              className="tree-more"
              disabled={busy}
              onClick={() => load(cursor)}
            >
              {m.workbench.tree.more}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Source({ source, props }: { source: Row; props: TreeProps }) {
  const { m } = useI18n();
  const [expanded, setExpanded] = useState(source.id === props.evidenceId);
  const [roots, setRoots] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (source.id === props.evidenceId) setExpanded(true);
  }, [source.id, props.evidenceId, props.folderId, props.selectedNode?.id]);
  useEffect(() => {
    if (!expanded) return;
    let live = true;
    setBusy(true);
    setError(null);
    gateway
      .call<Row[]>("files.roots", {
        case_id: props.caseId,
        evidence_id: source.id,
      })
      .then((roots) => {
        if (live) setRoots(roots);
      })
      .catch((error) => {
        if (live) setError(error);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [expanded, props.caseId, source.id, props.revision]);
  const open = () => {
    setExpanded(true);
    props.onEvidence(source.id);
  };
  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-label={source.display_name}
      aria-expanded={expanded}
      aria-selected={source.id === props.evidenceId && !props.folderId}
      onKeyDown={(event) => treeKey(event, setExpanded, open)}
    >
      <div
        className={`evidence-tree-row source ${source.id === props.evidenceId ? "current-source" : ""}`}
        onClick={open}
      >
        <button
          tabIndex={-1}
          aria-label={(expanded
            ? m.workbench.tree.collapse
            : m.workbench.tree.expand)(source.display_name)}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {source.format === "DIRECTORY" ? (
          <FolderOpen size={15} />
        ) : (
          <HardDrive size={15} />
        )}
        <span title={source.display_name}>{source.display_name}</span>
        <small>{source.format === "DIRECTORY" ? "DIR" : source.format}</small>
      </div>
      {expanded && (
        <div role="group" className="evidence-tree-children">
          {roots.map((node) => (
            <Branch
              key={node.id}
              root
              node={node}
              source={source}
              parents={[]}
              props={props}
            />
          ))}
          {busy && (
            <p className="tree-message" role="status">
              {m.workbench.tree.loadingEvidence}
            </p>
          )}
          {error != null && <ErrorState error={error} />}
          {!busy && !error && !roots.length && (
            <p className="tree-message">{m.workbench.tree.noIndex}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function EvidenceTree(props: TreeProps) {
  const { m } = useI18n();
  return (
    <div
      className="evidence-tree"
      role="tree"
      aria-label={m.workbench.tree.label}
    >
      {props.evidence.map((source) => (
        <Source
          key={`${props.caseId}:${source.id}`}
          source={source}
          props={props}
        />
      ))}
      {!props.evidence.length && (
        <p className="tree-message">
          {props.caseId
            ? m.workbench.tree.addHint
            : m.workbench.tree.selectCase}
        </p>
      )}
    </div>
  );
}
