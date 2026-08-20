declare const process: {
  env: Record<string, string | undefined>;
};

const domain = process.env["DOMAIN"] ?? "vdustr.dev";

const redirects = {
  [domain]: "https://vdustr.github.io",
  [`blog.${domain}`]: `https://${domain}/blog`,
} as const satisfies Record<string, string>;

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const destination = redirects[url.hostname];

  if (!destination) {
    return new Response(null, { status: 404 });
  }

  const targetUrl = new URL(url.pathname.slice(1), `${destination}/`);
  targetUrl.search = url.search;

  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control":
        url.hostname === domain
          ? "private, no-store"
          : "public, max-age=3600, must-revalidate",
      Location: targetUrl.toString(),
    },
  });
}
