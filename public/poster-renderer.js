// Ported from SubCast src/lib/poster.ts (baeb1ec).
import qrcode from "./poster-qrcode.js";
const SYS_SERIF = '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif';
const LATIN = 'Georgia, "Times New Roman", serif';
const SANS = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const NO_START = /^[，。、：；！？）」』》”’,.;:!?)\]…—]/;
export const CJK = /[一-鿿]/;
/** Open-source Chinese fonts (the same set as elon.qiaomu.ai), loaded from public CDNs only when picked. */
export const POSTER_FONTS = [
    { id: "sys", name: "系统宋体", family: SYS_SERIF, weight: 500 },
    { id: "serif", name: "思源宋体", family: '"Noto Serif SC"', css: "https://fonts.googleapis.cn/css2?family=Noto+Serif+SC:wght@500;700&display=swap", weight: 500 },
    { id: "kai", name: "霞鹜文楷", family: '"LXGW WenKai Screen"', css: "https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/lxgwwenkaiscreen.css", weight: 400 },
    { id: "song", name: "京华老宋体", family: '"KingHwa_OldSong"', css: "https://cdn.jsdelivr.net/npm/@chinese-fonts/jhlst@3.0.0/dist/%E4%BA%AC%E8%8F%AF%E8%80%81%E5%AE%8B%E4%BD%93v2_002/result.css", weight: 400 },
    { id: "sans", name: "思源黑体", family: '"Noto Sans SC"', css: "https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@500;700&display=swap", weight: 500, sans: true },
];
export const POSTER_THEMES = [
    { id: "paper", layout: "classic", style: "经典", name: "纸白", bg: "#faf8f3", ink: "#17181b", soft: "#4f525a", muted: "#8b8e96", accent: "#e8582a", rule: "#dedbd3" },
    { id: "warm", layout: "magazine", style: "杂志", name: "暖橙", bg: "#fdf1e8", bg2: "#f9dcc8", ink: "#2a1a12", soft: "#6b4a3a", muted: "#a07e6c", accent: "#d9481a", rule: "#efcfb9" },
    { id: "night", layout: "cinema", style: "电影", name: "墨夜", bg: "#151515", bg2: "#232120", ink: "#efebe4", soft: "#b9b4ab", muted: "#7f7b74", accent: "#ff7a45", rule: "#34312d" },
    { id: "bamboo", layout: "frame", style: "书签", name: "竹青", bg: "#eef1ea", ink: "#1d3328", soft: "#45604f", muted: "#7f9184", accent: "#2f7a55", rule: "#d3dccf" },
    { id: "sand", layout: "timecode", style: "时间码", name: "砂岩", bg: "#ebe4d8", ink: "#2b2622", soft: "#5d544b", muted: "#8f857a", accent: "#9c4a2f", rule: "#d4cab9" },
];
const loaded = new Map();
export function loadCss(href) {
    let p = loaded.get(href);
    if (!p) {
        p = new Promise((res, rej) => {
            const l = document.createElement("link");
            l.rel = "stylesheet";
            l.href = href;
            l.onload = () => res();
            l.onerror = () => { loaded.delete(href); rej(new Error("font css")); };
            document.head.appendChild(l);
        });
        loaded.set(href, p);
    }
    return p;
}
/** Loads the font's slices that cover `text`. Resolves false when it can't (offline): the poster then uses system fonts. */
export async function loadPosterFont(f, text) {
    if (!f.css)
        return true;
    const timeout = new Promise((r) => setTimeout(() => r(false), 12000));
    const go = (async () => {
        await loadCss(f.css);
        await Promise.all([document.fonts.load(`${f.weight} 50px ${f.family}`, text), document.fonts.load(`700 30px ${f.family}`, text)]);
        return document.fonts.check(`${f.weight} 50px ${f.family}`, text.slice(0, 20) || "字"); // i18n-ignore: a probe glyph, never shown
    })().catch(() => false);
    return Promise.race([go, timeout]);
}
function wrap(g, text, maxW, maxLines) {
    const toks = text.match(/[A-Za-z0-9'’\-.,;:!?%$]+\s*|\s+|./gu) || [];
    const lines = [];
    let line = "";
    for (const t of toks) {
        if (!line && /^\s+$/.test(t))
            continue;
        const test = line + t;
        if (g.measureText(test.trimEnd()).width > maxW && line) {
            if (NO_START.test(t) && line.length > 1) {
                lines.push(line.slice(0, -1).trimEnd());
                line = line.slice(-1) + t;
            }
            else {
                lines.push(line.trimEnd());
                line = /^\s+$/.test(t) ? "" : t;
            }
            if (lines.length === maxLines)
                break;
        }
        else
            line = test;
    }
    if (lines.length < maxLines && line.trim())
        lines.push(line.trimEnd());
    const used = lines.join("").replace(/\s/g, "").length;
    if (used < text.replace(/\s/g, "").length - 1 && lines.length) {
        let last = lines[lines.length - 1];
        while (last.length && g.measureText(last + "……").width > maxW)
            last = last.slice(0, -1);
        lines[lines.length - 1] = last + "……";
    }
    return lines;
}
/** Draws text vertically centred on `cy` (by its real glyph box), so a mark beside it lines up. */
function midText(g, text, x, cy) {
    const m = g.measureText(text);
    g.fillText(text, x, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
    return m.width;
}
export function drawPoster(o, logo, theme = POSTER_THEMES[0], font = POSTER_FONTS[0]) {
    const L = theme.layout;
    const W = 1080, P = L === "frame" ? 130 : 100, CW = W - P * 2;
    const center = L === "cinema" || L === "frame";
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    const F = `${font.family}, ${font.sans ? SANS : SYS_SERIF}`;
    const zh = o.zh, en = o.en && o.en !== zh ? o.en : "";
    // The quote sets the size: short quotes go big, long ones step down so the poster stays readable.
    const len = (zh || en).length;
    const zhSize = (len > 160 ? 40 : len > 100 ? 46 : len > 50 ? 54 : 62) + (L === "magazine" && len <= 50 ? 6 : 0);
    g.font = `${font.weight} ${zhSize}px ${F}`;
    const zhFont = g.font, zhLines = zh ? wrap(g, zh, CW, 14) : [], zhLH = Math.round(zhSize * 1.68);
    const enSize = zh ? 28 : zhSize - 6;
    g.font = `italic ${enSize}px ${LATIN}`;
    const enFont = g.font, enLines = en ? wrap(g, en, CW, zh ? 6 : 14) : [], enLH = Math.round(enSize * 1.55);
    g.font = `400 30px ${F}`;
    const titleFont = g.font, titleLines = o.title ? wrap(g, o.title, CW, 2) : [];
    const MARK = L === "classic" ? 150 : L === "timecode" ? 60 : L === "cinema" ? 110 : 80;
    let body = MARK + zhLines.length * zhLH + (zhLines.length && enLines.length ? 40 : 0) + enLines.length * enLH;
    body += 96 + 46 + titleLines.length * 46 + (o.meta ? 44 : 0);
    const HEAD = L === "magazine" ? 330 : L === "frame" ? 240 : 200, FOOT = 120 + 260 + P;
    const H = Math.max(1350, HEAD + body + FOOT);
    c.width = W;
    c.height = H;
    const top = HEAD + Math.max(0, (H - HEAD - FOOT - body) / 2) + MARK;
    const xAt = (w) => (center ? (W - w) / 2 : P);
    // background
    if (theme.bg2) {
        const gr = g.createLinearGradient(0, 0, W * 0.4, H);
        gr.addColorStop(0, theme.bg);
        gr.addColorStop(1, theme.bg2);
        g.fillStyle = gr;
    }
    else
        g.fillStyle = theme.bg;
    g.fillRect(0, 0, W, H);
    g.textBaseline = "alphabetic";
    // --- layout decoration and masthead ---
    const kick = o.show || "文章摘句";
    const fit = (text, max) => { let s = text; while (g.measureText(s).width > max && s.length > 2)
        s = s.slice(0, -2) + "…"; return s; };
    if (L === "magazine") {
        // A full-width colour band carrying the show's name in large type.
        g.fillStyle = theme.accent;
        g.fillRect(0, 0, W, 250);
        g.fillStyle = "#ffffff";
        g.font = `700 22px ${SANS}`;
        g.globalAlpha = 0.85;
        g.fillText("QMREADER  ·  " + "文章摘句", P, 78);
        g.globalAlpha = 1;
        g.font = `700 64px ${LATIN}`;
        g.fillText(fit(kick, CW), P, 180);
    }
    else if (L === "cinema") {
        // Letterbox bars and a centred time code, like a film subtitle frame.
        g.fillStyle = "#000000";
        g.fillRect(0, 0, W, 64);
        g.fillRect(0, H - 64, W, 64);
        g.font = `600 24px ${SANS}`;
        g.fillStyle = theme.muted;
        const head = `QMReader  ·  ${fit(kick, 600)}`;
        g.fillText(head, (W - g.measureText(head).width) / 2, 140);
    }
    else if (L === "frame") {
        // A thin frame with corner marks, like a bookmark.
        const m = 56;
        g.strokeStyle = theme.accent;
        g.lineWidth = 2;
        g.strokeRect(m, m, W - m * 2, H - m * 2);
        g.lineWidth = 6;
        const k = 34;
        for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
            g.beginPath();
            g.moveTo(x + dx * k, y);
            g.lineTo(x, y);
            g.lineTo(x, y + dy * k);
            g.stroke();
        }
        g.font = `500 26px ${F}`;
        g.fillStyle = theme.soft;
        const head = fit(kick, CW);
        g.fillText(head, (W - g.measureText(head).width) / 2, 170);
        g.fillStyle = theme.accent;
        g.fillRect(W / 2 - 20, 196, 40, 3);
    }
    else {
        if (L === "timecode" && o.ts) {
            // The moment in the episode, huge and faint behind the quote.
            g.save();
            g.globalAlpha = 0.09;
            g.fillStyle = theme.accent;
            g.font = `700 300px ${SANS}`;
            const tw = g.measureText(o.ts).width;
            g.fillText(o.ts, W - P - tw + 20, top + 120);
            g.restore();
        }
        if (logo)
            g.drawImage(logo, P, 84, 46, 46);
        g.fillStyle = theme.ink;
        g.font = `700 30px ${SANS}`;
        g.fillText("QMReader", P + (logo ? 60 : 0), 118);
        g.font = `500 24px ${F}`;
        g.fillStyle = theme.soft;
        const k = fit(kick, CW - 260);
        g.fillText(k, W - P - g.measureText(k).width, 116);
        g.fillStyle = theme.rule;
        g.fillRect(P, 158, CW, 2);
    }
    // --- quote ---
    if (L === "classic") {
        g.fillStyle = theme.accent;
        g.font = `700 180px ${LATIN}`;
        g.fillText("“", P - 10, top - 10);
    }
    else if (L === "magazine") {
        g.fillStyle = theme.accent;
        g.fillRect(P, top - 44, 80, 8);
    }
    else if (L === "cinema" && o.ts) {
        g.font = `600 30px ${SANS}`;
        g.fillStyle = theme.accent;
        const tw = g.measureText(o.ts).width;
        g.fillText(o.ts, (W - tw) / 2, top - 40);
    }
    else if (L === "frame") {
        g.fillStyle = theme.accent;
        g.font = `700 90px ${LATIN}`;
        const tw = g.measureText("“").width;
        g.fillText("“", (W - tw) / 2, top - 4);
    }
    else if (L === "timecode") {
        g.fillStyle = theme.accent;
        g.font = `700 26px ${SANS}`;
        g.fillText(o.ts ? `▶ ${o.ts}` : "▶", P, top - 24);
    }
    let y = top;
    g.fillStyle = theme.ink;
    g.font = zhFont;
    zhLines.forEach((ln) => { y += zhLH; g.fillText(ln, xAt(g.measureText(ln).width), y - zhLH * 0.28); });
    if (zhLines.length && enLines.length)
        y += 40;
    g.fillStyle = zh ? theme.muted : theme.ink;
    g.font = enFont;
    enLines.forEach((ln) => { y += enLH; g.fillText(ln, xAt(g.measureText(ln).width), y - enLH * 0.25); });
    // --- source: the show, the episode, the date and time ---
    y += 96;
    g.font = `700 32px ${F}`;
    const show = fit(o.show || "文章", CW - (center ? 0 : 60));
    const showW = g.measureText(show).width;
    const barW = center ? 0 : 40, gap = center ? 0 : 20;
    const sx = center ? (W - showW) / 2 : P;
    if (!center) {
        g.fillStyle = theme.accent;
        g.fillRect(sx, y - 2, barW, 4);
    }
    g.fillStyle = theme.ink;
    midText(g, show, sx + barW + gap, y);
    y += 58;
    g.fillStyle = theme.soft;
    g.font = titleFont;
    titleLines.forEach((ln) => { g.fillText(ln, xAt(g.measureText(ln).width), y); y += 46; });
    if (o.meta) {
        g.font = `400 24px ${SANS}`;
        g.fillStyle = theme.muted;
        g.fillText(o.meta, xAt(g.measureText(o.meta).width), y + 4);
    }
    // --- footer: slogan left, QR right ---
    const S = 210, fy = H - P - S - (L === "cinema" ? 30 : 0);
    if (L !== "frame") {
        g.fillStyle = theme.rule;
        g.fillRect(P, fy - 44, CW, 2);
    }
    g.fillStyle = theme.ink;
    g.font = `700 36px ${SANS}`;
    g.fillText("QMReader", P, fy + 52);
    g.font = `400 25px ${SANS}`;
    g.fillStyle = theme.soft;
    g.fillText("RSS 阅读 · 中文翻译 · 划线与 AI 问答", P, fy + 100);
    if (o.url) {
        g.fillStyle = theme.accent;
        g.font = `600 25px ${SANS}`;
        g.fillText("扫码阅读文章 →", P, fy + 158);
        try {
            const qr = qrcode(0, "M");
            qr.addData(o.url);
            qr.make();
            const n = qr.getModuleCount(), q = 12, cell = (S - q * 2) / n, qx = W - P - S, qy = fy;
            g.fillStyle = "#ffffff";
            g.beginPath();
            if (g.roundRect)
                g.roundRect(qx, qy, S, S, 16);
            else
                g.rect(qx, qy, S, S);
            g.fill();
            g.fillStyle = "#16171a";
            for (let r = 0; r < n; r++)
                for (let k = 0; k < n; k++)
                    if (qr.isDark(r, k))
                        g.fillRect(qx + q + k * cell, qy + q + r * cell, Math.ceil(cell), Math.ceil(cell));
        }
        catch { /* URL only */ }
    }
    return c;
}
