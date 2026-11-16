#!/usr/bin/env python3
"""为三国新增人物补百科档案层（facts + refs）。

facts 只写史传可考的硬信息（生卒、籍贯、官职、身份），
refs 只给维基/百度外链，不复制百科正文——与既有 39 人的口径一致。
"""
import json
import os
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "works", "sanguo", "encyclopedia.json")

# id: (姓名, 生卒, 籍贯, 官职/爵位, 身份)
FACTS = {
    "cao-ren": ("曹仁", "168年—223年", "沛国谯县（今安徽亳州）", "大司马", "曹魏宗室名将"),
    "xiahou-yuan": ("夏侯渊", "？—219年", "沛国谯县（今安徽亳州）", "征西将军", "曹魏宗室名将"),
    "dian-wei": ("典韦", "？—197年", "陈留己吾（今河南宁陵）", "都尉", "曹操亲卫将领"),
    "xu-chu-2": ("徐晃", "？—227年", "河东杨县（今山西洪洞）", "右将军", "曹魏五子良将之一"),
    "zhang-he": ("张郃", "？—231年", "河间鄚县（今河北任丘）", "征西车骑将军", "曹魏五子良将之一"),
    "jia-xu": ("贾诩", "147年—223年", "武威姑臧（今甘肃武威）", "太尉", "曹魏谋士"),
    "cheng-yu": ("程昱", "141年—220年", "东郡东阿（今山东东阿）", "卫尉", "曹操早期谋士"),
    "sima-zhao": ("司马昭", "211年—265年", "河内温县（今河南温县）", "晋王", "曹魏权臣、晋朝奠基者"),
    "deng-ai": ("邓艾", "197年—264年", "义阳棘阳（今河南新野）", "太尉", "灭蜀主将"),
    "zhong-hui": ("钟会", "225年—264年", "颍川长社（今河南长葛）", "司徒", "伐蜀主帅"),
    "guan-ping": ("关平", "？—220年", "河东解县（今山西运城）", "—", "关羽之子"),
    "liao-hua": ("廖化", "？—264年", "襄阳（今湖北襄阳）", "右车骑将军", "蜀汉将领"),
    "wei-yan": ("魏延", "？—234年", "义阳（今河南桐柏）", "前军师、征西大将军", "蜀汉将领"),
    "fa-zheng": ("法正", "176年—220年", "扶风郿县（今陕西眉县）", "尚书令", "刘备谋主"),
    "jiang-wan": ("蒋琬", "？—246年", "零陵湘乡（今湖南湘乡）", "大将军、录尚书事", "蜀汉执政"),
    "ma-dai": ("马岱", "生卒不详", "扶风茂陵（今陕西兴平）", "平北将军", "蜀汉将领"),
    "taishi-ci": ("太史慈", "166年—206年", "东莱黄县（今山东龙口）", "建昌都尉", "东吴名将"),
    "lu-meng-2": ("陆抗", "226年—274年", "吴郡吴县（今江苏苏州）", "大司马、荆州牧", "东吴后期名将"),
    "kan-ze": ("阚泽", "170年—243年", "会稽山阴（今浙江绍兴）", "中书令", "东吴谋士"),
    "xu-sheng": ("徐盛", "？—228年", "琅邪莒县（今山东莒县）", "安东将军", "东吴将领"),
    "zhang-jiao": ("张角", "？—184年", "巨鹿（今河北平乡）", "—", "黄巾起义首领"),
    "hua-tuo": ("华佗", "约145年—208年", "沛国谯县（今安徽亳州）", "—", "汉末名医"),
    "mi-heng": ("祢衡", "173年—198年", "平原般县（今山东临邑）", "—", "汉末文士"),
    "kong-rong": ("孔融", "153年—208年", "鲁国（今山东曲阜）", "北海相、少府", "建安七子之一"),
    "tao-qian": ("陶谦", "132年—194年", "丹阳（今安徽当涂）", "徐州牧", "汉末州牧"),
    "gongsun-zan": ("公孙瓒", "？—199年", "辽西令支（今河北迁安）", "前将军", "汉末军阀"),
    "ma-teng": ("马腾", "？—212年", "扶风茂陵（今陕西兴平）", "卫尉", "西凉军阀"),
    "yan-liang": ("颜良", "？—200年", "琅邪临沂（今山东临沂）", "—", "袁绍部将"),
    "wen-chou": ("文丑", "？—200年", "生卒籍贯不详", "—", "袁绍部将"),
    "tian-feng": ("田丰", "？—200年", "巨鹿（今河北平乡）", "别驾", "袁绍谋士"),
    "ju-shou": ("沮授", "？—200年", "广平（今河北邯郸）", "监军、奋威将军", "袁绍谋士"),
    "zhang-xiu": ("张绣", "？—207年", "武威祖厉（今甘肃靖远）", "破羌将军", "汉末军阀"),
}


def refs(name):
    q = urllib.parse.quote(name)
    return [
        {"label": "维基百科", "url": f"https://zh.wikipedia.org/wiki/{q}"},
        {"label": "百度百科", "url": f"https://baike.baidu.com/item/{q}"},
    ]


def main():
    with open(PATH, encoding="utf-8") as f:
        enc = json.load(f)

    data = json.load(open(os.path.join(ROOT, "works", "sanguo", "data.json"), encoding="utf-8"))
    ids = [c["id"] for c in data["characters"]]

    added = 0
    for cid in ids:
        if cid in enc["characters"]:
            continue
        if cid not in FACTS:
            raise SystemExit(f"缺少 {cid} 的事实数据")
        name, life, place, office, identity = FACTS[cid]
        enc["characters"][cid] = {
            "facts": [
                {"label": "生卒", "value": life},
                {"label": "籍贯", "value": place},
                {"label": "官职 / 爵位", "value": office},
                {"label": "身份", "value": identity},
            ],
            "refs": refs(name),
        }
        added += 1

    # 删除已不在人物表中的人物档案（保持 set 一致）
    enc["characters"] = {k: v for k, v in enc["characters"].items() if k in set(ids)}

    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(enc, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"新增百科档案 {added} 条，合计 {len(enc['characters'])} 条")


if __name__ == "__main__":
    main()
