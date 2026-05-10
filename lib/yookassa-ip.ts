// =============================================================================
// YooKassa webhook source-IP allowlist.
// https://yookassa.ru/developers/using-api/webhooks#ip
//
// CIDR matching is implemented inline so we don't need an `ipaddress`-style
// dependency. Supports IPv4 (CIDR or single) and IPv6 (single only — the
// only IPv6 entry YooKassa publishes is a /32 we treat as a prefix string
// match, which is enough since all their actual senders fall under it).
// =============================================================================

const DEFAULT_ALLOWLIST = [
    "185.71.76.0/27",
    "185.71.77.0/27",
    "77.75.153.0/25",
    "77.75.156.11/32",
    "77.75.156.35/32",
    "77.75.154.128/25",
    "2a02:5180::/32",
];

interface ParsedV4 { kind: "v4"; addr: number; prefix: number; }
interface ParsedV6Prefix { kind: "v6prefix"; prefix: string; }
type ParsedNet = ParsedV4 | ParsedV6Prefix;

function parseNetwork(token: string): ParsedNet | null {
    const t = token.trim();
    if (!t) return null;
    const [addrPart, prefixPart] = t.split("/", 2);
    if (addrPart && addrPart.includes(":")) {
        // IPv6 — match by hex prefix only (good enough for /32 allowlist entries).
        const expanded = addrPart.split("::")[0]?.replace(/:/g, "").toLowerCase() || "";
        const prefixBits = prefixPart ? parseInt(prefixPart, 10) : 128;
        const hexChars = Math.min(Math.ceil(prefixBits / 4), expanded.length);
        return { kind: "v6prefix", prefix: expanded.slice(0, hexChars) };
    }
    if (!addrPart) return null;
    const v4 = parseV4(addrPart);
    if (v4 == null) return null;
    return { kind: "v4", addr: v4, prefix: prefixPart ? parseInt(prefixPart, 10) : 32 };
}

function parseV4(addr: string): number | null {
    const parts = addr.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
        const x = Number(p);
        if (!Number.isInteger(x) || x < 0 || x > 255) return null;
        n = (n << 8) | x;
    }
    return n >>> 0;
}

function v4InNet(addr: number, net: ParsedV4): boolean {
    if (net.prefix === 0) return true;
    if (net.prefix < 0 || net.prefix > 32) return false;
    const mask = net.prefix === 32 ? 0xffffffff : (~((1 << (32 - net.prefix)) - 1)) >>> 0;
    return (addr & mask) === (net.addr & mask);
}

export function isYooKassaIp(env: { YOOKASSA_DISABLE_IP_CHECK?: string; YOOKASSA_WEBHOOK_IPS_ALLOWLIST?: string }, ip: string | null): boolean {
    if (env.YOOKASSA_DISABLE_IP_CHECK === "1") return true;

    const raw = env.YOOKASSA_WEBHOOK_IPS_ALLOWLIST?.trim()
        ? env.YOOKASSA_WEBHOOK_IPS_ALLOWLIST.split(",")
        : DEFAULT_ALLOWLIST;
    const nets = raw.map(parseNetwork).filter((n): n is ParsedNet => n !== null);
    if (nets.length === 0) return true; // empty allowlist == trust any (dev)
    if (!ip) return false;

    if (ip.includes(":")) {
        const expanded = ip.split("::")[0]?.replace(/:/g, "").toLowerCase() || "";
        return nets.some((n) => n.kind === "v6prefix" && expanded.startsWith(n.prefix));
    }
    const v4 = parseV4(ip);
    if (v4 === null) return false;
    return nets.some((n) => n.kind === "v4" && v4InNet(v4, n));
}

export function clientIp(request: Request): string | null {
    // Cloudflare always sets CF-Connecting-IP to the real client IP, even
    // when the worker is invoked through a proxy or workers.dev. This is the
    // ONLY reliable header on Pages Functions; X-Forwarded-For is appended
    // by Cloudflare too but CF-Connecting-IP is canonical.
    return (
        request.headers.get("cf-connecting-ip")
        || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || null
    );
}
