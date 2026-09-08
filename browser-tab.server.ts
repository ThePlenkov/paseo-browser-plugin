import type { output as ZodOutput } from "zod";
import { linkList, navigate } from "./browser-tab.shared";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return match[1].trim().slice(0, 500);
}

function extractLinks(html: string, baseUrl: string): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(html)) !== null && count < 200) {
    const href = m[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    const text = m[2].replace(/<[^>]+>/g, "").trim().slice(0, 200);
    if (!text) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    links.push({ text, href: abs });
    count++;
  }
  return links;
}

export async function handleNavigate({
  url,
}: ZodOutput<typeof navigate.input>): Promise<ZodOutput<typeof navigate.output>> {
  const target = normalizeUrl(url);
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": "Paseo-Browser-Tab-Plugin/0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = res.headers.get("content-type") ?? "unknown";
    const finalUrl = res.url || target;
    const html = await res.text();
    return {
      url: target,
      finalUrl,
      status: res.status,
      contentType,
      title: extractTitle(html),
      html,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      url: target,
      finalUrl: target,
      status: 0,
      contentType: "unknown",
      title: null,
      html: "",
      error: msg,
    };
  }
}

export async function handleLinks({
  url,
}: ZodOutput<typeof linkList.input>): Promise<ZodOutput<typeof linkList.output>> {
  const target = normalizeUrl(url);
  try {
    const res = await fetch(target, {
      headers: { "User-Agent": "Paseo-Browser-Tab-Plugin/0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    return { links: extractLinks(html, res.url || target), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { links: [], error: msg };
  }
}
