#!/usr/bin/env python3
"""飞书知识库采编引擎：从源库抓取文档 → 清洗（去外链/水印/源引用）→ 在目标板块建新文档（图文完整）。
用法:
  python3 collect.py test <src_node_token> <target_board_token>   # 单篇测试（dry 不写台账）
  python3 collect.py run <src_node_token> <target_board_token> <prefix>  # 正式采编
台账: 采编台账.json（首次运行自动创建，防重复采编）
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

CWD = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(CWD, "采编台账.json")

# ── 水印/推广文本（按需自定义：只删明确的源水印与推广尾巴） ──
# 片段级：有界匹配（禁跨标签/换行），只删命中文本本身。
# 以下为空清单 + 常见示例（注释掉），请按你的源库实际水印添加：
WATERMARK_SNIPPETS = [
    # 示例：r"来源[：:]\s*某某社区[^<\n]{0,120}",
    # 示例：r"某某水印\.cn",
]
# 段落级：整块 <p>/<h1-4>/<li> 的纯文本以推广语开头 → 整块删除
PROMO_PARA_PATTERNS = [
    r"^全平台@.+关注我",
    r"^视频号、公众号[:：]\s*直接搜索",
    r"^B站[:：]\s*https?://",
    r"^抖音[:：]\s*https?://",
    r"^小红书[:：]\s*https?://",
    r"^YouTube[:：]\s*https?://",
    r"^扫码关注",
    r"^更多内容请关注",
    r"^关注公众号",
    r"^公众号获取",
    r"^其他往期视频的教程文档都在",
]
WATERMARK_PATTERNS = WATERMARK_SNIPPETS  # 兼容旧引用

def load_ledger():
    if os.path.exists(LEDGER):
        return json.load(open(LEDGER, encoding="utf-8"))
    return {"collected": {}}

def save_ledger(l):
    json.dump(l, open(LEDGER, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

def run_cli(args, timeout=120):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    out = r.stdout
    s = out.find("{")
    if s < 0:
        return {"ok": False, "error": (r.stderr or out)[:300]}
    try:
        return json.loads(out[s:])
    except Exception:
        return {"ok": False, "error": out[:300]}

def fetch_doc(url):
    d = run_cli(["lark-cli", "docs", "+fetch", "--doc", url, "--as", "user", "--format", "json"])
    if not d.get("ok"):
        return None, d
    return d["data"].get("document", {}).get("content", ""), d

def node_create(parent, title):
    d = run_cli(["lark-cli", "wiki", "+node-create", "--parent-node-token", parent,
                 "--title", title, "--as", "user", "--format", "json"])
    data = d.get("data", d if isinstance(d, dict) else {})
    tok = data.get("node_token", "") if isinstance(data, dict) else ""
    return (d.get("ok") and tok), tok, data.get("obj_token", "")

def doc_update(doc, command, **kw):
    args = ["lark-cli", "docs", "+update", "--doc", doc, "--command", command,
            "--as", "user", "--format", "json"]
    for k, v in kw.items():
        args += ["--" + k.replace("_", "-"), v]
    return run_cli(args)

# ── 封面设置（首图优先，品牌横幅兜底）──
# 可选：放一张品牌横幅到 assets/brand_banner.png 作为无图文档的封面兜底；
# 不放置时自动跳过兜底（脚本已做存在性判断，不会报错）。
BRAND_COVER_REL = "assets/brand_banner.png"
def _set_cover(doc_url, verify_xml):
    """为新文档设封面：正文首图优先，无图用品牌横幅。返回 {'source':..., 'ok':bool}"""
    import re as _re, time as _time
    img_tok = None
    if verify_xml:
        m = _re.search(r'<img[^>]*\ssrc="([^"]+)"', verify_xml)
        if m: img_tok = m.group(1)
    chosen_rel = None; src = None
    if img_tok:
        tmp_rel = f"assets/_tmp_cover_{int(_time.time()*1000)}.png"
        d = run_cli(["lark-cli","docs","+media-download","--token",img_tok,"--output",tmp_rel,"--as","user"])
        tmp_abs = os.path.join(CWD, tmp_rel)
        if d.get("ok") and os.path.exists(tmp_abs) and os.path.getsize(tmp_abs) > 0:
            chosen_rel = tmp_rel; src = f"首图 token={img_tok}"
        else:
            try: os.unlink(tmp_abs)
            except: pass
    if not chosen_rel:
        if os.path.exists(os.path.join(CWD, BRAND_COVER_REL)):
            chosen_rel = BRAND_COVER_REL; src = "品牌横幅兜底"
        else:
            return {"ok": False, "source": "无素材"}
    r = run_cli(["lark-cli","docs","+resource-update","--doc",doc_url,"--type","cover","--file",chosen_rel,"--as","user"])
    if chosen_rel.startswith("assets/_tmp_cover_"):
        try: os.unlink(os.path.join(CWD, chosen_rel))
        except: pass
    return {"ok": r.get("ok", False), "source": src, "error": r.get("error")}

# ── 内容清洗 ──
def clean_content(xml):
    stats = {"links_removed": 0, "imgs": [], "watermarks_removed": 0, "cites_removed": 0}
    c = xml
    # 1. 去掉所有 <a> 链接包装，保留内文
    def _unlink(m):
        stats["links_removed"] += 1
        return m.group(1)
    c = re.sub(r"<a[^>]*>(.*?)</a>", _unlink, c, flags=re.S)
    # 2. 收集 img（保留 name/src/href），正文里原样保留（href 短时效，需尽快写回）
    def _is_qr(tag):
        name = re.search(r'name="([^"]*)"', tag)
        alt = re.search(r'alt="([^"]*)"', tag)
        return bool((name and "qrcode" in name.group(1).lower()) or
                    (alt and ("二维码" in alt.group(1) or "扫码" in alt.group(1))))
    for m in re.finditer(r"<img[^>]*/>", c):
        tag = m.group(0)
        if _is_qr(tag):
            stats["qrcode_imgs_removed"] = stats.get("qrcode_imgs_removed", 0) + 1
            continue
        src = re.search(r'src="([^"]+)"', tag)
        name = re.search(r'name="([^"]*)"', tag)
        w = re.search(r'width="(\d+)"', tag)
        if src:
            stats["imgs"].append({"src": src.group(1), "name": name.group(1) if name else "img",
                                  "width": w.group(1) if w else "", "tag": tag})
    # 3. 移除指向源库的结构块：sub-page-list / cite / wiki_recent_update / task
    c = re.sub(r"<sub-page-list.*?</sub-page-list>", "", c, flags=re.S)
    n0 = len(c)
    c = re.sub(r"<cite[^>]*>.*?</cite>", "", c, flags=re.S)
    c = re.sub(r"<cite[^>]*/>", "", c)
    if len(c) != n0:
        stats["cites_removed"] += 1
    c = re.sub(r"<wiki_recent_update[^>]*/?>", "", c)
    # 3. 布局容器解包（grid/column/figure 保留内部内容）
    c = re.sub(r"</?(grid|column|figure)( [^>]*)?>", "", c)
    # 4. 不可迁移块剔除：bookmark 书签（外链）/ source 文件附件
    c = re.sub(r"</?bookmark[^>]*>", "", c)
    c = re.sub(r"<source[^>]*/>", "", c)
    # 5. img 只保留 src token（href+src 组合会被 API 拒绝；src 跨租户可直接迁移）；二维码/扫码图剔除
    #    属性白名单：caption/crop 等会导致 "invalid <img> local resource tag"
    _IMG_ATTR_WHITELIST = ("name", "alt", "mime", "scale", "src", "width")
    def _fix_img(m):
        tag = m.group(0)
        if _is_qr(tag):
            return ""
        keep = []
        for am in re.finditer(r'(\w+)="([^"]*)"', tag):
            if am.group(1) in _IMG_ATTR_WHITELIST:
                keep.append(f'{am.group(1)}="{am.group(2)}"')
        return "<img " + " ".join(keep) + "/>"
    c = re.sub(r"<img[^>]*/>", _fix_img, c)
    # 4. 文本水印剔除（片段级，有界防误删）
    for pat in WATERMARK_SNIPPETS:
        c2 = re.sub(pat, "", c)
        if c2 != c:
            stats["watermarks_removed"] += 1
            c = c2
    # 4b. 推广段落级剔除：块内纯文本以推广语开头 → 整块删除
    def _para_is_promo(m):
        block = m.group(0)
        text = re.sub(r"<[^>]+>", "", block).strip()
        if not text:
            return block
        for pat in PROMO_PARA_PATTERNS:
            if re.match(pat, text):
                stats["watermarks_removed"] += 1
                return ""
        return block
    c = re.sub(r"<(p|h[1-4]|li)(?: [^>]*)?>.*?</\1>", _para_is_promo, c, flags=re.S)
    # 5. 去标题块（新文档标题由节点承载）
    c = re.sub(r"<title[^>]*>.*?</title>", "", c, flags=re.S)
    return c.strip(), stats

def transform_title(title, prefix):
    t = title.strip()
    if prefix and not t.startswith("【"):
        t = f"【{prefix}】{t}"
    return t

def collect(src_token, target_board, prefix, dry=False):
    ledger = load_ledger()
    if src_token in ledger["collected"]:
        return {"status": "skip", "reason": "已采编过", "record": ledger["collected"][src_token]}
    src_url = f"https://my.feishu.cn/wiki/{src_token}"
    # 解析源节点拿标题
    d = run_cli(["lark-cli", "wiki", "+node-get", "--node-token", src_token, "--as", "user", "--format", "json"])
    if not d.get("ok"):
        return {"status": "fail", "step": "node-get", "error": d.get("error", {})}
    src_title = d["data"]["title"]
    obj_token = d["data"]["obj_token"]

    xml, fd = fetch_doc(src_url)
    if xml is None:
        return {"status": "fail", "step": "fetch", "error": fd.get("error", {})}
    cleaned, stats = clean_content(xml)
    if not cleaned or len(re.sub(r"<[^>]+>", "", cleaned).strip()) < 30:
        # 正文过短，可能是目录页或空页 → 跳过
        return {"status": "skip", "reason": f"正文过短({len(re.sub(r'<[^>]+>', '', cleaned).strip())}字符)，疑似目录页"}

    new_title = transform_title(src_title, prefix)
    if dry:
        return {"status": "dry", "title": new_title, "stats": {k: v for k, v in stats.items() if k != 'imgs'},
                "img_count": len(stats["imgs"]), "content_len": len(cleaned)}

    ok, node_token, new_obj = node_create(target_board, new_title)
    if not ok:
        return {"status": "fail", "step": "node-create", "error": node_token}
    new_url = f"https://my.feishu.cn/wiki/{node_token}"
    # 写正文（img 原样带 href 内联回写）；>30KB 分块写入；超时/网络错误时回读校验（服务端可能已写入）
    def _append_ok(url, content):
        ud = doc_update(url, "append", content=content)
        if ud.get("ok") and ud.get("data", {}).get("result") in ("success", "partial_success"):
            return True
        chk_xml, _ = fetch_doc(url)
        chk_len = len(re.sub(r"<[^>]+>", "", chk_xml or "").strip())
        want_len = len(re.sub(r"<[^>]+>", "", content).strip())
        return want_len > 0 and chk_len >= want_len * 0.9

    ok2 = True
    if len(cleaned) > 30000:
        chunks, i = [], 0
        while i < len(cleaned):
            j = min(i + 20000, len(cleaned))
            k2 = cleaned.rfind("</p>", i, j)
            if k2 == -1 or k2 <= i:
                k2 = cleaned.rfind("</li>", i, j)
            if k2 == -1 or k2 <= i:
                k2 = j
            else:
                k2 += 4
            chunks.append(cleaned[i:k2])
            i = k2
        for ch in chunks:
            done = False
            for _ in range(3):
                if _append_ok(new_url, ch):
                    done = True
                    break
                time.sleep(2)
            if not done:
                ok2 = False
                break
            time.sleep(0.3)
    else:
        ok2 = _append_ok(new_url, cleaned)
    if not ok2:
        return {"status": "fail", "step": "append", "error": "chunk append failed (含超时回读校验未通过)", "node": node_token}

    # 校验图片是否成功迁移
    verify_xml, _ = fetch_doc(new_url)
    img_ok = verify_xml.count("<img") if verify_xml else 0

    # 设置封面：优先首图，无图则品牌横幅（assets/brand_banner.png）
    cover_info = _set_cover(new_url, verify_xml)

    rec = {
        "src_title": src_title, "src_obj": obj_token, "new_title": new_title,
        "new_node": node_token, "board": target_board, "date": time.strftime("%Y-%m-%d"),
        "imgs_planned": len(stats["imgs"]), "imgs_verified": img_ok,
        "links_removed": stats["links_removed"], "watermarks_removed": stats["watermarks_removed"],
        "cover": cover_info,
    }
    ledger["collected"][src_token] = rec
    save_ledger(ledger)
    return {"status": "ok", "record": rec}

if __name__ == "__main__":
    mode = sys.argv[1]
    src = sys.argv[2]
    board = sys.argv[3]
    prefix = sys.argv[4] if len(sys.argv) > 4 else ""
    print(json.dumps(collect(src, board, prefix, dry=(mode == "test")), ensure_ascii=False, indent=1))
