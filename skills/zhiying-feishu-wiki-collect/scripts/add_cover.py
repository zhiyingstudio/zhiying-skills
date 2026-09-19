#!/usr/bin/env python3
"""为已采编/新建的飞书文档设置封面。
规则：使用文档首张正文图作封面（最贴切），无图则用品牌横幅兜底。
用法：
  python3 add_cover.py <wiki_url>                  # 单篇
  python3 add_cover.py --ledger 采编台账.json      # 批量给台账所有已采编文档加封面
"""
import json
import os
import re
import subprocess
import sys
import time
import tempfile

CWD = os.path.dirname(os.path.abspath(__file__))
BRAND_COVER = os.path.join("assets", "brand_banner.png")  # 相对路径，lark-cli --file 禁止绝对路径

def run(args, timeout=120):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    out = r.stdout; s = out.find("{")
    if s < 0:
        return {"ok": False, "error": (r.stderr or out)[:300]}
    try: return json.loads(out[s:])
    except: return {"ok": False, "error": out[:300]}

def fetch_doc(url):
    d = run(["lark-cli","docs","+fetch","--doc",url,"--as","user","--format","json"])
    if not d.get("ok"): return None
    return d["data"].get("document",{}).get("content","")

def first_img_token(xml):
    if not xml: return None
    # 清洗器移除了 href 保留 src，img 形如 <img ... src="TOKEN" .../>
    m = re.search(r'<img[^>]*\ssrc="([^"]+)"', xml)
    if m: return m.group(1)
    return None

def download(token, out):
    return run(["lark-cli","docs","+media-download","--token",token,"--output",out,"--as","user"])

def set_cover(doc_url, file_path):
    return run(["lark-cli","docs","+resource-update","--doc",doc_url,"--type","cover","--file",file_path,"--as","user"])

def add_cover(doc_url, fallback_brand=BRAND_COVER):
    xml = fetch_doc(doc_url)
    img_tok = first_img_token(xml) if xml else None
    chosen = None; src = None
    tmp_rel = None
    if img_tok:
        # 相对路径 tmp（lark-cli --file/--output 禁止绝对路径）
        tmp_rel = os.path.join("assets", f"_tmp_cover_{int(time.time()*1000)}.png")
        tmp_abs = os.path.join(CWD, tmp_rel)
        d = download(img_tok, tmp_rel)
        if d.get("ok") and os.path.exists(tmp_abs) and os.path.getsize(tmp_abs) > 0:
            chosen = tmp_rel; src = f"首图 token={img_tok}"
    if not chosen:
        if os.path.exists(os.path.join(CWD, BRAND_COVER)):
            chosen = BRAND_COVER; src = "品牌横幅兜底"
        else:
            return {"status":"fail","error":"无可用封面图"}
    r = set_cover(doc_url, chosen)
    if tmp_rel:
        try: os.unlink(os.path.join(CWD, tmp_rel))
        except: pass
    if r.get("ok"):
        return {"status":"ok","source":src}
    return {"status":"fail","step":"resource-update","error":r.get("error",{})}

def batch_from_ledger(ledger_path=os.path.join(CWD,"采编台账.json")):
    l = json.load(open(ledger_path, encoding="utf-8"))
    ok=fail=skip=0
    for src_tok, rec in l.get("collected",{}).items():
        node = rec.get("new_node","")
        if not node: continue
        url = f"https://my.feishu.cn/wiki/{node}"
        r = add_cover(url)
        if r["status"]=="ok":
            ok+=1; print(f"OK  {rec.get('new_title','')[:40]} | {r['source']}")
        else:
            fail+=1; print(f"ERR {rec.get('new_title','')[:40]} | {r.get('error',r.get('error',{}))}")
        time.sleep(0.4)
    print(f"\n批量封面完成: 成功 {ok}, 失败 {fail}")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--ledger":
        batch_from_ledger()
    elif len(sys.argv) > 1:
        url = sys.argv[1]
        print(json.dumps(add_cover(url), ensure_ascii=False, indent=1))
    else:
        print("用法: add_cover.py <wiki_url>  或  add_cover.py --ledger")
