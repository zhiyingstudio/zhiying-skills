#!/usr/bin/env python3
"""BFS 遍历飞书知识库节点树，输出带路径的完整清单 JSON。只读操作。"""
import json
import subprocess
import sys
import time

# 用法: python3 inventory_wiki.py <space_id> <root_node_token> [out_file]
# space_id 与 root_node_token 从知识库 URL 获取：
#   https://xxx.feishu.cn/wiki/<root_node_token> ；space_id 在该节点详情的 space_id 字段
SPACE_ID = sys.argv[1] if len(sys.argv) > 1 else ""
ROOT_NODE_TOKEN = sys.argv[2] if len(sys.argv) > 2 else ""
OUT_FILE = sys.argv[3] if len(sys.argv) > 3 else "wiki_inventory.json"
if not SPACE_ID or not ROOT_NODE_TOKEN:
    sys.exit(__doc__)

def node_list(parent_token=None, page_token=None):
    cmd = ["lark-cli", "wiki", "+node-list", "--space-id", SPACE_ID, "--as", "user", "--format", "json", "--page-size", "50"]
    if parent_token:
        cmd += ["--parent-node-token", parent_token]
    if page_token:
        cmd += ["--page-token", page_token]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"exit {r.returncode}: {r.stderr[:500]}")
    out = r.stdout
    # strip non-JSON lines
    start = out.find("{")
    data = json.loads(out[start:])
    if not data.get("ok"):
        raise RuntimeError(f"api error: {out[:500]}")
    return data["data"]

def list_all_children(parent_token):
    """paginate through all children of a parent"""
    nodes = []
    page_token = None
    pages = 0
    while True:
        d = node_list(parent_token, page_token)
        nodes.extend(d.get("nodes", []))
        pages += 1
        if not d.get("has_more") or not d.get("page_token"):
            break
        page_token = d["page_token"]
        if pages > 20:
            print(f"WARN: >20 pages under {parent_token}", file=sys.stderr)
            break
    return nodes

def main():
    # 根节点信息
    items = []
    # 根节点自身
    root = {
        "node_token": ROOT_NODE_TOKEN,
        "obj_token": "N76nd2NmCo3VKbx28vDcrkyFnye",
        "obj_type": "docx",
        "parent_node_token": "",
        "node_type": "origin",
        "title": "<根节点标题>",
        "has_child": True,
        "space_id": SPACE_ID,
        "depth": 0,
        "path": "<根节点标题>",
    }
    items.append(root)

    queue = [root]
    scanned = 0
    while queue:
        cur = queue.pop(0)
        if not cur.get("has_child"):
            continue
        scanned += 1
        try:
            children = list_all_children(cur["node_token"])
        except Exception as e:
            print(f"BLOCKER under [{cur['path']}]: {e}", file=sys.stderr)
            items.append({
                "_blocker": True,
                "path": cur["path"],
                "error": str(e)[:300],
            })
            continue
        for ch in children:
            entry = {
                "node_token": ch.get("node_token", ""),
                "obj_token": ch.get("obj_token", ""),
                "obj_type": ch.get("obj_type", ""),
                "parent_node_token": ch.get("parent_node_token", ""),
                "node_type": ch.get("node_type", ""),
                "title": ch.get("title", ""),
                "has_child": ch.get("has_child", False),
                "space_id": ch.get("space_id", SPACE_ID),
                "depth": cur["depth"] + 1,
                "path": f"{cur['path']} / {ch.get('title', '')}",
            }
            items.append(entry)
            if ch.get("has_child"):
                queue.append(entry)
        print(f"progress: scanned {scanned} parents, total items {len(items)}, queue {len(queue)}", flush=True)
        time.sleep(0.05)

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    print(f"DONE: {len(items)} items -> {OUT_FILE}")

if __name__ == "__main__":
    main()
