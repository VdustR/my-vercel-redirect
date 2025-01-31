import urlJoin from "url-join";
const myDomain = process.env.DOMAIN ?? "vdustr.dev";
function defineSubdomainMap(map) {
    return map;
}
const defaultStatus = 307;
const defaultCacheControl = "public, max-age=3600, must-revalidate";
const subdomainMap = defineSubdomainMap({
    blog: "https://vdustr.dev/blog",
    dc: "https://ganhuaking.tw/",
    fb: "https://fb.me/vdustr",
    gh: "https://github.com/vdustr",
    r: "https://www.reddit.com/u/vp_tw",
    t: "https://twitter.com/vp_tw",
    x: "https://x.com/vp_tw",
});
export default function middleware(request) {
    const url = new URL(request.url);
    const domain = url.hostname;
    const matchedSubdomainOptions = Object.entries(subdomainMap).flatMap(([subdomain, options]) => {
        if (domain === `${subdomain}.${myDomain}`) {
            return [options];
        }
        return [];
    })[0];
    if (!matchedSubdomainOptions) {
        return new Response(null, {
            status: 404,
        });
    }
    const pathAndHash = `${url.pathname}${url.search}${url.hash}`;
    const target = typeof matchedSubdomainOptions === "string"
        ? matchedSubdomainOptions
        : matchedSubdomainOptions.target;
    const status = typeof matchedSubdomainOptions === "string" ||
        !("status" in matchedSubdomainOptions)
        ? defaultStatus
        : matchedSubdomainOptions.status;
    const cacheControl = typeof matchedSubdomainOptions === "string" ||
        !("cacheControl" in matchedSubdomainOptions)
        ? defaultCacheControl
        : matchedSubdomainOptions.cacheControl;
    return new Response(null, {
        status,
        headers: {
            Location: urlJoin(target, pathAndHash),
            "Cache-Control": cacheControl,
        },
    });
}
